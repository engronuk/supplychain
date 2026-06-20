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

ShipmentStatus = Literal[
    "created", "ready_for_dispatch", "assigned", "loaded",
    "in_transit", "arrived", "delivered", "cancelled",
    # Legacy values still present in production data until backfill migration v2
    # completes. They are kept here so the type checker doesn't reject them on
    # read; new writes MUST use the 8-state canonical set above.
    "pending", "received", "shipped",
]
VehicleStatus = Literal["available", "loading", "in_transit", "maintenance", "offline"]
DriverStatus  = Literal["available", "assigned", "on_trip", "offline"]
VehicleType   = Literal["truck", "van", "pickup", "trailer", "motorcycle"]
RequestStatus = Literal["pending", "approved", "rejected", "fulfilled"]
POStatus = Literal[
    "draft", "submitted", "approved", "processing",
    "shipped", "delivered", "cancelled", "rejected",
]
QuoteStatus = Literal["open", "responded", "closed", "expired"]
PartyRole = Literal["manufacturer", "distributor", "retailer", "wholesaler", "warehouse"]

# Universal organization architecture.
# Order matters in this list — it follows the natural supply-chain hierarchy
# (manufacturer → warehouse → distributor → wholesaler → retailer)
# with logistics_provider as a cross-cutting partner type.
OrganizationType = Literal[
    "manufacturer", "warehouse", "distributor",
    "wholesaler", "retailer", "logistics_provider",
]
OrganizationStatus = Literal["active", "inactive", "suspended"]

# Cross-tier supply-chain relationships (in addition to the canonical
# `parent_organization_id` hierarchy). These power many-to-many links —
# e.g. one distributor serving multiple manufacturers, or a logistics
# provider serving multiple distributors.
OrganizationRelationshipType = Literal[
    "supplies",          # from supplies products to → to
    "distributes_for",   # from (distributor) distributes for → to (manufacturer)
    "warehouses_for",    # from (warehouse) stores goods for → to
    "logistics_for",     # from (logistics_provider) ships for → to
    "partner",           # generic partnership
]
OrganizationRelationshipStatus = Literal["active", "pending", "ended"]

# Allowed parent/child relationships per type — used by the API to validate
# hierarchy edits and to derive what each role can create.
#
# The full supply-chain tree is:
#   Manufacturer → Warehouse → Distributor → Wholesaler → Retailer
# We also keep `manufacturer → distributor` as a legal direct path so that
# small operators / pilot tenants who don't (yet) run their own warehouse
# network can still onboard distributors directly.
ORG_CHILDREN_ALLOWED: dict[str, list[str]] = {
    "manufacturer":      ["warehouse", "distributor"],
    "warehouse":         ["distributor"],
    "distributor":       ["wholesaler"],
    "wholesaler":        ["retailer"],
    "retailer":          [],
    "logistics_provider": [],
}


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
