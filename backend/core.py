"""Shared core: env-driven Mongo client, logger, type literals, tiny utils.

All routers and services import db / utils from here so we never duplicate the
client or re-load the .env file in multiple places.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tradekonekt")

ShipmentStatus = Literal["pending", "in_transit", "received"]
RequestStatus = Literal["pending", "approved", "rejected", "fulfilled"]
PartyRole = Literal["manufacturer", "distributor", "retailer"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def clean(doc: dict | None) -> dict | None:
    """Strip Mongo's _id from a document copy."""
    if not doc:
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d
