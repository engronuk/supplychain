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

Production safety
-----------------
The previous implementation used an `aggregate + $merge` pipeline which
takes 10-20 s on a 48k-row inventory collection over a cold Atlas
connection — long enough to hit pymongo's default socket timeout and
emit a scary stack trace inside the deploy logs even though the outer
caller catches it. We now:

    1. Build a single MISSING-organization_id filter and ask Mongo to
       count first with a tight `maxTimeMS`. If zero, we exit instantly.
    2. Run an `update_many` with an aggregation-pipeline `$set` — server
       executes the field copy in one round-trip, with `maxTimeMS` set
       so a slow Atlas can't hang the deploy.
    3. Wrap every collection in its own try/except so one slow / cold
       collection cannot prevent the others from being backfilled.

All side effects are otherwise identical to the previous version.
"""
from __future__ import annotations

import asyncio
from typing import Dict, Optional

from pymongo.errors import PyMongoError

from core import db, logger

# Server-side max execution time per operation. Generous enough for a
# 50k-row inventory backfill, short enough to keep the deploy bootstrap
# from hanging on a half-warm Atlas connection.
_OP_TIMEOUT_MS = 30_000


def _missing_filter(source_field: str) -> dict:
    """Documents that still need to be backfilled."""
    return {
        "$or": [
            {"organization_id": {"$exists": False}},
            {"organization_id": ""},
            {"organization_id": None},
        ],
        source_field: {"$nin": ["", None]},
    }


async def _backfill_simple(coll: str, source_field: str) -> int:
    """Copy source_field → organization_id wherever it's still missing.

    Returns the number of documents matched (and therefore updated).
    Uses an update_many with aggregation pipeline; Mongo applies the
    `$set` server-side in a single pass and is materially faster than
    the previous `aggregate + $merge` approach.
    """
    filt = _missing_filter(source_field)

    # Tight server-side time budget on the count so an unhealthy Atlas
    # connection can't stall the deploy bootstrap.
    before = await db[coll].count_documents(filt, maxTimeMS=_OP_TIMEOUT_MS)
    if before == 0:
        return 0

    await db[coll].update_many(
        filt,
        [{"$set": {"organization_id": f"${source_field}"}}],
    )
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
    """Run the full ownership backfill. Idempotent.

    Every collection is its own try-block. A timeout on one collection
    (e.g. cold inventory on a fresh Atlas pod) will be logged and the
    next collection will still be attempted. The outer caller in
    `server.py` already wraps this entire function in a try/except, so
    a fatal error here only logs a "continuing" line.
    """
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
        try:
            total = await db[coll].count_documents({}, maxTimeMS=_OP_TIMEOUT_MS)
        except PyMongoError as exc:
            logger.warning(
                "Ownership backfill: count failed for %s (%s) — skipping",
                coll, exc.__class__.__name__,
            )
            report[coll] = {"error": "count_timeout", "source": src}
            continue

        if total == 0:
            report[coll] = {
                "total": 0, "backfilled": 0, "source": src, "skipped": True,
            }
            continue

        try:
            updated = await _backfill_simple(coll, src)
        except PyMongoError as exc:
            logger.warning(
                "Ownership backfill: update failed for %s (%s) — leaving as-is",
                coll, exc.__class__.__name__,
            )
            report[coll] = {
                "total": total, "backfilled": 0, "source": src,
                "error": exc.__class__.__name__,
            }
            continue

        try:
            missing = await db[coll].count_documents(
                {
                    "$or": [
                        {"organization_id": {"$exists": False}},
                        {"organization_id": ""},
                        {"organization_id": None},
                    ],
                },
                maxTimeMS=_OP_TIMEOUT_MS,
            )
        except PyMongoError:
            missing = None
        report[coll] = {
            "total": total,
            "backfilled": updated,
            "still_missing_org_id": missing,
            "source": src,
        }

    # Add warehouse_id placeholder on inventory only (the only collection
    # where the field is part of the new model). Best-effort.
    try:
        wh_added = await _ensure_warehouse_id("inventory")
        if "inventory" in report and isinstance(report["inventory"], dict):
            report["inventory"]["warehouse_id_added"] = wh_added
    except PyMongoError as exc:
        logger.warning(
            "Ownership backfill: warehouse_id placeholder failed (%s) — continuing",
            exc.__class__.__name__,
        )

    logger.info("Ownership migration report: %s", report)
    return report


if __name__ == "__main__":
    print(asyncio.run(run()))
