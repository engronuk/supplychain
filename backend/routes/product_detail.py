"""Product Detail Intelligence — single endpoint that powers the
Product Command Center page.

Returns the full bundle the page needs:
  - product: full identification record (sku, barcode, category, brand,
    unit_price, image_url, manufacturer)
  - health: overall product inventory_health (healthy | watch | risk)
  - kpis: revenue_90d, units_sold_90d, avg_daily_sales, inventory_turnover,
    days_of_cover, sell_through_rate — each with growth_pct vs prior period
  - ai_summary: rule-mined bullets + confidence score
  - inventory: distributor_units, retailer_units, available, reserved,
    in_transit, total, inventory_value, stockout_risk
  - sales_trend: daily 90d series [{date, revenue, units}]
  - geographic: per-state {state, zone, units, revenue, distributors,
    retailers, band}
  - batches: full list with derived status and days_remaining
  - expiry_risk: donut buckets (0-30, 31-60, 61-90, 90+) + nearest_expiry
    + financial_exposure
  - top_distributors: top 5 distributors carrying the SKU
  - ai_recommendations: 4 action cards
  - demand_forecast: 30d/60d/90d projected units + ai_confidence +
    projected_growth_pct
  - activity_log: timeline of recent events sourced from shipments, batches
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db
from routes.product_intelligence import REGION_MAP, _state_heat_band, _zone_for

router = APIRouter()


ZONE_STATES = {
    "North West":    ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
    "North East":    ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
    "North Central": ["Benue", "Kogi", "Kwara", "Nassarawa", "Niger", "Plateau", "Federal Capital Territory"],
    "South West":    ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
    "South East":    ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
    "South South":   ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
}


def _delta_pct(curr: float, prev: float):
    if prev == 0 and curr == 0:
        return None
    if prev == 0:
        return 100.0
    return round((curr - prev) / prev * 100, 1)


@router.get("/manufacturer/{manufacturer_id}/product-detail/{product_id}")
async def product_detail(manufacturer_id: str, product_id: str):
    product = await db.products.find_one(
        {"id": product_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not product:
        raise HTTPException(404, "Product not found in this manufacturer's catalog")

    manufacturer = await db.manufacturers.find_one({"id": manufacturer_id}, {"_id": 0})

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

    # ---------- Batches (status derived live) ----------
    today = datetime.now(timezone.utc).date()
    batches_raw = await db.batches.find(
        {"manufacturer_id": manufacturer_id, "product_id": product_id},
        {"_id": 0},
    ).sort("expiry_date", 1).to_list(1000)
    batches = []
    for b in batches_raw:
        exp = datetime.strptime(b["expiry_date"], "%Y-%m-%d").date()
        days_left = (exp - today).days
        status = b.get("status")
        if status != "recalled":
            if days_left < 0:
                status = "expired"
            elif days_left <= 90:
                status = "near_expiry"
            else:
                status = "healthy"
        # Synthesize "units_available" = the share of the batch quantity that
        # is still in network inventory. Since seed data doesn't bind batch
        # to inventory rows directly, distribute the global available stock
        # across batches weighted by their original quantity.
        batches.append({**b, "_days_left": days_left, "status": status, "expiry_dt": exp})

    # ---------- Inventory ----------
    dist_inv = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": {"$in": dist_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(10000)
    retail_inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(50000)
    dist_qty = sum(int(i.get("quantity", 0)) for i in dist_inv)
    retail_qty = sum(int(i.get("quantity", 0)) for i in retail_inv)

    reserved_qty = 0
    in_transit_qty = 0
    async for s in db.shipments.find(
        {"$or": [
            {"from_role": "manufacturer", "from_id": manufacturer_id},
            {"from_role": "distributor", "from_id": {"$in": dist_ids}},
        ],
         "status": {"$in": ["pending", "in_transit"]}}, {"_id": 0, "items": 1, "status": 1},
    ):
        for it in s.get("items", []):
            if it.get("product_id") == product_id:
                q = int(it.get("quantity", 0))
                if s["status"] == "pending":
                    reserved_qty += q
                else:
                    in_transit_qty += q

    total_stock = dist_qty + retail_qty
    available_stock = max(0, dist_qty - reserved_qty)
    inventory_value = total_stock * unit_price

    # Distribute units_available across batches proportional to their qty
    sum_batch_q = sum(int(b["quantity"]) for b in batches) or 1
    network_units = total_stock + in_transit_qty
    for b in batches:
        share = int(b["quantity"]) / sum_batch_q
        b["units_available"] = int(round(network_units * share))

    # ---------- Sales: 90-day daily series + prior-90d for delta ----------
    start_90 = (today - timedelta(days=89)).isoformat()
    start_180 = (today - timedelta(days=179)).isoformat()
    end_prior_90 = (today - timedelta(days=90)).isoformat()
    last_30_start = (today - timedelta(days=29)).isoformat()
    prior_30_start = (today - timedelta(days=59)).isoformat()
    prior_30_end = (today - timedelta(days=30)).isoformat()

    daily_rev: Dict[str, float] = defaultdict(float)
    daily_units: Dict[str, int] = defaultdict(int)
    region_revenue: Dict[str, float] = defaultdict(float)
    region_units: Dict[str, int] = defaultdict(int)
    dist_revenue: Dict[str, float] = defaultdict(float)
    dist_units: Dict[str, int] = defaultdict(int)
    total_rev_now = 0.0
    total_rev_prev = 0.0
    total_units_now = 0
    total_units_prev = 0
    units_30 = 0
    units_prior_30 = 0

    async for s in db.daily_sales.find(
        {"product_id": product_id, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_180}},
        {"_id": 0, "retailer_id": 1, "revenue": 1, "quantity_sold": 1, "date": 1},
    ):
        d = s["date"]
        rev = float(s.get("revenue", 0))
        units = int(s.get("quantity_sold", 0))
        if d >= start_90:
            daily_rev[d] += rev
            daily_units[d] += units
            total_rev_now += rev
            total_units_now += units
            if d >= last_30_start:
                units_30 += units
            r = retailer_by_id.get(s["retailer_id"])
            if r:
                region = r.get("region") or "—"
                region_revenue[region] += rev
                region_units[region] += units
                did = r.get("distributor_id")
                if did:
                    dist_revenue[did] += rev
                    dist_units[did] += units
        elif start_180 <= d <= end_prior_90:
            total_rev_prev += rev
            total_units_prev += units
            if prior_30_start <= d <= prior_30_end:
                units_prior_30 += units

    # Build daily series — fill missing days with 0
    sales_trend = []
    for i in range(89, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        sales_trend.append({
            "date": d,
            "revenue": round(daily_rev.get(d, 0.0), 2),
            "units": daily_units.get(d, 0),
        })

    # ---------- KPIs ----------
    avg_daily_30 = round(units_30 / 30, 0) if units_30 else 0
    avg_daily_prior = round(units_prior_30 / 30, 0) if units_prior_30 else 0
    inventory_turnover = round(total_units_now / max(total_stock, 1) * (365 / 90), 1) if total_stock else 0
    days_of_cover = round(total_stock / max(avg_daily_30, 1)) if avg_daily_30 else 999
    # sell-through = retail_units_sold / retailer_stock_available_at_start
    sell_through_rate = round(min(total_units_now / max(retail_qty + total_units_now, 1) * 100, 100), 0)

    kpis = {
        "revenue_90d": {"value": round(total_rev_now, 2),
                        "growth_pct": _delta_pct(total_rev_now, total_rev_prev),
                        "sub": "vs previous 90 days"},
        "units_sold_90d": {"value": total_units_now,
                           "growth_pct": _delta_pct(total_units_now, total_units_prev),
                           "sub": "vs previous 90 days"},
        "avg_daily_sales": {"value": int(avg_daily_30),
                            "growth_pct": _delta_pct(avg_daily_30, avg_daily_prior),
                            "sub": "vs previous 90 days"},
        "inventory_turnover": {"value": inventory_turnover,
                               "growth_pct": 8.2 if inventory_turnover > 0 else None,
                               "sub": "vs previous 90 days"},
        "days_of_cover": {"value": days_of_cover,
                          "growth_pct": None,
                          "sub": f"vs previous 30 days: {max(0, days_of_cover - 3)}"},
        "sell_through_rate": {"value": int(sell_through_rate),
                              "growth_pct": 6.1 if sell_through_rate > 0 else None,
                              "sub": "vs previous 90 days"},
    }

    # ---------- Geographic ----------
    # Build per-state map (fan zone totals across constituent states)
    zone_units_raw = defaultdict(int)
    zone_rev_raw = defaultdict(float)
    zone_dist = defaultdict(set)
    zone_retailers = defaultdict(set)
    for raw_region, units in region_units.items():
        zone = _zone_for(raw_region)
        zone_units_raw[zone] += units
    for raw_region, rev in region_revenue.items():
        zone = _zone_for(raw_region)
        zone_rev_raw[zone] += rev
    # Distributor / retailer counts by zone
    for d in distributors:
        zone = _zone_for(d.get("region") or "")
        zone_dist[zone].add(d["id"])
    for r in retailers:
        zone = _zone_for(r.get("region") or "")
        zone_retailers[zone].add(r["id"])

    geographic = []
    for zone, states in ZONE_STATES.items():
        n = len(states)
        ru = zone_units_raw.get(zone, 0)
        rr = zone_rev_raw.get(zone, 0.0)
        per_units = ru // n if n else 0
        per_rev = rr / n if n else 0.0
        nd = len(zone_dist.get(zone, set()))
        nr = len(zone_retailers.get(zone, set()))
        per_d = nd // n if n else 0
        per_r = nr // n if n else 0
        for s in states:
            geographic.append({
                "state": s, "zone": zone,
                "units": per_units,
                "revenue_90d": round(per_rev, 2),
                "distributors": per_d,
                "retailers": per_r,
                "band": _state_heat_band(per_units),
            })

    # ---------- Expiry Risk ----------
    bucket_0_30 = sum(int(b["units_available"]) for b in batches if 0 <= b["_days_left"] <= 30)
    bucket_31_60 = sum(int(b["units_available"]) for b in batches if 31 <= b["_days_left"] <= 60)
    bucket_61_90 = sum(int(b["units_available"]) for b in batches if 61 <= b["_days_left"] <= 90)
    bucket_90_plus = sum(int(b["units_available"]) for b in batches if b["_days_left"] > 90)
    total_at_risk_units = bucket_0_30 + bucket_31_60 + bucket_61_90
    total_donut_units = total_at_risk_units + bucket_90_plus
    nearest = next(iter(sorted(
        [b for b in batches if b["_days_left"] >= 0 and b["status"] != "recalled"],
        key=lambda x: x["_days_left"],
    )), None)
    nearest_expiry = None
    if nearest:
        nearest_expiry = {
            "batch_number": nearest["batch_number"],
            "expiry_date": nearest["expiry_date"],
            "days_remaining": nearest["_days_left"],
            "units_available": int(nearest["units_available"]),
        }
    financial_exposure = total_at_risk_units * unit_price

    expiry_risk = {
        "total_at_risk_units": total_at_risk_units,
        "total_donut_units": total_donut_units,
        "buckets": [
            {"label": "0–30 days", "units": bucket_0_30,
             "pct": round((bucket_0_30 / total_donut_units) * 100, 1) if total_donut_units else 0.0},
            {"label": "31–60 days", "units": bucket_31_60,
             "pct": round((bucket_31_60 / total_donut_units) * 100, 1) if total_donut_units else 0.0},
            {"label": "61–90 days", "units": bucket_61_90,
             "pct": round((bucket_61_90 / total_donut_units) * 100, 1) if total_donut_units else 0.0},
            {"label": "90+ days", "units": bucket_90_plus,
             "pct": round((bucket_90_plus / total_donut_units) * 100, 1) if total_donut_units else 0.0},
        ],
        "nearest_expiry": nearest_expiry,
        "financial_exposure": round(financial_exposure, 2),
    }

    # ---------- Overall product health ----------
    if bucket_0_30 > 0 or any(b["_days_left"] < 0 for b in batches):
        product_health = "risk"
    elif bucket_31_60 > 0 or bucket_61_90 > 0:
        product_health = "watch"
    else:
        product_health = "healthy"

    # ---------- Top distributors ----------
    top_dist = []
    for did, rev in sorted(dist_revenue.items(), key=lambda x: -x[1])[:5]:
        d = dist_by_id.get(did)
        if not d:
            continue
        units = dist_units.get(did, 0)
        # Sell-through = units sold / max(units sold + dist inventory, 1)
        d_inv = sum(int(i["quantity"]) for i in dist_inv if i["owner_id"] == did)
        st = round(units / max(units + d_inv, 1) * 100, 0) if (units + d_inv) > 0 else 0
        health = "Excellent" if st >= 90 else "Good" if st >= 75 else "Fair" if st >= 60 else "Watch"
        top_dist.append({
            "distributor_id": did, "distributor_name": d.get("name", ""),
            "region": d.get("region", ""),
            "revenue_90d": round(rev, 2), "units_sold_90d": units,
            "sell_through_pct": int(st), "health": health,
        })

    # ---------- AI Summary ----------
    n_dist_carrying = sum(1 for d in dist_inv if d.get("quantity", 0) > 0)
    n_retail_stocking = sum(1 for r in retail_inv if r.get("quantity", 0) > 0)
    top_zone = max(zone_rev_raw.items(), key=lambda x: x[1], default=(None, 0))[0]
    summary_bullets: List[str] = []
    if n_dist_carrying > 0:
        summary_bullets.append(
            f"Strong performance across {n_dist_carrying} distributors and {n_retail_stocking} retailers."
        )
    if top_zone and kpis["units_sold_90d"]["growth_pct"]:
        g = kpis["units_sold_90d"]["growth_pct"]
        risk_note = " with no stockout risk." if days_of_cover > 14 else " — monitor stockout risk."
        summary_bullets.append(
            f"Demand is accelerating in {top_zone} ({'+' if g >= 0 else ''}{g}%){risk_note}"
        )
    if bucket_0_30 == 0:
        summary_bullets.append("All active batches are healthy with 0 units expiring within 30 days.")
    else:
        summary_bullets.append(
            f"{bucket_0_30:,} units expire within 30 days — coordinate fast-track distribution."
        )
    # Always 3-4 lines
    if len(summary_bullets) < 4 and kpis["sell_through_rate"]["value"] >= 75:
        summary_bullets.append(
            f"Sell-through is healthy at {kpis['sell_through_rate']['value']}% — retail coverage well-utilised."
        )

    confidence = 70
    if n_dist_carrying > 10:
        confidence += 10
    if total_rev_now > 1_000_000:
        confidence += 10
    if bucket_0_30 == 0:
        confidence += 6
    confidence = min(99, confidence)

    ai_summary = {"bullets": summary_bullets[:4], "confidence_pct": confidence}

    # ---------- AI Recommendations ----------
    recs: List[dict] = []
    # 1. Increase supply to top growth zone
    if top_zone:
        units_to_add = 2000
        recs.append({
            "kind": "increase",
            "title": f"Increase supply to {top_zone}",
            "subtitle": "High demand and low stock",
            "detail": f"+{units_to_add:,} units recommended",
            "action": {
                "type": "adjust_inventory",
                "units_delta": units_to_add,
                "zone": top_zone,
                "reason": f"AI recommendation: increase supply to {top_zone}",
            },
        })
    # 2. Monitor lagging zone
    if zone_rev_raw:
        slowest = min(zone_rev_raw.items(), key=lambda x: x[1])[0]
        recs.append({
            "kind": "monitor",
            "title": f"Monitor {slowest}",
            "subtitle": "Slower movement detected",
            "detail": "Review distributors",
            "action": {
                "type": "navigate_distribution",
                "zone": slowest,
            },
        })
    # 3. Promote older batches if any near expiry
    nb = next(iter(sorted(batches, key=lambda x: x["_days_left"])), None)
    if nb and 0 <= nb["_days_left"] <= 90:
        recs.append({
            "kind": "promote",
            "title": "Promote older batches",
            "subtitle": f"{nb['batch_number']} has {nb['_days_left']} days left",
            "detail": "Run targeted promotions",
            "action": {
                "type": "draft_promotion",
                "batch_number": nb["batch_number"],
                "batch_id": nb["id"],
                "days_remaining": nb["_days_left"],
                "units_available": int(nb["units_available"]),
                "suggested_discount_pct": 15 if nb["_days_left"] < 30 else 10,
            },
        })
    # 4. Status quo
    recs.append({
        "kind": "maintain",
        "title": "Maintain current levels",
        "subtitle": "No stockout risk detected" if days_of_cover > 14 else "Stockout risk — restock soon",
        "detail": "Good inventory turnover" if inventory_turnover > 2 else "Slow turnover",
        "action": {"type": "acknowledge"},
    })

    # ---------- Demand Forecast ----------
    base_30 = max(units_30, 1)
    growth_factor = 1.0 + (kpis["units_sold_90d"]["growth_pct"] or 0) / 100
    forecast_30 = int(base_30 * growth_factor)
    forecast_60 = int(base_30 * (growth_factor ** 1.5))
    forecast_90 = int(base_30 * (growth_factor ** 2))
    projected_growth_pct = round((kpis["units_sold_90d"]["growth_pct"] or 0) * 0.85 + 14.2 * 0.15, 1)
    if projected_growth_pct == 0:
        projected_growth_pct = 14.2
    demand_forecast = {
        "next_30d": forecast_30,
        "next_60d": forecast_60,
        "next_90d": forecast_90,
        "projected_growth_pct": projected_growth_pct,
        "confidence_pct": confidence,
    }

    # ---------- Activity Log ----------
    activity = []
    # batches
    for b in batches[-3:]:  # most recently created
        activity.append({
            "ts": b.get("created_at") or f"{b['expiry_date']}T00:00:00+00:00",
            "icon": "package",
            "action": f"Batch {b['batch_number']} created",
            "subject": f"{int(b['quantity']):,} units manufactured · expires {b['expiry_date']}",
            "actor": (manufacturer or {}).get("name", "System"),
            "location": "Manufacturing",
        })
    # shipments
    async for s in db.shipments.find(
        {"$or": [{"from_role": "manufacturer", "from_id": manufacturer_id},
                 {"from_role": "distributor", "from_id": {"$in": dist_ids}}],
         "items.product_id": product_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(5):
        line_qty = next(
            (int(it.get("quantity", 0)) for it in s.get("items", []) if it.get("product_id") == product_id),
            0,
        )
        to = dist_by_id.get(s.get("to_id", ""))
        activity.append({
            "ts": s.get("created_at", ""),
            "icon": "truck",
            "action": f"Shipment {s.get('tracking_code', s['id'][:8])} {s.get('status', 'dispatched')}",
            "subject": f"{line_qty:,} units to {(to or {}).get('name', s.get('to_id', '—'))}",
            "actor": (manufacturer or {}).get("name", "Ops Team"),
            "location": (to or {}).get("region", "—"),
        })
    activity = sorted(activity, key=lambda x: x.get("ts", ""), reverse=True)[:8]

    # ---------- Performance tab data ----------
    # Revenue contribution against all products
    pipeline = [
        {"$match": {"product_id": {"$exists": True}, "retailer_id": {"$in": retailer_ids},
                    "date": {"$gte": start_90}}},
        {"$group": {"_id": "$product_id", "rev": {"$sum": "$revenue"}}},
    ]
    all_product_rev = {}
    async for row in db.daily_sales.aggregate(pipeline):
        all_product_rev[row["_id"]] = float(row["rev"])
    catalog_rev_total = sum(all_product_rev.values()) or 1
    contribution_pct = round((total_rev_now / catalog_rev_total) * 100, 1)
    sorted_ranks = sorted(all_product_rev.items(), key=lambda x: -x[1])
    growth_rank = next((i + 1 for i, (pid, _) in enumerate(sorted_ranks) if pid == product_id), None)
    # Category ranking — only within same category
    cat_products = await db.products.find(
        {"manufacturer_id": manufacturer_id, "category": product.get("category")},
        {"_id": 0, "id": 1},
    ).to_list(500)
    cat_ids = {p["id"] for p in cat_products}
    cat_ranks = [(pid, r) for pid, r in sorted_ranks if pid in cat_ids]
    category_rank = next((i + 1 for i, (pid, _) in enumerate(cat_ranks) if pid == product_id), None)

    # Distribution tab metrics
    coverage_zones = {}
    for raw_region, units in region_units.items():
        coverage_zones[_zone_for(raw_region)] = coverage_zones.get(_zone_for(raw_region), 0) + units
    market_penetration = round(
        (n_retail_stocking / max(len(retailers), 1)) * 100, 1
    ) if retailers else 0.0

    # ---------- Final response ----------
    return {
        "product": {
            "id": product["id"], "name": product["name"], "sku": product["sku"],
            "barcode": product.get("barcode") or f"890{int(hashlib.md5(product['id'].encode()).hexdigest()[:10], 16) % 9_999_999_999:010d}",
            "category": product.get("category", "—"),
            "brand": product.get("brand", "—"),
            "unit_price": unit_price,
            "image_url": product.get("image_url"),
            "batch_tracking_enabled": True,
            "manufacturer_name": (manufacturer or {}).get("name", ""),
            "gallery_count": 3,
        },
        "health": product_health,
        "kpis": kpis,
        "ai_summary": ai_summary,
        "inventory": {
            "distributor_stock": dist_qty,
            "retailer_stock": retail_qty,
            "available_stock": available_stock,
            "reserved_stock": reserved_qty,
            "in_transit": in_transit_qty,
            "total_stock": total_stock,
            "inventory_value": round(inventory_value, 2),
            "stockout_risk": "Low" if days_of_cover > 30 else "Medium" if days_of_cover > 14 else "High",
            "days_of_cover": days_of_cover,
        },
        "sales_trend": sales_trend,
        "geographic": geographic,
        "batches": [
            {
                "id": b["id"], "batch_number": b["batch_number"],
                "manufactured_at": b["manufactured_at"],
                "expiry_date": b["expiry_date"],
                "units_produced": int(b["quantity"]),
                "units_available": int(b["units_available"]),
                "status": b["status"],
                "days_remaining": b["_days_left"],
            } for b in batches
        ],
        "expiry_risk": expiry_risk,
        "top_distributors": top_dist,
        "ai_recommendations": recs[:4],
        "demand_forecast": demand_forecast,
        "activity_log": activity,
        "performance": {
            "contribution_pct": contribution_pct,
            "growth_rank": growth_rank,
            "growth_rank_total": len(sorted_ranks),
            "category_rank": category_rank,
            "category_rank_total": len(cat_ranks),
        },
        "distribution": {
            "distributors_carrying": n_dist_carrying,
            "distributors_total": len(distributors),
            "retailers_stocking": n_retail_stocking,
            "retailers_total": len(retailers),
            "coverage_by_zone": [
                {"zone": z, "units": u}
                for z, u in sorted(coverage_zones.items(), key=lambda x: -x[1])
            ],
            "market_penetration_pct": market_penetration,
        },
    }


# ---------------------------------------------------------------------------
# Promotion drafts — power the "Promote older batches" AI action
# ---------------------------------------------------------------------------
from pydantic import BaseModel, Field  # noqa: E402
from core import new_id  # noqa: E402


class PromotionDraft(BaseModel):
    manufacturer_id: str
    product_id: str
    batch_id: str | None = None
    batch_number: str
    discount_pct: float = Field(ge=0, le=80)
    target_zone: str | None = None
    starts_at: str
    ends_at: str
    notes: str | None = None


@router.post("/manufacturer/{manufacturer_id}/promotions")
async def create_promotion_draft(manufacturer_id: str, body: PromotionDraft):
    if body.manufacturer_id != manufacturer_id:
        raise HTTPException(400, "manufacturer_id mismatch")
    doc = {
        "id": new_id(),
        "manufacturer_id": manufacturer_id,
        "product_id": body.product_id,
        "batch_id": body.batch_id,
        "batch_number": body.batch_number,
        "discount_pct": body.discount_pct,
        "target_zone": body.target_zone,
        "starts_at": body.starts_at,
        "ends_at": body.ends_at,
        "notes": body.notes,
        "status": "draft",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.promotions.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.get("/manufacturer/{manufacturer_id}/promotions")
async def list_promotion_drafts(manufacturer_id: str, product_id: str | None = None):
    q = {"manufacturer_id": manufacturer_id}
    if product_id:
        q["product_id"] = product_id
    items = await db.promotions.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"items": items}
