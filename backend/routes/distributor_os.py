"""Distributor Operations Intelligence Center.

Fat aggregator for the modernized Distributor workspace. Mirrors the
``snapshots.py`` pattern used by the manufacturer dashboards so the heavy
analytical roll-ups are pre-computed (and cached as a single doc in
``dashboard_snapshots``) — the page renders instantly while a background
job refreshes it.

STRICT OWNERSHIP: A distributor owns wholesalers, not retailers. All
portfolio-style outputs (performance_matrix, top/attention, quadrant_counts,
KPIs marked "active_*") describe the WHOLESALER tier — the distributor's
direct downstream. Retailer numbers are exposed as downstream visibility only
under ``downstream_visibility``.

Payload structure (see GET /api/distributor/{id}/operations-intelligence):
    - as_of, distributor (id, name, region, city)
    - kpis: 6 cards w/ {value, growth_pct, spark}
        network_revenue_90d   - sum of downstream retailer daily_sales last 90d
        active_wholesalers    - wholesalers with ≥1 retailer active in last 30d
        retail_orders_pending - pending downstream stock-requests
        dispatched_30d        - shipments dispatched (last 30d)
        inventory_units       - units in distributor warehouse
        low_stock_skus        - SKUs at/below reorder at distributor
    - ai_brief: { insights, recommended_actions }
    - revenue_trend: 30-day daily { date, revenue, units }
    - performance_matrix: per-WHOLESALER { x: revenue, y: growth_pct, quadrant }
    - regional_coverage: per-region { region, retailers, revenue } (visibility)
    - inventory_health: { healthy_skus, low_skus, out_skus, donut, total_units }
    - top_wholesalers / attention_wholesalers
    - category_performance: top categories last 90d
    - order_pipeline: { pending, approved, dispatched, delivered_30d }
    - downstream_visibility: { total_retailers, active_retailers_30d }
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db
from services.snapshots import read_or_compute, recompute

router = APIRouter()


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _spark(seq: List[float]) -> List[int]:
    if not seq:
        return [0] * 12
    if len(seq) <= 12:
        return [int(round(v)) for v in seq]
    step = max(1, len(seq) // 12)
    out: List[int] = []
    for i in range(0, len(seq), step):
        chunk = seq[i:i + step]
        out.append(int(round(sum(chunk) / max(1, len(chunk)))))
        if len(out) == 12:
            break
    return out or [0]


def _delta_pct(curr: float, prev: float) -> float:
    if prev == 0 and curr == 0:
        return 0.0
    if prev == 0:
        return 100.0
    return round((curr - prev) / prev * 100, 1)


def _quadrant(rev: float, growth: float, med_rev: float) -> str:
    """BCG-style 2x2 — revenue × growth."""
    hi_rev = rev >= med_rev and rev > 0
    hi_grow = growth >= 0
    if hi_rev and hi_grow:
        return "stars"
    if not hi_rev and hi_grow:
        return "growth_opps"
    if hi_rev and not hi_grow:
        return "cash_cows"
    return "at_risk"


def _health_band(score: int) -> str:
    if score >= 80:
        return "excellent"
    if score >= 60:
        return "good"
    if score >= 40:
        return "fair"
    return "critical"


# ----------------------------------------------------------------------------
# main aggregator
# ----------------------------------------------------------------------------
@router.get("/distributor/{distributor_id}/operations-intelligence")
async def distributor_operations_intelligence(distributor_id: str):
    return await read_or_compute(
        "distributor-os", distributor_id,
        lambda: _build_distributor_os(distributor_id),
    )


@router.post("/distributor/{distributor_id}/operations-intelligence/refresh")
async def distributor_operations_intelligence_refresh(distributor_id: str):
    return await recompute(
        "distributor-os", distributor_id,
        lambda: _build_distributor_os(distributor_id),
    )


async def _build_distributor_os(distributor_id: str) -> dict:
    distributor = await db.distributors.find_one({"id": distributor_id}, {"_id": 0})
    if not distributor:
        raise HTTPException(404, "Distributor not found")

    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=90)).isoformat()
    start_180 = (today - timedelta(days=180)).isoformat()
    start_30 = (today - timedelta(days=30)).isoformat()
    start_60 = (today - timedelta(days=60)).isoformat()

    # ---- Direct children = wholesalers (strict ownership tier) -------------
    wholesalers = await db.organizations.find(
        {"organization_type": "wholesaler", "parent_organization_id": distributor_id},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "region": 1, "city": 1},
    ).to_list(500)
    wholesaler_ids = [w["id"] for w in wholesalers]
    wholesaler_by_id = {w["id"]: w for w in wholesalers}

    # ---- Downstream visibility: retailers under those wholesalers ----------
    # (Retailers are children of wholesalers — distributor visibility only.)
    retailers = await db.organizations.find(
        {"organization_type": "retailer",
         "parent_organization_id": {"$in": wholesaler_ids}},
        {"_id": 0, "id": 1, "organization_name": 1, "parent_organization_id": 1,
         "region": 1, "city": 1, "metadata": 1},
    ).to_list(20000) if wholesaler_ids else []
    retailer_ids = [r["id"] for r in retailers]
    retailer_by_id = {r["id"]: r for r in retailers}
    # retailer -> wholesaler (its owning parent)
    retailer_to_wholesaler = {r["id"]: r["parent_organization_id"] for r in retailers}

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}

    if not wholesaler_ids:
        return _empty_payload(distributor)

    # ---- daily_sales rollups (last 180d) -----------------------------------
    by_date: Dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "units": 0})
    by_retailer_rev: Dict[str, float] = defaultdict(float)
    by_retailer_active_dates: Dict[str, set] = defaultdict(set)
    by_wholesaler_rev: Dict[str, float] = defaultdict(float)
    by_wholesaler_units: Dict[str, int] = defaultdict(int)
    by_wholesaler_rev_prev: Dict[str, float] = defaultdict(float)
    by_wholesaler_active_retailers: Dict[str, set] = defaultdict(set)
    by_category: Dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "units": 0})
    by_region_rev: Dict[str, float] = defaultdict(float)
    by_region_count: Dict[str, set] = defaultdict(set)

    rev_90d_total = 0.0
    rev_prev_90d_total = 0.0

    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_180}},
        {"_id": 0, "retailer_id": 1, "product_id": 1, "revenue": 1,
         "units": 1, "quantity_sold": 1, "date": 1},
    ):
        rev = float(s.get("revenue", 0))
        units = int(s.get("units", s.get("quantity_sold", 0)))
        d = s["date"]
        rid = s["retailer_id"]
        wid = retailer_to_wholesaler.get(rid)
        if d >= start_90:
            rev_90d_total += rev
            by_retailer_rev[rid] += rev
            if wid:
                by_wholesaler_rev[wid] += rev
                by_wholesaler_units[wid] += units
            if d >= start_30:
                by_retailer_active_dates[rid].add(d)
                if wid:
                    by_wholesaler_active_retailers[wid].add(rid)
            by_date[d]["revenue"] += rev
            by_date[d]["units"] += units
            p = products.get(s.get("product_id"))
            if p:
                cat = p.get("category") or "Other"
                by_category[cat]["revenue"] += rev
                by_category[cat]["units"] += units
            r = retailer_by_id.get(rid)
            if r:
                region = r.get("region") or "—"
                by_region_rev[region] += rev
                by_region_count[region].add(rid)
        else:
            rev_prev_90d_total += rev
            if wid:
                by_wholesaler_rev_prev[wid] += rev

    # ---- 30-day daily revenue trend ----------------------------------------
    revenue_trend: List[dict] = []
    for i in range(30):
        d = (today - timedelta(days=29 - i)).isoformat()
        agg = by_date.get(d, {"revenue": 0.0, "units": 0})
        revenue_trend.append({
            "date": d,
            "revenue": round(agg["revenue"], 2),
            "units": agg["units"],
        })

    # ---- KPI: active wholesalers (any of its retailers sold in last 30d) ---
    active_wholesalers_30d = sum(
        1 for wid in wholesaler_ids if by_wholesaler_active_retailers.get(wid)
    )
    # active wholesalers in previous 30d window (30-60 days ago)
    active_wholesalers_prev: set[str] = set()
    if retailer_ids:
        async for s in db.daily_sales.find(
            {"retailer_id": {"$in": retailer_ids},
             "date": {"$gte": start_60, "$lt": start_30}},
            {"_id": 0, "retailer_id": 1},
        ):
            w = retailer_to_wholesaler.get(s["retailer_id"])
            if w:
                active_wholesalers_prev.add(w)
    active_wholesalers_prev_n = len(active_wholesalers_prev)
    # Downstream-visibility-only retailer activity
    active_retailers_30d = sum(1 for rid in retailer_ids if by_retailer_active_dates.get(rid))

    # ---- KPI: orders pending (requests pending state) ----------------------
    pending_requests = await db.requests.count_documents(
        {"distributor_id": distributor_id, "status": "pending"},
    )

    # ---- KPI: dispatched_30d (shipments dispatched last 30d) ---------------
    dispatched_30d = await db.shipments.count_documents({
        "from_role": "distributor", "from_id": distributor_id,
        "dispatched_at": {"$gte": start_30},
    })
    dispatched_prev = await db.shipments.count_documents({
        "from_role": "distributor", "from_id": distributor_id,
        "dispatched_at": {"$gte": start_60, "$lt": start_30},
    })

    # ---- KPI: distributor inventory ---------------------------------------
    inv_units_total = 0
    low_stock_skus = 0
    out_stock_skus = 0
    healthy_skus = 0
    total_skus = 0
    async for inv in db.inventory.find(
        {"owner_type": "distributor", "owner_id": distributor_id},
        {"_id": 0, "quantity": 1, "reorder_level": 1, "product_id": 1},
    ):
        q = int(inv.get("quantity", 0))
        ro = int(inv.get("reorder_level", 0))
        inv_units_total += q
        total_skus += 1
        if q == 0:
            out_stock_skus += 1
        elif q <= ro:
            low_stock_skus += 1
        else:
            healthy_skus += 1

    # ---- Per-wholesaler growth & performance matrix ------------------------
    # (Strict-ownership: distributor's portfolio is wholesalers, not retailers.)
    matrix: List[dict] = []
    growth_list: List[dict] = []
    for wid in wholesaler_ids:
        w = wholesaler_by_id.get(wid) or {}
        rev = by_wholesaler_rev.get(wid, 0.0)
        prev = by_wholesaler_rev_prev.get(wid, 0.0)
        growth = _delta_pct(rev, prev)
        units = by_wholesaler_units.get(wid, 0)
        growth_list.append({
            "id": wid,
            "name": w.get("organization_name", "—"),
            "code": w.get("organization_code", ""),
            "city": w.get("city", ""),
            "region": w.get("region", ""),
            "revenue_90d": round(rev, 2),
            "revenue_prev_90d": round(prev, 2),
            "growth_pct": growth,
            "units": units,
            "active_retailers_30d": len(by_wholesaler_active_retailers.get(wid, set())),
        })
    rev_values = [g["revenue_90d"] for g in growth_list if g["revenue_90d"] > 0]
    rev_values.sort()
    med_rev = rev_values[len(rev_values) // 2] if rev_values else 0.0
    for g in growth_list:
        q = _quadrant(g["revenue_90d"], g["growth_pct"], med_rev)
        matrix.append({**g, "quadrant": q})

    # quadrant counts now reference wholesalers
    quadrant_counts = {
        "stars": sum(1 for m in matrix if m["quadrant"] == "stars"),
        "cash_cows": sum(1 for m in matrix if m["quadrant"] == "cash_cows"),
        "growth_opps": sum(1 for m in matrix if m["quadrant"] == "growth_opps"),
        "at_risk": sum(1 for m in matrix if m["quadrant"] == "at_risk"),
    }

    # ---- Top / attention WHOLESALERS ---------------------------------------
    top_wholesalers = sorted(growth_list, key=lambda x: x["revenue_90d"], reverse=True)[:5]
    attention_wholesalers = sorted(
        [g for g in growth_list if g["growth_pct"] < 0 or (med_rev > 0 and g["revenue_90d"] < med_rev / 2)],
        key=lambda x: x["growth_pct"],
    )[:5]
    if not attention_wholesalers:
        attention_wholesalers = sorted(growth_list, key=lambda x: x["revenue_90d"])[:5]

    # ---- Regional coverage (downstream rollup — VISIBILITY) ----------------
    regional_coverage = []
    for region, rev in by_region_rev.items():
        regional_coverage.append({
            "region": region,
            "retailers": len(by_region_count.get(region, set())),
            "revenue": round(rev, 2),
        })
    regional_coverage.sort(key=lambda x: x["revenue"], reverse=True)

    # ---- Category performance -----------------------------------------------
    category_performance = sorted(
        [{"category": k, "revenue": round(v["revenue"], 2), "units": v["units"]}
         for k, v in by_category.items()],
        key=lambda x: x["revenue"], reverse=True,
    )[:6]

    # ---- Order pipeline (distributor_orders state + stock requests) --------
    pipeline = {
        "pending": 0, "approved": 0, "dispatched": 0, "delivered_30d": 0,
    }
    async for o in db.distributor_orders.find(
        {"distributor_id": distributor_id},
        {"_id": 0, "status": 1, "delivered_at": 1},
    ):
        st = o.get("status", "pending")
        if st in ("pending", "approved", "dispatched"):
            pipeline[st] += 1
        elif st == "delivered" and (o.get("delivered_at") or "") >= start_30:
            pipeline["delivered_30d"] += 1

    # ---- Revenue trend 12-pt spark (for hero) ------------------------------
    revenue_spark = _spark([t["revenue"] for t in revenue_trend])

    # ---- KPI strip (direct-tier = wholesalers; retailer numbers visibility-only) -----
    kpis = {
        "network_revenue_90d": {
            "value": round(rev_90d_total, 2),
            "growth_pct": _delta_pct(rev_90d_total, rev_prev_90d_total),
            "spark": revenue_spark,
        },
        "active_wholesalers": {
            "value": active_wholesalers_30d,
            "growth_pct": _delta_pct(active_wholesalers_30d, active_wholesalers_prev_n),
            "spark": _spark([1 if wid in by_wholesaler_active_retailers else 0
                             for wid in wholesaler_ids[:60]]) or [0],
        },
        "retail_orders_pending": {
            "value": pending_requests + pipeline["pending"],
            "growth_pct": None,
            "spark": [pending_requests + pipeline["pending"]] * 12,
        },
        "dispatched_30d": {
            "value": dispatched_30d,
            "growth_pct": _delta_pct(dispatched_30d, dispatched_prev),
            "spark": [dispatched_30d] * 12,
        },
        "inventory_units": {
            "value": inv_units_total,
            "growth_pct": None,
            "spark": _spark([inv_units_total] * 12),
        },
        "low_stock_skus": {
            "value": low_stock_skus + out_stock_skus,
            "growth_pct": None,
            "spark": _spark([low_stock_skus + out_stock_skus] * 12),
        },
    }

    # ---- Inventory health donut --------------------------------------------
    inventory_health = {
        "healthy_skus": healthy_skus,
        "low_skus": low_stock_skus,
        "out_skus": out_stock_skus,
        "total_skus": total_skus,
        "total_units": inv_units_total,
        "donut": [
            {"label": "Healthy", "value": healthy_skus, "color": "#10b981"},
            {"label": "Low", "value": low_stock_skus, "color": "#f59e0b"},
            {"label": "Out", "value": out_stock_skus, "color": "#ef4444"},
        ],
    }

    # ---- AI brief (deterministic insights + recommended actions) -----------
    ai_brief = _build_ai_brief(
        distributor_name=distributor.get("name", ""),
        rev_90d=rev_90d_total,
        rev_growth=_delta_pct(rev_90d_total, rev_prev_90d_total),
        active_30d=active_wholesalers_30d, active_total=len(wholesaler_ids),
        attention=attention_wholesalers, top=top_wholesalers,
        pending_requests=pending_requests + pipeline["pending"],
        low_stock=low_stock_skus + out_stock_skus,
        top_region=regional_coverage[0] if regional_coverage else None,
        top_category=category_performance[0] if category_performance else None,
        quadrant_counts=quadrant_counts,
        tier_label="wholesaler",
    )

    # ---- Composite health score for hero -----------------------------------
    health_score = _composite_health(
        rev_growth=_delta_pct(rev_90d_total, rev_prev_90d_total),
        active_ratio=active_wholesalers_30d / max(1, len(wholesaler_ids)),
        low_stock=low_stock_skus + out_stock_skus,
        attention_count=len(attention_wholesalers),
    )

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "distributor": {
            "id": distributor["id"],
            "name": distributor.get("name", "Distributor"),
            "region": distributor.get("region", ""),
            "city": distributor.get("city", ""),
            "state": distributor.get("state", ""),
        },
        "kpis": kpis,
        "ai_brief": ai_brief,
        "revenue_trend": revenue_trend,
        # NOTE: performance_matrix / quadrant_counts / top / attention now describe
        # WHOLESALERS (direct downstream tier). Retailers are visibility-only.
        "performance_matrix": matrix,
        "quadrant_counts": quadrant_counts,
        "regional_coverage": regional_coverage,
        "inventory_health": inventory_health,
        "top_wholesalers": top_wholesalers,
        "attention_wholesalers": attention_wholesalers,
        "category_performance": category_performance,
        "order_pipeline": pipeline,
        "network_health": {
            "score": health_score,
            "band": _health_band(health_score),
        },
        "totals": {
            "total_wholesalers": len(wholesaler_ids),
            "total_skus": total_skus,
        },
        # Downstream visibility (not ownership): aggregated retailer numbers the
        # distributor can see through its wholesalers.
        "downstream_visibility": {
            "total_retailers": len(retailer_ids),
            "active_retailers_30d": active_retailers_30d,
        },
    }


def _composite_health(
    *, rev_growth: float, active_ratio: float,
    low_stock: int, attention_count: int,
) -> int:
    score = (
        max(0.0, min((rev_growth + 30) / 60, 1.0)) * 35 +   # growth normalized -30..+30
        active_ratio * 30 +
        max(0.0, 1 - low_stock * 0.04) * 20 +
        max(0.0, 1 - attention_count * 0.10) * 15
    )
    return int(max(0, min(100, round(score))))


def _build_ai_brief(
    *, distributor_name: str, rev_90d: float, rev_growth: float,
    active_30d: int, active_total: int,
    attention: List[dict], top: List[dict],
    pending_requests: int, low_stock: int,
    top_region: dict | None, top_category: dict | None,
    quadrant_counts: dict,
    tier_label: str = "wholesaler",
) -> dict:
    """Deterministic, instant AI brief — kept fast for snapshot builds."""
    insights: List[dict] = []
    recommended_actions: List[dict] = []
    tier_label_plural = f"{tier_label}s"

    if rev_growth > 5:
        insights.append({
            "tone": "positive", "icon": "trending-up",
            "title": f"Revenue is up {rev_growth:.1f}% versus the prior 90 days",
            "detail": f"Sustain stock depth across top {tier_label_plural} to capture demand.",
        })
    elif rev_growth < -5:
        insights.append({
            "tone": "critical", "icon": "trending-down",
            "title": f"Revenue is down {abs(rev_growth):.1f}% versus the prior 90 days",
            "detail": "Investigate root cause — pricing, competitor activity, or stockouts.",
        })
    else:
        insights.append({
            "tone": "info", "icon": "info",
            "title": "Revenue trend is stable",
            "detail": f"₦{rev_90d:,.0f} earned across the network in the last 90 days.",
        })

    if top_region:
        insights.append({
            "tone": "info", "icon": "compass",
            "title": f"{top_region['region']} is your highest revenue region",
            "detail": f"₦{top_region['revenue']:,.0f} across {top_region['retailers']} retailers.",
        })

    if top_category:
        insights.append({
            "tone": "info", "icon": "trophy",
            "title": f"Best-selling category: {top_category['category']}",
            "detail": f"₦{top_category['revenue']:,.0f} contribution over 90 days.",
        })

    coverage_pct = (active_30d / max(active_total, 1)) * 100
    if coverage_pct < 60:
        insights.append({
            "tone": "warning", "icon": "alert-triangle",
            "title": f"Only {active_30d}/{active_total} {tier_label_plural} ({coverage_pct:.0f}%) active in last 30 days",
            "detail": f"Re-engage dormant {tier_label_plural} to grow coverage.",
        })

    if quadrant_counts.get("at_risk", 0) > 0:
        insights.append({
            "tone": "warning", "icon": "alert-octagon",
            "title": f"{quadrant_counts['at_risk']} {tier_label}(s) in At-Risk quadrant",
            "detail": "Low revenue × declining growth — schedule rescue calls.",
        })

    # Actions
    if low_stock > 0:
        recommended_actions.append({
            "tone": "critical",
            "title": f"Replenish {low_stock} low-stock SKUs in warehouse",
            "detail": f"Place purchase order with manufacturer to avoid {tier_label} stockouts.",
            "cta": "Open Inventory",
        })
    if pending_requests > 0:
        recommended_actions.append({
            "tone": "warning",
            "title": f"{pending_requests} {tier_label} order(s) awaiting your decision",
            "detail": "Approve or reject pending stock requests to keep flow steady.",
            "cta": "Open Requests",
        })
    if attention:
        first = attention[0]
        recommended_actions.append({
            "tone": "warning",
            "title": f"Engage {first['name']}",
            "detail": f"Revenue declined {first['growth_pct']:.1f}% — recommend a restock visit.",
            "cta": f"View {tier_label.title()}",
        })
    if top:
        leader = top[0]
        recommended_actions.append({
            "tone": "positive",
            "title": f"Reward {leader['name']}",
            "detail": f"₦{leader['revenue_90d']:,.0f} in 90 days — consider promotional volume.",
            "cta": f"View {tier_label.title()}",
        })
    while len(recommended_actions) < 3:
        recommended_actions.append({
            "tone": "info",
            "title": "Operations stable",
            "detail": "No immediate intervention required — keep monitoring.",
            "cta": None,
        })
    return {"insights": insights[:5], "recommended_actions": recommended_actions[:4]}


def _empty_payload(distributor: dict) -> dict:
    """Return well-formed empty payload when distributor has no wholesalers."""
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "distributor": {
            "id": distributor["id"],
            "name": distributor.get("name", "Distributor"),
            "region": distributor.get("region", ""),
            "city": distributor.get("city", ""),
            "state": distributor.get("state", ""),
        },
        "kpis": {
            "network_revenue_90d": {"value": 0, "growth_pct": 0, "spark": [0] * 12},
            "active_wholesalers": {"value": 0, "growth_pct": 0, "spark": [0] * 12},
            "retail_orders_pending": {"value": 0, "growth_pct": 0, "spark": [0] * 12},
            "dispatched_30d": {"value": 0, "growth_pct": 0, "spark": [0] * 12},
            "inventory_units": {"value": 0, "growth_pct": 0, "spark": [0] * 12},
            "low_stock_skus": {"value": 0, "growth_pct": 0, "spark": [0] * 12},
        },
        "ai_brief": {
            "insights": [{"tone": "info", "icon": "info",
                          "title": "No wholesalers yet",
                          "detail": "Onboard wholesalers to start seeing operations intelligence."}],
            "recommended_actions": [],
        },
        "revenue_trend": [{"date": (datetime.now(timezone.utc).date() - timedelta(days=29 - i)).isoformat(),
                           "revenue": 0, "units": 0} for i in range(30)],
        "performance_matrix": [],
        "quadrant_counts": {"stars": 0, "cash_cows": 0, "growth_opps": 0, "at_risk": 0},
        "regional_coverage": [],
        "inventory_health": {
            "healthy_skus": 0, "low_skus": 0, "out_skus": 0,
            "total_skus": 0, "total_units": 0,
            "donut": [{"label": "Healthy", "value": 0, "color": "#10b981"}],
        },
        "top_wholesalers": [],
        "attention_wholesalers": [],
        "category_performance": [],
        "order_pipeline": {"pending": 0, "approved": 0, "dispatched": 0, "delivered_30d": 0},
        "network_health": {"score": 0, "band": "critical"},
        "totals": {"total_wholesalers": 0, "total_skus": 0},
        "downstream_visibility": {"total_retailers": 0, "active_retailers_30d": 0},
    }



# ============================================================================
# WHOLESALER NETWORK — Distributor → Wholesalers (primary network surface)
# ----------------------------------------------------------------------------
# Per the canonical chain (Distributor → Wholesaler → Retailer), the
# distributor's primary downstream relationship is with wholesalers, not
# retailers. The dashboard surfaces wholesaler-level metrics and supports a
# drill-down into each wholesaler to see the retailers it serves.
# ============================================================================
@router.get("/distributor/{distributor_id}/wholesaler-network")
async def distributor_wholesaler_network(distributor_id: str):
    """Wholesalers served by this distributor + roll-up metrics."""
    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=90)).isoformat()
    start_180 = (today - timedelta(days=180)).isoformat()
    start_30 = (today - timedelta(days=30)).isoformat()

    # Wholesalers under this distributor
    wholesalers = await db.organizations.find(
        {"organization_type": "wholesaler", "parent_organization_id": distributor_id},
        {"_id": 0},
    ).to_list(500)
    ws_ids = [w["id"] for w in wholesalers]

    # Retailers under those wholesalers
    retailers = await db.organizations.find(
        {"organization_type": "retailer", "parent_organization_id": {"$in": ws_ids}},
        {"_id": 0, "id": 1, "parent_organization_id": 1, "organization_name": 1, "region": 1, "city": 1},
    ).to_list(5000) if ws_ids else []
    rt_by_ws: Dict[str, list] = defaultdict(list)
    for r in retailers:
        rt_by_ws[r["parent_organization_id"]].append(r)

    retailer_ids = [r["id"] for r in retailers]
    rev_by_retailer_90: Dict[str, float] = defaultdict(float)
    rev_by_retailer_prev: Dict[str, float] = defaultdict(float)
    active_retailers_30: set[str] = set()
    if retailer_ids:
        async for s in db.daily_sales.find(
            {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_180}},
            {"_id": 0, "retailer_id": 1, "date": 1, "revenue": 1},
        ):
            rid = s["retailer_id"]
            d = s.get("date", "")
            rev = float(s.get("revenue") or 0)
            if d >= start_90:
                rev_by_retailer_90[rid] += rev
                if d >= start_30:
                    active_retailers_30.add(rid)
            else:
                rev_by_retailer_prev[rid] += rev

    # Aggregate per wholesaler
    cards: list[dict] = []
    for ws in wholesalers:
        rs = rt_by_ws.get(ws["id"], [])
        retailer_count = len(rs)
        active_30 = sum(1 for r in rs if r["id"] in active_retailers_30)
        rev_90 = sum(rev_by_retailer_90.get(r["id"], 0) for r in rs)
        rev_prev = sum(rev_by_retailer_prev.get(r["id"], 0) for r in rs)
        growth_pct = _delta_pct(rev_90, rev_prev)
        pending_orders = await db.purchase_orders.count_documents({
            "distributor_id": ws["id"], "supplier_type": "wholesaler",
            "status": {"$in": ["submitted", "approved", "processing"]},
        })
        status = (
            "critical" if active_30 == 0 and retailer_count > 0
            else "attention" if growth_pct < -10
            else "healthy"
        )
        cards.append({
            "id": ws["id"],
            "name": ws.get("organization_name"),
            "code": ws.get("organization_code"),
            "region": ws.get("region"),
            "city": ws.get("city"),
            "retailer_count": retailer_count,
            "active_retailers_30d": active_30,
            "revenue_90d": round(rev_90, 2),
            "growth_pct": growth_pct,
            "pending_orders": pending_orders,
            "status": status,
        })

    cards.sort(key=lambda c: c["revenue_90d"], reverse=True)
    top = cards[:5]
    attention = sorted([c for c in cards if c["status"] != "healthy"],
                       key=lambda c: c["revenue_90d"], reverse=True)[:5]

    # Key-account retailers served direct (legacy / Shoprite etc.)
    ka_retailers = await db.organizations.find(
        {"organization_type": "retailer", "parent_organization_id": distributor_id},
        {"_id": 0, "id": 1, "organization_name": 1, "region": 1, "city": 1, "metadata": 1},
    ).to_list(50)
    ka_cards = []
    if ka_retailers:
        ka_ids = [r["id"] for r in ka_retailers]
        ka_rev: Dict[str, float] = defaultdict(float)
        async for s in db.daily_sales.find(
            {"retailer_id": {"$in": ka_ids}, "date": {"$gte": start_90}},
            {"_id": 0, "retailer_id": 1, "revenue": 1},
        ):
            ka_rev[s["retailer_id"]] += float(s.get("revenue") or 0)
        for r in ka_retailers:
            ka_cards.append({
                "id": r["id"],
                "name": r.get("organization_name"),
                "region": r.get("region"),
                "city": r.get("city"),
                "brand": (r.get("metadata") or {}).get("key_account_brand"),
                "revenue_90d": round(ka_rev.get(r["id"], 0), 2),
            })
        ka_cards.sort(key=lambda c: c["revenue_90d"], reverse=True)

    return {
        "distributor_id": distributor_id,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "kpis": {
            "total_wholesalers": len(wholesalers),
            "active_wholesalers_30d": sum(1 for c in cards if c["active_retailers_30d"] > 0),
            "total_retailers_in_network": len(retailers),
            "active_retailers_30d": len(active_retailers_30),
            "revenue_90d": round(sum(rev_by_retailer_90.values()), 2),
            "key_account_retailers": len(ka_retailers),
        },
        "wholesalers": cards,
        "top_wholesalers": top,
        "attention_wholesalers": attention,
        "key_account_retailers": ka_cards,
    }


@router.get("/distributor/{distributor_id}/wholesaler/{wholesaler_id}/detail")
async def distributor_wholesaler_detail(distributor_id: str, wholesaler_id: str):
    """Full drill-down on one wholesaler — retailers + recent orders."""
    ws = await db.organizations.find_one(
        {"id": wholesaler_id, "organization_type": "wholesaler",
         "parent_organization_id": distributor_id},
        {"_id": 0},
    )
    if not ws:
        raise HTTPException(404, "Wholesaler not in this distributor's network")

    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=90)).isoformat()
    start_30 = (today - timedelta(days=30)).isoformat()

    retailers = await db.organizations.find(
        {"organization_type": "retailer", "parent_organization_id": wholesaler_id},
        {"_id": 0},
    ).to_list(500)
    rt_ids = [r["id"] for r in retailers]
    rev_90: Dict[str, float] = defaultdict(float)
    units_90: Dict[str, int] = defaultdict(int)
    last_sale: Dict[str, str] = {}
    if rt_ids:
        async for s in db.daily_sales.find(
            {"retailer_id": {"$in": rt_ids}, "date": {"$gte": start_90}},
            {"_id": 0, "retailer_id": 1, "revenue": 1, "units": 1, "date": 1},
        ):
            rid = s["retailer_id"]
            rev_90[rid] += float(s.get("revenue") or 0)
            units_90[rid] += int(s.get("units") or 0)
            d = s.get("date", "")
            if d and d > last_sale.get(rid, ""):
                last_sale[rid] = d

    retailer_cards = []
    for r in retailers:
        rev = round(rev_90.get(r["id"], 0), 2)
        last = last_sale.get(r["id"])
        status = (
            "healthy" if last and last >= start_30
            else "attention" if last
            else "critical"
        )
        retailer_cards.append({
            "id": r["id"],
            "name": r.get("organization_name"),
            "code": r.get("organization_code"),
            "region": r.get("region"),
            "city": r.get("city"),
            "revenue_90d": rev,
            "units_90d": units_90.get(r["id"], 0),
            "last_sale_date": last,
            "status": status,
        })
    retailer_cards.sort(key=lambda c: c["revenue_90d"], reverse=True)

    # Recent retailer orders against this wholesaler
    recent_orders = []
    async for po in db.purchase_orders.find(
        {"distributor_id": wholesaler_id, "supplier_type": "wholesaler"},
        {"_id": 0, "id": 1, "po_number": 1, "retailer_id": 1, "total_amount": 1,
         "status": 1, "created_at": 1, "items": 1},
    ).sort("created_at", -1).limit(25):
        retailer = next((r for r in retailers if r["id"] == po.get("retailer_id")), {})
        recent_orders.append({
            "id": po["id"],
            "po_number": po.get("po_number"),
            "retailer_id": po.get("retailer_id"),
            "retailer_name": retailer.get("organization_name", "Unknown"),
            "total_amount": float(po.get("total_amount") or 0),
            "status": po.get("status"),
            "line_count": len(po.get("items") or []),
            "created_at": po.get("created_at"),
        })

    # Pending wholesaler PO to this distributor (procurement upstream)
    incoming_pos = []
    async for wpo in db.wholesaler_purchase_orders.find(
        {"wholesaler_id": wholesaler_id, "supplier_id": distributor_id},
        {"_id": 0, "id": 1, "po_number": 1, "total_amount": 1, "status": 1,
         "items": 1, "created_at": 1},
    ).sort("created_at", -1).limit(15):
        incoming_pos.append({
            "id": wpo["id"], "po_number": wpo.get("po_number"),
            "total_amount": float(wpo.get("total_amount") or 0),
            "status": wpo.get("status"),
            "line_count": len(wpo.get("items") or []),
            "created_at": wpo.get("created_at"),
        })

    return {
        "wholesaler": {
            "id": ws["id"],
            "name": ws.get("organization_name"),
            "code": ws.get("organization_code"),
            "region": ws.get("region"),
            "city": ws.get("city"),
            "address": ws.get("address"),
            "contact_email": ws.get("contact_email"),
        },
        "kpis": {
            "total_retailers": len(retailers),
            "active_retailers_30d": sum(1 for c in retailer_cards if c["status"] == "healthy"),
            "revenue_90d": round(sum(rev_90.values()), 2),
            "pending_orders_from_retailers": sum(
                1 for o in recent_orders
                if o["status"] in ("submitted", "approved", "processing")
            ),
            "pending_procurement_to_distributor": sum(
                1 for p in incoming_pos
                if p["status"] in ("submitted", "approved", "processing")
            ),
        },
        "retailers": retailer_cards,
        "recent_retailer_orders": recent_orders,
        "wholesaler_purchase_orders_to_distributor": incoming_pos,
    }
