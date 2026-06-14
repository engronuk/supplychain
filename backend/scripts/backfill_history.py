"""Backfill historical daily_sales so the manufacturer forecast/revenue
trend charts are dense (12 months of data instead of ~90 days).

Strategy:
1.  Take every existing (retailer, product) pair from the current dense
    window (last 90 days). These are the SKUs the retailer actually
    stocks. We use their existing average units/day as the baseline
    velocity — preserves realism per shop.
2.  For each (retailer, product) baseline, generate synthetic sales going
    back ~12 months with:
      - DOW weighting (Mon..Sun) [0.85,0.95,1,1.05,1.2,1.35,1.15]
      - Mild monthly growth (older months have ~25% lower volume than today)
      - Quarterly seasonality (Dec festive +18%, Aug rains +5%)
      - Salary-window spike (25th-30th) +12%
      - 18% random "no-sale" days to avoid mechanical perfection
3.  Only inserts dates that don't already have a row for that
    (retailer, product) — idempotent.
4.  Stamps both `units` (canonical) and `quantity_sold` (legacy) so any
    consumer still works.

Re-runnable.  Caps at ~600k generated docs to stay safe.

    cd /app/backend && python -m scripts.backfill_history
"""
from __future__ import annotations

import asyncio
import math
import os
import random
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


DOW_WEIGHT = [0.85, 0.95, 1.0, 1.05, 1.20, 1.35, 1.15]  # Mon..Sun
BACKFILL_DAYS = 365            # generate 12 months back from today
SKIP_RECENT_DAYS = 1           # only skip today — densify everything else
MAX_INSERTS = 600_000          # safety cap
NO_SALE_PROB = 0.18            # 18% of days the SKU sees no sale
CHUNK_SIZE = 5_000


def month_growth(days_back: int) -> float:
    """Older = ~25% lower. Linear ramp from 1.0 (today) to 0.75 at 365d."""
    return max(0.55, 1.0 - 0.25 * (days_back / 365.0))


def seasonality_mult(d: datetime) -> float:
    """Mild monthly seasonality."""
    m = d.month
    if m == 12:
        return 1.18        # festive lift
    if m == 11:
        return 1.10        # Black Friday warm-up
    if m in (1, 7):
        return 0.92        # post-festive slump / heat
    if m == 8:
        return 1.05        # rainy peak
    return 1.0


def salary_mult(d: datetime) -> float:
    return 1.12 if d.day >= 25 else 1.0


