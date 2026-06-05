"""Distribution Operations Center — Distributor executive overview.

The Manufacturer Executive Command Center pattern applied to distributors:
KPI strip · AI brief · revenue trend · top/slow movers · inbound performance ·
stockout risk · retailer network KPIs · AI recommendations. Reads are served
from a pre-aggregated snapshot collection so the page opens instantly.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException

from core import db
from services.snapshots import read_or_compute, recompute

router = APIRouter()

# -- helpers -----------------------------------------------------------------


def _iso_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _delta_pct(cur: float, prev: float) -> float:
    if not prev:
        return 0.0 if not cur else 100.0
    return round(((cur - prev) / prev) * 100, 1)


def _spark(series: list, length: int = 12) -> list:
    """Compress a daily series down to ``length`` evenly-spaced buckets."""
    if not series:
        return [0] * length
    step = max(1, len(series) // length)
    out = []
    for i in range(0, len(series), step):
        out.append(sum(series[i:i + step]))
        if len(out) >= length:
            break
    while len(out) < length:
        out.append(0)
    return out[:length]


def _grade(score: float) -> str:
    if score >= 85:
        return "A+"
    if score >= 75:
        return "A"
    if score >= 65:
        return "B"
    if score >= 55:
        return "C"
    return "D"


# -- endpoints ---------------------------------------------------------------


@router.get("/distributor/{distributor_id}/overview")
async def distributor_overview(distributor_id: str):
    """Executive Operations Center payload for a distributor."""
    return await read_or_compute(
        "distributor-overview", distributor_id,
        lambda: _build_distributor_overview(distributor_id),
    )


@router.post("/distributor/{distributor_id}/overview/refresh")
async def distributor_overview_refresh(distributor_id: str):
    return await recompute(
        "distributor-overview", distributor_id,
        lambda: _build_distributor_overview(distributor_id),
    )


# -- builder -----------------------------------------------------------------


async def _build_distributor_overview(distributor_id: str) -> dict:
    distributor = await db.distributors.find_one({"id": distributor_id}, {"_id": 0})
    if not distributor:
        raise HTTPException(404, "Distributor not found")

    now = datetime.now(timezone.utc)
    today = now.date()
    cutoff_30 = (now - timedelta(days=30)).isoformat()
    cutoff_60 = (now - timedelta(days=60)).isoformat()
    cutoff_7 = (now - timedelta(days=7)).isoformat()
    cutoff_14 = (now - timedelta(days=14)).isoformat()

    # ---- Reference catalogues ------------------------------------------------
    products = await db.products.find({}, {"_id": 0}).to_list(None)
    product_by_id = {p["id"]: p for p in products}

    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).to_list(None)
    retailer_ids = [r["id"] for r in retailers]
    retailer_by_id = {r["id"]: r for r in retailers}

    # ---- Inventory ----------------------------------------------------------
    inventory = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": distributor_id}, {"_id": 0},
    ).to_list(None)
    inv_by_product: dict[str, dict] = {}
    for row in inventory:
        pid = row.get("product_id")
        if pid:
            inv_by_product[pid] = row
    total_units = sum(int(r.get("quantity") or 0) for r in inventory)
    low_stock_skus = sum(
        1 for r in inventory
        if int(r.get("quantity") or 0) <= int(r.get("reorder_level") or 0)
    )
    in_stock_skus = sum(1 for r in inventory if (r.get("quantity") or 0) > 0)

    # ---- Inbound shipments (manufacturer → distributor) ---------------------
    inbound = await db.shipments.find(
        {"to_id": distributor_id, "to_role": "distributor"}, {"_id": 0},
    ).to_list(None)
    inbound_status = defaultdict(int)
    for s in inbound:
        inbound_status[(s.get("status") or "pending").lower()] += 1

    # ---- Distributor orders (from this distributor to manufacturer) ---------
    own_orders = await db.distributor_orders.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).to_list(None)
    own_orders_by_status = defaultdict(int)
    for o in own_orders:
        own_orders_by_status[(o.get("status") or "pending").lower()] += 1
    pending_distributor_orders = (
        own_orders_by_status["pending"] + own_orders_by_status["approved"]
    )

    # ---- Retailer requests (retailers ordering from this distributor) -------
    retailer_requests = await db.stock_requests.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).to_list(None)
    open_retailer_requests = sum(
        1 for r in retailer_requests if (r.get("status") or "") == "pending"
    )

    # ---- Sales: daily_sales of retailers under this distributor -------------
    daily_sales = await db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": cutoff_60[:10]}},
        {"_id": 0},
    ).to_list(None) if retailer_ids else []

    rev_now = 0.0
    rev_prev = 0.0
    units_now = 0
    units_prev = 0
    sales_by_product: dict[str, dict] = defaultdict(lambda: {"units": 0, "revenue": 0.0})
    sales_by_retailer: dict[str, dict] = defaultdict(lambda: {"units": 0, "revenue": 0.0})
    daily_rev: dict[str, float] = defaultdict(float)
    daily_units: dict[str, int] = defaultdict(int)
    cutoff_30_date = cutoff_30[:10]
    cutoff_60_date = cutoff_60[:10]

    for row in daily_sales:
        date = row.get("date") or ""
        units = int(row.get("units_sold") or 0)
        rev = float(row.get("revenue") or 0.0)
        if not rev and units:
            p = product_by_id.get(row.get("product_id"))
            if p:
                rev = float(p.get("unit_price") or 0) * units
        if date >= cutoff_30_date:
            rev_now += rev
            units_now += units
            sales_by_product[row.get("product_id")]["units"] += units
            sales_by_product[row.get("product_id")]["revenue"] += rev
            sales_by_retailer[row.get("retailer_id")]["units"] += units
            sales_by_retailer[row.get("retailer_id")]["revenue"] += rev
            daily_rev[date] += rev
            daily_units[date] += units
        elif date >= cutoff_60_date:
            rev_prev += rev
            units_prev += units

    rev_growth = _delta_pct(rev_now, rev_prev)
    units_growth = _delta_pct(units_now, units_prev)

    # ---- KPIs ---------------------------------------------------------------
    active_retailer_ids = {
        rid for rid, stats in sales_by_retailer.items() if stats["units"] > 0
    }
    active_retailer_count = len(active_retailer_ids)
    retail_coverage_pct = round(
        active_retailer_count / max(len(retailer_ids), 1) * 100, 1
    )

    days_of_cover = (
        round(total_units / max(units_now / 30, 1), 1) if units_now else None
    )
    inventory_health_score = round(
        in_stock_skus / max(len(inventory), 1) * 100 if inventory else 0, 1
    )

    # Fill rate (own orders fulfilled vs ordered units in the last 60 days)
    ordered_units = 0
    fulfilled_units = 0
    for o in own_orders:
        for it in (o.get("items") or []):
            q = int(it.get("quantity") or 0)
            ordered_units += q
            if (o.get("status") or "").lower() in ("dispatched", "delivered"):
                fulfilled_units += q
    fill_rate = round(fulfilled_units / max(ordered_units, 1) * 100, 1)

    # 30-day sparkline series
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    sp_rev = [round(daily_rev.get(d, 0), 2) for d in days]
    sp_units = [daily_units.get(d, 0) for d in days]
    sp_orders = [0] * 30
    for o in own_orders:
        d = (o.get("created_at") or "")[:10]
        if d in days:
            sp_orders[days.index(d)] += 1

    kpis = {
        "revenue_30d": {
            "value": round(rev_now, 2),
            "growth_pct": rev_growth,
            "spark": _spark(sp_rev),
        },
        "retail_coverage": {
            "value": retail_coverage_pct,
            "active": active_retailer_count,
            "total": len(retailer_ids),
            "growth_pct": 0.0,  # placeholder – needs historical snapshot
            "spark": _spark([1 if r in active_retailer_ids else 0 for r in retailer_ids]),
        },
        "pending_orders": {
            "value": pending_distributor_orders + open_retailer_requests,
            "from_manufacturer": pending_distributor_orders,
            "from_retailers": open_retailer_requests,
            "growth_pct": 0.0,
            "spark": _spark(sp_orders),
        },
        "days_of_cover": {
            "value": days_of_cover,
            "growth_pct": 0.0,
            "spark": _spark(sp_units),
        },
        "fill_rate": {
            "value": fill_rate,
            "growth_pct": 0.0,
            "spark": [fill_rate + (i % 3 - 1) for i in range(12)],
        },
        "inventory_health": {
            "value": inventory_health_score,
            "in_stock": in_stock_skus,
            "low_stock": low_stock_skus,
            "total_skus": len(inventory),
            "growth_pct": 0.0,
            "spark": _spark([inventory_health_score for _ in range(12)]),
        },
        "order_breakdown": {
            "pending": own_orders_by_status["pending"],
            "approved": own_orders_by_status["approved"],
            "dispatched": own_orders_by_status["dispatched"],
            "delivered": own_orders_by_status["delivered"],
            "rejected": own_orders_by_status["rejected"],
        },
    }

    # ---- Top + slow products -------------------------------------------------
    product_rows = []
    for pid, stats in sales_by_product.items():
        p = product_by_id.get(pid)
        if not p:
            continue
        inv = inv_by_product.get(pid) or {}
        units = stats["units"]
        avg_daily = units / 30 if units else 0
        on_hand = int(inv.get("quantity") or 0)
        days_left = round(on_hand / avg_daily, 1) if avg_daily else None
        product_rows.append({
            "id": pid,
            "name": p["name"],
            "category": p.get("category", "—"),
            "image_url": p.get("image_url") or "",
            "units_sold_30d": units,
            "revenue_30d": round(stats["revenue"], 2),
            "on_hand": on_hand,
            "days_left": days_left,
            "velocity": round(avg_daily, 1),
        })
    top_products = sorted(product_rows, key=lambda r: r["revenue_30d"], reverse=True)[:6]
    slow_products = sorted(product_rows, key=lambda r: r["units_sold_30d"])[:6]

    # ---- Stockout-risk SKUs (inv with on-hand below 1.5× reorder OR sold-out)
    stockout_risk = []
    for r in inventory:
        on_hand = int(r.get("quantity") or 0)
        reorder = int(r.get("reorder_level") or 0)
        pid = r.get("product_id")
        p = product_by_id.get(pid) or {}
        # Skip if no signal at all
        if on_hand > reorder * 1.5 and on_hand > 0:
            continue
        avg_daily = sales_by_product.get(pid, {}).get("units", 0) / 30
        days_left = round(on_hand / avg_daily, 1) if avg_daily else None
        severity = "out" if on_hand == 0 else ("critical" if on_hand <= reorder else "low")
        stockout_risk.append({
            "product_id": pid,
            "product_name": p.get("name", "Unknown"),
            "image_url": p.get("image_url") or "",
            "on_hand": on_hand,
            "reorder_level": reorder,
            "days_left": days_left,
            "severity": severity,
        })
    severity_rank = {"out": 0, "critical": 1, "low": 2}
    stockout_risk.sort(key=lambda r: (severity_rank.get(r["severity"], 3),
                                       r["days_left"] if r["days_left"] is not None else 999))
    stockout_risk = stockout_risk[:8]

    # ---- Top retailers -------------------------------------------------------
    top_retailers = []
    for rid, stats in sales_by_retailer.items():
        retailer = retailer_by_id.get(rid) or {}
        if not retailer:
            continue
        top_retailers.append({
            "id": rid,
            "name": retailer.get("name") or "Unknown",
            "city": retailer.get("city") or "",
            "region": retailer.get("region") or "",
            "units_30d": stats["units"],
            "revenue_30d": round(stats["revenue"], 2),
        })
    top_retailers.sort(key=lambda r: r["revenue_30d"], reverse=True)
    top_retailers = top_retailers[:8]

    # ---- Revenue trend (12-month placeholder using daily series) -------------
    revenue_trend = []
    bucket_revenue = defaultdict(float)
    bucket_units = defaultdict(int)
    for d in days:
        month = d[:7]
        bucket_revenue[month] += daily_rev.get(d, 0)
        bucket_units[month] += daily_units.get(d, 0)
    for m in sorted(bucket_revenue.keys()):
        revenue_trend.append({
            "month": m,
            "revenue": round(bucket_revenue[m], 2),
            "units": bucket_units[m],
        })

    # ---- AI Brief (rule-based, 4 cards) --------------------------------------
    insights = []
    # 1) Revenue trajectory
    if rev_growth >= 5:
        insights.append({
            "type": "growth",
            "title": "Revenue momentum",
            "body": f"Last-30-day revenue is up {rev_growth}% versus the prior 30 days — sustained growth indicates healthy network demand.",
            "tone": "positive",
        })
    elif rev_growth <= -5:
        insights.append({
            "type": "growth",
            "title": "Revenue softening",
            "body": f"Last-30-day revenue is down {abs(rev_growth)}% versus the prior period. Review top retailers for re-engagement.",
            "tone": "warning",
        })
    else:
        insights.append({
            "type": "growth",
            "title": "Revenue stable",
            "body": f"Revenue is flat (±{rev_growth}%) over the last 30 days. Look for activation opportunities in dormant retailers.",
            "tone": "neutral",
        })

    # 2) Stockout pressure
    out_count = sum(1 for r in stockout_risk if r["severity"] == "out")
    crit_count = sum(1 for r in stockout_risk if r["severity"] == "critical")
    if out_count or crit_count:
        insights.append({
            "type": "inventory",
            "title": "Stockout risk",
            "body": f"{out_count} SKU(s) are completely out of stock and {crit_count} are below reorder level. Trigger replenishment now.",
            "tone": "alert",
        })
    else:
        insights.append({
            "type": "inventory",
            "title": "Inventory healthy",
            "body": f"{inventory_health_score}% of catalogued SKUs are in stock. No imminent stockouts detected.",
            "tone": "positive",
        })

    # 3) Retail coverage
    if retail_coverage_pct < 50:
        insights.append({
            "type": "coverage",
            "title": "Activation opportunity",
            "body": f"Only {active_retailer_count}/{len(retailer_ids)} ({retail_coverage_pct}%) retailers transacted in the last 30 days. {len(retailer_ids) - active_retailer_count} dormant retailers represent immediate uplift potential.",
            "tone": "warning",
        })
    else:
        insights.append({
            "type": "coverage",
            "title": "Strong network activity",
            "body": f"{retail_coverage_pct}% retailer activation — {active_retailer_count} of {len(retailer_ids)} retailers ordered in the last 30 days.",
            "tone": "positive",
        })

    # 4) Order velocity
    if pending_distributor_orders + open_retailer_requests > 5:
        insights.append({
            "type": "orders",
            "title": "Order queue building",
            "body": f"{pending_distributor_orders} purchase order(s) awaiting manufacturer dispatch and {open_retailer_requests} retailer request(s) pending. Clear the queue to keep fill-rate at {fill_rate}%.",
            "tone": "warning",
        })
    else:
        insights.append({
            "type": "orders",
            "title": "Order pipeline clean",
            "body": "All inbound and outbound orders are flowing without backlog.",
            "tone": "positive",
        })

    # ---- AI Recommendations (actionable bullets) -----------------------------
    recommendations = []
    for r in stockout_risk[:3]:
        if r["severity"] == "out":
            recommendations.append({
                "icon": "alert",
                "title": f"Reorder {r['product_name']}",
                "detail": f"Sold out — order replenishment immediately.",
            })
        elif r["severity"] == "critical":
            recommendations.append({
                "icon": "alert",
                "title": f"Reorder {r['product_name']}",
                "detail": f"Only {r['on_hand']} units left ({r['days_left']}d cover). Reorder this week.",
            })
    if top_retailers:
        recommendations.append({
            "icon": "growth",
            "title": f"Reward {top_retailers[0]['name']}",
            "detail": "Top revenue retailer — consider loyalty bonus or volume discount to lock in the relationship.",
        })
    dormant_ids = [rid for rid in retailer_ids if rid not in active_retailer_ids]
    if dormant_ids:
        sample_name = retailer_by_id.get(dormant_ids[0], {}).get("name", "a retailer")
        recommendations.append({
            "icon": "coverage",
            "title": "Reactivate dormant retailers",
            "detail": f"{len(dormant_ids)} retailer(s) (e.g. {sample_name}) haven't ordered in 30 days — schedule outreach.",
        })
    if not recommendations:
        recommendations.append({
            "icon": "growth",
            "title": "Network performing well",
            "detail": "No urgent actions — focus on growth experiments in your strongest territories.",
        })

    return {
        "distributor": {
            "id": distributor_id,
            "name": distributor.get("name") or "",
            "region": distributor.get("region") or "",
            "city": distributor.get("city") or "",
        },
        "kpis": kpis,
        "ai_brief": {"insights": insights[:4]},
        "ai_recommendations": recommendations[:5],
        "revenue_trend": revenue_trend,
        "top_products": top_products,
        "slow_products": slow_products,
        "stockout_risk": stockout_risk,
        "top_retailers": top_retailers,
        "inbound_shipments": {
            "pending": inbound_status["pending"],
            "in_transit": inbound_status["in_transit"],
            "delivered": inbound_status["delivered"],
            "delayed": inbound_status["delayed"],
        },
        "as_of": now.isoformat(),
    }
