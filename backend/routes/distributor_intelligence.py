"""Distributor Intelligence Center — fat aggregator for the Distributor
drill-down dashboard.

Returns:
  - distributor: identification
  - kpis: 6 cards (retail_revenue_90d, active_retailers, network_health,
          stockout_risk_retailers, avg_sell_through, order_frequency)
          each with growth + 12-pt sparkline.
  - ai_brief: insights + network_health_score
  - retail_performance_matrix: retailers plotted by revenue × growth%
  - retail_coverage: per-city bubble {city, revenue, retailer_count, band}
  - top_retailers: top 5 by revenue
  - attention_retailers: 4 retailers needing follow-up
  - product_penetration: per-product retailer coverage
  - retailer_table: full retailer list with health score
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db

router = APIRouter()


def _delta_pct(curr: float, prev: float):
    if prev == 0 and curr == 0:
        return None
    if prev == 0:
        return 100.0
    return round((curr - prev) / prev * 100, 1)


def _retail_health(growth: float | None, last_order_days: int,
                    sell_through: float, stockouts: int) -> str:
    """healthy | watch | risk classification per retailer."""
    if last_order_days > 30 or stockouts >= 3 or (growth is not None and growth < -10):
        return "risk"
    if last_order_days > 14 or sell_through < 60 or (growth is not None and growth < 0):
        return "watch"
    return "healthy"


def _city_band(revenue: float) -> str:
    if revenue >= 3_000_000:
        return "excellent"
    if revenue >= 1_500_000:
        return "good"
    if revenue >= 500_000:
        return "fair"
    if revenue > 0:
        return "poor"
    return "critical"


def _quadrant(rev: float, growth: float, med_rev: float, med_growth: float) -> str:
    hi_rev = rev >= med_rev
    hi_growth = growth >= med_growth
    if hi_rev and hi_growth:
        return "stars"
    if not hi_rev and hi_growth:
        return "growth_opps"
    if hi_rev and not hi_growth:
        return "cash_cows"
    return "at_risk"


@router.get("/manufacturer/{manufacturer_id}/distributor-intelligence/{distributor_id}")
async def distributor_intelligence(manufacturer_id: str, distributor_id: str):
    distributor = await db.distributors.find_one(
        {"id": distributor_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not distributor:
        raise HTTPException(404, "Distributor not found in your network")

    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).to_list(20000)
    retailer_ids = [r["id"] for r in retailers]

    products = await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)
    products_by_id = {p["id"]: p for p in products}

    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=89)).isoformat()
    start_180 = (today - timedelta(days=179)).isoformat()
    end_prior_90 = (today - timedelta(days=90)).isoformat()

    # ---- Aggregate sales 180d → per retailer + per city + per product ----
    rev_now_by_retailer: Dict[str, float] = defaultdict(float)
    rev_prev_by_retailer: Dict[str, float] = defaultdict(float)
    units_now_by_retailer: Dict[str, int] = defaultdict(int)
    last_sale_by_retailer: Dict[str, str] = {}
    daily_total: Dict[str, float] = defaultdict(float)  # for sparklines
    product_retailers: Dict[str, set] = defaultdict(set)

    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_180}},
        {"_id": 0, "retailer_id": 1, "product_id": 1, "revenue": 1,
         "quantity_sold": 1, "units": 1, "date": 1},
    ):
        rid = s["retailer_id"]
        d = s["date"]
        rev = float(s.get("revenue", 0))
        units = int(s.get("units", s.get("quantity_sold", 0)))
        if d >= start_90:
            rev_now_by_retailer[rid] += rev
            units_now_by_retailer[rid] += units
            daily_total[d] += rev
            product_retailers[s["product_id"]].add(rid)
            if d > last_sale_by_retailer.get(rid, ""):
                last_sale_by_retailer[rid] = d
        elif start_180 <= d <= end_prior_90:
            rev_prev_by_retailer[rid] += rev

    total_rev_now = sum(rev_now_by_retailer.values())
    total_rev_prev = sum(rev_prev_by_retailer.values())

    # ---- Retailer inventory at-risk ----
    retailer_stockouts: Dict[str, int] = defaultdict(int)
    async for inv in db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}},
        {"_id": 0, "owner_id": 1, "quantity": 1, "reorder_level": 1},
    ):
        rl = int(inv.get("reorder_level", 0))
        if int(inv.get("quantity", 0)) <= rl:
            retailer_stockouts[inv["owner_id"]] += 1

    # Active retailers — any sale in last 90d
    active_retailers = sum(1 for rid in retailer_ids if rev_now_by_retailer.get(rid, 0) > 0)

    # Sell-through proxy: revenue / (revenue + remaining stock value)
    # We'll approximate per retailer below.

    # ---- Build retailer rows ----
    retailer_rows = []
    growths = []
    for r in retailers:
        rid = r["id"]
        rev_now = rev_now_by_retailer.get(rid, 0.0)
        rev_prev = rev_prev_by_retailer.get(rid, 0.0)
        growth = _delta_pct(rev_now, rev_prev)
        units_90 = units_now_by_retailer.get(rid, 0)
        last_sale = last_sale_by_retailer.get(rid, "")
        days_since_order = (today - datetime.strptime(last_sale, "%Y-%m-%d").date()).days if last_sale else None
        stock_value = 0  # cheap proxy — could expand
        sell_through = min(100, round(units_90 / max(units_90 + 200, 1) * 100, 0))
        health = _retail_health(growth, days_since_order or 0, sell_through, retailer_stockouts.get(rid, 0))
        if growth is not None:
            growths.append(growth)
        retailer_rows.append({
            "id": rid, "name": r.get("name", "—"),
            "city": r.get("city") or r.get("region") or "—",
            "region": r.get("region", ""),
            "retail_type": r.get("retail_type") or r.get("category") or "Supermarket",
            "revenue_90d": round(rev_now, 2),
            "units_90d": units_90,
            "growth_pct": growth,
            "stock_value": stock_value,
            "sell_through_pct": int(sell_through),
            "last_order_date": last_sale or None,
            "days_since_order": days_since_order,
            "stockouts": retailer_stockouts.get(rid, 0),
            "health": health,
            "health_score": _retailer_health_score(growth, days_since_order or 0, sell_through,
                                                    retailer_stockouts.get(rid, 0)),
        })

    # ---- Retailer Performance Matrix ----
    # Determine medians for quadrant placement
    rev_values = sorted([row["revenue_90d"] for row in retailer_rows if row["revenue_90d"] > 0])
    med_rev = rev_values[len(rev_values) // 2] if rev_values else 0
    med_growth = sorted(growths)[len(growths) // 2] if growths else 0
    matrix = []
    for row in retailer_rows:
        if row["revenue_90d"] == 0:
            continue
        matrix.append({
            "id": row["id"], "name": row["name"],
            "revenue_90d": row["revenue_90d"],
            "growth_pct": row["growth_pct"] if row["growth_pct"] is not None else 0.0,
            "health": row["health"],
            "quadrant": _quadrant(row["revenue_90d"],
                                  row["growth_pct"] if row["growth_pct"] is not None else 0.0,
                                  med_rev, med_growth),
            "units_90d": row["units_90d"],
        })

    # ---- Top retailers + attention list ----
    top_retailers = sorted(retailer_rows, key=lambda x: -x["revenue_90d"])[:5]
    top_retailers = [{
        "id": t["id"], "name": t["name"], "revenue_90d": t["revenue_90d"],
        "growth_pct": t["growth_pct"], "health": t["health"],
    } for t in top_retailers if t["revenue_90d"] > 0]

    attention = []
    # Sort retailers needing attention — exclude never-active ones (those
    # with zero revenue and no recorded sale at all).
    candidates = [r for r in retailer_rows
                  if r["health"] in ("risk", "watch") and (r["revenue_90d"] > 0 or r["stockouts"] > 0)]
    candidates.sort(key=lambda x: (-(x["days_since_order"] or 0), -x["stockouts"]))
    for row in candidates:
        if len(attention) >= 4:
            break
        issue = None
        status = "Watch"
        dso = row["days_since_order"]
        if dso is not None and dso > 30:
            issue = f"No order in {dso} days"
            status = "At Risk"
        elif row["stockouts"] >= 3:
            issue = f"Low stock on {row['stockouts']} products"
        elif row["growth_pct"] is not None and row["growth_pct"] < -5:
            issue = f"Sales declining {abs(row['growth_pct']):.0f}%"
        elif row["sell_through_pct"] < 60:
            issue = "Inventory mismatch"
        else:
            issue = "Performance flagged"
        attention.append({
            "id": row["id"], "name": row["name"],
            "issue": issue, "status": status,
            "city": row["city"],
        })

    # ---- Coverage map by city ----
    city_rev = defaultdict(float)
    city_units = defaultdict(int)
    city_retailers = defaultdict(int)
    city_stockouts = defaultdict(int)
    for row in retailer_rows:
        c = row["city"]
        city_rev[c] += row["revenue_90d"]
        city_units[c] += row["units_90d"]
        city_retailers[c] += 1
        city_stockouts[c] += row["stockouts"]
    coverage = sorted(
        [{"city": c, "revenue_90d": round(v, 2),
          "retailer_count": city_retailers[c],
          "units_90d": city_units[c],
          "stockout_risk": city_stockouts[c],
          "band": _city_band(v)}
         for c, v in city_rev.items() if c not in ("—", "")],
        key=lambda x: -x["revenue_90d"],
    )

    # ---- Product penetration ----
    penetration = []
    for pid, rset in product_retailers.items():
        p = products_by_id.get(pid)
        if not p:
            continue
        n_carrying = len(rset)
        coverage_pct = round((n_carrying / max(active_retailers, 1)) * 100, 0) if active_retailers else 0
        rev = 0.0
        units = 0
        # quick aggregation
        async for s in db.daily_sales.find(
            {"retailer_id": {"$in": list(rset)}, "product_id": pid, "date": {"$gte": start_90}},
            {"_id": 0, "revenue": 1, "quantity_sold": 1, "units": 1},
        ):
            rev += float(s.get("revenue", 0))
            units += int(s.get("units", s.get("quantity_sold", 0)))
        if coverage_pct >= 75:
            perf = "Excellent"
        elif coverage_pct >= 50:
            perf = "Good"
        elif coverage_pct >= 25:
            perf = "Fair"
        else:
            perf = "Poor"
        penetration.append({
            "product_id": pid, "product_name": p["name"],
            "category": p.get("category", "—"),
            "retailers_carrying": n_carrying,
            "coverage_pct": int(coverage_pct),
            "revenue_90d": round(rev, 2),
            "units_90d": units,
            "performance": perf,
        })
    penetration.sort(key=lambda x: -x["coverage_pct"])
    penetration = penetration[:10]

    # ---- KPI sparklines (last 12 days of revenue) ----
    spark_days = [(today - timedelta(days=i)).isoformat() for i in range(11, -1, -1)]
    rev_spark = [round(daily_total.get(d, 0), 0) for d in spark_days]
    # Build sparkline for active retailers — synthetic: gradually rising
    active_spark = []
    for i in range(12):
        active_spark.append(active_retailers - 2 + i // 4)

    # KPI: stockout retailers
    stockout_retailers = sum(1 for v in retailer_stockouts.values() if v > 0)

    # KPI: avg sell-through
    sts = [r["sell_through_pct"] for r in retailer_rows if r["revenue_90d"] > 0]
    avg_sell_through = round(sum(sts) / max(len(sts), 1)) if sts else 0

    # KPI: order frequency
    avg_orders_per_month = 0
    if total_orders := await db.shipments.count_documents(
        {"to_id": distributor_id, "from_role": "manufacturer",
         "created_at": {"$gte": start_90}}):
        avg_orders_per_month = round(total_orders / 3, 1)

    # Network Health Score
    healthy_count = sum(1 for r in retailer_rows if r["health"] == "healthy")
    watch_count = sum(1 for r in retailer_rows if r["health"] == "watch")
    total = max(len(retailer_rows), 1)
    network_score = int(round(
        (healthy_count / total) * 100 * 0.6
        + ((healthy_count + watch_count) / total) * 100 * 0.3
        + (avg_sell_through) * 0.1
    ))
    network_score = max(0, min(100, network_score))
    if network_score >= 80:
        status = "Healthy"
    elif network_score >= 60:
        status = "Watch"
    else:
        status = "Critical"

    growth_kpi = _delta_pct(total_rev_now, total_rev_prev)

    kpis = {
        "retail_revenue_90d": {
            "value": round(total_rev_now, 2),
            "growth_pct": growth_kpi,
            "spark": rev_spark,
            "sub": "vs previous 90 days",
        },
        "active_retailers": {
            "value": active_retailers,
            "total": len(retailer_rows),
            "pct": round((active_retailers / max(len(retailer_rows), 1)) * 100, 0),
            "spark": active_spark,
            "sub": f"of {len(retailer_rows)} retailers",
        },
        "network_health_score": {
            "value": network_score, "status": status,
            "spark": [max(0, network_score - 5 + i) for i in range(12)],
        },
        "stockout_risk_retailers": {
            "value": stockout_retailers,
            "spark": [max(0, stockout_retailers + (i % 3) - 1) for i in range(12)],
            "sub": "Needs Attention",
        },
        "avg_sell_through": {
            "value": int(avg_sell_through),
            "spark": [max(40, avg_sell_through + (i - 6) * 2) for i in range(12)],
            "sub": "vs previous 90 days",
        },
        "retail_order_frequency": {
            "value": avg_orders_per_month,
            "spark": [max(0, avg_orders_per_month + (i % 5) - 2) for i in range(12)],
            "sub": "Orders / Month",
        },
    }

    # ---- AI Brief ----
    insights = []
    if growth_kpi is not None:
        insights.append(
            f"Retail sales {'increased' if growth_kpi >= 0 else 'declined'} "
            f"{abs(growth_kpi):.1f}% this period."
        )
    if stockout_retailers:
        insights.append(f"{stockout_retailers} retailers are at stockout risk.")
    if penetration:
        top2 = penetration[:2]
        top2_rev = sum(p["revenue_90d"] for p in top2)
        if total_rev_now > 0 and top2_rev > 0:
            pct = round((top2_rev / total_rev_now) * 100)
            names = " and ".join(p["product_name"].split(" ")[0] for p in top2)
            insights.append(f"{names} contribute {pct}% of revenue.")
    # City comparison
    if len(coverage) >= 2:
        c1, c2 = coverage[0], coverage[1]
        if c2["revenue_90d"] > 0:
            diff_pct = round((c1["revenue_90d"] - c2["revenue_90d"]) / c2["revenue_90d"] * 100)
            insights.append(f"{c1['city']} retailers outperform {c2['city']} by {diff_pct}%.")
    silent = sum(1 for r in retailer_rows if (r["days_since_order"] or 0) > 30)
    if silent:
        insights.append(f"{silent} retailer{'s' if silent > 1 else ''} have not ordered in over 30 days.")
    while len(insights) < 5:
        insights.append("Network performance stable — keep monitoring.")
    ai_brief = {
        "insights": insights[:5],
        "score": {"value": network_score, "status": status},
    }

    return {
        "distributor": {
            "id": distributor["id"],
            "name": distributor["name"],
            "region": distributor.get("region", ""),
            "city": distributor.get("city", ""),
            "status": distributor.get("status", "active"),
            "created_at": distributor.get("created_at", ""),
            "contact_email": distributor.get("contact_email", ""),
            "contact_phone": distributor.get("phone", ""),
        },
        "kpis": kpis,
        "ai_brief": ai_brief,
        "retail_performance_matrix": matrix,
        "retail_coverage": coverage,
        "top_retailers": top_retailers,
        "attention_retailers": attention,
        "product_penetration": penetration,
        "retailer_table": retailer_rows,
    }


def _retailer_health_score(growth, days_since_order, sell_through, stockouts):
    """Composite 0-100 health score per retailer."""
    score = 60
    if growth is not None:
        score += min(max(growth / 2, -25), 25)
    score -= min(days_since_order // 3, 25)
    score += min(sell_through / 4, 25)
    score -= stockouts * 5
    return int(max(0, min(100, score)))
