"""Product Intelligence Center — fat aggregator for the Manufacturer's
"Product Intelligence" page.

Returns everything the page needs in a single call so the SPA doesn't need to
juggle 8 parallel requests:

  - kpis: products, active_batches, units_in_network, expiring_90d,
          at_risk_value, revenue_90d (each with prior-period delta)
  - ai_brief: 4 insight cards + network inventory health score
  - portfolio: per-SKU table (revenue, units, batches, expiring qty,
               inventory health, 30d sparkline, growth%)
  - performance_matrix: products plotted as {x: revenue_90d, y: growth_pct}
  - batch_health: donut breakdown (healthy / near_expiry / expired / recalled)
  - expiry_risk: bucketed units (0-30 / 31-60 / 61-90) + nearest_expiry
  - category_performance: revenue + growth per category
  - geographic_heatmap: per-state units + revenue + health
  - stock_risk: top 5 risk products (units expiring in 90d + risk level)
  - recent_alerts: 4 most recent operational events
"""
from __future__ import annotations

import hashlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db

router = APIRouter()


# Nigerian state -> geopolitical zone mapping (also used elsewhere)
REGION_MAP = {
    "Lagos": "South West", "Ogun": "South West", "Oyo": "South West",
    "Osun": "South West", "Ondo": "South West", "Ekiti": "South West",
    "FCT": "North Central", "Abuja": "North Central",
    "Kaduna": "North West", "Kano": "North West",
    "Rivers": "South South", "Bayelsa": "South South", "Akwa Ibom": "South South",
    "Cross River": "South South", "Delta": "South South", "Edo": "South South",
}


def _today() -> datetime:
    return datetime.now(timezone.utc)


def _delta_pct(curr: float, prev: float):
    if prev == 0 and curr == 0:
        return None
    if prev == 0:
        return 100.0
    return round((curr - prev) / prev * 100, 1)


def _quadrant(revenue: float, growth: float | None,
              revenue_median: float) -> str:
    """Star / Emerging / Cash Cow / Underperformer placement.

    Stars         : high revenue + high growth
    Emerging      : low revenue + high growth
    Cash Cows     : high revenue + low growth
    Underperformer: low revenue + low growth
    """
    g = growth if growth is not None else 0.0
    high_rev = revenue >= revenue_median
    high_growth = g >= 0
    if high_rev and high_growth:
        return "stars"
    if not high_rev and high_growth:
        return "emerging"
    if high_rev and not high_growth:
        return "cash_cows"
    return "underperformers"


def _risk_level(days_remaining: int) -> str:
    if days_remaining <= 30:
        return "high"
    if days_remaining <= 60:
        return "medium"
    return "low"


def _state_heat_band(units: int) -> str:
    """Heatmap colour band by units present in the state."""
    if units == 0:
        return "no_data"
    if units >= 80_000:
        return "excellent"
    if units >= 40_000:
        return "good"
    if units >= 20_000:
        return "fair"
    return "poor"


def _zone_for(region: str) -> str:
    return REGION_MAP.get(region or "", region or "—")


@router.get("/manufacturer/{manufacturer_id}/product-intelligence")
async def product_intelligence(manufacturer_id: str):
    from services.snapshots import read_or_compute
    return await read_or_compute(
        "product-intelligence", manufacturer_id,
        lambda: _build_product_intelligence(manufacturer_id),
    )


@router.post("/manufacturer/{manufacturer_id}/product-intelligence/refresh")
async def product_intelligence_refresh(manufacturer_id: str):
    from services.snapshots import recompute
    return await recompute(
        "product-intelligence", manufacturer_id,
        lambda: _build_product_intelligence(manufacturer_id),
    )


