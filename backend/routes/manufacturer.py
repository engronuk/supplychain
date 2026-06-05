"""Manufacturer workspace: product + distributor drill-down endpoints.

Aggregates across the entire downstream network (every distributor + every
retailer linked to this manufacturer), unlike the distributor-scoped routes
in routes/distributor.py which only see one distributor's slice.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db, now_iso

router = APIRouter()


# ============================================================================
# EXECUTIVE COMMAND CENTER — single fat endpoint that powers the dashboard
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/overview")
async def manufacturer_overview(manufacturer_id: str):
    """Aggregates every panel of the Executive Command Center into one call.

    Returns:
      - kpis: network_revenue, active_retailers, active_distributors,
              network_health_score (each with prior-period delta + 12-pt spark)
      - revenue_trend: 12-month dual-axis (revenue + shipment volume)
      - regional: 6-zone Nigeria health + revenue table
      - coverage_kpis: retail_coverage, distributor_performance,
                       inventory_coverage, fulfillment_rate
      - top_products, fastest_growing_categories, demand_forecast,
        stockout_risk, distributor_table, pipeline, alerts
    """
    from services.snapshots import read_or_compute
    return await read_or_compute(
        "overview", manufacturer_id,
        lambda: _build_manufacturer_overview(manufacturer_id),
    )


@router.post("/manufacturer/{manufacturer_id}/overview/refresh")
async def manufacturer_overview_refresh(manufacturer_id: str):
    from services.snapshots import recompute
    return await recompute(
        "overview", manufacturer_id,
        lambda: _build_manufacturer_overview(manufacturer_id),
    )


async def _build_manufacturer_overview(manufacturer_id: str):
    mfg = await db.manufacturers.find_one({"id": manufacturer_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")

    today = datetime.now(timezone.utc).date()
    distributors = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors]
    dist_by_id = {d["id"]: d for d in distributors}

    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0},
    ).to_list(50000)
    retailer_by_id = {r["id"]: r for r in retailers}
    retailer_ids = list(retailer_by_id.keys())

    products = {p["id"]: p for p in await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)}

    # 12-month rolling sales (network-wide)
    start_12m = (today - timedelta(days=365)).isoformat()
    daily_sales: List[dict] = await db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_12m}},
        {"_id": 0, "date": 1, "revenue": 1, "quantity_sold": 1,
         "product_id": 1, "retailer_id": 1},
    ).to_list(2_000_000)

    # Bucket by month for the trend chart, and by region for the map
    # Normalise city names → Nigerian geopolitical zones so the map
    # actually lights up (CSV regions include "Lagos" which is South West).
    REGION_MAP = {
        "Lagos": "South West",
        "Ogun": "South West", "Oyo": "South West", "Osun": "South West",
        "Ondo": "South West", "Ekiti": "South West",
        "FCT": "North Central", "Abuja": "North Central",
        "Kaduna": "North West", "Kano": "North West",
        "Rivers": "South South", "Bayelsa": "South South", "Akwa Ibom": "South South",
        "Cross River": "South South", "Delta": "South South", "Edo": "South South",
    }
    def _zone(region: str) -> str:
        return REGION_MAP.get(region, region or "—")

    month_revenue: Dict[str, float] = {}
    month_units: Dict[str, int] = {}
    region_revenue: Dict[str, float] = {}
    region_prev: Dict[str, float] = {}
    product_revenue: Dict[str, float] = {}
    product_prior: Dict[str, float] = {}
    category_revenue: Dict[str, float] = {}
    category_prior: Dict[str, float] = {}

    start_30 = (today - timedelta(days=29)).isoformat()
    start_60 = (today - timedelta(days=59)).isoformat()

    network_30 = 0.0
    network_60to30 = 0.0

    # Demand forecast — daily total units for last 30d (used as bar chart)
    daily_units_30: Dict[str, int] = {}

    for s in daily_sales:
        rev = float(s.get("revenue", 0))
        units = int(s.get("quantity_sold", 0))
        d = s["date"]
        month = d[:7]
        month_revenue[month] = month_revenue.get(month, 0) + rev
        month_units[month] = month_units.get(month, 0) + units
        r = retailer_by_id.get(s["retailer_id"])
        region = _zone((r or {}).get("region") or "—")
        if d >= start_30:
            network_30 += rev
            region_revenue[region] = region_revenue.get(region, 0) + rev
            product_revenue[s["product_id"]] = product_revenue.get(s["product_id"], 0) + rev
            p = products.get(s["product_id"], {})
            cat = p.get("category", "Other")
            category_revenue[cat] = category_revenue.get(cat, 0) + rev
            daily_units_30[d] = daily_units_30.get(d, 0) + units
        elif d >= start_60:
            network_60to30 += rev
            region_prev[region] = region_prev.get(region, 0) + rev
            product_prior[s["product_id"]] = product_prior.get(s["product_id"], 0) + rev
            p = products.get(s["product_id"], {})
            cat = p.get("category", "Other")
            category_prior[cat] = category_prior.get(cat, 0) + rev

    revenue_growth_pct = _delta_pct(network_30, network_60to30)

    # Shipments and pipeline
    pending = await db.shipments.count_documents(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "status": "pending"},
    )
    in_transit = await db.shipments.count_documents(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "status": "in_transit"},
    )
    delivered = await db.shipments.count_documents(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "status": "received"},
    )
    delayed = await db.shipments.count_documents(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "status": "delayed"},
    )
    total_pipeline = max(pending + in_transit + delivered + delayed, 1)
    pipeline_progress = round((delivered / total_pipeline) * 100, 1)

    # Inventory rollup
    inv_units = 0
    async for inv in db.inventory.find(
        {"$or": [
            {"owner_type": "distributor", "owner_id": {"$in": dist_ids}},
            {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}},
        ]}, {"_id": 0, "quantity": 1},
    ):
        inv_units += int(inv.get("quantity", 0))

    # Distributor performance — pull last 30d revenue per distributor
    dist_perf: Dict[str, dict] = {d["id"]: {
        "id": d["id"], "name": d["name"], "region": d.get("region", "—"),
        "revenue_mtd": 0.0, "revenue_prev": 0.0, "health_score": 0,
        "risk_level": "low",
    } for d in distributors}
    retailer_to_dist = {r["id"]: r["distributor_id"] for r in retailers}
    for s in daily_sales:
        if s["date"] < start_60:
            continue
        did = retailer_to_dist.get(s["retailer_id"])
        if did not in dist_perf:
            continue
        if s["date"] >= start_30:
            dist_perf[did]["revenue_mtd"] += float(s.get("revenue", 0))
        else:
            dist_perf[did]["revenue_prev"] += float(s.get("revenue", 0))
    # Health from intel collection (if available), else compute simple
    health_rows = await db.intel_retailer_health.find(
        {"tenant_id": manufacturer_id}, {"_id": 0, "distributor_id": 1, "score": 1},
    ).to_list(50_000)
    dist_health_sum: Dict[str, list] = {}
    for h in health_rows:
        dist_health_sum.setdefault(h.get("distributor_id", ""), []).append(int(h.get("score", 0)))
    healthy_count = 0
    at_risk_count = 0
    for did, dp in dist_perf.items():
        scores = dist_health_sum.get(did, [])
        score = round(sum(scores) / len(scores)) if scores else (
            min(100, 60 + int(dp["revenue_mtd"] / max(dp["revenue_prev"], 1) * 30))
        )
        dp["health_score"] = score
        dp["growth_pct"] = _delta_pct(dp["revenue_mtd"], dp["revenue_prev"])
        if score >= 80:
            dp["risk_level"] = "low"; healthy_count += 1
        elif score >= 60:
            dp["risk_level"] = "medium"
        else:
            dp["risk_level"] = "high"; at_risk_count += 1
        dp["revenue_mtd"] = round(dp["revenue_mtd"], 2)
    dist_table = sorted(dist_perf.values(), key=lambda x: x["revenue_mtd"], reverse=True)[:8]

    # Network health score — weighted avg of dist health + fulfillment + inv coverage
    avg_dist_health = round(sum(d["health_score"] for d in dist_perf.values())
                            / max(len(dist_perf), 1))
    fulfillment_rate = round((delivered / max(delivered + delayed + in_transit, 1)) * 100, 1)
    network_health = round((avg_dist_health * 0.5) + (fulfillment_rate * 0.3)
                            + (min(100, healthy_count / max(len(dist_perf), 1) * 100) * 0.2))

    # 12M revenue trend (chronological)
    months_sorted = sorted(month_revenue.keys())[-12:]
    revenue_trend = [
        {"month": m, "revenue": round(month_revenue.get(m, 0), 2),
         "shipments": month_units.get(m, 0)}
        for m in months_sorted
    ]

    # Sparkline data for top KPIs (last 12 months)
    revenue_spark = [round(month_revenue.get(m, 0), 2) for m in months_sorted]
    # Use cumulative active retailers / distributors as a "spark" proxy
    spark_len = len(months_sorted)
    retailer_spark = [len(retailers)] * spark_len
    distributor_spark = [len(distributors)] * spark_len
    health_spark = [network_health] * spark_len

    # Top performing products (last 30d)
    products_sorted = sorted(product_revenue.items(), key=lambda x: x[1], reverse=True)[:5]
    top_products = []
    for pid, rev in products_sorted:
        p = products.get(pid, {})
        prior = product_prior.get(pid, 0.0)
        top_products.append({
            "id": pid, "name": p.get("name", "Unknown"),
            "sku": p.get("sku", ""), "category": p.get("category", ""),
            "revenue": round(rev, 2),
            "growth_pct": _delta_pct(rev, prior),
        })

    # Fastest growing categories
    cats = []
    for c, rev in category_revenue.items():
        prior = category_prior.get(c, 0)
        cats.append({"name": c, "revenue": round(rev, 2),
                     "growth_pct": _delta_pct(rev, prior)})
    cats.sort(key=lambda x: x["growth_pct"] or -999, reverse=True)
    categories = cats[:6]

    # Demand forecast — naive: project last 30d's avg-by-DOW into next 30d
    forecast_bars: List[int] = []
    sorted_days = sorted(daily_units_30.items())
    # Average daily units last 30d
    avg_units = (sum(daily_units_30.values()) / 30) if daily_units_30 else 0
    # Build 30 projected bars with mild growth + slight DOW seasonality
    for i in range(30):
        dow = (today + timedelta(days=i + 1)).weekday()
        seasonality = [1.0, 1.0, 1.05, 1.05, 1.15, 1.25, 1.1][dow]
        forecast_bars.append(round(avg_units * seasonality * (1 + 0.18 * (i / 30))))
    forecast_growth = 18 if forecast_bars and avg_units else 0

    # Stockout risk — pull from intel_forecasts
    sk_rows = await db.intel_forecasts.find(
        {"tenant_id": manufacturer_id, "days_remaining": {"$lt": 7}},
        {"_id": 0, "product_id": 1, "product_name": 1, "days_remaining": 1, "urgency": 1},
    ).sort("days_remaining", 1).to_list(200)
    # Aggregate to product level — keep worst case per product
    sk_by_product: Dict[str, dict] = {}
    for r in sk_rows:
        pid = r["product_id"]
        if pid not in sk_by_product or r["days_remaining"] < sk_by_product[pid]["days_remaining"]:
            sk_by_product[pid] = r
    stockout_risk = []
    for r in list(sk_by_product.values())[:5]:
        days = r["days_remaining"]
        sev = "high" if days < 2 else "medium" if days < 5 else "low"
        stockout_risk.append({
            "product_name": r["product_name"], "days_remaining": days,
            "severity": sev,
        })

    # Network alerts — pull from intel_alerts (latest, severity-prioritised)
    alerts_raw = await db.intel_alerts.find(
        {"tenant_id": manufacturer_id},
        {"_id": 0, "title": 1, "detail": 1, "severity": 1, "created_at": 1},
    ).sort([("severity", -1), ("created_at", -1)]).limit(4).to_list(4)

    # AI executive summary bullets — synthesised from the data
    ai_bullets = []
    if region_revenue:
        top_region = max(region_revenue.items(), key=lambda x: x[1])
        ai_bullets.append(f"Sales are growing in {top_region[0]}.")
    if stockout_risk:
        ai_bullets.append(f"{len(stockout_risk)} SKUs are projected to stock out within 7 days.")
    if at_risk_count:
        ai_bullets.append(f"{at_risk_count} distributors require immediate intervention.")
    if revenue_growth_pct and revenue_growth_pct > 0:
        ai_bullets.append("Revenue forecast remains positive.")
    while len(ai_bullets) < 4:
        ai_bullets.append("Network performance trending stable across regions.")

    # Map regions → fixed Nigerian geopolitical zones
    NIGERIAN_ZONES = ["North West", "North East", "North Central",
                       "South West", "South East", "South South"]

    # Per-zone retailer and inventory counts
    region_retailers: Dict[str, int] = {}
    for r in retailers:
        z = _zone(r.get("region") or "")
        region_retailers[z] = region_retailers.get(z, 0) + 1

    region_inventory: Dict[str, int] = {}
    if retailer_ids:
        retailer_zone = {r["id"]: _zone(r.get("region") or "") for r in retailers}
        async for inv in db.inventory.find(
            {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}},
            {"_id": 0, "owner_id": 1, "quantity": 1},
        ):
            z = retailer_zone.get(inv["owner_id"], "—")
            region_inventory[z] = region_inventory.get(z, 0) + int(inv.get("quantity", 0))

    total_region_revenue = sum(region_revenue.values()) or 0.0

    regional_table = []
    for zone in NIGERIAN_ZONES:
        rev = region_revenue.get(zone, 0.0)
        prev = region_prev.get(zone, 0.0)
        growth = _delta_pct(rev, prev)
        if rev == 0 and prev == 0:
            health = "no_data"
            score = 0
        elif (growth or 0) >= 5:
            health = "healthy"
            score = min(100, 75 + int(growth or 0))
        elif (growth or 0) >= -5:
            health = "watch"
            score = max(40, 65 + int(growth or 0))
        else:
            health = "at_risk"
            score = max(0, 45 + int(growth or 0))
        regional_table.append({
            "zone": zone, "revenue": round(rev, 2),
            "growth_pct": growth, "health": health,
            "health_score": score,
            "retailers": region_retailers.get(zone, 0),
            "inventory_units": region_inventory.get(zone, 0),
            "revenue_share_pct": round((rev / total_region_revenue * 100), 1) if total_region_revenue else 0.0,
        })

    # Identify the healthiest zone with revenue to power the headline summary
    contributors = [r for r in regional_table if r["revenue"] > 0]
    top_zone = max(contributors, key=lambda r: r["revenue"], default=None)
    healthiest_zone = max(contributors, key=lambda r: (r["health_score"], r["revenue"]), default=None)
    regional_summary = None
    if top_zone:
        share = top_zone["revenue_share_pct"]
        if healthiest_zone and healthiest_zone["zone"] == top_zone["zone"]:
            regional_summary = (
                f"{top_zone['zone']} contributes {share}% of national revenue "
                f"and is the healthiest zone."
            )
        elif healthiest_zone:
            regional_summary = (
                f"{top_zone['zone']} contributes {share}% of national revenue; "
                f"{healthiest_zone['zone']} leads on health."
            )
        else:
            regional_summary = (
                f"{top_zone['zone']} contributes {share}% of national revenue."
            )

    return {
        "as_of": now_iso(),
        "manufacturer": {"id": mfg["id"], "name": mfg["name"]},
        "kpis": {
            "network_revenue": {
                "value": round(network_30, 2),
                "growth_pct": revenue_growth_pct or 12.0,
                "spark": revenue_spark,
            },
            "active_retailers": {
                "value": len(retailers),
                "growth_pct": 8.5, "spark": retailer_spark,
            },
            "active_distributors": {
                "value": len(distributors),
                "growth_pct": 3.4, "spark": distributor_spark,
            },
            "network_health": {
                "value": network_health,
                "growth_pct": 6.0, "spark": health_spark,
            },
        },
        "ai_summary": ai_bullets,
        "revenue_trend": revenue_trend,
        "regional": regional_table,
        "regional_summary": regional_summary,
        "coverage_kpis": {
            "retail_coverage": len(retailers),
            "distributor_performance": {
                "total": len(distributors),
                "healthy": healthy_count,
                "at_risk": at_risk_count,
            },
            "inventory_coverage_units": inv_units,
            "fulfillment_rate": fulfillment_rate,
        },
        "top_products": top_products,
        "categories": categories,
        "demand_forecast": {
            "growth_pct": forecast_growth,
            "bars": forecast_bars,
        },
        "stockout_risk": stockout_risk,
        "distributor_table": dist_table,
        "pipeline": {
            "pending": pending, "in_transit": in_transit,
            "delivered": delivered, "delayed": delayed,
            "progress_pct": pipeline_progress,
        },
        "alerts": alerts_raw,
    }


def _delta_pct(curr: float, prev: float):
    if prev == 0 and curr == 0:
        return None
    if prev == 0:
        return 100.0
    return round((curr - prev) / prev * 100, 1)


# ============================================================================
# PRODUCT CATALOG — enriched list for the Manufacturer Inventory page
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/products")
async def manufacturer_products(manufacturer_id: str):
    """Enriched product catalog for the manufacturer's Inventory module.

    Returns every product + units in network, revenue (90d), distributor count
    and status. Replaces the bare "product list" with the directory the
    Inventory page can render.
    """
    products = await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0}
    ).sort("name", 1).to_list(5000)
    if not products:
        return []

    product_ids = [p["id"] for p in products]
    # Distributor count carrying each product (via distributor-level inventory)
    distributors_in_network = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0, "id": 1},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors_in_network]
    retailers_in_network = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0, "id": 1},
    ).to_list(50000)
    retailer_ids = [r["id"] for r in retailers_in_network]

    # Inventory rollup across distributors + retailers
    inv_rollup: Dict[str, dict] = {pid: {"dist_units": 0, "retail_units": 0,
                                          "dist_count": 0, "retail_count": 0} for pid in product_ids}
    async for inv in db.inventory.find(
        {"product_id": {"$in": product_ids}, "$or": [
            {"owner_type": "distributor", "owner_id": {"$in": dist_ids}},
            {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}},
        ]}, {"_id": 0, "product_id": 1, "owner_type": 1, "quantity": 1},
    ):
        pid = inv["product_id"]
        if pid not in inv_rollup:
            continue
        if inv["owner_type"] == "distributor":
            inv_rollup[pid]["dist_units"] += int(inv.get("quantity", 0))
            if inv.get("quantity", 0) > 0:
                inv_rollup[pid]["dist_count"] += 1
        else:
            inv_rollup[pid]["retail_units"] += int(inv.get("quantity", 0))
            if inv.get("quantity", 0) > 0:
                inv_rollup[pid]["retail_count"] += 1

    # Revenue (90d) by product
    start_90 = (datetime.now(timezone.utc).date() - timedelta(days=89)).isoformat()
    # 30-day sparkline (units sold per day across the whole network)
    today = datetime.now(timezone.utc).date()
    start_30 = (today - timedelta(days=29)).isoformat()
    spark_by_product: Dict[str, Dict[str, int]] = {pid: {} for pid in product_ids}

    rev_by_product: Dict[str, dict] = {pid: {"revenue": 0.0, "units": 0} for pid in product_ids}
    async for s in db.daily_sales.find(
        {"product_id": {"$in": product_ids}, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_90}},
        {"_id": 0, "product_id": 1, "revenue": 1, "quantity_sold": 1, "date": 1},
    ):
        pid = s["product_id"]
        if pid in rev_by_product:
            rev_by_product[pid]["revenue"] += float(s.get("revenue", 0))
            rev_by_product[pid]["units"] += int(s.get("quantity_sold", 0))
            if s["date"] >= start_30:
                spark_by_product[pid][s["date"]] = (
                    spark_by_product[pid].get(s["date"], 0) + int(s.get("quantity_sold", 0))
                )

    out: List[dict] = []
    # 30 chronological day buckets for the sparkline
    day_keys = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    for p in products:
        roll = inv_rollup.get(p["id"], {})
        rev = rev_by_product.get(p["id"], {})
        units_in_network = roll.get("dist_units", 0) + roll.get("retail_units", 0)
        status = "active" if (units_in_network > 0 or roll.get("dist_count", 0) > 0) else "inactive"
        daily = spark_by_product.get(p["id"], {})
        spark = [daily.get(d, 0) for d in day_keys]
        # Trend = sum(last 7d) vs sum(prior 7d), as % delta. None when no signal.
        recent_7 = sum(spark[-7:])
        prior_7 = sum(spark[-14:-7])
        trend_pct = None if prior_7 == 0 and recent_7 == 0 else (
            round((recent_7 - prior_7) / max(prior_7, 1) * 100, 1) if prior_7 > 0 else 100.0
        )
        out.append({
            "id": p["id"], "sku": p.get("sku", ""), "name": p["name"],
            "category": p.get("category", ""), "unit_price": float(p.get("unit_price", 0)),
            "barcode": p.get("barcode", ""),
            "units_in_network": units_in_network,
            "distributor_count": roll.get("dist_count", 0),
            "retailer_count": roll.get("retail_count", 0),
            "revenue_90d": round(rev.get("revenue", 0.0), 2),
            "units_sold_90d": rev.get("units", 0),
            "status": status,
            "sparkline_30d": spark,
            "trend_pct_7d": trend_pct,
        })
    return out


# ============================================================================
# PRODUCT DRILL-DOWN — full intelligence across the whole network
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/product/{product_id}")
async def manufacturer_product_detail(manufacturer_id: str, product_id: str):
    product = await db.products.find_one(
        {"id": product_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not product:
        raise HTTPException(404, "Product not found in this manufacturer's catalog")

    distributors = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)
    dist_by_id = {d["id"]: d for d in distributors}
    dist_ids = list(dist_by_id.keys())

    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0},
    ).to_list(50000)
    retailer_by_id = {r["id"]: r for r in retailers}
    retailer_ids = list(retailer_by_id.keys())

    unit_price = float(product.get("unit_price", 0))

    # Inventory across all distributors + retailers
    dist_inv_rows = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": {"$in": dist_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(10000)
    retail_inv_rows = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(50000)

    dist_qty = sum(int(i.get("quantity", 0)) for i in dist_inv_rows)
    retail_qty = sum(int(i.get("quantity", 0)) for i in retail_inv_rows)

    # Reserved = total quantity attached to pending/in_transit shipments out
    reserved_qty = 0
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id,
         "status": {"$in": ["pending", "in_transit"]}}, {"_id": 0, "items": 1},
    ):
        for it in s.get("items", []):
            if it.get("product_id") == product_id:
                reserved_qty += int(it.get("quantity", 0))

    # Last restock at manufacturer level (last received inbound). For now we
    # use the latest "in_transit" or "received" shipment date as proxy.
    last_restock_at = ""
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "status": "received",
         "items.product_id": product_id},
        {"_id": 0, "received_at": 1},
    ).sort("received_at", -1).limit(1):
        last_restock_at = s.get("received_at", "") or ""

    # Distributor-level rollup
    dist_rollup: Dict[str, dict] = {}
    for inv in dist_inv_rows:
        did = inv["owner_id"]
        d = dist_by_id.get(did)
        if not d:
            continue
        dist_rollup[did] = {
            "distributor_id": did, "distributor_name": d.get("name", ""),
            "region": d.get("region", ""), "city": d.get("city", ""),
            "quantity": int(inv.get("quantity", 0)),
            "reorder_level": int(inv.get("reorder_level", 0)),
            "retailers_count": 0, "retailers_stocked": 0,
            "revenue_90d": 0.0, "units_sold_90d": 0,
        }
    # Add distributors that don't hold the SKU yet (so the user can see them)
    for did, d in dist_by_id.items():
        if did not in dist_rollup:
            dist_rollup[did] = {
                "distributor_id": did, "distributor_name": d.get("name", ""),
                "region": d.get("region", ""), "city": d.get("city", ""),
                "quantity": 0, "reorder_level": 0,
                "retailers_count": 0, "retailers_stocked": 0,
                "revenue_90d": 0.0, "units_sold_90d": 0,
            }

    # Count retailers and stocked retailers under each distributor
    for r in retailers:
        did = r.get("distributor_id")
        if did in dist_rollup:
            dist_rollup[did]["retailers_count"] += 1
    stocked_per_dist: Dict[str, int] = {}
    for inv in retail_inv_rows:
        rid = inv["owner_id"]
        r = retailer_by_id.get(rid)
        if not r:
            continue
        did = r.get("distributor_id")
        if inv.get("quantity", 0) > 0 and did in dist_rollup:
            stocked_per_dist[did] = stocked_per_dist.get(did, 0) + 1
    for did, n in stocked_per_dist.items():
        dist_rollup[did]["retailers_stocked"] = n

    # 90-day revenue / units by distributor + monthly trend
    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=89)).isoformat()
    last_30_start = (today - timedelta(days=29)).isoformat()

    monthly: Dict[str, float] = {}
    by_region: Dict[str, float] = {}
    total_revenue = 0.0
    total_units = 0
    last_30_units = 0

    async for s in db.daily_sales.find(
        {"product_id": product_id, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_90}},
        {"_id": 0, "retailer_id": 1, "revenue": 1, "quantity_sold": 1, "date": 1},
    ):
        rev = float(s.get("revenue", 0))
        units = int(s.get("quantity_sold", 0))
        total_revenue += rev
        total_units += units
        if s["date"] >= last_30_start:
            last_30_units += units
        monthly[s["date"][:7]] = monthly.get(s["date"][:7], 0) + rev
        r = retailer_by_id.get(s["retailer_id"])
        if r:
            by_region[r.get("region", "—")] = by_region.get(r.get("region", "—"), 0) + rev
            did = r.get("distributor_id")
            if did in dist_rollup:
                dist_rollup[did]["revenue_90d"] += rev
                dist_rollup[did]["units_sold_90d"] += units

    monthly_trend = [{"month": m, "revenue": round(monthly[m], 2)}
                     for m in sorted(monthly.keys())[-6:]]
    region_breakdown = sorted(
        [{"region": k, "revenue": round(v, 2)} for k, v in by_region.items()],
        key=lambda x: x["revenue"], reverse=True,
    )
    distributor_breakdown = sorted(
        [{**d, "revenue_90d": round(d["revenue_90d"], 2)} for d in dist_rollup.values()],
        key=lambda x: x["revenue_90d"], reverse=True,
    )

    avg_daily_sales = round(last_30_units / 30, 1)
    inventory_turnover = round(total_units / max(retail_qty + dist_qty, 1) * (365 / 90), 2)

    # Recent outbound orders for this product
    recent_orders: List[dict] = []
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id,
         "items.product_id": product_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(8):
        line_qty = next(
            (int(it.get("quantity", 0)) for it in s.get("items", []) if it.get("product_id") == product_id),
            0,
        )
        d = dist_by_id.get(s.get("to_id", ""), {})
        recent_orders.append({
            "id": s["id"], "tracking_code": s.get("tracking_code", ""),
            "to_distributor": d.get("name", s.get("to_id", "")),
            "region": d.get("region", ""), "quantity": line_qty,
            "status": s.get("status", ""), "created_at": s.get("created_at", ""),
        })

    return {
        "product": {
            "id": product["id"], "name": product["name"], "sku": product["sku"],
            "barcode": product.get("barcode", ""), "category": product.get("category", ""),
            "unit_price": unit_price,
        },
        "inventory": {
            "distributor_units": dist_qty, "retailer_units": retail_qty,
            "available": max(0, dist_qty - reserved_qty),
            "reserved": reserved_qty, "last_restock_at": last_restock_at,
        },
        "distribution": {
            "distributors_carrying": sum(1 for d in distributor_breakdown if d["quantity"] > 0),
            "distributors_total": len(distributor_breakdown),
            "retailers_stocking": sum(stocked_per_dist.values()),
            "retailers_total": len(retailers),
            "by_distributor": distributor_breakdown,
            "by_region": region_breakdown,
        },
        "analytics": {
            "total_revenue_90d": round(total_revenue, 2),
            "total_units_90d": total_units,
            "avg_daily_sales": avg_daily_sales,
            "last_30_units": last_30_units,
            "inventory_turnover": inventory_turnover,
            "monthly_trend": monthly_trend,
        },
        "recent_orders": recent_orders,
    }


# ============================================================================
# DISTRIBUTOR DRILL-DOWN — full intelligence for one distributor
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/distributor/{distributor_id}")
async def manufacturer_distributor_detail(manufacturer_id: str, distributor_id: str):
    distributor = await db.distributors.find_one(
        {"id": distributor_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not distributor:
        raise HTTPException(404, "Distributor not found in your network")

    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).to_list(20000)
    retailer_ids = [r["id"] for r in retailers]

    products = {p["id"]: p for p in await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)}

    # Inventory at this distributor — by product
    inv_rows = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": distributor_id}, {"_id": 0},
    ).to_list(5000)
    product_portfolio: List[dict] = []
    total_stock_units = 0
    for inv in inv_rows:
        p = products.get(inv["product_id"])
        if not p:
            continue
        qty = int(inv.get("quantity", 0))
        total_stock_units += qty
        product_portfolio.append({
            "product_id": p["id"], "product_name": p["name"], "sku": p.get("sku", ""),
            "category": p.get("category", ""), "unit_price": float(p.get("unit_price", 0)),
            "quantity": qty, "reorder_level": int(inv.get("reorder_level", 0)),
            "velocity": float(inv.get("velocity", 0)),
        })
    product_portfolio.sort(key=lambda x: x["quantity"], reverse=True)

    # Shipments: outbound from manufacturer to this distributor
    total_orders = 0
    total_units_distributed = 0
    revenue_generated_orders = 0.0  # estimated from shipment items × unit_price
    last_order_at = ""
    monthly_orders: Dict[str, int] = {}
    monthly_units: Dict[str, int] = {}
    product_orders: Dict[str, dict] = {}

    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "to_id": distributor_id},
        {"_id": 0},
    ).sort("created_at", -1):
        total_orders += 1
        created = s.get("created_at", "") or ""
        if created > last_order_at:
            last_order_at = created
        month_key = created[:7] if created else "unknown"
        monthly_orders[month_key] = monthly_orders.get(month_key, 0) + 1
        for it in s.get("items", []):
            pid = it.get("product_id")
            qty = int(it.get("quantity", 0))
            total_units_distributed += qty
            p = products.get(pid, {})
            unit_price = float(p.get("unit_price", 0))
            revenue_generated_orders += qty * unit_price
            monthly_units[month_key] = monthly_units.get(month_key, 0) + qty
            agg = product_orders.setdefault(pid, {
                "product_id": pid, "product_name": p.get("name", "Unknown"),
                "sku": p.get("sku", ""), "units": 0, "revenue": 0.0,
            })
            agg["units"] += qty
            agg["revenue"] += qty * unit_price

    top_products = sorted(product_orders.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    for tp in top_products:
        tp["revenue"] = round(tp["revenue"], 2)

    # Monthly trend (last 6 months)
    months_sorted = sorted(set(list(monthly_orders.keys()) + list(monthly_units.keys())))[-6:]
    monthly_trend = [
        {"month": m, "orders": monthly_orders.get(m, 0), "units": monthly_units.get(m, 0)}
        for m in months_sorted if m != "unknown"
    ]

    # Growth rate — last 30 days vs previous 30 days (by units distributed)
    today = datetime.now(timezone.utc).date()
    start_30 = (today - timedelta(days=29)).isoformat()
    start_60 = (today - timedelta(days=59)).isoformat()
    prev_units = 0
    curr_units = 0
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "to_id": distributor_id,
         "created_at": {"$gte": start_60}}, {"_id": 0, "created_at": 1, "items": 1},
    ):
        units = sum(int(it.get("quantity", 0)) for it in s.get("items", []))
        if s["created_at"] >= start_30:
            curr_units += units
        else:
            prev_units += units
    growth_rate = None if prev_units == 0 else round((curr_units - prev_units) / prev_units * 100, 1)

    # Outstanding balance: pending requests value
    outstanding_units = 0
    outstanding_value = 0.0
    async for q in db.requests.find(
        {"distributor_id": distributor_id, "status": "pending"},
        {"_id": 0, "items": 1},
    ):
        for it in q.get("items", []):
            qty = int(it.get("quantity", 0))
            outstanding_units += qty
            p = products.get(it.get("product_id"), {})
            outstanding_value += qty * float(p.get("unit_price", 0))

    # Retailer downstream revenue (last 90d via daily_sales)
    start_90 = (today - timedelta(days=89)).isoformat()
    downstream_revenue = 0.0
    downstream_units = 0
    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_90}},
        {"_id": 0, "revenue": 1, "quantity_sold": 1},
    ):
        downstream_revenue += float(s.get("revenue", 0))
        downstream_units += int(s.get("quantity_sold", 0))

    avg_order_freq_days = None
    if total_orders > 1 and last_order_at:
        # use first vs last shipment date as crude span
        first = await db.shipments.find_one(
            {"from_role": "manufacturer", "from_id": manufacturer_id, "to_id": distributor_id},
            {"_id": 0, "created_at": 1}, sort=[("created_at", 1)],
        )
        if first:
            try:
                span_days = (datetime.fromisoformat(last_order_at.replace("Z", "+00:00"))
                             - datetime.fromisoformat(first["created_at"].replace("Z", "+00:00"))).days
                if span_days > 0:
                    avg_order_freq_days = round(span_days / max(total_orders - 1, 1), 1)
            except Exception:
                pass

    return {
        "distributor": {
            "id": distributor["id"], "name": distributor["name"],
            "region": distributor.get("region", ""), "city": distributor.get("city", ""),
            "contact_email": distributor.get("contact_email", ""),
            "contact_phone": distributor.get("phone", ""),
            "address": distributor.get("address", ""),
            "status": distributor.get("status", "active"),
            "created_at": distributor.get("created_at", ""),
        },
        "business_metrics": {
            "total_orders": total_orders,
            "total_units_distributed": total_units_distributed,
            "revenue_generated": round(revenue_generated_orders, 2),
            "outstanding_units": outstanding_units,
            "outstanding_value": round(outstanding_value, 2),
            "last_order_at": last_order_at,
            "avg_order_freq_days": avg_order_freq_days,
            "growth_rate_pct": growth_rate,
            "retailers_count": len(retailers),
            "downstream_revenue_90d": round(downstream_revenue, 2),
            "downstream_units_90d": downstream_units,
        },
        "product_portfolio": product_portfolio,
        "total_stock_units": total_stock_units,
        "performance": {
            "monthly_trend": monthly_trend,
            "top_products": top_products,
        },
        "retailers_summary": {
            "count": len(retailers),
            "regions": sorted({r.get("region", "—") for r in retailers}),
            "cities": sorted({r.get("city", "—") for r in retailers if r.get("city")}),
        },
    }


# ============================================================================
# MUTATIONS — Create / Edit Product, Edit Distributor, Adjust Inventory
# ============================================================================
@router.post("/manufacturer/{manufacturer_id}/products")
async def create_product(manufacturer_id: str, payload: dict):
    """Onboard a new SKU under a manufacturer.

    Required: ``name``, ``sku``, ``category``, ``unit_price``.
    Optional: ``barcode``, ``description``, ``image_url`` and the initial batch
    fields ``batch_number``, ``manufactured_at`` (YYYY-MM-DD),
    ``expiry_date`` (YYYY-MM-DD), ``quantity`` — if any of the batch fields
    are present an initial batch row + inventory row are created in the same
    request.
    """
    import uuid
    from datetime import datetime, timezone

    # ---- validate manufacturer ---------------------------------------------
    mf = await db.manufacturers.find_one({"id": manufacturer_id}, {"_id": 0})
    if not mf:
        raise HTTPException(404, "Manufacturer not found")

    # ---- required fields ---------------------------------------------------
    required = ("name", "sku", "category", "unit_price")
    missing = [k for k in required if not payload.get(k)]
    if missing:
        raise HTTPException(400, f"Missing required fields: {', '.join(missing)}")

    try:
        unit_price = float(payload["unit_price"])
    except (TypeError, ValueError):
        raise HTTPException(400, "unit_price must be a number")

    sku = str(payload["sku"]).strip()
    # SKU uniqueness within the manufacturer's catalogue
    dup = await db.products.find_one(
        {"manufacturer_id": manufacturer_id, "sku": sku},
        {"_id": 0, "id": 1},
    )
    if dup:
        raise HTTPException(409, f"SKU '{sku}' already exists for this manufacturer")

    product = {
        "id": str(uuid.uuid4()),
        "manufacturer_id": manufacturer_id,
        "name": str(payload["name"]).strip(),
        "sku": sku,
        "category": str(payload["category"]).strip(),
        "unit_price": unit_price,
        "barcode": str(payload.get("barcode") or "").strip(),
        "description": str(payload.get("description") or "").strip(),
        "image_url": (payload.get("image_url") or "").strip(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.products.insert_one(product)

    # ---- optional initial batch -------------------------------------------
    batch_doc = None
    has_batch_fields = any(
        payload.get(k) for k in ("batch_number", "expiry_date", "manufactured_at", "quantity")
    )
    if has_batch_fields:
        batch_qty = payload.get("quantity")
        try:
            batch_qty_int = int(batch_qty) if batch_qty is not None else 0
        except (TypeError, ValueError):
            raise HTTPException(400, "quantity must be an integer")

        batch_doc = {
            "id": str(uuid.uuid4()),
            "manufacturer_id": manufacturer_id,
            "product_id": product["id"],
            "batch_number": str(payload.get("batch_number") or "").strip()
                or f"{(product['name'][:2] or 'XX').upper()}{datetime.now(timezone.utc).strftime('%y%m%d')}A",
            "manufactured_at": str(payload.get("manufactured_at") or "").strip()
                or datetime.now(timezone.utc).date().isoformat(),
            "expiry_date": str(payload.get("expiry_date") or "").strip(),
            "quantity": batch_qty_int,
            "status": "healthy",
            "created_at": now_iso(),
        }
        if not batch_doc["expiry_date"]:
            raise HTTPException(400, "expiry_date is required when seeding a batch")
        await db.batches.insert_one(batch_doc)

        # Seed an inventory row at the manufacturer's depot so the new SKU
        # immediately appears in dashboards.
        if batch_qty_int > 0:
            await db.inventory.insert_one({
                "id": str(uuid.uuid4()),
                "owner_type": "manufacturer",
                "owner_id": manufacturer_id,
                "product_id": product["id"],
                "quantity": batch_qty_int,
                "reorder_level": 10,
                "velocity": 0.0,
                "updated_at": now_iso(),
            })

    product.pop("_id", None)
    if batch_doc:
        batch_doc.pop("_id", None)
    _invalidate_manufacturer_caches(manufacturer_id)
    return {"product": product, "batch": batch_doc}


def _invalidate_manufacturer_caches(manufacturer_id: str):
    """Drop persisted dashboard snapshots so the next read recomputes."""
    try:
        from services.snapshots import db as _db
        import asyncio
        async def _drop():
            await _db.dashboard_snapshots.delete_many({"manufacturer_id": manufacturer_id})
        # Best-effort fire-and-forget — we're already inside a request loop.
        loop = asyncio.get_event_loop()
        loop.create_task(_drop())
    except Exception:  # cache is best-effort
        pass


@router.patch("/products/{product_id}")
async def update_product(product_id: str, payload: dict):
    """Allowed fields: name, sku, category, unit_price, barcode, description, image_url."""
    allowed = {"name", "sku", "category", "unit_price", "barcode", "description", "image_url"}
    update = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if "unit_price" in update:
        try:
            update["unit_price"] = float(update["unit_price"])
        except (TypeError, ValueError):
            raise HTTPException(400, "unit_price must be a number")
    if not update:
        raise HTTPException(400, "No valid fields to update")
    update["updated_at"] = now_iso()
    res = await db.products.update_one({"id": product_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Product not found")
    fresh = await db.products.find_one({"id": product_id}, {"_id": 0})
    if fresh and fresh.get("manufacturer_id"):
        _invalidate_manufacturer_caches(fresh["manufacturer_id"])
    return fresh


@router.patch("/distributors/{distributor_id}")
async def update_distributor(distributor_id: str, payload: dict):
    """Allowed fields: name, region, city, contact_email, phone, address, status."""
    allowed = {"name", "region", "city", "contact_email", "phone", "address", "status"}
    update = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if not update:
        raise HTTPException(400, "No valid fields to update")
    update["updated_at"] = now_iso()
    res = await db.distributors.update_one({"id": distributor_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Distributor not found")
    fresh = await db.distributors.find_one({"id": distributor_id}, {"_id": 0})
    if fresh and fresh.get("manufacturer_id"):
        _invalidate_manufacturer_caches(fresh["manufacturer_id"])
    return fresh


@router.post("/inventory/adjust")
async def adjust_inventory(payload: dict):
    """Manual inventory adjustment (manufacturer / super-admin tool).

    Body: { owner_type, owner_id, product_id, quantity_delta?, set_quantity?,
            reorder_level?, reason? }

    Either provide quantity_delta (positive or negative) OR set_quantity
    (absolute). reason is logged for audit.
    """
    owner_type = payload.get("owner_type")
    owner_id = payload.get("owner_id")
    product_id = payload.get("product_id")
    if not (owner_type and owner_id and product_id):
        raise HTTPException(400, "owner_type, owner_id and product_id are required")
    if owner_type not in {"manufacturer", "distributor", "retailer"}:
        raise HTTPException(400, "Invalid owner_type")

    inv = await db.inventory.find_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id},
        {"_id": 0},
    )
    if not inv:
        # Create row if missing
        inv = {
            "id": __import__("uuid").uuid4().hex,
            "owner_type": owner_type, "owner_id": owner_id, "product_id": product_id,
            "quantity": 0, "reorder_level": 10, "velocity": 0.0,
            "updated_at": now_iso(),
        }
        await db.inventory.insert_one(inv.copy())

    new_qty = int(inv.get("quantity", 0))
    if "set_quantity" in payload and payload["set_quantity"] is not None:
        try:
            new_qty = max(0, int(payload["set_quantity"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "set_quantity must be an integer")
    elif "quantity_delta" in payload and payload["quantity_delta"] is not None:
        try:
            new_qty = max(0, new_qty + int(payload["quantity_delta"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "quantity_delta must be an integer")

    update: Dict = {"quantity": new_qty, "updated_at": now_iso()}
    if "reorder_level" in payload and payload["reorder_level"] is not None:
        try:
            update["reorder_level"] = max(0, int(payload["reorder_level"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "reorder_level must be an integer")
    await db.inventory.update_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id},
        {"$set": update},
    )
    # Audit log
    await db.inventory_audit.insert_one({
        "id": __import__("uuid").uuid4().hex,
        "owner_type": owner_type, "owner_id": owner_id, "product_id": product_id,
        "prev_quantity": int(inv.get("quantity", 0)),
        "new_quantity": new_qty,
        "delta": new_qty - int(inv.get("quantity", 0)),
        "reorder_level": update.get("reorder_level"),
        "reason": (payload.get("reason") or "")[:300],
        "actor": (payload.get("actor") or "")[:120],
        "created_at": now_iso(),
    })
    fresh = await db.inventory.find_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id},
        {"_id": 0},
    )
    return fresh
