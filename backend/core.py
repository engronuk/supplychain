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
# Atlas-friendly client tunings. Defaults (no timeout / 30s server selection)
# can cause indefinite hangs and worker restarts on a slow write or a brief
# network blip. These tighter, explicit limits surface failures fast and let
# us retry at the application layer.
client = AsyncIOMotorClient(
    mongo_url,
    serverSelectionTimeoutMS=10_000,
    connectTimeoutMS=10_000,
    socketTimeoutMS=45_000,
    retryWrites=True,
    retryReads=True,
    maxPoolSize=50,
    minPoolSize=2,
)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("tradekonekt")

ShipmentStatus = Literal["pending", "in_transit", "received"]
RequestStatus = Literal["pending", "approved", "rejected", "fulfilled"]
POStatus = Literal[
    "draft", "submitted", "approved", "processing",
    "shipped", "delivered", "cancelled", "rejected",
]
QuoteStatus = Literal["open", "responded", "closed", "expired"]
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
