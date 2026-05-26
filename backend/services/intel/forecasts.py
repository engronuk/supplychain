"""Stock-exhaustion forecasting using exponentially-weighted demand.

Method (deliberately simple, defensible, fast):
  1. Pull last 30 days of daily_sales per (retailer, product).
  2. Compute EWMA velocity (alpha=0.35) — recent days weighted more.
  3. Apply day-of-week multiplier so weekend stockouts aren't underestimated.
  4. Apply external multipliers (weather, holidays) from cached signals.
  5. Days-to-stockout = current_qty / adjusted_velocity.
  6. Confidence interval from velocity std-dev (Wilson-style proxy).

Outputs forecasts to db.intel_forecasts keyed by (tenant_id, retailer_id, product_id).
Also rolled up to distributor and manufacturer levels for higher-tier views.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from core import db, logger, new_id, now_iso

EWMA_ALPHA = 0.35
DOW_WEIGHT = [0.85, 0.95, 1.0, 1.05, 1.2, 1.35, 1.15]  # Mon..Sun


def _ewma_velocity(series: List[float]) -> tuple[float, float]:
    """Return (ewma_per_day, std_dev). Series in chronological order, length >=1."""
    if not series:
        return 0.0, 0.0
    e = series[0]
    for x in series[1:]:
        e = EWMA_ALPHA * x + (1 - EWMA_ALPHA) * e
    if len(series) > 1:
        mean = sum(series) / len(series)
        variance = sum((x - mean) ** 2 for x in series) / max(len(series) - 1, 1)
        std = math.sqrt(variance)
    else:
        std = 0.0
    return e, std


def _external_multiplier(category: str, signals: Dict) -> float:
    """Combine weather + holidays into a demand multiplier for the next ~7d."""
    mult = 1.0
    if not signals:
        return mult
    w = signals.get("weather") or {}
    rainfall = float(w.get("rainfall_mm_7d", 0))
    temp_max = float(w.get("temp_max_c", 30))
    if category in {"Food", "Beverages"}:
        if rainfall > 30:
            mult *= 1.15  # rain ↑ hot beverages, instant food
        if temp_max > 33:
            mult *= 1.10
    if category in {"Home Care", "Personal Care"} and rainfall > 50:
        mult *= 1.05
    if signals.get("holiday_within_7d"):
        mult *= 1.20
    if signals.get("salary_window"):  # end-of-month / 25-28th
        mult *= 1.12
    return round(mult, 3)


def _confidence(std: float, velocity: float) -> float:
    """Rough confidence score 0..1 — higher = tighter dispersion."""
    if velocity <= 0:
        return 0.1
    cv = std / velocity if velocity > 0 else 1.0
    return round(max(0.1, min(1.0, 1.0 - min(cv, 0.8))), 2)


def _urgency(days_remaining: float, confidence: float) -> str:
    if days_remaining <= 2:
        return "critical"
    if days_remaining <= 5 and confidence >= 0.4:
        return "high"
    if days_remaining <= 10:
        return "medium"
    return "low"


async def compute_stock_exhaustion(tenant_id: str) -> dict:
    """Recompute forecasts for the tenant. Idempotent — replaces prior forecasts."""
    distributors = await db.distributors.find(
        {"manufacturer_id": tenant_id}, {"_id": 0, "id": 1, "region": 1, "city": 1, "name": 1},
    ).to_list(5000)
    if not distributors:
        return {"forecasts": 0}
    dist_ids = [d["id"] for d in distributors]
    dist_by_id = {d["id"]: d for d in distributors}

    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}},
        {"_id": 0, "id": 1, "distributor_id": 1, "region": 1, "city": 1, "name": 1},
    ).to_list(20000)
    if not retailers:
        return {"forecasts": 0}
    retailer_ids = [r["id"] for r in retailers]
    retailer_by_id = {r["id"]: r for r in retailers}

    products = {p["id"]: p for p in await db.products.find(
        {"manufacturer_id": tenant_id}, {"_id": 0},
    ).to_list(5000)}
    product_ids = list(products.keys())

    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=29)).isoformat()
    sales = await db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "product_id": {"$in": product_ids},
         "date": {"$gte": start}}, {"_id": 0},
    ).to_list(500_000)

    # Index sales as { (rid, pid): [series chronological] }
    series_map: Dict[tuple, Dict[str, float]] = {}
    for s in sales:
        key = (s["retailer_id"], s["product_id"])
        m = series_map.setdefault(key, {})
        m[s["date"]] = m.get(s["date"], 0.0) + float(s.get("units", 0))

    # Latest external signals (cached upstream)
    signals_doc = await db.intel_external_signals.find_one({"tenant_id": tenant_id}, {"_id": 0})
    signals = (signals_doc or {}).get("payload") or {}

    inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids},
         "product_id": {"$in": product_ids}}, {"_id": 0},
    ).to_list(500_000)

    # Wipe prior forecasts for this tenant (idempotent replace)
    await db.intel_forecasts.delete_many({"tenant_id": tenant_id})

    forecasts: List[dict] = []
    now = now_iso()
    for it in inv:
        qty = int(it.get("quantity", 0))
        rid = it["owner_id"]
        pid = it["product_id"]
        r = retailer_by_id.get(rid)
        p = products.get(pid)
        if not r or not p:
            continue
        m = series_map.get((rid, pid), {})
        series = [m.get((today - timedelta(days=i)).isoformat(), 0.0) for i in range(29, -1, -1)]
        ewma, std = _ewma_velocity(series)
        dow_idx = today.weekday()
        velocity = max(0.0, ewma * DOW_WEIGHT[dow_idx])
        external_mult = _external_multiplier(p.get("category", ""), signals)
        adjusted_velocity = round(velocity * external_mult, 3)
        if adjusted_velocity <= 0:
            # Fallback to inventory's stored velocity if no recent sales
            adjusted_velocity = max(float(it.get("velocity", 0)) * external_mult, 0.0)
        if adjusted_velocity <= 0:
            continue  # no signal at all — skip
        days = qty / adjusted_velocity if adjusted_velocity > 0 else 999
        stockout_date = (today + timedelta(days=int(days))).isoformat() if days < 365 else None
        conf = _confidence(std, ewma if ewma > 0 else adjusted_velocity)
        urg = _urgency(days, conf)
        d = dist_by_id.get(r["distributor_id"], {})
        forecasts.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "scope_role": "retailer",
            "scope_id": rid,
            "distributor_id": r["distributor_id"],
            "retailer_id": rid,
            "retailer_name": r.get("name", ""),
            "product_id": pid,
            "product_name": p["name"],
            "category": p.get("category", ""),
            "region": r.get("region", ""),
            "city": r.get("city", ""),
            "distributor_name": d.get("name", ""),
            "current_qty": qty,
            "velocity": round(velocity, 3),
            "adjusted_velocity": adjusted_velocity,
            "external_multiplier": external_mult,
            "days_remaining": round(days, 1),
            "stockout_date": stockout_date,
            "confidence": conf,
            "urgency": urg,
            "computed_at": now,
        })

    if forecasts:
        # Batch insert
        for i in range(0, len(forecasts), 5000):
            try:
                await db.intel_forecasts.insert_many(forecasts[i:i + 5000], ordered=False)
            except Exception:
                logger.exception("forecasts batch insert failed")

    return {"forecasts": len(forecasts)}


async def rollup_distributor(tenant_id: str) -> List[dict]:
    """Aggregate per-product days-remaining at the distributor level."""
    pipeline = [
        {"$match": {"tenant_id": tenant_id}},
        {"$group": {
            "_id": {"d": "$distributor_id", "p": "$product_id"},
            "distributor_name": {"$first": "$distributor_name"},
            "product_name": {"$first": "$product_name"},
            "category": {"$first": "$category"},
            "total_qty": {"$sum": "$current_qty"},
            "shops_at_risk": {"$sum": {"$cond": [{"$lt": ["$days_remaining", 5]}, 1, 0]}},
            "avg_days": {"$avg": "$days_remaining"},
            "min_days": {"$min": "$days_remaining"},
            "avg_conf": {"$avg": "$confidence"},
        }},
        {"$sort": {"min_days": 1}},
    ]
    return [r async for r in db.intel_forecasts.aggregate(pipeline)]