async def backfill(db=None) -> dict:
    if db is None:
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        owns_client = client
    else:
        owns_client = None

    today = datetime.now(timezone.utc).date()
    recent_cutoff = (today - timedelta(days=SKIP_RECENT_DAYS)).isoformat()
    history_floor = (today - timedelta(days=BACKFILL_DAYS)).isoformat()

    # 1. Existing (retailer, product) pairs from the dense recent window
    pipeline = [
        {"$match": {"date": {"$gte": recent_cutoff}}},
        {"$group": {
            "_id": {"r": "$retailer_id", "p": "$product_id"},
            "total_units": {
                "$sum": {"$ifNull": ["$units", {"$ifNull": ["$quantity_sold", 0]}]}
            },
            "days_seen": {"$addToSet": "$date"},
            "unit_price": {"$first": "$revenue"},  # placeholder
            "channel": {"$first": "$channel"},
            "tenant_id": {"$first": "$tenant_id"},
            "manufacturer_id": {"$first": "$manufacturer_id"},
        }},
    ]
    pairs = await db.daily_sales.aggregate(pipeline).to_list(50_000)
    print(f"Found {len(pairs)} (retailer, product) pairs from recent window")

    # 2. Pull product prices for accurate revenue
    products = {p["id"]: p async for p in db.products.find({}, {"_id": 0})}
    retailers = {r["id"]: r async for r in db.retailers.find({}, {"_id": 0})}

    # 3. Pre-compute existing date set per (r, p) so we never duplicate
    print("Indexing existing dates to skip duplicates...")
    existing_keys: dict[tuple[str, str], set[str]] = defaultdict(set)
    cursor = db.daily_sales.find(
        {"date": {"$lt": recent_cutoff, "$gte": history_floor}},
        {"_id": 0, "retailer_id": 1, "product_id": 1, "date": 1},
    )
    async for s in cursor:
        existing_keys[(s["retailer_id"], s["product_id"])].add(s["date"])
    print(f"Existing pre-cutoff dates indexed for {len(existing_keys)} pairs")

    buffer: list[dict] = []
    total_inserted = 0
    pair_count = 0

    for pair in pairs:
        rid = pair["_id"]["r"]
        pid = pair["_id"]["p"]
        days_seen = len(pair["days_seen"])
        total_units = max(int(pair["total_units"]), 0)
        if days_seen == 0 or total_units == 0:
            continue
        avg_units_per_day = total_units / max(days_seen, 1)
        # Boost the baseline a bit so older history is dense enough to drive forecasts
        baseline = max(avg_units_per_day, 0.6)

        prod = products.get(pid) or {}
        retailer = retailers.get(rid) or {}
        unit_price = float(prod.get("unit_price") or 0)
        if unit_price <= 0:
            unit_price = 1500.0  # safe default — keeps revenue non-zero

        tenant_id = pair.get("tenant_id") or prod.get("manufacturer_id") or retailer.get("manufacturer_id")
        manufacturer_id = pair.get("manufacturer_id") or prod.get("manufacturer_id")
        channel = pair.get("channel") or random.choice(["wholesaler", "distributor", "direct"])

        # 4. Generate historical sales day by day
        existing_dates = existing_keys.get((rid, pid), set())
        for delta in range(SKIP_RECENT_DAYS + 1, BACKFILL_DAYS + 1):
            d = today - timedelta(days=delta)
            d_iso = d.isoformat()
            if d_iso in existing_dates:
                continue
            # Skip a fraction of days to mimic real (lumpy) selling patterns
            if random.random() < NO_SALE_PROB:
                continue
            dow_w = DOW_WEIGHT[d.weekday()]
            mg = month_growth(delta)
            mm = seasonality_mult(datetime(d.year, d.month, d.day))
            sm = salary_mult(datetime(d.year, d.month, d.day))
            noise = random.uniform(0.7, 1.4)
            units = max(1, int(round(baseline * dow_w * mg * mm * sm * noise)))
            revenue = round(units * unit_price * random.uniform(0.95, 1.06), 2)
            doc = {
                "id": f"DS-BF-{rid[:8]}-{pid[:8]}-{d_iso}",
                "retailer_id": rid,
                "product_id": pid,
                "organization_id": rid,
                "date": d_iso,
                "units": units,
                "quantity_sold": units,
                "revenue": revenue,
                "channel": channel,
                "source": "backfill_history_v1",
                "seed_tag": "backfill_history_v1",
                "tenant_id": tenant_id,
                "manufacturer_id": manufacturer_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            buffer.append(doc)
            if len(buffer) >= CHUNK_SIZE:
                try:
                    await db.daily_sales.insert_many(buffer, ordered=False)
                    total_inserted += len(buffer)
                except Exception as exc:
                    print(f"  insert_many failed (continuing): {exc}")
                buffer.clear()
                if total_inserted >= MAX_INSERTS:
                    print(f"Hit cap {MAX_INSERTS}, stopping.")
                    break
        pair_count += 1
        if pair_count % 200 == 0:
            print(f"  processed {pair_count}/{len(pairs)} pairs · inserted {total_inserted}")
        if total_inserted >= MAX_INSERTS:
            break

    if buffer:
        try:
            await db.daily_sales.insert_many(buffer, ordered=False)
            total_inserted += len(buffer)
        except Exception as exc:
            print(f"  final insert_many failed: {exc}")

    # Mark progress
    await db.seed_meta.update_one(
        {"_id": "backfill_history_v1"},
        {"$set": {
            "inserted": total_inserted,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    print(f"\n✓ backfill complete · inserted {total_inserted} rows")
    if owns_client is not None:
        owns_client.close()
    return {"inserted": total_inserted}


if __name__ == "__main__":
    asyncio.run(backfill())
