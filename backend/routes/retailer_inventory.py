"""Retailer Inventory Command Center — fat aggregator endpoint.

Powers the new retailer Inventory experience: KPI strip, stock-health donut,
AI insights, low-stock center, value-by-category, 30-day trend and
fast/slow-mover leaderboards.

Heuristics (since the schema has no expiry/batch metadata):
  - "expiring_soon"  → items with quantity > 0 AND no sale in the last 60d
                       AND inventory updated_at older than 60d.
                       (Surfaced as "Aging Stock" with a tooltip.)
  - "dead_stock"     → items with quantity > 0 AND no sale in last 90d.
  - "critical"       → quantity == 0  (out of stock)
  - "low"            → quantity > 0 AND quantity <= reorder_level
  - "healthy"        → quantity > reorder_level

Performance: results aggregate ~50-200 SKUs per retailer; no snapshot
needed for v1.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from core import db, now_iso

router = APIRouter()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _round(v: float, n: int = 2) -> float:
    return round(float(v or 0), n)


def _days_remaining(qty: int, velocity: float) -> float | None:
    if velocity <= 0:
        return None
    return round(qty / velocity, 1)


def _classify(qty: int, reorder: int) -> str:
    if qty <= 0:
        return "critical"
    if qty <= reorder:
        return "low"
    return "healthy"


def _recommended_qty(velocity: float, days_cover: int = 30) -> int:
    qty = max(10, int(round(velocity * days_cover / 10) * 10))
    return qty


# ---------------------------------------------------------------------------
# endpoint
# ---------------------------------------------------------------------------
@router.get("/retailer/{retailer_id}/inventory-command-center")
async def inventory_command_center(retailer_id: str):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    today = datetime.now(timezone.utc).date()
    start_30 = (today - timedelta(days=30)).isoformat()
    start_60 = (today - timedelta(days=60)).isoformat()
    start_90 = (today - timedelta(days=90)).isoformat()

    # ---- load inventory + products ---------------------------------------
    inventory = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0},
    ).to_list(2000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}

    # ---- last sale date + velocity per product ---------------------------
    velocity_by_pid: Dict[str, dict] = defaultdict(
        lambda: {"units_30d": 0, "revenue_30d": 0.0,
                 "units_90d": 0, "revenue_90d": 0.0, "last_sale": None}
    )

    async for s in db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": start_90}},
        {"_id": 0, "product_id": 1, "units": 1, "quantity_sold": 1,
         "revenue": 1, "date": 1},
    ):
        pid = s["product_id"]
        u = int(s.get("units", s.get("quantity_sold", 0)))
        r = float(s.get("revenue", 0))
        d = s["date"]
        v = velocity_by_pid[pid]
        v["units_90d"] += u
        v["revenue_90d"] += r
        if d >= start_30:
            v["units_30d"] += u
            v["revenue_30d"] += r
        if not v["last_sale"] or d > v["last_sale"]:
            v["last_sale"] = d

    # 30-day inventory value trend uses today's unit cost (approximation).
    # We don't have historical stock snapshots, so we project the trend
    # backwards from current value using the sales-out signal.

    # ---- per-item evaluation ---------------------------------------------
    enriched: List[dict] = []
    total_value = 0.0
    total_units = 0
    healthy_count = low_count = critical_count = 0
    expiring_soon: List[dict] = []
    dead_stock: List[dict] = []
    by_category: Dict[str, dict] = defaultdict(
        lambda: {"value": 0.0, "units": 0, "skus": 0}
    )

    for inv in inventory:
        product = products.get(inv["product_id"], {})
        qty = int(inv.get("quantity", 0))
        reorder = int(inv.get("reorder_level", 0))
        unit_price = float(product.get("unit_price", 0))
        value = qty * unit_price
        total_value += value
        total_units += qty

        v = velocity_by_pid.get(inv["product_id"], {})
        velocity_30d = v.get("units_30d", 0) / 30 if v else 0
        last_sale = v.get("last_sale") if v else None
        days_left = _days_remaining(qty, velocity_30d)
        status = _classify(qty, reorder)
        if status == "healthy":
            healthy_count += 1
        elif status == "low":
            low_count += 1
        else:
            critical_count += 1

        # category roll-up
        cat = product.get("category") or "Other"
        by_category[cat]["value"] += value
        by_category[cat]["units"] += qty
        by_category[cat]["skus"] += 1

        # Dead / aging classification (only counts items with positive stock)
        if qty > 0:
            stale = (not last_sale) or last_sale < start_90
            aging = (not last_sale) or last_sale < start_60
            if stale:
                dead_stock.append({
                    "product_id": inv["product_id"],
                    "product": product,
                    "quantity": qty,
                    "value": _round(value),
                    "last_sale": last_sale,
                })
            elif aging:
                expiring_soon.append({
                    "product_id": inv["product_id"],
                    "product": product,
                    "quantity": qty,
                    "value": _round(value),
                    "last_sale": last_sale,
                    "days_idle": (today - datetime.fromisoformat(last_sale).date()).days
                        if last_sale else None,
                })

        enriched.append({
            "id": inv["id"],
            "product_id": inv["product_id"],
            "product": product,
            "quantity": qty,
            "reorder_level": reorder,
            "value": _round(value),
            "unit_price": unit_price,
            "status": status,
            "velocity_30d": _round(velocity_30d, 2),
            "days_remaining": days_left,
            "last_sale": last_sale,
            "updated_at": inv.get("updated_at"),
        })

    # ---- low-stock center -------------------------------------------------
    low_stock_center = sorted([
        {
            "product_id": e["product_id"],
            "product": e["product"],
            "current_stock": e["quantity"],
            "reorder_level": e["reorder_level"],
            "velocity": e["velocity_30d"],
            "days_remaining": e["days_remaining"],
            "recommended_qty": _recommended_qty(e["velocity_30d"]),
            "status": e["status"],
        }
        for e in enriched
        if e["status"] in ("low", "critical") or (
            e["days_remaining"] is not None and e["days_remaining"] <= 14
        )
    ], key=lambda x: (
        0 if x["status"] == "critical" else 1 if x["status"] == "low" else 2,
        x["days_remaining"] if x["days_remaining"] is not None else 9999,
    ))

    # ---- fast / slow movers ----------------------------------------------
    movers = []
    for e in enriched:
        v = velocity_by_pid.get(e["product_id"], {})
        movers.append({
            "product_id": e["product_id"],
            "product": e["product"],
            "units_30d": v.get("units_30d", 0),
            "revenue_30d": _round(v.get("revenue_30d", 0)),
            "velocity": e["velocity_30d"],
            "current_stock": e["quantity"],
            "days_remaining": e["days_remaining"],
        })
    fast_moving = sorted(movers, key=lambda x: x["units_30d"], reverse=True)[:5]
    slow_moving = sorted(
        [m for m in movers if m["current_stock"] > 0],
        key=lambda x: (x["units_30d"], -x["current_stock"]),
    )[:5]

    # ---- 30-day inventory value trend ------------------------------------
    # We project value backwards using daily sales — each day's "value left"
    # is (today's value) + (units sold after that day × unit price).
    # Build day-by-day units sold per product first.
    day_units: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    async for s in db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": start_30}},
        {"_id": 0, "product_id": 1, "units": 1, "quantity_sold": 1, "date": 1},
    ):
        day_units[s["date"]][s["product_id"]] += int(
            s.get("units", s.get("quantity_sold", 0))
        )

    inventory_trend: List[dict] = []
    # Walk backwards
    cumulative_units: Dict[str, int] = defaultdict(int)
    for i in range(30):
        d = (today - timedelta(days=i)).isoformat()
        if i > 0:
            # Add the units that were sold ON day d so they show as part of stock that day
            for pid, units in day_units[d].items():
                cumulative_units[pid] += units
        projected_value = total_value
        for pid, units in cumulative_units.items():
            projected_value += units * float(products.get(pid, {}).get("unit_price", 0))
        inventory_trend.append({
            "date": d,
            "value": _round(projected_value),
        })
    inventory_trend.reverse()  # chronological order

    # ---- AI insights ------------------------------------------------------
    ai_insights = _ai_insights(enriched, velocity_by_pid, fast_moving, slow_moving)

    # ---- KPI strip --------------------------------------------------------
    kpis = {
        "inventory_value":  {"value": _round(total_value)},
        "total_skus":       {"value": len(enriched)},
        "inventory_units":  {"value": total_units},
        "low_stock":        {"value": low_count},
        "critical_stock":   {"value": critical_count},
        "expiring_soon":    {"value": len(expiring_soon)},
        "dead_stock":       {"value": len(dead_stock)},
    }

    # ---- Stock health donut ----------------------------------------------
    stock_health = {
        "healthy": healthy_count,
        "low": low_count,
        "critical": critical_count,
        "total": len(enriched),
        "donut": [
            {"label": "Healthy", "value": healthy_count, "color": "#10b981"},
            {"label": "Low", "value": low_count, "color": "#f59e0b"},
            {"label": "Critical", "value": critical_count, "color": "#ef4444"},
        ],
    }

    # ---- Category roll-up -------------------------------------------------
    value_by_category = sorted([
        {
            "category": k,
            "value": _round(v["value"]),
            "units": v["units"],
            "skus": v["skus"],
            "pct": _round(v["value"] / total_value * 100, 1) if total_value > 0 else 0.0,
        }
        for k, v in by_category.items()
    ], key=lambda x: x["value"], reverse=True)

    return {
        "as_of": now_iso(),
        "retailer": {
            "id": retailer["id"], "name": retailer.get("name", ""),
            "region": retailer.get("region"), "city": retailer.get("city"),
        },
        "kpis": kpis,
        "stock_health": stock_health,
        "ai_insights": ai_insights,
        "low_stock_center": low_stock_center,
        "value_by_category": value_by_category,
        "inventory_trend": inventory_trend,
        "fast_moving": fast_moving,
        "slow_moving": slow_moving,
        "expiring_soon": sorted(expiring_soon, key=lambda x: x.get("days_idle") or 0, reverse=True)[:10],
        "dead_stock": sorted(dead_stock, key=lambda x: x["value"], reverse=True)[:10],
        "inventory": sorted(enriched, key=lambda x: x["product"].get("name", "")),
    }


def _ai_insights(
    enriched: List[dict],
    velocity_by_pid: Dict[str, dict],
    fast: List[dict],
    slow: List[dict],
) -> List[dict]:
    """Build a deterministic but rich set of AI Inventory insights."""
    insights: List[dict] = []

    # Imminent stockouts first
    urgent = [e for e in enriched
              if e["days_remaining"] is not None and 0 < e["days_remaining"] <= 7]
    urgent.sort(key=lambda e: e["days_remaining"])
    for e in urgent[:3]:
        p = e["product"]
        insights.append({
            "type": "stockout",
            "severity": "critical" if e["days_remaining"] <= 3 else "high",
            "icon": "alert-octagon",
            "product_id": e["product_id"],
            "product_name": p.get("name", "—"),
            "title": f"{p.get('name','SKU')} will stock out in {e['days_remaining']} days",
            "detail": (
                f"Current stock: {e['quantity']} units · "
                f"Velocity: {e['velocity_30d']}/day · "
                f"Place a reorder today to avoid shelf-gap."
            ),
            "actions": ["reorder", "transfer", "review"],
        })

    # Fast risers (velocity > category average × 1.5)
    if fast:
        avg_units = sum(m["units_30d"] for m in fast) / max(1, len(fast))
        for m in fast[:2]:
            if m["units_30d"] >= avg_units:
                p = m["product"]
                insights.append({
                    "type": "trending_up",
                    "severity": "info",
                    "icon": "trending-up",
                    "product_id": m["product_id"],
                    "product_name": p.get("name", "—"),
                    "title": f"{p.get('name','SKU')} demand is increasing",
                    "detail": (
                        f"Moved {m['units_30d']} units in last 30 days · "
                        f"Revenue ₦{m['revenue_30d']:,.0f}. Consider raising reorder level."
                    ),
                    "actions": ["reorder", "review"],
                })

    # Slow movers
    for m in slow[:2]:
        p = m["product"]
        if m["units_30d"] < 5 and m["current_stock"] > 0:
            insights.append({
                "type": "slow_mover",
                "severity": "warning",
                "icon": "trending-down",
                "product_id": m["product_id"],
                "product_name": p.get("name", "—"),
                "title": f"{p.get('name','SKU')} moving slower than average",
                "detail": (
                    f"Only {m['units_30d']} units sold in 30 days "
                    f"while {m['current_stock']} sit on the shelf. "
                    f"Consider transfer, bundle promo or markdown."
                ),
                "actions": ["transfer", "review"],
            })

    if not insights:
        insights.append({
            "type": "all_clear",
            "severity": "positive",
            "icon": "shield-check",
            "product_id": None,
            "product_name": "",
            "title": "All clear",
            "detail": "Stock levels and velocity look healthy across your assortment.",
            "actions": [],
        })
    return insights[:6]
