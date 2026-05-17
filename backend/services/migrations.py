"""Idempotent index management — Mongo-equivalent of schema migrations.

MongoDB is schemaless, so there are no DDL migrations. What matters for
correctness + scale is having the right indexes on the right collections.
This module is idempotent — running it twice is a no-op.
"""
from __future__ import annotations

from typing import List, Tuple

from pymongo import ASCENDING, DESCENDING

from core import db, logger

# (collection_name, [(field, direction)], options)
INDEX_SPECS: List[Tuple[str, list, dict]] = [
    # Master data
    ("manufacturers", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("distributors", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("distributors", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),
    ("retailers", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("retailers", [("distributor_id", ASCENDING)], {"name": "by_distributor"}),
    ("retailers", [("region", ASCENDING), ("city", ASCENDING)], {"name": "by_region_city"}),
    ("products", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("products", [("sku", ASCENDING)], {"name": "by_sku"}),
    ("products", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),

    # Hot path — inventory rollups
    ("inventory", [("owner_type", ASCENDING), ("owner_id", ASCENDING)], {"name": "by_owner"}),
    ("inventory", [("owner_type", ASCENDING), ("owner_id", ASCENDING), ("product_id", ASCENDING)],
     {"unique": True, "name": "uniq_owner_product"}),

    # Shipments
    ("shipments", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("shipments", [("distributor_id", ASCENDING)], {"name": "by_distributor"}),
    ("shipments", [("retailer_id", ASCENDING)], {"name": "by_retailer"}),
    ("shipments", [("manufacturer_id", ASCENDING)], {"name": "by_manufacturer"}),
    ("shipments", [("to_role", ASCENDING), ("to_id", ASCENDING)], {"name": "by_destination"}),
    ("shipments", [("from_role", ASCENDING), ("from_id", ASCENDING)], {"name": "by_source"}),
    ("shipments", [("status", ASCENDING), ("created_at", DESCENDING)], {"name": "by_status_recent"}),

    # Requests
    ("requests", [("id", ASCENDING)], {"unique": True, "name": "uniq_id"}),
    ("requests", [("distributor_id", ASCENDING), ("status", ASCENDING)], {"name": "by_distributor_status"}),
    ("requests", [("retailer_id", ASCENDING), ("status", ASCENDING)], {"name": "by_retailer_status"}),

    # Notifications
    ("notifications", [("target_type", ASCENDING), ("target_id", ASCENDING), ("created_at", DESCENDING)],
     {"name": "by_target_recent"}),

    # Daily sales (analytics-heavy)
    ("daily_sales", [("retailer_id", ASCENDING), ("date", ASCENDING)], {"name": "by_retailer_date"}),
    ("daily_sales", [("product_id", ASCENDING), ("date", ASCENDING)], {"name": "by_product_date"}),
]


async def ensure_indexes() -> dict:
    """Create all required indexes idempotently. Safe to run on every boot.

    Returns a summary with the count created vs already present.
    """
    ensured, failed = 0, 0
    for coll, keys, opts in INDEX_SPECS:
        try:
            await db[coll].create_index(keys, **opts)
            ensured += 1
        except Exception as e:
            failed += 1
            logger.warning("Index ensure failed on %s %s: %s", coll, keys, e)
    return {
        "indexes_ensured": ensured,
        "indexes_failed": failed,
        "total_specs": len(INDEX_SPECS),
    }
