"""Idempotent data backfills.

Unlike `migrations.py` (which only manages indexes), this module mutates
documents to keep older rows compatible with newer schema fields. Each
function is safe to re-run.
"""
from __future__ import annotations

from core import db, logger, now_iso


async def backfill_wholesaler_orders_customer_fields() -> dict:
    """Stamp ``customer_type`` / ``customer_id`` / ``customer`` on every
    legacy ``wholesaler_orders`` document.

    The collection was originally written with the (now-deprecated) "distributor
    submits orders to wholesaler" semantics. Per the foundational supply-chain
    spec ("Distributors serve Wholesalers; Retailers order from Wholesalers"),
    the canonical customer of a wholesaler is a retailer; distributors remain
    valid for back-compat and key-account flows.

    This backfill normalises legacy rows to the customer-neutral shape so
    every list / detail / dashboard endpoint can treat them uniformly.
    """
    updated = 0
    cursor = db.wholesaler_orders.find(
        {"customer_type": {"$exists": False}},
        {"_id": 0, "id": 1, "distributor_id": 1, "distributor": 1},
    )
    async for row in cursor:
        dist = row.get("distributor") or {}
        customer = {
            "id": row.get("distributor_id") or dist.get("id") or "",
            "name": dist.get("name") or "",
            "code": dist.get("code") or "",
            "region": dist.get("region") or "",
            "city": dist.get("city") or "",
            "type": "distributor",
        }
        res = await db.wholesaler_orders.update_one(
            {"id": row["id"], "customer_type": {"$exists": False}},
            {"$set": {
                "customer_type": "distributor",
                "customer_id": row.get("distributor_id") or "",
                "customer": customer,
                "migrated_at": now_iso(),
            }},
        )
        if res.modified_count:
            updated += 1
    if updated:
        logger.info("wholesaler_orders backfill: stamped customer fields on %s rows", updated)
    return {"wholesaler_orders_customer_backfill": updated}


async def run_all() -> dict:
    """Entry point — extend as more backfills are added."""
    out: dict = {}
    out.update(await backfill_wholesaler_orders_customer_fields())
    return out
