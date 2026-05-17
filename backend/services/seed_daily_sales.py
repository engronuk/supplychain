"""Historical daily_sales generator — idempotent, realistic, batch-inserts.

Why a dedicated seeder?
The main `seed_from_csv()` only writes daily_sales for 3 sample retailers (14d)
to keep cold-start fast. This module generates a much wider, more realistic
synthetic dataset that powers the manufacturer / distributor analytics
dashboards in production demos.

Design:
- Pulls each retailer's inventory rows to read its per-product velocity.
- Synthesizes `days` of history with weekday/weekend seasonality + jitter.
- Idempotent: looks up the existing (retailer_id, product_id, date) keys via a
  single aggregation, then INSERTS ONLY the missing tuples. Re-running the
  endpoint after a partial seed will only fill the gaps.
- Caps work via `retailers_limit` so a 3k-retailer dataset doesn't accidentally
  generate 1.4M rows on every call.
- Batched insert_many in chunks of 5,000 so a single op never gets too big.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Set, Tuple

from core import db, logger, new_id

# Multiplier per day-of-week (Mon=0 ... Sun=6) — Sat/Sun lift, Mon dip.
DOW_MULTIPLIER = [0.85, 0.95, 1.0, 1.05, 1.2, 1.35, 1.15]

# Categories that pull more weight in Nigerian retail
HOT_CATEGORIES = {"Food", "Home Care"}


def _default_velocity(category: str | None) -> float:
    """Reasonable per-day baseline when inventory.velocity is missing or zero.

    Hot consumer categories sell faster than personal care / specialty SKUs.
    Numbers stay realistic for a small Nigerian retailer (~1-3 units/day/SKU).
    """
    if (category or "") in HOT_CATEGORIES:
        return 2.2
    return 1.0


def _bucket(units_per_day_avg: float, dt: datetime, seed: int) -> int:
    """Realistic synthetic day-level units for a given product+date.

    Combines: base velocity · day-of-week seasonality · seeded jitter (so the
    same date for the same product always yields the same number — replays
    look stable to the eye).
    """
    if units_per_day_avg <= 0:
        return 0
    rng = random.Random(seed)
    dow_mult = DOW_MULTIPLIER[dt.weekday()]
    jitter = 0.7 + rng.random() * 0.7        # 0.7 .. 1.4
    spike = 1.0
    if rng.random() < 0.05:                   # occasional 5% spike day
        spike = 1.6 + rng.random()
    return max(0, int(round(units_per_day_avg * dow_mult * jitter * spike)))


async def _existing_keys(retailer_ids: List[str], date_set: Set[str]) -> Set[Tuple[str, str, str]]:
    """Return the set of (retailer_id, product_id, date) tuples already present.

    One aggregation hit, scoped to the working window so the set fits in memory.
    """
    if not retailer_ids or not date_set:
        return set()
    cursor = db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$in": list(date_set)}},
        {"_id": 0, "retailer_id": 1, "product_id": 1, "date": 1},
    )
    out: Set[Tuple[str, str, str]] = set()
    async for r in cursor:
        out.add((r["retailer_id"], r["product_id"], r["date"]))
    return out


def _chunked(seq: List[dict], size: int) -> Iterable[List[dict]]:
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


async def seed_daily_sales(*, days: int = 30, retailers_limit: int = 200,
                           force: bool = False) -> dict:
    """Idempotent seeder.

    Args:
      days: how many days of history to synthesize, ending today (1..120).
      retailers_limit: cap how many retailers to seed (top-by-velocity first).
      force: when True, wipes the seeder's prior rows in this window before
             generating fresh ones. Safe — only deletes rows with
             source='daily_sales_seeder_v1'.

    Returns: { ok, inserted, skipped, retailers, days, window_start, window_end }
    """
    days = max(1, min(int(days), 120))
    retailers_limit = max(1, min(int(retailers_limit), 5000))

    today = datetime.now(timezone.utc).date()
    window: List[str] = [(today - timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    window_set = set(window)

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    if not products:
        return {"ok": False, "inserted": 0, "error": "no products in DB — seed master data first"}

    # Pick retailers preferring those with velocity, falling back to retailer
    # collection order. Tie-break by id ASC so idempotency holds across calls.
    vel_pipeline = [
        {"$match": {"owner_type": "retailer", "velocity": {"$gt": 0}}},
        {"$group": {"_id": "$owner_id", "total_velocity": {"$sum": "$velocity"}}},
        {"$sort": {"total_velocity": -1, "_id": 1}},
        {"$limit": retailers_limit},
    ]
    rid_rows = [r async for r in db.inventory.aggregate(vel_pipeline)]
    retailer_ids = [r["_id"] for r in rid_rows]
    if len(retailer_ids) < retailers_limit:
        # Top-up with retailers that don't have velocity-tagged inventory yet —
        # they'll still get rows via the per-product default velocity below.
        have = set(retailer_ids)
        needed = retailers_limit - len(retailer_ids)
        extras = await db.retailers.find({"id": {"$nin": list(have)}}, {"_id": 0, "id": 1})\
            .sort("id", 1).limit(needed).to_list(needed)
        retailer_ids.extend(r["id"] for r in extras)
    if not retailer_ids:
        return {"ok": False, "inserted": 0, "error": "no retailers in DB"}

    if force:
        await db.daily_sales.delete_many({
            "retailer_id": {"$in": retailer_ids},
            "date": {"$in": window},
            "source": "daily_sales_seeder_v1",
        })

    # Fetch per-retailer inventory once. We DO NOT filter on velocity > 0 here:
    # in production seeds the `velocity` field may be missing or zero, but we
    # still want to generate plausible sales for every retailer × product pair.
    # Missing velocity gets a sensible default derived from the stocked qty.
    inv_rows = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}},
        {"_id": 0, "owner_id": 1, "product_id": 1, "velocity": 1, "quantity": 1,
         "reorder_level": 1},
    ).to_list(500_000)

    # If a retailer has no inventory at all (production case: master data was
    # seeded but inventory wasn't), synthesize one row per product so the
    # retailer still gets a full history via the per-category default velocity.
    rids_with_inv = {r["owner_id"] for r in inv_rows}
    missing_inv = [rid for rid in retailer_ids if rid not in rids_with_inv]
    if missing_inv:
        for rid in missing_inv:
            for pid in products:
                inv_rows.append({
                    "owner_id": rid, "product_id": pid,
                    "velocity": 0, "quantity": 0, "reorder_level": 0,
                })

    existing = await _existing_keys(retailer_ids, window_set)

    docs: List[dict] = []
    skipped = 0
    for inv in inv_rows:
        rid = inv["owner_id"]
        pid = inv["product_id"]
        prod = products.get(pid) or {}
        base_velocity = float(inv.get("velocity", 0))
        if base_velocity <= 0:
            base_velocity = _default_velocity(prod.get("category"))
        elif prod.get("category") in HOT_CATEGORIES:
            base_velocity *= 1.25
        price = float(prod.get("unit_price", 0))
        for date_str in window:
            if (rid, pid, date_str) in existing:
                skipped += 1
                continue
            try:
                dt = datetime.fromisoformat(date_str)
            except Exception:
                continue
            seed_key = hash((rid, pid, date_str)) & 0x7FFFFFFF
            units = _bucket(base_velocity, dt, seed_key)
            if units == 0:
                continue
            docs.append({
                "id": new_id(),
                "retailer_id": rid,
                "product_id": pid,
                "date": date_str,
                "units": units,
                "quantity_sold": units,
                "revenue": round(units * price, 2),
                "source": "daily_sales_seeder_v1",
            })

    inserted = 0
    for batch in _chunked(docs, 5000):
        try:
            res = await db.daily_sales.insert_many(batch, ordered=False)
            inserted += len(res.inserted_ids)
        except Exception:
            logger.exception("daily_sales batch insert failed (continuing)")

    logger.info(
        "Seeded daily_sales: inserted=%s skipped=%s retailers=%s days=%s",
        inserted, skipped, len(retailer_ids), days,
    )
    return {
        "ok": True,
        "inserted": inserted,
        "skipped": skipped,
        "retailers": len(retailer_ids),
        "days": days,
        "window_start": window[0],
        "window_end": window[-1],
    }