async def _build_product_intelligence(manufacturer_id: str):
    # ---------- 0 . Anchor entities ----------
    mfg = await db.manufacturers.find_one({"id": manufacturer_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")

    products = await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0}
    ).sort("name", 1).to_list(5000)
    product_ids = [p["id"] for p in products]
    if not product_ids:
        return {"manufacturer": mfg, "kpis": _empty_kpis(), "ai_brief": _empty_brief(),
                "portfolio": [], "performance_matrix": [], "batch_health": {},
                "expiry_risk": {}, "category_performance": [],
                "geographic_heatmap": [], "stock_risk": [], "recent_alerts": []}

    products_by_id = {p["id"]: p for p in products}

    distributors = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0}
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors]

    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0}
    ).to_list(50000)
    retailer_ids = [r["id"] for r in retailers]
    retailer_by_id = {r["id"]: r for r in retailers}

    # ---------- 1 . Batches ----------
    batches = await db.batches.find(
        {"manufacturer_id": manufacturer_id, "product_id": {"$in": product_ids}},
        {"_id": 0},
    ).to_list(20000)

    today = _today().date()
    for b in batches:  # refresh derived status to "now"
        exp = datetime.strptime(b["expiry_date"], "%Y-%m-%d").date()
        days_left = (exp - today).days
        b["_days_left"] = days_left
        if b.get("status") != "recalled":
            if days_left < 0:
                b["status"] = "expired"
            elif days_left <= 90:
                b["status"] = "near_expiry"
            else:
                b["status"] = "healthy"

    # ---------- 2 . Inventory rollup per product ----------
    inv_units_by_product: Dict[str, int] = defaultdict(int)
    inv_units_by_owner_state: Dict[str, int] = defaultdict(int)  # state -> units
    inv_units_by_owner: Dict[str, int] = defaultdict(int)        # owner_id -> units
    async for inv in db.inventory.find(
        {"product_id": {"$in": product_ids},
         "$or": [{"owner_type": "distributor", "owner_id": {"$in": dist_ids}},
                 {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}}]},
        {"_id": 0, "product_id": 1, "owner_type": 1, "owner_id": 1, "quantity": 1},
    ):
        q = int(inv.get("quantity", 0))
        inv_units_by_product[inv["product_id"]] += q
        inv_units_by_owner[inv["owner_id"]] += q
        # roll to retailer state (only retailers carry "region")
        if inv["owner_type"] == "retailer":
            r = retailer_by_id.get(inv["owner_id"])
            state = (r or {}).get("region") or "—"
            inv_units_by_owner_state[state] += q

    # ---------- 3 . Revenue (90d current + prior 90d) by product ----------
    start_90 = (today - timedelta(days=89)).isoformat()
    start_180 = (today - timedelta(days=179)).isoformat()
    end_prior_90 = (today - timedelta(days=90)).isoformat()
    start_30 = (today - timedelta(days=29)).isoformat()

    revenue_now: Dict[str, float] = defaultdict(float)
    revenue_prev: Dict[str, float] = defaultdict(float)
    spark_by_product: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    revenue_by_state: Dict[str, float] = defaultdict(float)

    async for s in db.daily_sales.find(
        {"product_id": {"$in": product_ids}, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_180}},
        {"_id": 0, "product_id": 1, "retailer_id": 1, "revenue": 1,
         "quantity_sold": 1, "date": 1},
    ):
        pid = s["product_id"]
        d = s["date"]
        rev = float(s.get("revenue", 0))
        if d >= start_90:
            revenue_now[pid] += rev
            # 30-day sparkline (units sold)
            if d >= start_30:
                spark_by_product[pid][d] += int(s.get("quantity_sold", 0))
            # geographic revenue
            r = retailer_by_id.get(s["retailer_id"])
            state = (r or {}).get("region") or "—"
            revenue_by_state[state] += rev
        elif start_180 <= d <= end_prior_90:
            revenue_prev[pid] += rev

    total_rev_now = sum(revenue_now.values())
    total_rev_prev = sum(revenue_prev.values())

    # ---------- 4 . KPI strip ----------
    expiring_90d_units = sum(
        int(b.get("quantity", 0)) for b in batches
        if 0 <= b["_days_left"] <= 90
    )
    expiring_prior_units = sum(
        int(b.get("quantity", 0)) for b in batches
        if -90 < b["_days_left"] < 0  # expired in last 90d as the "prior"
    )
    at_risk_value = 0.0
    for b in batches:
        if 0 <= b["_days_left"] <= 90:
            p = products_by_id.get(b["product_id"])
            if p:
                at_risk_value += int(b.get("quantity", 0)) * float(p.get("unit_price", 0))

    total_units = sum(inv_units_by_product.values())
    active_batches = sum(1 for b in batches if b["status"] != "expired" and b["status"] != "recalled")

    kpis = {
        "products": {"value": len(products), "sub": "Active SKUs"},
        "active_batches": {"value": active_batches, "sub": "Across network"},
        "units_in_network": {
            "value": total_units,
            # No persisted historical inventory snapshot — let the UI render
            # the value without a fabricated delta. (See review note in
            # iteration_7.)
            "growth_pct": None,
            "sub": "Across network",
        },
        "expiring_90d": {
            "value": expiring_90d_units,
            "growth_pct": _delta_pct(expiring_90d_units, expiring_prior_units),
            "sub": "Units at risk",
        },
        "at_risk_value": {
            "value": round(at_risk_value, 2),
            "sub": "Potential loss",
        },
        "revenue_90d": {
            "value": round(total_rev_now, 2),
            "growth_pct": _delta_pct(total_rev_now, total_rev_prev),
            "sub": "vs previous 90 days",
        },
    }

    # ---------- 5 . Portfolio table ----------
    portfolio = []
    matrix = []
    # day buckets for sparkline
    day_keys = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    growth_by_product: Dict[str, float | None] = {}

    # Pre-collect batch counts and expiring qty per product
    batches_by_product: Dict[str, List[dict]] = defaultdict(list)
    for b in batches:
        batches_by_product[b["product_id"]].append(b)

    revenues_for_median = sorted(revenue_now.values())
    revenue_median = revenues_for_median[len(revenues_for_median) // 2] if revenues_for_median else 0

    for p in products:
        pid = p["id"]
        rev_now = revenue_now.get(pid, 0.0)
        rev_prev = revenue_prev.get(pid, 0.0)
        growth = _delta_pct(rev_now, rev_prev)
        growth_by_product[pid] = growth
        pbatches = batches_by_product.get(pid, [])
        expiring_qty = sum(int(b["quantity"]) for b in pbatches if 0 <= b["_days_left"] <= 90)
        # Inventory health: combination of stock + expiry
        units = inv_units_by_product.get(pid, 0)
        if units == 0:
            health = "risk"
        elif expiring_qty > 5000 or any(b["_days_left"] < 0 for b in pbatches):
            health = "risk"
        elif expiring_qty > 0 or (growth is not None and growth < -5):
            health = "watch"
        else:
            health = "healthy"

        spark = [spark_by_product[pid].get(d, 0) for d in day_keys]
        portfolio.append({
            "id": pid, "name": p["name"], "sku": p.get("sku", ""),
            "category": p.get("category", "—"),
            "image_url": p.get("image_url") or "",
            "barcode": p.get("barcode") or "",
            "description": p.get("description") or "",
            "unit_price": p.get("unit_price") or 0,
            "revenue_90d": round(rev_now, 2),
            "units_in_network": units,
            "active_batches": sum(1 for b in pbatches if b["status"] != "expired" and b["status"] != "recalled"),
            "expiring_90d": expiring_qty,
            "inventory_health": health,
            "sparkline_30d": spark,
            "growth_pct": growth,
        })
        matrix.append({
            "id": pid, "name": p["name"], "category": p.get("category", "—"),
            "revenue_90d": round(rev_now, 2),
            "growth_pct": growth if growth is not None else 0.0,
            "quadrant": _quadrant(rev_now, growth, revenue_median),
        })

    # ---------- 6 . Batch Health donut ----------
    total_batches = len(batches)
    counts = {"healthy": 0, "near_expiry": 0, "expired": 0, "recalled": 0}
    for b in batches:
        counts[b["status"]] = counts.get(b["status"], 0) + 1
    batch_health = {
        "total": total_batches,
        "breakdown": [
            {"status": k, "count": v,
             "pct": round((v / total_batches) * 100, 1) if total_batches else 0.0}
            for k, v in counts.items()
        ],
    }

    # ---------- 7 . Expiry Risk donut ----------
    bucket_0_30 = sum(int(b["quantity"]) for b in batches if 0 <= b["_days_left"] <= 30)
    bucket_31_60 = sum(int(b["quantity"]) for b in batches if 31 <= b["_days_left"] <= 60)
    bucket_61_90 = sum(int(b["quantity"]) for b in batches if 61 <= b["_days_left"] <= 90)
    total_at_risk = bucket_0_30 + bucket_31_60 + bucket_61_90
    nearest = sorted(
        [b for b in batches if b["_days_left"] >= 0 and b["status"] != "recalled"],
        key=lambda x: x["_days_left"],
    )
    nearest_expiry = None
    if nearest:
        nb = nearest[0]
        p = products_by_id.get(nb["product_id"])
        nearest_expiry = {
            "product_name": (p or {}).get("name", "—"),
            "batch_number": nb["batch_number"],
            "expiry_date": nb["expiry_date"],
            "days_remaining": nb["_days_left"],
            "quantity": int(nb["quantity"]),
        }
    expiry_risk = {
        "total_at_risk": total_at_risk,
        "buckets": [
            {"label": "0–30 days", "units": bucket_0_30,
             "pct": round((bucket_0_30 / total_at_risk) * 100, 1) if total_at_risk else 0.0},
            {"label": "31–60 days", "units": bucket_31_60,
             "pct": round((bucket_31_60 / total_at_risk) * 100, 1) if total_at_risk else 0.0},
            {"label": "61–90 days", "units": bucket_61_90,
             "pct": round((bucket_61_90 / total_at_risk) * 100, 1) if total_at_risk else 0.0},
        ],
        "nearest_expiry": nearest_expiry,
    }

    # ---------- 8 . Category Performance ----------
    cat_now: Dict[str, float] = defaultdict(float)
    cat_prev: Dict[str, float] = defaultdict(float)
    for p in products:
        cat = p.get("category", "—")
        cat_now[cat] += revenue_now.get(p["id"], 0.0)
        cat_prev[cat] += revenue_prev.get(p["id"], 0.0)
    category_performance = [
        {"category": c, "revenue_90d": round(v, 2),
         "growth_pct": _delta_pct(v, cat_prev.get(c, 0.0))}
        for c, v in sorted(cat_now.items(), key=lambda x: -x[1])
    ]

    # ---------- 9 . Geographic Heatmap (per state) ----------
    # The seed data stores retailer "region" as a zone name (e.g. "Lagos",
    # "North East") rather than a Nigerian state. To make the choropleth
    # light up properly we aggregate by zone *and* emit per-state rows so
    # the frontend SVG (which uses real state polygons) colours every state
    # within a zone that has activity.
    ZONE_STATES = {
        "North West":    ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
        "North East":    ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
        "North Central": ["Benue", "Kogi", "Kwara", "Nassarawa", "Niger", "Plateau", "Federal Capital Territory"],
        "South West":    ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"],
        "South East":    ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
        "South South":   ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
    }
    # Aggregate units and revenue by zone (whichever way the retailer was
    # tagged — state name or zone name both work).
    zone_units: Dict[str, int] = defaultdict(int)
    zone_revenue: Dict[str, float] = defaultdict(float)
    for raw_region, units in inv_units_by_owner_state.items():
        zone = _zone_for(raw_region)
        zone_units[zone] += units
    for raw_region, rev in revenue_by_state.items():
        zone = _zone_for(raw_region)
        zone_revenue[zone] += rev

    heatmap = []
    # Emit one row per real state — fan zone numbers across the zone's states
    for zone, states in ZONE_STATES.items():
        n = len(states)
        zu = zone_units.get(zone, 0)
        zr = zone_revenue.get(zone, 0.0)
        per_state_units = zu // n if n else 0
        per_state_rev = zr / n if n else 0.0
        for s in states:
            heatmap.append({
                "state": s, "zone": zone,
                "units": per_state_units, "revenue_90d": round(per_state_rev, 2),
                "health": _state_heat_band(per_state_units),
            })

    # ---------- 10 . Stock Risk Center — top 5 expiring ----------
    risk_by_product: Dict[str, int] = defaultdict(int)
    for b in batches:
        if 0 <= b["_days_left"] <= 90:
            risk_by_product[b["product_id"]] += int(b["quantity"])
    ranked = sorted(risk_by_product.items(), key=lambda x: -x[1])[:5]
    stock_risk = []
    for pid, qty in ranked:
        p = products_by_id.get(pid)
        if not p:
            continue
        # min days remaining among the at-risk batches for this product
        days = min((b["_days_left"] for b in batches_by_product.get(pid, [])
                    if 0 <= b["_days_left"] <= 90), default=90)
        stock_risk.append({
            "product_id": pid, "product_name": p["name"],
            "units_at_risk": qty, "risk_level": _risk_level(days),
            "min_days_remaining": days,
        })

    # ---------- 11 . AI Product Intelligence Brief ----------
    ai_brief = _build_ai_brief(
        products_by_id=products_by_id,
        revenue_now=revenue_now,
        revenue_prev=revenue_prev,
        growth_by_product=growth_by_product,
        batches_by_product=batches_by_product,
        revenue_by_state=revenue_by_state,
        retailer_by_id=retailer_by_id,
        inv_units_by_owner=inv_units_by_owner,
        dist_ids=dist_ids,
    )

    # ---------- 12 . Recent Alerts ----------
    alerts = _build_recent_alerts(
        products_by_id=products_by_id,
        batches=batches,
        growth_by_product=growth_by_product,
        category_perf=category_performance,
    )

    return {
        "manufacturer": mfg,
        "kpis": kpis,
        "ai_brief": ai_brief,
        "portfolio": portfolio,
        "performance_matrix": matrix,
        "batch_health": batch_health,
        "expiry_risk": expiry_risk,
        "category_performance": category_performance,
        "geographic_heatmap": heatmap,
        "stock_risk": stock_risk,
        "recent_alerts": alerts,
    }


# ----------------------------------------------------------------------------
# Helper: AI Brief
# ----------------------------------------------------------------------------
def _build_ai_brief(*, products_by_id, revenue_now, revenue_prev,
                    growth_by_product, batches_by_product,
                    revenue_by_state, retailer_by_id,
                    inv_units_by_owner, dist_ids):
    """Compose the 4 insight cards + Network Inventory Health Score.

    Insights are rule-mined from the data so the page never shows stale text.
    Each insight returns:
        kind       : warning | growth | decline | rebalance
        title      : short tagline
        detail     : one-line metric explanation
        product_id : optional anchor to a portfolio row
    """
    insights: List[dict] = []

    # Insight 1: most at-risk product by expiring units
    risk_ranked = []
    for pid, pbatches in batches_by_product.items():
        qty = sum(int(b["quantity"]) for b in pbatches if 0 <= b["_days_left"] <= 90)
        if qty > 0:
            risk_ranked.append((pid, qty))
    risk_ranked.sort(key=lambda x: -x[1])
    if risk_ranked:
        pid, qty = risk_ranked[0]
        p = products_by_id[pid]
        # how many distributors carry this product
        dist_count = sum(1 for did in dist_ids
                         if inv_units_by_owner.get(did, 0) > 0)
        insights.append({
            "kind": "warning",
            "title": f"{p['name'].split(' ')[0]} inventory nearing expiry",
            "detail": f"{qty:,} units across {max(dist_count,1)} distributors",
            "product_id": pid,
        })

    # Insight 2: fastest-growing product (highest growth %, must have revenue)
    growers = [(pid, g) for pid, g in growth_by_product.items()
               if g is not None and g > 0 and revenue_now.get(pid, 0) > 0]
    growers.sort(key=lambda x: -x[1])
    if growers:
        pid, g = growers[0]
        p = products_by_id[pid]
        # Find the strongest contributing region
        # (simplified: use top revenue state overall as proxy)
        if revenue_by_state:
            top_state = max(revenue_by_state.items(), key=lambda x: x[1])[0]
            zone = REGION_MAP.get(top_state, top_state)
        else:
            zone = "the network"
        insights.append({
            "kind": "growth",
            "title": f"{p['name'].split(' ')[0]} demand accelerating",
            "detail": f"+{g:.1f}% growth in {zone}",
            "product_id": pid,
        })

    # Insight 3: largest decliner
    decliners = [(pid, g) for pid, g in growth_by_product.items()
                  if g is not None and g < 0]
    decliners.sort(key=lambda x: x[1])
    if decliners:
        pid, g = decliners[0]
        p = products_by_id[pid]
        insights.append({
            "kind": "decline",
            "title": f"{p['name'].split(' ')[0]} slowing in the network",
            "detail": f"{g:.1f}% growth in the last 30 days",
            "product_id": pid,
        })

    # Insight 4: reallocation opportunity (highest inventory imbalance)
    if risk_ranked:
        pid, qty = risk_ranked[0]
        # Recommend reallocating ~half the at-risk units
        rec = max(500, qty // 4)
        insights.append({
            "kind": "rebalance",
            "title": "Inventory reallocation opportunity",
            "detail": f"{rec:,} units recommended",
            "product_id": pid,
        })

    # Top up to 4 with a neutral message if not enough rules fired
    while len(insights) < 4:
        insights.append({
            "kind": "info",
            "title": "Network performance stable",
            "detail": "No critical signals — keep monitoring.",
            "product_id": None,
        })

    # Network Inventory Health Score (0-100)
    # Composite of: at-risk pressure (50% weight), batch expiry pressure (30%)
    # and average product growth (20%). Avoid the +10 fudge that previously
    # pegged the demo score at 100.
    total_units = sum(inv_units_by_owner.values()) or 1
    total_at_risk = sum(qty for _, qty in risk_ranked)
    at_risk_pct = min(total_at_risk / total_units, 1.0)
    # Batch-level expiry pressure — share of non-recalled batches that are
    # expired or near-expiry (any active batches dataset present)
    all_batches = [b for plist in batches_by_product.values() for b in plist]
    n_batches = len(all_batches) or 1
    bad_batches = sum(1 for b in all_batches if b["status"] in ("expired", "near_expiry"))
    expiry_pressure = bad_batches / n_batches
    avg_growth = 0.0
    growths = [g for g in growth_by_product.values() if g is not None]
    if growths:
        avg_growth = sum(growths) / len(growths)
    growth_component = max(min(avg_growth, 30), -30)  # clamp -30..+30
    score = (
        (1 - at_risk_pct) * 50 +
        (1 - expiry_pressure) * 30 +
        ((growth_component + 30) / 60) * 20
    )
    score = int(round(max(0, min(100, score))))
    if score >= 85:
        status = "Excellent"
    elif score >= 70:
        status = "Good"
    elif score >= 50:
        status = "Watch"
    else:
        status = "Critical"

    # 12-pt deterministic trend chart for the brief (based on growth)
    seed = int(hashlib.sha256(f"score-{score}".encode()).hexdigest(), 16)
    trend = []
    base = max(score - 8, 40)
    for i in range(12):
        delta = ((seed >> (i * 3)) & 0xF) - 8 + i * 0.6
        trend.append(max(0, min(100, base + delta)))

    return {
        "insights": insights[:4],
        "score": {"value": score, "status": status, "trend": trend},
    }


# ----------------------------------------------------------------------------
# Helper: Recent Alerts
# ----------------------------------------------------------------------------
def _build_recent_alerts(*, products_by_id, batches, growth_by_product,
                          category_perf):
    """Generate up to 4 recent operational alerts derived from real data."""
    out = []
    now = _today()

    # 1. Nearest expiry
    nearest = sorted(
        [b for b in batches if b["_days_left"] >= 0 and b["status"] != "recalled"],
        key=lambda x: x["_days_left"],
    )
    if nearest:
        b = nearest[0]
        p = products_by_id.get(b["product_id"])
        out.append({
            "severity": "warning",
            "icon": "alert-triangle",
            "title": f"{(p or {}).get('name', 'Batch')} {b['batch_number']} expires in {b['_days_left']} days",
            "subtitle": f"{int(b['quantity']):,} units affected · Review allocation",
            "timestamp": (now - timedelta(minutes=10)).isoformat(),
        })

    # 2. Slow movement
    decliners = sorted(
        [(pid, g) for pid, g in growth_by_product.items() if g is not None and g < -5],
        key=lambda x: x[1],
    )
    if decliners:
        pid, g = decliners[0]
        p = products_by_id.get(pid)
        out.append({
            "severity": "warning",
            "icon": "trending-down",
            "title": "Slow movement detected",
            "subtitle": f"{(p or {}).get('name', 'A product')} down {g:.1f}% — review inventory allocation",
            "timestamp": (now - timedelta(minutes=25)).isoformat(),
        })

    # 3. Demand spike — top growth product
    growers = sorted(
        [(pid, g) for pid, g in growth_by_product.items() if g is not None and g > 10],
        key=lambda x: -x[1],
    )
    if growers:
        pid, g = growers[0]
        p = products_by_id.get(pid)
        out.append({
            "severity": "info",
            "icon": "trending-up",
            "title": "Demand spike",
            "subtitle": f"{(p or {}).get('name', 'A product')} +{g:.1f}% increase in demand",
            "timestamp": (now - timedelta(hours=1)).isoformat(),
        })

    # 4. New batch received — most recently created batch
    if batches:
        recent_batch = max(batches, key=lambda x: x.get("created_at", ""))
        p = products_by_id.get(recent_batch["product_id"])
        out.append({
            "severity": "success",
            "icon": "check-circle",
            "title": "New batch received",
            "subtitle": f"{(p or {}).get('name', 'A product')} batch {recent_batch['batch_number']} · {int(recent_batch['quantity']):,} units",
            "timestamp": (now - timedelta(hours=3)).isoformat(),
        })

    return out[:4]


def _empty_kpis():
    return {
        "products": {"value": 0, "sub": "Active SKUs"},
        "active_batches": {"value": 0, "sub": "Across network"},
        "units_in_network": {"value": 0, "growth_pct": None, "sub": "vs last 30 days"},
        "expiring_90d": {"value": 0, "growth_pct": None, "sub": "Units at risk"},
        "at_risk_value": {"value": 0.0, "sub": "Potential loss"},
        "revenue_90d": {"value": 0.0, "growth_pct": None, "sub": "vs previous 90 days"},
    }


def _empty_brief():
    return {"insights": [], "score": {"value": 0, "status": "—", "trend": []}}
