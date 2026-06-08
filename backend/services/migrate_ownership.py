"""Phase 1 + 2 Ownership Model migration.

Adds an `organization_id` field (and an optional `warehouse_id`) to every
ownership-bearing collection so consumers can progressively move off the
legacy `manufacturer_id` / `distributor_id` / `retailer_id` fields.

Idempotent: every UPDATE filters on `organization_id missing OR empty`, so a
re-run only touches rows that haven't been backfilled yet.

Ownership mapping (read this carefully — it freezes the semantics):

    Collection                Source FK → organization_id
    --------------------------------------------------------
    products                  manufacturer_id   (creator/brand)
    inventory                 owner_id          (current holder)
    batches                   manufacturer_id   (production source)
    promotions                manufacturer_id   (brand running the promo)
    purchase_orders           retailer_id       (the buyer)
    procurement_carts         retailer_id       (the buyer)
    supplier_quotes           retailer_id       (the quote requester)
    distributor_orders        distributor_id    (the buyer)
    requests                  retailer_id       (the requester)
    sales                     retailer_id       (the storefront)
    daily_sales               retailer_id       (the storefront)
    shipments                 from_id           (the dispatcher)

`warehouse_id` is left NULL everywhere for now — it will be populated by
the future Warehouse Management Module.

This is a PHASE 1+2 migration: it ONLY adds new fields and copies values.
No write paths, no business logic, no UI, no legacy field removal.
"""
from __future__ import annotations

import asyncio
from typing import Dict

from core import db, logger


async def _backfill_simple(coll: str, source_field: str) -> int:
    """Set organization_id = <source_field> on every row where organization_id
    is missing or empty. Returns count of documents updated."""
    pipeline = [
        {
            "$match": {
                "$or": [
                    {"organization_id": {"$exists": False}},
                    {"organization_id": ""},
                    {"organization_id": None},
                ],
                source_field: {"$nin": ["", None]},
            },
        },
        {
            "$set": {"organization_id": f"${source_field}"},
        },
        {"$merge": {"into": coll, "on": "_id", "whenMatched": "merge"}},
    ]
    # Count first so we can return a delta (aggregate-with-merge returns no count).
    before = await db[coll].count_documents({
        "$or": [
            {"organization_id": {"$exists": False}},
            {"organization_id": ""},
            {"organization_id": None},
        ],
        source_field: {"$nin": ["", None]},
    })
    if before == 0:
        return 0
    await db[coll].aggregate(pipeline).to_list(1)
    return before


async def _ensure_warehouse_id(coll: str) -> int:
    """Make sure every row carries a `warehouse_id` key (set to None) so
    queries that filter on it don't choke on KeyError. Returns updated count.
    """
    result = await db[coll].update_many(
        {"warehouse_id": {"$exists": False}},
        {"$set": {"warehouse_id": None}},
    )
    return result.modified_count


async def run() -> Dict[str, dict]:
    """Run the full ownership backfill. Idempotent."""
    plan = [
        # (collection, source_fk_field)
        ("products",           "manufacturer_id"),
        ("inventory",          "owner_id"),
        ("batches",            "manufacturer_id"),
        ("promotions",         "manufacturer_id"),
        ("purchase_orders",    "retailer_id"),
        ("procurement_carts",  "retailer_id"),
        ("supplier_quotes",    "retailer_id"),
        ("distributor_orders", "distributor_id"),
        ("requests",           "retailer_id"),
        ("sales",              "retailer_id"),
        ("daily_sales",        "retailer_id"),
        ("shipments",          "from_id"),
    ]
    report: Dict[str, dict] = {}
    for coll, src in plan:
        total = await db[coll].count_documents({})
        if total == 0:
            report[coll] = {"total": 0, "backfilled": 0, "source": src, "skipped": True}
            continue
        updated = await _backfill_simple(coll, src)
        # Sanity: how many still lack org_id?
        missing = await db[coll].count_documents({
            "$or": [
                {"organization_id": {"$exists": False}},
                {"organization_id": ""},
                {"organization_id": None},
            ],
        })
        report[coll] = {
            "total": total,
            "backfilled": updated,
            "still_missing_org_id": missing,
            "source": src,
        }

    # Add warehouse_id placeholder on inventory only (the only collection
    # where the field is part of the new model).
    wh_added = await _ensure_warehouse_id("inventory")
    report["inventory"]["warehouse_id_added"] = wh_added

    logger.info("Ownership migration report: %s", report)
    return report


if __name__ == "__main__":
    print(asyncio.run(run()))
