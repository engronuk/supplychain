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


async def backfill_inventory_missing_fields() -> dict:
    """Stamp ``id`` (uuid) and ``reorder_level`` on every legacy
    ``inventory`` document that lacks them.

    Older seeders inserted inventory rows without the ``id`` field (only
    Mongo's ``_id``) and without ``reorder_level`` — which crashes the
    retailer Inventory Command Center and the simulator's retail-sale
    generator.  Defaults: ``reorder_level = max(10, 20% of quantity)``.
    """
    import uuid
    n_id = 0
    n_reorder = 0
    cursor = db.inventory.find(
        {"$or": [{"id": {"$exists": False}}, {"reorder_level": {"$exists": False}}]},
        {"_id": 1, "id": 1, "reorder_level": 1, "quantity": 1},
    )
    async for inv in cursor:
        patch: dict = {}
        if not inv.get("id"):
            patch["id"] = str(uuid.uuid4())
            n_id += 1
        if "reorder_level" not in inv:
            qty = int(inv.get("quantity") or 0)
            patch["reorder_level"] = max(10, int(qty * 0.2))
            n_reorder += 1
        if patch:
            patch["updated_at"] = now_iso()
            await db.inventory.update_one({"_id": inv["_id"]}, {"$set": patch})
    if n_id or n_reorder:
        logger.info("inventory backfill: stamped id=%s, reorder_level=%s", n_id, n_reorder)
    return {"inventory_id_backfill": n_id, "inventory_reorder_backfill": n_reorder}


async def backfill_manufacturer_ids_on_legacy_legs() -> dict:
    """Stamp ``manufacturer_id`` on legacy shipment + vehicle rows that
    lacked it (distributor→wholesaler / wholesaler→retailer / etc.).

    Without this, those trucks vanish from the manufacturer-scoped Control
    Tower because the live-map query filters by ``manufacturer_id``.
    Idempotent — only touches rows where the field is ``None``.
    """
    from scripts.backfill_mfr_ids import backfill_manufacturer_ids
    stats = await backfill_manufacturer_ids(db=db)
    if stats.get("shipments_patched") or stats.get("vehicles_patched"):
        logger.info("mfr_id backfill: %s", stats)
    return {"mfr_id_backfill": stats}


async def run_all() -> dict:
    """Entry point — extend as more backfills are added."""
    out: dict = {}
    out.update(await backfill_wholesaler_orders_customer_fields())
    out.update(await backfill_inventory_missing_fields())
    out.update(await backfill_manufacturer_ids_on_legacy_legs())
    return out
