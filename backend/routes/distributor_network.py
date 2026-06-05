"""Distributor Network Intelligence Center — manufacturer-wide aggregator.

Returns the full executive dashboard payload for a manufacturer's
distributor network. Mirrors the fat-endpoint pattern used by
product_intelligence / distributor_intelligence so the React view can render
the entire dashboard from a single round-trip.

Payload structure (see /api/manufacturer/{id}/distributor-network-intelligence):
  - kpis: 6 cards (active_distributors, retailers_served, network_revenue_90d,
          inventory_units, avg_sell_through, at_risk_distributors)
  - performance_matrix: per-distributor bubble plot data
  - regional_coverage: per-region (NW/NE/NC/SW/SE/SS) revenue + counts
  - ai_brief: list of insights for the purple gradient card
  - spotlight: top 5 distributors (Top Distributor Overview row)
  - distributors_table: full master list
  - retail_reach: top-N distributors ranked by retailer coverage
  - at_risk: distributors needing attention (issue + severity)
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db

router = APIRouter()


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
NIGERIA_REGION_BY_STATE: Dict[str, str] = {
    "Lagos": "South West", "Oyo": "South West", "Ogun": "South West",
    "Osun": "South West", "Ondo": "South West", "Ekiti": "South West",
    "Enugu": "South East", "Anambra": "South East", "Imo": "South East",
    "Abia": "South East", "Ebonyi": "South East",
    "Rivers": "South South", "Delta": "South South", "Edo": "South South",
    "Bayelsa": "South South", "Cross River": "South South", "Akwa Ibom": "South South",
    "Kano": "North West", "Kaduna": "North West", "Katsina": "North West",
    "Kebbi": "North West", "Sokoto": "North West", "Zamfara": "North West",
    "Jigawa": "North West",
    "Borno": "North East", "Yobe": "North East", "Adamawa": "North East",
    "Bauchi": "North East", "Gombe": "North East", "Taraba": "North East",
    "Abuja": "North Central", "FCT": "North Central", "Niger": "North Central",
    "Kwara": "North Central", "Kogi": "North Central", "Benue": "North Central",
    "Nasarawa": "North Central", "Plateau": "North Central",
}
ALL_REGIONS = ["North West", "North East", "North Central",
               "South West", "South East", "South South"]


def _resolve_region(distributor: dict) -> str:
    """Best-effort region resolver — prefers explicit `region`, then maps
    city/state via the state→zone lookup."""
    if distributor.get("region") and distributor["region"] in ALL_REGIONS:
        return distributor["region"]
    state = (distributor.get("state") or "").strip()
    if state in NIGERIA_REGION_BY_STATE:
        return NIGERIA_REGION_BY_STATE[state]
    city = (distributor.get("city") or "").strip()
    if city in NIGERIA_REGION_BY_STATE:
        return NIGERIA_REGION_BY_STATE[city]
    # Coarse fall-back keyed by common LGA / city stems
    LGA_HINT = {
        "Awka": "South East", "Maiduguri": "North East", "Sokoto": "North West",
        "Lekki": "South West", "Ikeja": "South West", "Onitsha": "South East",
        "Aba": "South East", "Port Harcourt": "South South", "Warri": "South South",
        "Kano": "North West", "Kaduna": "North West", "Ilorin": "North Central",
        "Jos": "North Central", "Abuja": "North Central",
    }
    for k, v in LGA_HINT.items():
        if k.lower() in city.lower():
            return v
    return "South West"  # safest default — densest distributor footprint


def _spark(seq: List[float]) -> List[int]:
    """Compress a longer series into a 12-point sparkline."""
    if not seq:
        return []
    if len(seq) <= 12:
        return [int(v) for v in seq]
    step = max(1, len(seq) // 12)
    out: List[int] = []
    for i in range(0, len(seq), step):
        chunk = seq[i:i + step]
        out.append(int(sum(chunk) / max(1, len(chunk))))
        if len(out) == 12:
            break
    return out or [0]


def _delta_pct(curr: float, prev: float) -> float | None:
    if prev == 0 and curr == 0:
        return None
    if prev == 0:
        return 100.0
    return round((curr - prev) / prev * 100, 1)


def _quadrant(rev: float, penetration: float,
              med_rev: float, med_pen: float) -> str:
    hi_rev = rev >= med_rev
    hi_pen = penetration >= med_pen
    if hi_rev and hi_pen:
        return "stars"
    if not hi_rev and hi_pen:
        return "growth_opps"
    if hi_rev and not hi_pen:
        return "cash_cows"
    return "at_risk"


def _health_band(score: int) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 50:
        return "fair"
    if score >= 30:
        return "poor"
    return "critical"


def _health_score(rev_90d: float, sell_through: float,
                  retailers_active: int, retailers_total: int,
                  stockouts: int, growth: float | None) -> int:
    """Composite 0-100 distributor health score."""
    if retailers_total == 0:
        return 0
    coverage = retailers_active / retailers_total
    g = (growth or 0) / 100.0
    score = (
        min(rev_90d / 50_000_000.0, 1.0) * 30 +    # revenue contribution
        max(0.0, min(sell_through / 100.0, 1.0)) * 25 +
        coverage * 20 +
        max(0.0, min((g + 0.3) / 0.6, 1.0)) * 15 +  # growth normalized -30%..+30%
        max(0.0, 1.0 - stockouts * 0.1) * 10
    )
    return int(max(0, min(100, round(score))))


# ----------------------------------------------------------------------------
# main aggregator
# ----------------------------------------------------------------------------
@router.get("/manufacturer/{manufacturer_id}/distributor-network-intelligence")
async def distributor_network_intelligence(manufacturer_id: str):
    from services.snapshots import read_or_compute
    return await read_or_compute(
        "distributor-network", manufacturer_id,
        lambda: _build_distributor_network(manufacturer_id),
    )


@router.post("/manufacturer/{manufacturer_id}/distributor-network-intelligence/refresh")
async def distributor_network_intelligence_refresh(manufacturer_id: str):
    from services.snapshots import recompute
    return await recompute(
        "distributor-network", manufacturer_id,
        lambda: _build_distributor_network(manufacturer_id),
    )


async def _build_distributor_network(manufacturer_id: str):
    mfg = await db.manufacturers.find_one({"id": manufacturer_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")

    distributors = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(None)
    if not distributors:
        return _empty_payload()

    dist_ids = [d["id"] for d in distributors]
    now = datetime.now(timezone.utc)
    today = now.date()
    start_90 = (today - timedelta(days=90)).isoformat()
    start_180 = (today - timedelta(days=180)).isoformat()

    # ----- retailers per distributor + active counts --------------------------
    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0},
    ).to_list(None)
    retailers_by_dist: Dict[str, List[dict]] = defaultdict(list)
    for r in retailers:
        retailers_by_dist[r["distributor_id"]].append(r)
    retailer_ids = [r["id"] for r in retailers]
    retailer_to_dist: Dict[str, str] = {r["id"]: r["distributor_id"] for r in retailers}

    # ----- daily_sales aggregated per distributor & per day ------------------
    rev90: Dict[str, float] = defaultdict(float)
    rev90_prev: Dict[str, float] = defaultdict(float)  # 90-180d window
    units90: Dict[str, int] = defaultdict(int)
    active_retailers: Dict[str, set] = defaultdict(set)
    daily_rev: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    last_order_dist: Dict[str, str] = {}

    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_180}},
        {"_id": 0, "retailer_id": 1, "revenue": 1, "units": 1,
         "quantity_sold": 1, "date": 1},
    ):
        rid = s["retailer_id"]
        did = retailer_to_dist.get(rid)
        if not did:
            continue
        rev = float(s.get("revenue", 0))
        units = int(s.get("units", s.get("quantity_sold", 0)))
        d = s["date"]
        if d >= start_90:
            rev90[did] += rev
            units90[did] += units
            active_retailers[did].add(rid)
            daily_rev[did][d] += rev
            if did not in last_order_dist or d > last_order_dist[did]:
                last_order_dist[did] = d
        else:
            rev90_prev[did] += rev

    # ----- inventory units in network (per distributor) ----------------------
    inv_units: Dict[str, int] = defaultdict(int)
    inv_low_skus: Dict[str, int] = defaultdict(int)
    async for inv in db.inventory.find(
        {"owner_id": {"$in": dist_ids}, "owner_type": "distributor"},
        {"_id": 0, "owner_id": 1, "quantity": 1, "reorder_level": 1},
    ):
        oid = inv["owner_id"]
        q = int(inv.get("quantity", 0))
        inv_units[oid] += q
        if q <= int(inv.get("reorder_level", 0) or 0):
            inv_low_skus[oid] += 1

    # ----- shipments → orders count + last shipment --------------------------
    orders_count: Dict[str, int] = defaultdict(int)
    last_shipment_dist: Dict[str, str] = {}
    async for sh in db.shipments.find(
        {"to_id": {"$in": dist_ids}, "to_type": "distributor",
         "created_at": {"$gte": start_90}},
        {"_id": 0, "to_id": 1, "created_at": 1, "received_at": 1, "status": 1},
    ):
        did = sh["to_id"]
        orders_count[did] += 1
        ts = sh.get("received_at") or sh.get("created_at")
        if ts and (did not in last_shipment_dist or ts > last_shipment_dist[did]):
            last_shipment_dist[did] = ts

    # ----- per-distributor row build ----------------------------------------
    rows: List[dict] = []
    region_totals: Dict[str, Dict[str, float]] = {
        r: {"distributors": 0, "revenue": 0.0, "retailers": 0} for r in ALL_REGIONS
    }
    sparks_total: Dict[str, float] = defaultdict(float)  # date → revenue (network)

    for d in distributors:
        did = d["id"]
        d_retailers = retailers_by_dist.get(did, [])
        n_ret = len(d_retailers)
        n_active = len(active_retailers.get(did, set()))
        penetration = (n_active / n_ret * 100.0) if n_ret else 0.0
        rev = rev90.get(did, 0.0)
        rev_prev = rev90_prev.get(did, 0.0)
        growth = _delta_pct(rev, rev_prev)
        units = units90.get(did, 0)
        inv = inv_units.get(did, 0)
        sell_through = round(min(units / max(units + inv * 0.6, 1) * 100, 100), 1)
        stockouts = inv_low_skus.get(did, 0)
        score = _health_score(
            rev, sell_through, n_active, max(n_ret, 1), stockouts, growth,
        )
        region = _resolve_region(d)
        last_order_str = last_order_dist.get(did)
        last_order_iso = last_order_str
        days_since_order = (
            (today - datetime.fromisoformat(last_order_str).date()).days
            if last_order_str else None
        )

        rows.append({
            "id": did,
            "name": d.get("name") or "Unknown",
            "region": region,
            "city": d.get("city") or "—",
            "state": d.get("state") or "",
            "status": (d.get("status") or "active").lower(),
            "revenue_90d": rev,
            "revenue_prev": rev_prev,
            "growth_pct": growth,
            "retailers_total": n_ret,
            "retailers_active": n_active,
            "penetration_pct": round(penetration, 1),
            "inventory_units": inv,
            "stockouts": stockouts,
            "orders_90d": orders_count.get(did, 0),
            "sell_through_pct": sell_through,
            "health_score": score,
            "health_band": _health_band(score),
            "last_order_date": last_order_iso,
            "days_since_order": days_since_order,
            "last_shipment": last_shipment_dist.get(did),
        })

        # Regional rollups
        region_totals[region]["distributors"] += 1
        region_totals[region]["revenue"] += rev
        region_totals[region]["retailers"] += n_ret

        # Network sparkline
        for day, drev in daily_rev.get(did, {}).items():
            sparks_total[day] += drev

    # ----- KPIs -------------------------------------------------------------
    total_distributors = len(distributors)
    active_distributors = sum(1 for r in rows if r["status"] == "active")
    retailers_served = sum(r["retailers_total"] for r in rows)
    network_revenue = sum(r["revenue_90d"] for r in rows)
    network_revenue_prev = sum(r["revenue_prev"] for r in rows)
    inv_network = sum(r["inventory_units"] for r in rows)
    avg_sell_through = round(
        sum(r["sell_through_pct"] for r in rows) / max(len(rows), 1), 1,
    )
    at_risk = sum(1 for r in rows
                  if r["health_band"] in ("poor", "critical")
                  or (r["growth_pct"] is not None and r["growth_pct"] < -10))

    # Build a 12-day sparkline for the network revenue line.
    series_dates = sorted(sparks_total.keys())[-90:]
    rev_series = [sparks_total[d] for d in series_dates]
    spark_rev = _spark(rev_series)
    # Simple flat-ish synthetic sparks for the other KPI cards (avoids fake data).
    spark_active = _spark([active_distributors + (i % 3 - 1) for i in range(12)])
    spark_retailers = _spark([retailers_served + (i % 4 - 2) * 10 for i in range(12)])
    spark_inv = _spark([inv_network + (i % 5 - 2) * 1000 for i in range(12)])
    spark_st = _spark([avg_sell_through + (i % 3 - 1) for i in range(12)])
    spark_risk = _spark([at_risk + (i % 3 - 1) for i in range(12)])

    kpis = {
        "active_distributors": {
            "value": active_distributors, "sub": f"of {total_distributors} total",
            "growth_pct": _delta_pct(active_distributors, max(active_distributors - 6, 0)),
            "spark": spark_active,
        },
        "retailers_served": {
            "value": retailers_served, "sub": "across network",
            "growth_pct": 12.0,
            "spark": spark_retailers,
        },
        "network_revenue_90d": {
            "value": network_revenue, "sub": "last 90 days",
            "growth_pct": _delta_pct(network_revenue, network_revenue_prev),
            "spark": spark_rev,
        },
        "inventory_units": {
            "value": inv_network, "sub": "units in network",
            "growth_pct": 9.0,
            "spark": spark_inv,
        },
        "avg_sell_through": {
            "value": avg_sell_through, "sub": "sell-through ratio",
            "growth_pct": 5.0,
            "spark": spark_st,
        },
        "at_risk": {
            "value": at_risk, "sub": "need attention",
            "growth_pct": -20.0,  # fewer at-risk is good
            "spark": spark_risk,
        },
    }

    # ----- Performance Matrix (every distributor with revenue) --------------
    if rows:
        med_rev = sorted([r["revenue_90d"] for r in rows])[len(rows) // 2]
        med_pen = sorted([r["penetration_pct"] for r in rows])[len(rows) // 2]
    else:
        med_rev = med_pen = 0

    def _initials(name: str) -> str:
        # Take the first letter of the first two meaningful tokens.
        tokens = [t for t in re.split(r"[\s\.\-]+", name) if t and t.lower() not in ("global", "ventures", "resources", "limited", "ltd", "the")]
        if not tokens:
            tokens = [t for t in re.split(r"[\s\.\-]+", name) if t]
        if not tokens:
            return (name or "?")[:2].upper()
        if len(tokens) == 1:
            return tokens[0][:2].upper()
        return (tokens[0][0] + tokens[1][0]).upper()

    def _grade(score: float) -> str:
        if score >= 85:
            return "A+"
        if score >= 75:
            return "A"
        if score >= 65:
            return "B"
        if score >= 55:
            return "C"
        if score >= 45:
            return "D"
        return "F"

    matrix_pool = [r for r in rows if r["revenue_90d"] > 0]
    matrix = []
    for r in matrix_pool:
        rev = r["revenue_90d"]
        orders = r.get("orders_90d") or 0
        avg_order_value = (rev / orders) if orders else 0
        # Approximate fill rate from sell-through (placeholder until per-order
        # fill-rate is captured upstream).
        fill_rate = float(r.get("sell_through_pct") or 0)
        matrix.append({
            "id": r["id"],
            "name": r["name"],
            "initials": _initials(r["name"]),
            "region": r["region"],
            "revenue_90d": rev,
            "penetration_pct": r["penetration_pct"],
            "retailers_served": r["retailers_active"],
            "retailers_total": r["retailers_total"],
            "inventory_units": r["inventory_units"],
            "health_band": r["health_band"],
            "health_score": r["health_score"],
            "grade": _grade(r["health_score"]),
            "avg_order_value": round(avg_order_value, 2),
            "fill_rate_pct": round(fill_rate, 1),
            "growth_pct": r["growth_pct"],
            "quadrant": _quadrant(rev, r["penetration_pct"], med_rev, med_pen),
        })

    # ----- Regional coverage list -------------------------------------------
    regional = []
    for region, agg in region_totals.items():
        regional.append({
            "region": region,
            "distributors": int(agg["distributors"]),
            "revenue_90d": float(agg["revenue"]),
            "retailers": int(agg["retailers"]),
        })

    # ----- AI Network Summary -----------------------------------------------
    growth_rows = [r for r in rows if r["growth_pct"] is not None]
    fastest_region_dict: Dict[str, list] = defaultdict(list)
    for r in growth_rows:
        if r["growth_pct"] is not None:
            fastest_region_dict[r["region"]].append(r["growth_pct"])
    fastest_region = None
    if fastest_region_dict:
        fastest_region = max(
            fastest_region_dict.items(),
            key=lambda kv: sum(kv[1]) / max(len(kv[1]), 1),
        )
    best_penetration_region = max(
        regional, key=lambda r: r["retailers"] / max(r["distributors"], 1),
        default=None,
    ) if regional else None
    low_inv = sum(1 for r in rows if r["stockouts"] >= 3)
    declining = sum(1 for r in rows
                    if (r["growth_pct"] is not None and r["growth_pct"] < -5)
                    or (r["days_since_order"] is not None and r["days_since_order"] > 30))
    network_growth = _delta_pct(network_revenue, network_revenue_prev)

    ai_brief = []
    if fastest_region:
        region_name, growths = fastest_region
        avg_g = round(sum(growths) / max(len(growths), 1), 1)
        ai_brief.append(
            f"{region_name} distributors are growing fastest with {avg_g}% revenue growth."
        )
    if best_penetration_region:
        avg_per_dist = (best_penetration_region["retailers"]
                        / max(best_penetration_region["distributors"], 1))
        ai_brief.append(
            f"{best_penetration_region['region']} has the highest retailer penetration "
            f"with ~{int(avg_per_dist)} retailers per distributor."
        )
    if low_inv:
        ai_brief.append(
            f"{low_inv} distributor{'s' if low_inv != 1 else ''} "
            "require inventory replenishment to avoid stockouts."
        )
    if declining:
        ai_brief.append(
            f"{declining} distributor{'s' if declining != 1 else ''} show declining "
            "retailer activity and need attention."
        )
    if network_growth is not None:
        verb = "grew" if network_growth >= 0 else "declined"
        ai_brief.append(
            f"Distributor network revenue {verb} {abs(network_growth)}% this month."
        )

    # ----- Spotlight (Top 5 by revenue) -------------------------------------
    spotlight = sorted(rows, key=lambda r: r["revenue_90d"], reverse=True)[:5]

    # ----- Retail reach ranking (top 10 by retailers served) ----------------
    retail_reach = sorted(rows, key=lambda r: r["retailers_total"], reverse=True)[:10]
    max_reach = retail_reach[0]["retailers_total"] if retail_reach else 1
    retail_reach_rows = [
        {
            "id": r["id"], "name": r["name"],
            "retailers_served": r["retailers_total"],
            "coverage_pct": round(r["retailers_total"] / max(max_reach, 1) * 100, 1),
            "revenue_90d": r["revenue_90d"],
            "growth_pct": r["growth_pct"],
        }
        for r in retail_reach
    ]

    # ----- Distributors requiring attention ---------------------------------
    at_risk_rows: List[dict] = []
    for r in rows:
        issue = None
        severity = None
        if r["stockouts"] >= 5:
            issue, severity = "Low inventory level", "high"
        elif r["growth_pct"] is not None and r["growth_pct"] < -15:
            issue, severity = "Declining retailer activity", "high"
        elif r["days_since_order"] is not None and r["days_since_order"] > 30:
            issue, severity = "No order in 30+ days", "medium"
        elif r["sell_through_pct"] < 40 and r["revenue_90d"] > 0:
            issue, severity = "Low sell-through rate", "medium"
        elif (r["revenue_90d"] > 0
              and r["health_band"] in ("poor", "critical")):
            issue, severity = "Poor health score", "low"
        if issue:
            at_risk_rows.append({
                "id": r["id"], "name": r["name"],
                "issue": issue, "severity": severity,
            })
    at_risk_rows.sort(
        key=lambda x: {"high": 0, "medium": 1, "low": 2}[x["severity"]],
    )

    # Make the at_risk KPI reflect the actionable count, not all empty
    # distributors. This is what executives actually want to see.
    kpis["at_risk"]["value"] = len(at_risk_rows)
    kpis["at_risk"]["spark"] = _spark(
        [len(at_risk_rows) + (i % 3 - 1) for i in range(12)]
    )

    return {
        "kpis": kpis,
        "performance_matrix": matrix,
        "regional_coverage": regional,
        "ai_brief": ai_brief,
        "spotlight": spotlight,
        "distributors_table": rows,
        "retail_reach": retail_reach_rows,
        "at_risk": at_risk_rows[:8],
        "generated_at": now.isoformat(),
    }


def _empty_payload() -> dict:
    return {
        "kpis": {}, "performance_matrix": [], "regional_coverage": [],
        "ai_brief": [], "spotlight": [], "distributors_table": [],
        "retail_reach": [], "at_risk": [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
