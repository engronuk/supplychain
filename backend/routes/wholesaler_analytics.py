"""Wholesaler Workspace · Distributor detail + Analytics.

Pure DB-backed (no AI). Powers the click-through distributor detail page
and the wholesaler analytics dashboard. Cross-persona endpoints surface
wholesaler POs to manufacturers and wholesaler orders/shipments to
distributors, so every collection stays "alive" across the personas.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core import db, now_iso
from routes._wholesaler_shared import (
    get_wholesaler_org,
    require_wholesaler_access,
    require_wholesaler_owner,
    tenant_id_for,
    walk_to_manufacturer,
)
from services.auth import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _days_ago_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# Inventory Analytics Center helpers (Phase 3B) — pure math, no AI.
# ---------------------------------------------------------------------------
def _dos_band(days_of_supply: Optional[float]) -> str:
    if days_of_supply is None:
        return "unknown"
    if days_of_supply < 7:
        return "red"
    if days_of_supply < 21:
        return "yellow"
    return "green"


def _age_bucket(days: Optional[int]) -> str:
    if days is None:
        return "unknown"
    if days <= 30:
        return "0_30"
    if days <= 60:
        return "31_60"
    if days <= 90:
        return "61_90"
    return "over_90"


def _dead_bucket(days_since_movement: Optional[int]) -> Optional[str]:
    if days_since_movement is None:
        return None
    if days_since_movement >= 90:
        return "dead_90"
    if days_since_movement >= 60:
        return "dead_60"
    if days_since_movement >= 30:
        return "dead_30"
    return None


def _expiry_bucket(days_to_expiry: Optional[int]) -> Optional[str]:
    if days_to_expiry is None:
        return None
    if days_to_expiry < 0:
        return "expired"
    if days_to_expiry <= 30:
        return "exp_30"
    if days_to_expiry <= 60:
        return "exp_60"
    if days_to_expiry <= 90:
        return "exp_90"
    return None


def _compute_inventory_intelligence(inventory: List[dict], pmap: Dict[str, dict],
                                     warehouse_lookup: Dict[str, str]) -> Dict[str, object]:
    """Inventory Analytics Center math — turnover, days-of-supply with
    red/yellow/green band, dead-stock 30/60/90 buckets, aging buckets, and
    expiry-risk dashboard. Pure programmatic logic."""
    if not inventory:
        return {
            "kpis": {
                "inventory_value": 0.0, "total_units": 0,
                "turnover_per_year": 0.0, "avg_days_of_supply": None,
                "stock_coverage_pct": 0.0, "stockout_risk_count": 0,
                "expiring_value_60d": 0.0,
            },
            "days_of_supply": {"green": 0, "yellow": 0, "red": 0,
                                "items": []},
            "aging": {"buckets": {"0_30": 0, "31_60": 0, "61_90": 0, "over_90": 0},
                       "value_by_bucket": {"0_30": 0.0, "31_60": 0.0,
                                            "61_90": 0.0, "over_90": 0.0}},
            "dead_stock": {"buckets": {"dead_30": 0, "dead_60": 0, "dead_90": 0},
                            "value_by_bucket": {"dead_30": 0.0, "dead_60": 0.0,
                                                 "dead_90": 0.0},
                            "items": []},
            "expiry": {"buckets": {"expired": 0, "exp_30": 0, "exp_60": 0, "exp_90": 0},
                        "value_by_bucket": {"expired": 0.0, "exp_30": 0.0,
                                             "exp_60": 0.0, "exp_90": 0.0},
                        "items": []},
            "turnover_by_category": [], "turnover_by_warehouse": [],
        }

    now = datetime.now(timezone.utc)
    items: List[dict] = []
    total_value = 0.0
    total_units = 0
    stockout_risk = 0
    coverage_ok = 0
    coverage_total = 0
    dos_band_counts = {"green": 0, "yellow": 0, "red": 0, "unknown": 0}
    aging_counts = {"0_30": 0, "31_60": 0, "61_90": 0, "over_90": 0, "unknown": 0}
    aging_values = {"0_30": 0.0, "31_60": 0.0, "61_90": 0.0, "over_90": 0.0}
    dead_counts = {"dead_30": 0, "dead_60": 0, "dead_90": 0}
    dead_values = {"dead_30": 0.0, "dead_60": 0.0, "dead_90": 0.0}
    expiry_counts = {"expired": 0, "exp_30": 0, "exp_60": 0, "exp_90": 0}
    expiry_values = {"expired": 0.0, "exp_30": 0.0, "exp_60": 0.0, "exp_90": 0.0}
    expiring_value_60d = 0.0
    category_acc: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"value": 0.0, "outbound_units": 0.0, "on_hand": 0.0}
    )
    warehouse_acc: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"value": 0.0, "outbound_units": 0.0, "on_hand": 0.0,
                  "name": "Unassigned"}
    )

    dos_values: List[float] = []

    for r in inventory:
        pid = r.get("product_id")
        prod = pmap.get(pid) or {}
        unit_price = float(prod.get("unit_price") or 0)
        on_hand = int(r.get("quantity") or 0)
        reserved = int(r.get("reserved") or 0)
        available = max(0, on_hand - reserved)
        value = on_hand * unit_price
        velocity = float(r.get("velocity") or 0)
        reorder = int(r.get("reorder_level") or 0)

        # Days of supply via velocity (units/day implied by seed).
        days_of_supply: Optional[float] = None
        if velocity > 0:
            days_of_supply = round(available / velocity, 1)
            dos_values.append(days_of_supply)
        band = _dos_band(days_of_supply)
        dos_band_counts[band] = dos_band_counts.get(band, 0) + 1

        # Stockout & coverage signals.
        if on_hand == 0 or (reorder > 0 and on_hand < reorder):
            stockout_risk += 1
        if reorder > 0:
            coverage_total += 1
            if on_hand >= reorder:
                coverage_ok += 1

        # Aging — how long the SKU has been on the books.
        created = _to_dt(r.get("created_at"))
        age_days: Optional[int] = (now - created).days if created else None
        ab = _age_bucket(age_days)
        aging_counts[ab] = aging_counts.get(ab, 0) + 1
        if ab in aging_values:
            aging_values[ab] += value

        # Dead stock — days since last movement.
        last_mvmt = _to_dt(r.get("last_movement_at")) or created
        days_since_movement: Optional[int] = (
            (now - last_mvmt).days if last_mvmt else None
        )
        db_bucket = _dead_bucket(days_since_movement)
        if db_bucket and on_hand > 0:
            dead_counts[db_bucket] += 1
            dead_values[db_bucket] += value

        # Expiry risk.
        exp = _to_dt(r.get("expiry_date"))
        days_to_expiry: Optional[int] = (
            (exp - now).days if exp else None
        )
        eb = _expiry_bucket(days_to_expiry)
        if eb and on_hand > 0:
            expiry_counts[eb] += 1
            expiry_values[eb] += value
            if eb in ("expired", "exp_30", "exp_60"):
                expiring_value_60d += value

        outbound_units_30d = velocity * 30  # implied 30d outbound
        cat = (prod.get("category") or "Uncategorised").strip() or "Uncategorised"
        category_acc[cat]["value"] += value
        category_acc[cat]["outbound_units"] += outbound_units_30d
        category_acc[cat]["on_hand"] += on_hand

        wh_id = r.get("warehouse_id") or "unassigned"
        warehouse_acc[wh_id]["value"] += value
        warehouse_acc[wh_id]["outbound_units"] += outbound_units_30d
        warehouse_acc[wh_id]["on_hand"] += on_hand
        warehouse_acc[wh_id]["name"] = warehouse_lookup.get(wh_id, "Unassigned")

        items.append({
            "product_id": pid,
            "product_name": prod.get("name") or "?",
            "sku": prod.get("sku") or "",
            "category": cat,
            "warehouse_name": warehouse_lookup.get(wh_id, "Unassigned"),
            "on_hand": on_hand,
            "reserved": reserved,
            "available": available,
            "reorder_level": reorder,
            "value": round(value, 2),
            "velocity": velocity,
            "days_of_supply": days_of_supply,
            "dos_band": band,
            "age_days": age_days,
            "age_bucket": ab,
            "days_since_movement": days_since_movement,
            "dead_bucket": db_bucket,
            "days_to_expiry": days_to_expiry,
            "expiry_bucket": eb,
        })
        total_value += value
        total_units += on_hand

    # Aggregate turnover per year. Use velocity-implied 365d outbound.
    annual_outbound = sum(float(r.get("velocity") or 0) * 365 for r in inventory)
    turnover_per_year = round(
        annual_outbound / max(total_units, 1), 2,
    ) if total_units else 0.0
    avg_dos = round(sum(dos_values) / len(dos_values), 1) if dos_values else None
    stock_coverage_pct = (
        round(coverage_ok / coverage_total * 100, 1)
        if coverage_total else 0.0
    )

    # Category / Warehouse rollup with turnover.
    turnover_by_category = []
    for cat, agg in sorted(category_acc.items(),
                            key=lambda x: x[1]["value"], reverse=True):
        annual = agg["outbound_units"] * (365 / 30)
        oh = agg["on_hand"] or 1
        turnover_by_category.append({
            "category": cat,
            "value": round(agg["value"], 2),
            "on_hand": int(agg["on_hand"]),
            "turnover_per_year": round(annual / oh, 2),
        })
    turnover_by_warehouse = []
    for wh_id, agg in sorted(warehouse_acc.items(),
                              key=lambda x: x[1]["value"], reverse=True):
        annual = agg["outbound_units"] * (365 / 30)
        oh = agg["on_hand"] or 1
        turnover_by_warehouse.append({
            "warehouse_id": wh_id,
            "warehouse_name": agg["name"],
            "value": round(agg["value"], 2),
            "on_hand": int(agg["on_hand"]),
            "turnover_per_year": round(annual / oh, 2),
        })

    # Slice items for tables.
    dos_items = sorted(
        [i for i in items if i["days_of_supply"] is not None],
        key=lambda x: x["days_of_supply"],
    )[:25]
    dead_items = sorted(
        [i for i in items if i["dead_bucket"] and i["on_hand"] > 0],
        key=lambda x: x["value"], reverse=True,
    )[:25]
    expiry_items = sorted(
        [i for i in items if i["expiry_bucket"] and i["on_hand"] > 0],
        key=lambda x: (x["days_to_expiry"] is None, x["days_to_expiry"] or 0),
    )[:25]

    return {
        "kpis": {
            "inventory_value": round(total_value, 2),
            "total_units": total_units,
            "turnover_per_year": turnover_per_year,
            "avg_days_of_supply": avg_dos,
            "stock_coverage_pct": stock_coverage_pct,
            "stockout_risk_count": stockout_risk,
            "expiring_value_60d": round(expiring_value_60d, 2),
            "dead_stock_value": round(sum(dead_values.values()), 2),
        },
        "days_of_supply": {
            "green": dos_band_counts.get("green", 0),
            "yellow": dos_band_counts.get("yellow", 0),
            "red": dos_band_counts.get("red", 0),
            "unknown": dos_band_counts.get("unknown", 0),
            "items": dos_items,
        },
        "aging": {
            "buckets": {k: aging_counts[k] for k in ("0_30", "31_60", "61_90", "over_90")},
            "value_by_bucket": {k: round(v, 2) for k, v in aging_values.items()},
        },
        "dead_stock": {
            "buckets": dead_counts,
            "value_by_bucket": {k: round(v, 2) for k, v in dead_values.items()},
            "items": dead_items,
        },
        "expiry": {
            "buckets": expiry_counts,
            "value_by_bucket": {k: round(v, 2) for k, v in expiry_values.items()},
            "items": expiry_items,
        },
        "turnover_by_category": turnover_by_category[:10],
        "turnover_by_warehouse": turnover_by_warehouse[:10],
    }


# ---------------------------------------------------------------------------
# Distributor Analytics Center helpers (Phase 3A) — pure math, no AI.
# ---------------------------------------------------------------------------
def _status_bucket(growth_pct: float, revenue: float, recent_orders: int) -> str:
    """Categorical growth status. Tuned for B2B distributor traffic."""
    if recent_orders == 0 and revenue > 0:
        return "at_risk"
    if growth_pct >= 20:
        return "high_growth"
    if growth_pct <= -10:
        return "at_risk"
    return "stable"


def _bcg_quadrant(rev_share_pct: float, growth_pct: float,
                   rev_threshold: float, growth_threshold: float) -> str:
    """Plot a distributor in the classic BCG matrix.

    Stars         = high revenue + high growth
    Cash Cows     = high revenue + low growth
    Question Marks= low revenue  + high growth
    At Risk (Dogs)= low revenue  + low growth
    """
    high_rev = rev_share_pct >= rev_threshold
    high_growth = growth_pct >= growth_threshold
    if high_rev and high_growth:
        return "star"
    if high_rev and not high_growth:
        return "cash_cow"
    if not high_rev and high_growth:
        return "question_mark"
    return "at_risk"


def _churn_score(growth_pct: float, freq_change_pct: float, days_since_last: int,
                 has_history: bool) -> Dict[str, object]:
    """Compute a 0-100 churn-risk score with reason strings. Pure rules."""
    score = 0
    reasons: List[str] = []

    # Revenue drop contributes up to 40 points (penalty for >0% drop).
    if growth_pct < 0:
        rev_pts = min(40, int(round(abs(growth_pct) * 0.8)))
        score += rev_pts
        reasons.append(
            f"Revenue down {abs(round(growth_pct, 1))}% vs prior 30 days"
        )

    # Order-frequency drop contributes up to 30 points.
    if freq_change_pct < 0:
        freq_pts = min(30, int(round(abs(freq_change_pct) * 0.6)))
        score += freq_pts
        reasons.append(
            f"Order frequency down {abs(round(freq_change_pct, 0))}% over last 60 days"
        )

    # Recency staleness contributes up to 30 points.
    if has_history:
        if days_since_last >= 60:
            score += 30
            reasons.append(f"No order in {days_since_last} days")
        elif days_since_last >= 30:
            score += 18
            reasons.append(f"No order in {days_since_last} days")
        elif days_since_last >= 14:
            score += 8

    score = max(0, min(100, score))
    if score >= 60:
        level = "high"
    elif score >= 30:
        level = "medium"
    else:
        level = "low"
    if not reasons:
        reasons.append("Healthy purchase pattern across the last 60 days")
    return {"score": score, "level": level, "reasons": reasons}


# ---------------------------------------------------------------------------
# Demand Forecast + Replenishment Intelligence helpers (Phase 3C) — pure math.
# Lead time + safety factor are configurable constants tuned for the seed.
# ---------------------------------------------------------------------------
DEFAULT_LEAD_TIME_DAYS = 7
SAFETY_FACTOR = 1.5

def _safety_status(on_hand: int, target: float) -> str:
    if target <= 0:
        return "unknown"
    ratio = on_hand / target
    if ratio < 0.5:
        return "breach"
    if ratio < 1.0:
        return "warn"
    return "ok"


def _replenishment_priority(days_of_cover: Optional[float]) -> Optional[str]:
    if days_of_cover is None:
        return None
    if days_of_cover < 7:
        return "urgent"
    if days_of_cover < 14:
        return "soon"
    if days_of_cover < 21:
        return "plan"
    return None


def _compose_control_tower(
    distributors_deep: Dict[str, object],
    inventory_deep: Dict[str, object],
    forecast_deep: Dict[str, object],
    shipments: List[dict],
) -> Dict[str, object]:
    """Phase 3E — Control Tower View. Composite Network Health Score
    (0–100) plus heat-map matrices for revenue, inventory and demand.
    Pure rule-based math from the existing analytics blocks."""
    dist_k = (distributors_deep or {}).get("kpis") or {}
    inv_k = (inventory_deep or {}).get("kpis") or {}
    regional = (forecast_deep or {}).get("regional") or []
    by_category = (inventory_deep or {}).get("turnover_by_category") or []
    ranking = (distributors_deep or {}).get("ranking") or []

    inventory_health = float(inv_k.get("stock_coverage_pct") or 0)
    hg = int(dist_k.get("high_growth") or 0)
    st = int(dist_k.get("stable") or 0)
    ar = int(dist_k.get("at_risk") or 0)
    denom = max(1, hg + st + ar)
    distributor_health = round(
        max(0.0, min(100.0,
            ((hg * 1.0 + st * 0.7 + ar * -0.2) / denom) * 100,
        )), 1,
    )
    fulfillment_perf = float(dist_k.get("service_level_pct") or 0)
    if shipments:
        valid = [s for s in shipments if s.get("status") != "cancelled"]
        delivered = sum(1 for s in valid if s.get("status") == "delivered")
        shipment_reliability = round(
            (delivered / max(1, len(valid))) * 100, 1,
        )
    else:
        shipment_reliability = 0.0

    composite = round(
        (inventory_health + distributor_health
         + fulfillment_perf + shipment_reliability) / 4.0, 1,
    )
    if composite >= 80:
        score_band = "excellent"
    elif composite >= 60:
        score_band = "good"
    elif composite >= 40:
        score_band = "watch"
    else:
        score_band = "critical"

    region_max = max((r.get("revenue_30d") or 0) for r in regional) if regional else 0
    revenue_heat = [
        {
            "label": r["region"],
            "value": float(r.get("revenue_30d") or 0),
            "intensity": round((r.get("revenue_30d") or 0) / region_max, 2) if region_max else 0,
            "growth_pct": r.get("growth_pct") or 0,
            "risk_level": r.get("risk_level") or "low",
        }
        for r in regional
    ]
    cat_max = max((c.get("value") or 0) for c in by_category) if by_category else 0
    inventory_heat = [
        {
            "label": c["category"],
            "value": float(c.get("value") or 0),
            "intensity": round((c.get("value") or 0) / cat_max, 2) if cat_max else 0,
            "turnover_per_year": c.get("turnover_per_year") or 0,
            "on_hand": c.get("on_hand") or 0,
        }
        for c in by_category
    ]
    dist_max = max((r.get("revenue") or 0) for r in ranking) if ranking else 0
    distributor_heat = [
        {
            "label": r["name"],
            "value": float(r.get("revenue") or 0),
            "intensity": round((r.get("revenue") or 0) / dist_max, 2) if dist_max else 0,
            "growth_pct": r.get("growth_pct") or 0,
            "status": r.get("status") or "stable",
            "region": r.get("region") or "—",
        }
        for r in ranking[:12]
    ]

    nodes = []
    for w in ((inventory_deep or {}).get("turnover_by_warehouse") or [])[:6]:
        nodes.append({
            "type": "warehouse",
            "id": w.get("warehouse_id") or "unassigned",
            "name": w.get("warehouse_name") or "Warehouse",
            "value": w.get("value") or 0,
            "label": f"₦{(w.get('value') or 0):,.0f}",
        })
    for r in ranking[:8]:
        nodes.append({
            "type": "distributor",
            "id": r.get("id"),
            "name": r.get("name"),
            "value": r.get("revenue") or 0,
            "region": r.get("region") or "—",
            "status": r.get("status") or "stable",
            "growth_pct": r.get("growth_pct") or 0,
            "label": f"₦{(r.get('revenue') or 0):,.0f}",
        })

    return {
        "health_score": {
            "composite": composite,
            "band": score_band,
            "components": {
                "inventory_health": round(inventory_health, 1),
                "distributor_health": distributor_health,
                "fulfillment_performance": round(fulfillment_perf, 1),
                "shipment_reliability": round(shipment_reliability, 1),
            },
        },
        "heat_maps": {
            "revenue_by_region": revenue_heat,
            "inventory_by_category": inventory_heat,
            "distributor_activity": distributor_heat,
        },
        "network": {
            "nodes": nodes,
            "summary": {
                "warehouses": sum(1 for n in nodes if n["type"] == "warehouse"),
                "distributors": sum(1 for n in nodes if n["type"] == "distributor"),
                "active_shipments": sum(
                    1 for s in (shipments or [])
                    if s.get("status") in ("in_transit", "loaded", "out_for_delivery")
                ),
            },
        },
    }



def _compose_intelligence_briefing(
    distributors_deep: Dict[str, object],
    inventory_deep: Dict[str, object],
    forecast_deep: Dict[str, object],
) -> Dict[str, object]:
    """Phase 3D — synthesise the Intelligence Center surface from the three
    deep blocks. Rule-based templating only. No AI involvement."""
    dist_k = (distributors_deep or {}).get("kpis") or {}
    inv_k = (inventory_deep or {}).get("kpis") or {}
    fcst_k = (forecast_deep or {}).get("kpis") or {}
    churn_rows = (distributors_deep or {}).get("churn") or []
    bcg_items = ((distributors_deep or {}).get("bcg") or {}).get("items") or []
    regional = (forecast_deep or {}).get("regional") or []
    replen = (forecast_deep or {}).get("replenishment") or []
    safety = (forecast_deep or {}).get("safety") or []
    dead_items = ((inventory_deep or {}).get("dead_stock") or {}).get("items") or []
    expiry_items = ((inventory_deep or {}).get("expiry") or {}).get("items") or []

    # Stars + Question Marks + Cash Cows
    stars = [b for b in bcg_items if b.get("quadrant") == "star"]
    qmarks = [b for b in bcg_items if b.get("quadrant") == "question_mark"]
    cash_cows = [b for b in bcg_items if b.get("quadrant") == "cash_cow"]

    headlines: List[str] = []

    if dist_k.get("active_distributors"):
        headlines.append(
            f"{dist_k['active_distributors']} active distributors generated "
            f"₦{(dist_k.get('total_revenue') or 0):,.0f} in revenue over the last 90 days."
        )
    growth_n = dist_k.get("high_growth") or 0
    risk_n = dist_k.get("at_risk") or 0
    if growth_n or risk_n:
        headlines.append(
            f"{growth_n} distributor(s) in the high-growth band · "
            f"{risk_n} flagged at-risk."
        )
    if fcst_k.get("total_projected_revenue_30d"):
        headlines.append(
            f"Projected next-30-day revenue: ₦"
            f"{fcst_k['total_projected_revenue_30d']:,.0f} across "
            f"{fcst_k.get('products_in_forecast', 0)} SKUs."
        )
    urgent = fcst_k.get("urgent_replenishments") or 0
    if urgent:
        headlines.append(
            f"{urgent} SKU(s) projected to stock out within 7 days at current velocity."
        )
    if regional:
        top_reg = max(regional, key=lambda r: r.get("growth_pct") or 0)
        if (top_reg.get("growth_pct") or 0) > 0:
            headlines.append(
                f"Strongest regional growth: {top_reg['region']} "
                f"(+{top_reg['growth_pct']}% revenue vs prior 30d)."
            )

    # ---- Opportunities ----------------------------------------------------
    opportunities: List[dict] = []
    if stars:
        opportunities.append({
            "id": "stars",
            "title": f"{len(stars)} Star distributor(s) ready to scale",
            "body": ", ".join(s["name"] for s in stars[:3])
                     + (" +more" if len(stars) > 3 else ""),
            "icon": "rocket",
        })
    if qmarks:
        opportunities.append({
            "id": "question_marks",
            "title": f"{len(qmarks)} Question Mark distributor(s) — invest to convert to Stars",
            "body": ", ".join(q["name"] for q in qmarks[:3])
                     + (" +more" if len(qmarks) > 3 else ""),
            "icon": "target",
        })
    if cash_cows:
        opportunities.append({
            "id": "cash_cows",
            "title": f"{len(cash_cows)} Cash Cow distributor(s) — protect this revenue base",
            "body": ", ".join(c["name"] for c in cash_cows[:3])
                     + (" +more" if len(cash_cows) > 3 else ""),
            "icon": "wallet",
        })
    # Regional opportunity
    growing_regions = [r for r in regional if (r.get("growth_pct") or 0) > 10]
    if growing_regions:
        names = ", ".join(r["region"] for r in growing_regions[:3])
        opportunities.append({
            "id": "growth_regions",
            "title": f"{len(growing_regions)} region(s) growing >10%",
            "body": f"Push stock and promotions in: {names}.",
            "icon": "trending_up",
        })

    # ---- Risks ------------------------------------------------------------
    risks: List[dict] = []
    high_churn = [c for c in churn_rows if c.get("level") == "high"]
    if high_churn:
        risks.append({
            "id": "churn_high",
            "title": f"{len(high_churn)} distributor(s) at HIGH churn risk",
            "body": ", ".join(c["name"] for c in high_churn[:3]),
            "severity": "high",
        })
    medium_churn = [c for c in churn_rows if c.get("level") == "medium"]
    if medium_churn:
        risks.append({
            "id": "churn_medium",
            "title": f"{len(medium_churn)} distributor(s) at medium churn risk",
            "body": ", ".join(c["name"] for c in medium_churn[:3]),
            "severity": "medium",
        })
    if inv_k.get("stockout_risk_count"):
        risks.append({
            "id": "stockout",
            "title": f"{inv_k['stockout_risk_count']} SKU(s) below reorder level",
            "body": f"Coverage rate is {inv_k.get('stock_coverage_pct', 0)}%.",
            "severity": "high",
        })
    if inv_k.get("dead_stock_value"):
        risks.append({
            "id": "dead_stock",
            "title": f"₦{inv_k['dead_stock_value']:,.0f} tied in dead/slow inventory",
            "body": (
                f"Top idle SKU: {dead_items[0]['product_name']} "
                f"({dead_items[0].get('days_since_movement', 0)} idle days, "
                f"₦{dead_items[0]['value']:,.0f})"
            ) if dead_items else "Idle SKUs with 30+ days no movement.",
            "severity": "medium",
        })
    if inv_k.get("expiring_value_60d"):
        risks.append({
            "id": "expiry",
            "title": f"₦{inv_k['expiring_value_60d']:,.0f} expiring within 60 days",
            "body": (
                f"Top: {expiry_items[0]['product_name']} expires in "
                f"{expiry_items[0].get('days_to_expiry', 0)}d"
            ) if expiry_items else "Move expiring SKUs to fast-rotation channels.",
            "severity": "high",
        })
    breached = [s for s in safety if s.get("status") == "breach"]
    if breached:
        risks.append({
            "id": "safety_breach",
            "title": f"{len(breached)} SKU(s) below safety stock target",
            "body": ", ".join(b["product_name"] for b in breached[:3]),
            "severity": "medium",
        })

    # ---- Recommended Actions ---------------------------------------------
    actions: List[dict] = []
    if urgent and replen:
        top_urgent = next((r for r in replen if r.get("priority") == "urgent"), None)
        if top_urgent:
            actions.append({
                "id": "urgent_replen",
                "title": f"Place urgent replenishment for {top_urgent['product_name']}",
                "body": top_urgent.get("message") or "",
                "priority": "high",
                "subject_id": top_urgent["product_id"],
            })
    if high_churn:
        top = high_churn[0]
        actions.append({
            "id": "rescue_distributor",
            "title": f"Reach out to {top['name']} (HIGH churn risk · score {top['score']})",
            "body": "; ".join(top.get("reasons") or []),
            "priority": "high",
            "subject_id": top["id"],
        })
    if dead_items:
        top = dead_items[0]
        actions.append({
            "id": "clear_dead_stock",
            "title": f"Promote or transfer {top['product_name']} (₦{top['value']:,.0f} idle)",
            "body": f"Idle for {top.get('days_since_movement', 0)} days — consider regional transfer or discount.",
            "priority": "medium",
            "subject_id": top["product_id"],
        })
    if growing_regions:
        top = growing_regions[0]
        actions.append({
            "id": "boost_region",
            "title": f"Boost {top['region']} inventory allocation",
            "body": f"Region growing at {top['growth_pct']}% — increase regional stock before next 30d.",
            "priority": "medium",
            "subject_id": top.get("region"),
        })
    if breached and not urgent:
        actions.append({
            "id": "safety_top_up",
            "title": f"Top up safety stock on {breached[0]['product_name']}",
            "body": (
                f"Currently {breached[0]['on_hand']} units · target "
                f"{breached[0]['target_safety_stock']}."
            ),
            "priority": "medium",
            "subject_id": breached[0]["product_id"],
        })

    return {
        "as_of": now_iso(),
        "headlines": headlines[:5],
        "opportunities": opportunities[:6],
        "risks": risks[:6],
        "actions": actions[:6],
        "snapshot": {
            "active_distributors": dist_k.get("active_distributors", 0),
            "total_revenue_90d": dist_k.get("total_revenue", 0),
            "inventory_value": inv_k.get("inventory_value", 0),
            "projected_revenue_30d": fcst_k.get("total_projected_revenue_30d", 0),
            "urgent_replenishments": urgent,
            "high_churn": len(high_churn),
            "safety_breaches": len(breached),
            "dead_stock_value": inv_k.get("dead_stock_value", 0),
        },
    }


def _compute_forecast_intelligence(
    inventory: List[dict],
    pmap: Dict[str, dict],
    orders: List[dict],
    distributors: List[dict],
) -> Dict[str, object]:
    """Demand Forecast Center + Replenishment Intelligence math.

    Inputs: full 90d distributor-order history, current wholesaler
    inventory, product catalogue, distributor list.

    Outputs: 7/30/90-day product forecasts, regional rollup, distributor
    forecast, replenishment recommendation engine, safety-stock monitor.
    All rule-based — derived from trailing-window velocity ratios.
    """
    now = datetime.now(timezone.utc)
    last30_start = now - timedelta(days=30)
    prev30_start = now - timedelta(days=60)

    # ---- Per-product velocity (last 30d vs prior 30d) ---------------------
    last30_units: Dict[str, int] = defaultdict(int)
    prev30_units: Dict[str, int] = defaultdict(int)
    for o in orders:
        ts = _to_dt(o.get("created_at"))
        if not ts:
            continue
        bucket = "last" if ts >= last30_start else ("prev" if ts >= prev30_start else None)
        if not bucket:
            continue
        for it in (o.get("items") or []):
            qty = int(it.get("quantity") or 0)
            if qty <= 0:
                continue
            pid = it.get("product_id")
            if not pid:
                continue
            if bucket == "last":
                last30_units[pid] += qty
            else:
                prev30_units[pid] += qty

    inv_by_pid: Dict[str, dict] = {r.get("product_id"): r for r in inventory if r.get("product_id")}
    pids = set(last30_units) | set(prev30_units) | set(inv_by_pid)

    product_forecasts: List[dict] = []
    safety_rows: List[dict] = []
    replenishment_rows: List[dict] = []

    for pid in pids:
        prod = pmap.get(pid) or {}
        vel_last = last30_units.get(pid, 0) / 30.0
        vel_prev = prev30_units.get(pid, 0) / 30.0
        growth_pct = (
            ((vel_last - vel_prev) / vel_prev * 100) if vel_prev > 0
            else (100.0 if vel_last > 0 else 0.0)
        )
        on_hand = int(inv_by_pid.get(pid, {}).get("quantity") or 0)
        days_of_cover = (round(on_hand / vel_last, 1) if vel_last > 0 else None)

        proj7 = round(vel_last * 7, 0)
        proj30 = round(vel_last * 30, 0)
        proj90 = round(vel_last * 90, 0)

        unit_price = float(prod.get("unit_price") or 0)
        category = (prod.get("category") or "Uncategorised").strip() or "Uncategorised"

        target_safety = round(DEFAULT_LEAD_TIME_DAYS * vel_last * SAFETY_FACTOR, 0)
        safety_status = _safety_status(on_hand, target_safety)

        priority = _replenishment_priority(days_of_cover)
        suggested_qty = max(0, int(round(proj30 + target_safety - on_hand)))
        if vel_last > 0 and on_hand > target_safety:
            days_until_reorder = (on_hand - target_safety) / vel_last
            order_by = (now + timedelta(days=max(0.0, days_until_reorder - DEFAULT_LEAD_TIME_DAYS))).date().isoformat()
        elif vel_last > 0:
            order_by = now.date().isoformat()
        else:
            order_by = None

        product_forecasts.append({
            "product_id": pid,
            "product_name": prod.get("name") or pid,
            "sku": prod.get("sku") or "",
            "category": category,
            "current_weekly_demand": round(vel_last * 7, 0),
            "previous_weekly_demand": round(vel_prev * 7, 0),
            "growth_pct": round(growth_pct, 1),
            "projected_7d": proj7,
            "projected_30d": proj30,
            "projected_90d": proj90,
            "on_hand": on_hand,
            "days_of_cover": days_of_cover,
            "unit_price": unit_price,
            "projected_revenue_30d": round(proj30 * unit_price, 2),
        })

        if vel_last > 0 or on_hand > 0:
            safety_rows.append({
                "product_id": pid,
                "product_name": prod.get("name") or pid,
                "category": category,
                "on_hand": on_hand,
                "current_safety_stock": on_hand,
                "target_safety_stock": int(target_safety),
                "lead_time_days": DEFAULT_LEAD_TIME_DAYS,
                "daily_velocity": round(vel_last, 2),
                "status": safety_status,
            })

        if priority:
            replenishment_rows.append({
                "product_id": pid,
                "product_name": prod.get("name") or pid,
                "category": category,
                "supplier_name": prod.get("manufacturer_name") or "Manufacturer",
                "manufacturer_id": prod.get("manufacturer_id"),
                "priority": priority,
                "on_hand": on_hand,
                "days_of_cover": days_of_cover,
                "suggested_quantity": suggested_qty,
                "order_by": order_by,
                "message": (
                    f"Only {days_of_cover}d of cover — order {suggested_qty} units"
                    if priority == "urgent"
                    else f"{days_of_cover}d of cover — plan {suggested_qty}-unit replenishment by {order_by}"
                    if order_by
                    else f"{days_of_cover}d of cover — plan replenishment"
                ),
            })

    product_forecasts.sort(key=lambda r: r["projected_30d"], reverse=True)
    safety_rows.sort(
        key=lambda r: (
            {"breach": 0, "warn": 1, "ok": 2, "unknown": 3}.get(r["status"], 4),
            -float(r["daily_velocity"] or 0),
        )
    )
    replenishment_rows.sort(
        key=lambda r: (
            {"urgent": 0, "soon": 1, "plan": 2}.get(r["priority"], 3),
            r["days_of_cover"] if r["days_of_cover"] is not None else 999,
        )
    )

    # ---- Regional forecast ------------------------------------------------
    dist_region: Dict[str, str] = {}
    for d in distributors:
        dist_region[d.get("id")] = (d.get("region") or "Unknown").strip() or "Unknown"

    region_orders30: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {"orders": 0, "units": 0, "revenue": 0.0,
                  "orders_prev": 0, "units_prev": 0, "revenue_prev": 0.0}
    )
    for o in orders:
        ts = _to_dt(o.get("created_at"))
        if not ts:
            continue
        reg = dist_region.get(o.get("distributor_id"), "Unknown")
        units = sum(int(it.get("quantity") or 0) for it in (o.get("items") or []))
        rev = float(o.get("total_amount") or 0)
        if ts >= last30_start:
            region_orders30[reg]["orders"] += 1
            region_orders30[reg]["units"] += units
            region_orders30[reg]["revenue"] += rev
        elif ts >= prev30_start:
            region_orders30[reg]["orders_prev"] += 1
            region_orders30[reg]["units_prev"] += units
            region_orders30[reg]["revenue_prev"] += rev

    regional_forecast: List[dict] = []
    for reg, m in region_orders30.items():
        growth_pct = (
            ((m["revenue"] - m["revenue_prev"]) / m["revenue_prev"] * 100)
            if m["revenue_prev"] > 0 else (100.0 if m["revenue"] > 0 else 0.0)
        )
        risk = "low"
        if growth_pct < -15:
            risk = "high"
        elif growth_pct < -5:
            risk = "medium"
        regional_forecast.append({
            "region": reg,
            "orders_30d": int(m["orders"]),
            "units_30d": int(m["units"]),
            "revenue_30d": round(m["revenue"], 2),
            "projected_revenue_30d": round(m["revenue"], 2),
            "projected_revenue_90d": round(m["revenue"] * 3, 2),
            "growth_pct": round(growth_pct, 1),
            "risk_level": risk,
        })
    regional_forecast.sort(key=lambda r: r["revenue_30d"], reverse=True)

    # ---- Distributor forecast --------------------------------------------
    by_dist: Dict[str, List[dict]] = defaultdict(list)
    for o in orders:
        did = o.get("distributor_id")
        if did:
            by_dist[did].append(o)

    distributor_forecast: List[dict] = []
    name_map = {d.get("id"): d.get("name") for d in distributors}
    for d in distributors:
        did = d.get("id")
        d_orders = by_dist.get(did, [])
        last30 = [o for o in d_orders if (_to_dt(o.get("created_at")) or now) >= last30_start]
        prev30 = [o for o in d_orders
                   if prev30_start <= (_to_dt(o.get("created_at")) or now) < last30_start]
        rev_last = sum(float(o.get("total_amount") or 0) for o in last30)
        rev_prev = sum(float(o.get("total_amount") or 0) for o in prev30)
        growth_pct = (
            ((rev_last - rev_prev) / rev_prev * 100) if rev_prev > 0
            else (100.0 if rev_last > 0 else 0.0)
        )
        expected_orders = len(last30)
        expected_revenue = rev_last
        timestamps = sorted(_to_dt(o.get("created_at")) for o in d_orders
                             if _to_dt(o.get("created_at")))
        gaps = [
            (timestamps[i + 1] - timestamps[i]).days
            for i in range(len(timestamps) - 1)
        ]
        avg_gap = round(sum(gaps) / len(gaps), 1) if gaps else None
        last_ts = timestamps[-1] if timestamps else None
        next_replenishment = (
            (last_ts + timedelta(days=avg_gap)).date().isoformat()
            if last_ts and avg_gap else None
        )

        if expected_orders == 0 and rev_prev == 0:
            continue

        distributor_forecast.append({
            "distributor_id": did,
            "name": name_map.get(did) or "?",
            "region": (d.get("region") or "Unknown"),
            "orders_last_30d": len(last30),
            "revenue_last_30d": round(rev_last, 2),
            "expected_orders_next_30d": expected_orders,
            "expected_revenue_next_30d": round(expected_revenue, 2),
            "growth_pct": round(growth_pct, 1),
            "avg_order_gap_days": avg_gap,
            "next_replenishment_est": next_replenishment,
        })
    distributor_forecast.sort(key=lambda r: r["expected_revenue_next_30d"],
                              reverse=True)

    breaches = sum(1 for r in safety_rows if r["status"] == "breach")
    warns = sum(1 for r in safety_rows if r["status"] == "warn")
    healthy = sum(1 for r in safety_rows if r["status"] == "ok")
    urgent_recs = sum(1 for r in replenishment_rows if r["priority"] == "urgent")
    total_proj_30d = sum(r["projected_30d"] for r in product_forecasts)
    total_proj_revenue_30d = sum(r["projected_revenue_30d"] for r in product_forecasts)

    return {
        "kpis": {
            "total_projected_demand_7d": int(sum(r["projected_7d"] for r in product_forecasts)),
            "total_projected_demand_30d": int(total_proj_30d),
            "total_projected_demand_90d": int(sum(r["projected_90d"] for r in product_forecasts)),
            "total_projected_revenue_30d": round(total_proj_revenue_30d, 2),
            "products_in_forecast": len(product_forecasts),
            "safety_stock_breaches": breaches,
            "safety_stock_warnings": warns,
            "safety_stock_ok": healthy,
            "urgent_replenishments": urgent_recs,
            "total_replenishments": len(replenishment_rows),
        },
        "products": product_forecasts[:20],
        "regional": regional_forecast,
        "distributors": distributor_forecast[:12],
        "replenishment": replenishment_rows[:15],
        "safety": safety_rows[:20],
    }




def _compute_distributor_intelligence(distributor_perf: List[dict],
                                       all_orders: List[dict],
                                       ninety_ago_iso: str) -> Dict[str, object]:
    """Builds KPI strip, ranking, BCG matrix and churn signals for the
    Distributor Analytics Center. Strictly programmatic — no AI."""
    if not distributor_perf:
        return {
            "kpis": {
                "active_distributors": 0, "total_revenue": 0.0,
                "average_order_value": 0.0, "average_order_frequency": 0.0,
                "fill_rate_pct": 0.0, "service_level_pct": 0.0,
                "high_growth": 0, "stable": 0, "at_risk": 0,
            },
            "ranking": [], "bcg": {"items": [], "rev_threshold": 0.0,
                                    "growth_threshold": 0.0},
            "churn": [], "trend_months": [], "monthly_purchases": {},
        }

    total_rev = sum(d["revenue"] for d in distributor_perf) or 1.0

    # Group orders per distributor for AOV, frequency, recency.
    by_dist: Dict[str, List[dict]] = defaultdict(list)
    for o in all_orders:
        did = o.get("distributor_id")
        if did:
            by_dist[did].append(o)

    # Date windows for frequency change calc.
    now = datetime.now(timezone.utc)
    last30_start = now - timedelta(days=30)
    prev30_start = now - timedelta(days=60)

    ranking: List[dict] = []
    bcg_items: List[dict] = []
    churn_rows: List[dict] = []
    fill_num, fill_den = 0, 0
    service_num, service_den = 0, 0

    # Median revenue share & median growth as quadrant thresholds — adapts
    # to data scale automatically. Fallback to mean/2 when the median is 0
    # (happens when most distributors are inactive in the window).
    shares = sorted((d["revenue"] / total_rev * 100) for d in distributor_perf)
    growths = sorted((d.get("growth_pct") or 0.0) for d in distributor_perf)
    rev_threshold = shares[len(shares) // 2] if shares else 0.0
    if rev_threshold == 0 and shares:
        rev_threshold = (sum(shares) / len(shares)) / 2 or 1.0
    growth_threshold = growths[len(growths) // 2] if growths else 0.0
    if growth_threshold == 0 and growths:
        growth_threshold = (sum(growths) / len(growths)) / 2

    aov_values: List[float] = []
    freq_values: List[float] = []

    for d in distributor_perf:
        did = d["id"]
        d_orders = by_dist.get(did, [])
        delivered = [o for o in d_orders if o.get("status") == "delivered"]
        delivered_count = len(delivered)
        # Average order value over delivered orders.
        aov = (sum(float(o.get("total_amount") or 0) for o in delivered)
               / delivered_count) if delivered_count else 0.0
        aov_values.append(aov)

        # Frequency (orders/week) over last 30d and prev 30d.
        last30_count = sum(
            1 for o in d_orders
            if (_to_dt(o.get("created_at")) or now) >= last30_start
        )
        prev30_count = sum(
            1 for o in d_orders
            if prev30_start <= (_to_dt(o.get("created_at")) or now) < last30_start
        )
        freq_last = last30_count * 7 / 30
        freq_prev = prev30_count * 7 / 30
        freq_change_pct = ((freq_last - freq_prev) / freq_prev * 100) \
            if freq_prev else (100.0 if freq_last else 0.0)
        freq_values.append(freq_last)

        # Days since last order.
        last_ts = max(
            (_to_dt(o.get("created_at")) for o in d_orders
             if _to_dt(o.get("created_at"))),
            default=None,
        )
        days_since_last = (
            (now - last_ts).days if last_ts else 999
        )

        # Fill rate / service level numerators (also computed per-distributor).
        d_fill_num, d_fill_den = 0, 0
        for o in d_orders:
            for it in (o.get("items") or []):
                req = int(it.get("quantity") or 0)
                appr = int(it.get("approved_quantity") or 0)
                if req > 0:
                    fill_den += req
                    fill_num += min(appr, req)
                    d_fill_den += req
                    d_fill_num += min(appr, req)
        for o in delivered:
            service_den += 1
            c = _to_dt(o.get("created_at"))
            dl = _to_dt(o.get("delivered_at"))
            if c and dl and (dl - c).total_seconds() <= 7 * 86400:
                service_num += 1
        dist_fill_pct = (round(d_fill_num / d_fill_den * 100, 1)
                          if d_fill_den else None)

        growth_pct = float(d.get("growth_pct") or 0.0)
        rev_share = d["revenue"] / total_rev * 100 if total_rev else 0.0
        status = _status_bucket(growth_pct, d["revenue"], last30_count)

        ranking.append({
            "id": did,
            "name": d["name"],
            "code": d.get("code", ""),
            "region": d.get("region", ""),
            "city": d.get("city", ""),
            "revenue": d["revenue"],
            "revenue_share_pct": round(rev_share, 1),
            "orders": d["orders"],
            "growth_pct": growth_pct,
            "status": status,
            "last_order_at": d.get("last_order_at") or "",
            "average_order_value": round(aov, 2),
            "order_frequency_per_week": round(freq_last, 2),
            "fill_rate_pct": dist_fill_pct,
        })

        bcg_items.append({
            "id": did,
            "name": d["name"],
            "region": d.get("region", ""),
            "revenue": d["revenue"],
            "revenue_share_pct": round(rev_share, 1),
            "growth_pct": growth_pct,
            "quadrant": _bcg_quadrant(rev_share, growth_pct,
                                       rev_threshold, growth_threshold),
        })

        churn = _churn_score(
            growth_pct=growth_pct,
            freq_change_pct=freq_change_pct,
            days_since_last=days_since_last,
            has_history=bool(d_orders),
        )
        churn_rows.append({
            "id": did,
            "name": d["name"],
            "region": d.get("region", ""),
            "revenue": d["revenue"],
            "days_since_last_order": days_since_last if last_ts else None,
            "growth_pct": growth_pct,
            "frequency_change_pct": round(freq_change_pct, 1),
            "score": churn["score"],
            "level": churn["level"],
            "reasons": churn["reasons"],
        })

    # 6-month purchase trend (across all distributors, for the chart).
    monthly: Dict[str, float] = defaultdict(float)
    months_window: List[str] = []
    for i in range(5, -1, -1):
        ref = now - timedelta(days=30 * i)
        months_window.append(ref.strftime("%Y-%m"))
    months_set = set(months_window)
    for o in all_orders:
        if o.get("status") != "delivered":
            continue
        ts = _to_dt(o.get("created_at") or o.get("delivered_at"))
        if not ts:
            continue
        m = ts.strftime("%Y-%m")
        if m in months_set:
            monthly[m] += float(o.get("total_amount") or 0)

    high_growth = sum(1 for r in ranking if r["status"] == "high_growth")
    at_risk = sum(1 for r in ranking if r["status"] == "at_risk")
    stable = len(ranking) - high_growth - at_risk

    aov_overall = (sum(aov_values) / len(aov_values)) if aov_values else 0.0
    freq_overall = (sum(freq_values) / len(freq_values)) if freq_values else 0.0
    fill_rate_pct = round(fill_num / fill_den * 100, 1) if fill_den else 0.0
    service_level_pct = round(service_num / service_den * 100, 1) if service_den else 0.0

    # Sort outputs sensibly.
    ranking.sort(key=lambda r: r["revenue"], reverse=True)
    churn_rows.sort(key=lambda r: r["score"], reverse=True)

    return {
        "kpis": {
            "active_distributors": len(distributor_perf),
            "total_revenue": round(total_rev, 2),
            "average_order_value": round(aov_overall, 2),
            "average_order_frequency": round(freq_overall, 2),
            "fill_rate_pct": fill_rate_pct,
            "service_level_pct": service_level_pct,
            "high_growth": high_growth,
            "stable": stable,
            "at_risk": at_risk,
        },
        "ranking": ranking,
        "bcg": {
            "items": bcg_items,
            "rev_threshold": round(rev_threshold, 2),
            "growth_threshold": round(growth_threshold, 2),
        },
        "churn": churn_rows,
        "trend_months": months_window,
        "monthly_purchases": {m: round(monthly.get(m, 0.0), 2) for m in months_window},
    }


async def _enrich_products(product_ids: List[str]) -> Dict[str, dict]:
    if not product_ids:
        return {}
    rows = await db.products.find(
        {"id": {"$in": list(set(product_ids))}},
        {"_id": 0, "id": 1, "name": 1, "sku": 1, "unit_price": 1, "category": 1},
    ).to_list(2000)
    return {r["id"]: r for r in rows}


# ===========================================================================
# WHOLESALER → DISTRIBUTOR DETAIL
# ===========================================================================


@router.get("/wholesaler/{wholesaler_id}/distributors/{distributor_id}/detail")
async def distributor_detail(wholesaler_id: str, distributor_id: str,
                             _user: dict = Depends(require_wholesaler_owner)):
    """360º view of a single distributor served by this wholesaler."""
    wh = await get_wholesaler_org(wholesaler_id)
    tenant_id = await tenant_id_for(wh)

    dist_org = await db.organizations.find_one(
        {"id": distributor_id, "organization_type": "distributor"},
        {"_id": 0},
    )
    legacy = await db.distributors.find_one(
        {"id": distributor_id}, {"_id": 0},
    )
    if not dist_org and not legacy:
        raise HTTPException(404, "Distributor not found")
    # Tenant guard: if a legacy mirror exists, it must match.
    if legacy and tenant_id and legacy.get("manufacturer_id") != tenant_id:
        raise HTTPException(403, "Distributor outside your tenant")

    profile = {
        "id": distributor_id,
        "name": (dist_org or {}).get("organization_name")
                or (legacy or {}).get("name") or "",
        "code": (dist_org or {}).get("organization_code", ""),
        "region": (dist_org or {}).get("region")
                  or (legacy or {}).get("region") or "",
        "city": (dist_org or {}).get("city")
                or (legacy or {}).get("city") or "",
        "address": (dist_org or {}).get("address") or "",
        "manager_name": (dist_org or {}).get("manager_name") or "",
        "contact_email": (dist_org or {}).get("contact_email") or "",
        "contact_phone": (dist_org or {}).get("contact_phone") or "",
    }

    # ---- Orders this distributor placed with THIS wholesaler ---------------
    orders = await db.wholesaler_orders.find(
        {"wholesaler_id": wholesaler_id, "distributor_id": distributor_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    shipments = await db.wholesaler_shipments.find(
        {"wholesaler_id": wholesaler_id, "distributor_id": distributor_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    ninety_ago = _days_ago_iso(90)
    thirty_ago = _days_ago_iso(30)

    # ---- KPIs -------------------------------------------------------------
    order_count_90d = sum(1 for o in orders if (o.get("created_at") or "") >= ninety_ago)
    order_count_30d = sum(1 for o in orders if (o.get("created_at") or "") >= thirty_ago)
    delivered_90d = [o for o in orders
                     if o.get("status") == "delivered"
                     and (o.get("delivered_at") or "") >= ninety_ago]
    revenue_90d = sum(float(o.get("total_amount") or 0) for o in delivered_90d)
    units_90d = sum(int(o.get("total_units") or 0) for o in delivered_90d)
    aov = round(revenue_90d / len(delivered_90d), 2) if delivered_90d else 0.0

    # Fill rate (90d): delivered units / approved units
    approved_units = 0
    delivered_units = 0
    for o in orders:
        if (o.get("created_at") or "") < ninety_ago:
            continue
        for it in (o.get("items") or []):
            approved_units += int(it.get("approved_quantity") or 0)
            if o.get("status") == "delivered":
                delivered_units += int(it.get("approved_quantity") or 0)
    fill_rate = round(delivered_units / approved_units * 100, 1) if approved_units else 0.0

    # Avg delivery hours (created → delivered) across closed orders
    deltas: List[float] = []
    for o in delivered_90d:
        t0 = _to_dt(o.get("created_at"))
        t1 = _to_dt(o.get("delivered_at"))
        if t0 and t1:
            deltas.append((t1 - t0).total_seconds() / 3600.0)
    avg_delivery_hours = round(sum(deltas) / len(deltas), 1) if deltas else None

    # Last order date
    last_order_at = orders[0]["created_at"] if orders else None

    # ---- Distributor's owned inventory (downstream stock) -----------------
    inv = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": distributor_id},
        {"_id": 0},
    ).to_list(2000)
    in_stock_skus = sum(1 for r in inv if int(r.get("quantity") or 0) > 0)
    total_skus = len(inv)
    inv_health = round(in_stock_skus / total_skus * 100, 1) if total_skus else 0.0

    # ---- Top products purchased -------------------------------------------
    prod_units: Dict[str, int] = defaultdict(int)
    prod_revenue: Dict[str, float] = defaultdict(float)
    for o in orders:
        if (o.get("created_at") or "") < ninety_ago:
            continue
        for it in (o.get("items") or []):
            pid = it.get("product_id")
            qty = int(it.get("approved_quantity") or it.get("quantity") or 0)
            unit_price = float(it.get("unit_price") or 0)
            prod_units[pid] += qty
            prod_revenue[pid] += unit_price * qty
    top_pids = sorted(prod_units, key=lambda p: prod_revenue[p], reverse=True)[:8]
    pmap = await _enrich_products(top_pids) if top_pids else {}
    top_products = [{
        "product_id": pid,
        "product_name": (pmap.get(pid) or {}).get("name") or pid,
        "sku": (pmap.get(pid) or {}).get("sku") or "",
        "units": prod_units[pid],
        "revenue": round(prod_revenue[pid], 2),
    } for pid in top_pids]

    # ---- 90-day daily order trend -----------------------------------------
    daily: Dict[str, dict] = {}
    for o in orders:
        d = (o.get("created_at") or "")[:10]
        if not d or d < ninety_ago[:10]:
            continue
        bucket = daily.setdefault(d, {"date": d, "orders": 0, "units": 0,
                                       "revenue": 0.0})
        bucket["orders"] += 1
        bucket["units"] += int(o.get("total_units") or 0)
        if o.get("status") == "delivered":
            bucket["revenue"] += float(o.get("total_amount") or 0)
    trend_90d = sorted(daily.values(), key=lambda r: r["date"])

    # ---- Status distribution ----------------------------------------------
    status_dist: Dict[str, int] = defaultdict(int)
    for o in orders:
        status_dist[o.get("status", "submitted")] += 1

    return {
        "wholesaler_id": wholesaler_id,
        "profile": profile,
        "kpis": {
            "orders_90d": order_count_90d,
            "orders_30d": order_count_30d,
            "revenue_90d": round(revenue_90d, 2),
            "units_90d": units_90d,
            "average_order_value": aov,
            "fill_rate_pct": fill_rate,
            "avg_delivery_hours": avg_delivery_hours,
            "last_order_at": last_order_at,
            "inventory_health_pct": inv_health,
            "inventory_skus": total_skus,
        },
        "orders": orders[:50],
        "shipments": shipments[:30],
        "top_products": top_products,
        "trend_90d": trend_90d,
        "status_distribution": status_dist,
        "as_of": now_iso(),
    }


# ===========================================================================
# WHOLESALER ANALYTICS
# ===========================================================================


@router.get("/wholesaler/{wholesaler_id}/analytics")
async def wholesaler_analytics(wholesaler_id: str,
                               _user: dict = Depends(require_wholesaler_owner)):
    """Comprehensive analytics: inventory, distributor performance, orders,
    procurement, and rule-based demand forecast. No AI."""
    wh = await get_wholesaler_org(wholesaler_id)
    tenant_id = await tenant_id_for(wh)
    _ = wh.get("region") or ""   # reserved for future region-filtered analytics

    ninety_ago = _days_ago_iso(90)
    thirty_ago = _days_ago_iso(30)
    sixty_ago_to_thirty_ago_start = _days_ago_iso(60)

    # ---- Inventory ---------------------------------------------------------
    inventory = await db.inventory.find(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id}, {"_id": 0},
    ).to_list(2000)
    movements = await db.wholesaler_inventory_movements.find(
        {"wholesaler_id": wholesaler_id,
         "created_at": {"$gte": ninety_ago}}, {"_id": 0},
    ).to_list(5000)

    products = await db.products.find(
        {"manufacturer_id": tenant_id} if tenant_id else {}, {"_id": 0},
    ).to_list(2000)
    pmap = {p["id"]: p for p in products}

    total_units = sum(int(r.get("quantity") or 0) for r in inventory)
    total_value = sum(int(r.get("quantity") or 0)
                      * float((pmap.get(r.get("product_id")) or {}).get("unit_price") or 0)
                      for r in inventory)
    reserved = sum(int(r.get("reserved") or 0) for r in inventory)
    in_transit = sum(int(r.get("in_transit") or 0) for r in inventory)
    damaged = sum(int(r.get("damaged") or 0) for r in inventory)

    # Outbound throughput last 90d (dispatch movements)
    outbound_units = sum(
        abs(int(m.get("delta") or 0))
        for m in movements
        if m.get("kind") == "dispatch"
    )
    turnover = round(outbound_units / max(total_units, 1), 2) if total_units else 0.0
    days_of_supply_avg = round(90 / turnover, 1) if turnover else None

    # ABC classification of inventory by value
    inv_by_value = []
    for r in inventory:
        unit_price = float((pmap.get(r.get("product_id")) or {}).get("unit_price") or 0)
        value = unit_price * int(r.get("quantity") or 0)
        inv_by_value.append({
            "product_id": r.get("product_id"),
            "product_name": (pmap.get(r.get("product_id")) or {}).get("name") or "?",
            "sku": (pmap.get(r.get("product_id")) or {}).get("sku") or "",
            "on_hand": int(r.get("quantity") or 0),
            "value": round(value, 2),
            "velocity": float(r.get("velocity") or 0),
        })
    inv_by_value.sort(key=lambda x: x["value"], reverse=True)
    total_inv_value = sum(x["value"] for x in inv_by_value) or 1
    cumulative = 0.0
    for row in inv_by_value:
        cumulative += row["value"]
        share = cumulative / total_inv_value
        row["abc"] = "A" if share <= 0.8 else ("B" if share <= 0.95 else "C")
    abc_summary = {
        "A": sum(1 for r in inv_by_value if r["abc"] == "A"),
        "B": sum(1 for r in inv_by_value if r["abc"] == "B"),
        "C": sum(1 for r in inv_by_value if r["abc"] == "C"),
    }

    # Slow movers / fast movers / dead stock (rule-based)
    fast_movers = sorted(
        [r for r in inv_by_value if r["velocity"] > 0],
        key=lambda r: r["velocity"], reverse=True,
    )[:6]
    slow_movers = sorted(
        [r for r in inv_by_value if r["on_hand"] > 0 and r["velocity"] > 0],
        key=lambda r: r["velocity"],
    )[:6]
    dead_stock = [r for r in inv_by_value
                  if r["on_hand"] > 0 and r["velocity"] == 0][:6]

    # ---- Phase 3B — Inventory Analytics Center deep block ------------------
    warehouse_lookup: Dict[str, str] = {}
    wh_ids = {r.get("warehouse_id") for r in inventory if r.get("warehouse_id")}
    if wh_ids:
        whs = await db.warehouses.find(
            {"id": {"$in": list(wh_ids)}}, {"_id": 0, "id": 1, "name": 1},
        ).to_list(200)
        warehouse_lookup = {w["id"]: w.get("name") or "Warehouse" for w in whs}
    inventory_deep = _compute_inventory_intelligence(inventory, pmap, warehouse_lookup)


    # ---- Orders -----------------------------------------------------------
    orders = await db.wholesaler_orders.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0},
    ).to_list(2000)

    orders_90d = [o for o in orders if (o.get("created_at") or "") >= ninety_ago]
    orders_30d = [o for o in orders if (o.get("created_at") or "") >= thirty_ago]
    orders_prev30 = [o for o in orders
                     if sixty_ago_to_thirty_ago_start <= (o.get("created_at") or "") < thirty_ago]

    revenue_30d = sum(float(o.get("total_amount") or 0)
                      for o in orders_30d if o.get("status") == "delivered")
    revenue_prev30 = sum(float(o.get("total_amount") or 0)
                         for o in orders_prev30 if o.get("status") == "delivered")
    revenue_growth_pct = round(
        ((revenue_30d - revenue_prev30) / revenue_prev30 * 100) if revenue_prev30 else 0.0, 1)

    status_dist: Dict[str, int] = defaultdict(int)
    for o in orders:
        status_dist[o.get("status", "submitted")] += 1

    approved_total = 0
    delivered_total = 0
    for o in orders_90d:
        for it in (o.get("items") or []):
            approved_total += int(it.get("approved_quantity") or 0)
            if o.get("status") == "delivered":
                delivered_total += int(it.get("approved_quantity") or 0)
    fill_rate_pct = round(delivered_total / approved_total * 100, 1) if approved_total else 0.0

    # 90d daily trend
    daily_orders: Dict[str, dict] = {}
    for o in orders_90d:
        d = (o.get("created_at") or "")[:10]
        if not d:
            continue
        b = daily_orders.setdefault(d, {"date": d, "orders": 0, "units": 0, "revenue": 0.0})
        b["orders"] += 1
        b["units"] += int(o.get("total_units") or 0)
        if o.get("status") == "delivered":
            b["revenue"] += float(o.get("total_amount") or 0)
    orders_trend_90d = sorted(daily_orders.values(), key=lambda r: r["date"])

    # ---- Distributor analytics --------------------------------------------
    dist_acc: Dict[str, dict] = {}
    for o in orders_90d:
        did = o.get("distributor_id")
        if not did:
            continue
        d = dist_acc.setdefault(did, {
            "id": did,
            "name": (o.get("distributor") or {}).get("name", ""),
            "region": (o.get("distributor") or {}).get("region", ""),
            "city": (o.get("distributor") or {}).get("city", ""),
            "orders": 0, "units": 0, "revenue": 0.0,
            "last_order_at": "",
        })
        d["orders"] += 1
        d["units"] += int(o.get("total_units") or 0)
        if o.get("status") == "delivered":
            d["revenue"] += float(o.get("total_amount") or 0)
        if (o.get("created_at") or "") > d["last_order_at"]:
            d["last_order_at"] = o.get("created_at")
    # Compute prev-30 vs last-30 to derive growth
    prev30: Dict[str, float] = defaultdict(float)
    last30: Dict[str, float] = defaultdict(float)
    for o in orders:
        if o.get("status") != "delivered":
            continue
        did = o.get("distributor_id")
        amt = float(o.get("total_amount") or 0)
        ca = o.get("created_at") or ""
        if ca >= thirty_ago:
            last30[did] += amt
        elif ca >= sixty_ago_to_thirty_ago_start:
            prev30[did] += amt
    for did, d in dist_acc.items():
        last = last30.get(did, 0)
        prev = prev30.get(did, 0)
        d["last_30d_revenue"] = round(last, 2)
        d["prev_30d_revenue"] = round(prev, 2)
        d["growth_pct"] = round(((last - prev) / prev * 100) if prev else (100.0 if last else 0.0), 1)
        d["revenue"] = round(d["revenue"], 2)
    distributor_perf = sorted(dist_acc.values(), key=lambda r: r["revenue"], reverse=True)
    top_distributors = distributor_perf[:6]
    fastest_growing = sorted(distributor_perf,
                              key=lambda r: r["growth_pct"], reverse=True)[:5]
    declining = sorted([r for r in distributor_perf if r["growth_pct"] < 0],
                       key=lambda r: r["growth_pct"])[:5]

    # ---- Distributor Analytics Center (Phase 3A) --------------------------
    # KPI strip, BCG matrix, ranking with growth status, churn risk scoring,
    # and 6-month monthly purchase trend per top distributor. Pure math.
    distributors_deep = _compute_distributor_intelligence(
        distributor_perf, orders, ninety_ago,
    )

    # ---- Phase 3C — Demand Forecast + Replenishment Intelligence ---------
    # Pure math against trailing 90d orders + current inventory.
    forecast_deep = _compute_forecast_intelligence(
        inventory, pmap, orders_90d, distributor_perf,
    )

    # ---- Phase 3D — Intelligence Center briefing (rule-based) -------------
    intelligence_deep = _compose_intelligence_briefing(
        distributors_deep, inventory_deep, forecast_deep,
    )

    # ---- Phase 3E — Control Tower View (rule-based composite scoring) ----
    shipments_90d = await db.wholesaler_shipments.find(
        {"wholesaler_id": wholesaler_id, "created_at": {"$gte": ninety_ago}},
        {"_id": 0, "status": 1, "created_at": 1, "id": 1},
    ).to_list(2000)
    control_tower = _compose_control_tower(
        distributors_deep, inventory_deep, forecast_deep, shipments_90d,
    )

    # ---- Procurement ------------------------------------------------------
    pos = await db.wholesaler_purchase_orders.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0},
    ).to_list(500)
    po_open = sum(1 for p in pos if p.get("status") not in ("delivered", "cancelled"))
    po_delivered_90d = [p for p in pos if p.get("status") == "delivered"
                        and (p.get("delivered_at") or "") >= ninety_ago]
    procurement_lead_times: List[float] = []
    for p in po_delivered_90d:
        t0 = _to_dt(p.get("submitted_at") or p.get("created_at"))
        t1 = _to_dt(p.get("delivered_at"))
        if t0 and t1:
            procurement_lead_times.append((t1 - t0).total_seconds() / 3600.0)
    avg_po_lead_hours = round(
        sum(procurement_lead_times) / len(procurement_lead_times), 1
    ) if procurement_lead_times else None

    supplier_acc: Dict[str, dict] = {}
    for p in pos:
        sid = p.get("supplier_id")
        if not sid:
            continue
        d = supplier_acc.setdefault(sid, {
            "supplier_id": sid,
            "supplier_name": p.get("supplier_name") or "",
            "supplier_type": p.get("supplier_type") or "",
            "po_count": 0, "po_value": 0.0, "delivered": 0,
        })
        d["po_count"] += 1
        d["po_value"] += float(p.get("total_amount") or 0)
        if p.get("status") == "delivered":
            d["delivered"] += 1
    for s in supplier_acc.values():
        s["po_value"] = round(s["po_value"], 2)
        s["fill_rate_pct"] = round(s["delivered"] / s["po_count"] * 100, 1) \
            if s["po_count"] else 0.0
    supplier_perf = sorted(supplier_acc.values(), key=lambda r: r["po_value"], reverse=True)

    # ---- Demand forecast (rule-based 14-day projection) -------------------
    # Use trailing 30d order velocity per product and project next 14 days.
    velocity_per_pid: Dict[str, float] = defaultdict(float)
    last30_units: Dict[str, int] = defaultdict(int)
    for o in orders_30d:
        for it in (o.get("items") or []):
            last30_units[it["product_id"]] += int(it.get("quantity") or 0)
    for pid, total_units_30d in last30_units.items():
        velocity_per_pid[pid] = total_units_30d / 30.0   # units/day

    forecast = []
    for pid, vel in velocity_per_pid.items():
        proj_14d = vel * 14
        on_hand = sum(int(r.get("quantity") or 0)
                      for r in inventory if r.get("product_id") == pid)
        cover_days = round(on_hand / vel, 1) if vel > 0 else None
        forecast.append({
            "product_id": pid,
            "product_name": (pmap.get(pid) or {}).get("name") or pid,
            "sku": (pmap.get(pid) or {}).get("sku") or "",
            "daily_velocity": round(vel, 2),
            "projected_demand_14d": round(proj_14d, 0),
            "on_hand": on_hand,
            "days_of_cover": cover_days,
        })
    forecast.sort(key=lambda r: r["daily_velocity"], reverse=True)
    forecast = forecast[:12]

    # Replenishment recommendations (rule-based)
    recs = []
    for f in forecast:
        if f["days_of_cover"] is None:
            continue
        if f["days_of_cover"] < 7:
            recs.append({
                "product_id": f["product_id"],
                "product_name": f["product_name"],
                "type": "urgent_reorder",
                "message": f"Only {f['days_of_cover']}d of cover at current velocity — "
                           f"order {int(f['projected_demand_14d'] - f['on_hand'])} units now.",
                "suggested_qty": max(0, int(f["projected_demand_14d"] - f["on_hand"])),
            })
        elif f["days_of_cover"] < 14:
            recs.append({
                "product_id": f["product_id"],
                "product_name": f["product_name"],
                "type": "reorder",
                "message": f"{f['days_of_cover']}d of cover — plan replenishment.",
                "suggested_qty": max(0, int(f["projected_demand_14d"] - f["on_hand"])),
            })
    recs = recs[:8]

    return {
        "wholesaler_id": wholesaler_id,
        "as_of": now_iso(),
        "inventory": {
            "total_units": total_units,
            "total_value": round(total_value, 2),
            "reserved": reserved,
            "in_transit": in_transit,
            "damaged": damaged,
            "turnover_90d": turnover,
            "days_of_supply": days_of_supply_avg,
            "abc_summary": abc_summary,
            "fast_movers": fast_movers,
            "slow_movers": slow_movers,
            "dead_stock": dead_stock,
            "deep": inventory_deep,
        },
        "orders": {
            "total_90d": len(orders_90d),
            "total_30d": len(orders_30d),
            "revenue_30d": round(revenue_30d, 2),
            "revenue_growth_pct": revenue_growth_pct,
            "fill_rate_pct": fill_rate_pct,
            "status_distribution": status_dist,
            "trend_90d": orders_trend_90d,
        },
        "distributors": {
            "active_90d": len(distributor_perf),
            "top": top_distributors,
            "fastest_growing": fastest_growing,
            "declining": declining,
            "deep": distributors_deep,
        },
        "procurement": {
            "pos_open": po_open,
            "pos_total": len(pos),
            "avg_lead_hours": avg_po_lead_hours,
            "supplier_performance": supplier_perf,
        },
        "demand_forecast": {
            "horizon_days": 14,
            "rows": forecast,
            "replenishment_recommendations": recs,
            "deep": forecast_deep,
        },
        "intelligence": intelligence_deep,
        "control_tower": control_tower,
    }


# ===========================================================================
# CROSS-PERSONA SURFACING
# ===========================================================================


async def _walk_to_mfr_id(org: dict) -> str:
    return await walk_to_manufacturer(org)


@router.get("/manufacturer/{manufacturer_id}/wholesaler-pos")
async def manufacturer_inbound_wholesaler_pos(manufacturer_id: str, request: Request):
    """Manufacturer-side view of every wholesaler purchase order targeting
    this manufacturer (or any warehouse under it). Drives the "pending
    wholesaler replenishments" widget on the manufacturer dashboard."""
    user = await get_current_user(request)
    role = user.get("role")
    if role not in ("super_admin", "manufacturer"):
        raise HTTPException(403, "Only manufacturers can view this")
    if role == "manufacturer" and user.get("entity_id") != manufacturer_id:
        raise HTTPException(403, "Cross-tenant access denied")

    pos = await db.wholesaler_purchase_orders.find(
        {"tenant_id": manufacturer_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    # Enrich with wholesaler + product names
    wh_ids = list({p.get("wholesaler_id") for p in pos if p.get("wholesaler_id")})
    wh_map: dict = {}
    async for w in db.organizations.find(
        {"id": {"$in": wh_ids}},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "region": 1, "city": 1},
    ):
        wh_map[w["id"]] = w
    pids = [it["product_id"] for p in pos for it in (p.get("items") or [])]
    pmap = await _enrich_products(pids)
    for p in pos:
        w = wh_map.get(p.get("wholesaler_id")) or {}
        p["wholesaler_name"] = w.get("organization_name", "")
        p["wholesaler_code"] = w.get("organization_code", "")
        p["wholesaler_region"] = w.get("region", "")
        for it in (p.get("items") or []):
            pr = pmap.get(it.get("product_id")) or {}
            it["product_name"] = pr.get("name", "")
            it["sku"] = pr.get("sku", "")

    # Aggregate KPIs
    open_pos = [p for p in pos if p.get("status") in ("submitted", "approved")]
    in_fulfillment = [p for p in pos if p.get("status") in ("allocated", "shipped")]
    return {
        "kpis": {
            "open_pos": len(open_pos),
            "in_fulfillment": len(in_fulfillment),
            "delivered_90d": sum(
                1 for p in pos
                if p.get("status") == "delivered"
                and (p.get("delivered_at") or "") >= _days_ago_iso(90)
            ),
            "total_open_value": round(sum(
                float(p.get("total_amount") or 0) for p in open_pos
            ), 2),
        },
        "purchase_orders": pos[:200],
        "as_of": now_iso(),
    }


@router.get("/distributor/{distributor_id}/wholesaler-orders")
async def distributor_outbound_wholesaler_orders(distributor_id: str,
                                                  request: Request):
    """Distributor-side view of every order this distributor has placed
    against a wholesaler — orders, fulfillments, and shipments."""
    user = await get_current_user(request)
    role = user.get("role")
    if role == "distributor" and user.get("entity_id") != distributor_id:
        raise HTTPException(403, "Cross-tenant access denied")
    if role not in ("super_admin", "distributor", "manufacturer"):
        raise HTTPException(403, "Not permitted")

    orders = await db.wholesaler_orders.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    fulfillments = await db.wholesaler_fulfillment_orders.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    shipments = await db.wholesaler_shipments.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    open_orders = [o for o in orders if o.get("status") not in (
        "delivered", "cancelled", "rejected")]
    active_shipments = [s for s in shipments
                        if s.get("status") in ("loaded", "in_transit")]

    # Wholesaler enrichment
    wh_ids = list({o["wholesaler_id"] for o in orders if o.get("wholesaler_id")})
    wh_map: dict = {}
    async for w in db.organizations.find(
        {"id": {"$in": wh_ids}},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "region": 1, "city": 1},
    ):
        wh_map[w["id"]] = w
    for collection in (orders, fulfillments, shipments):
        for row in collection:
            wid = row.get("wholesaler_id")
            w = wh_map.get(wid) or {}
            row["wholesaler_name"] = w.get("organization_name", "")
            row["wholesaler_code"] = w.get("organization_code", "")
            row["wholesaler_region"] = w.get("region", "")

    return {
        "kpis": {
            "open_orders": len(open_orders),
            "delivered_90d": sum(
                1 for o in orders
                if o.get("status") == "delivered"
                and (o.get("delivered_at") or "") >= _days_ago_iso(90)
            ),
            "active_shipments": len(active_shipments),
            "open_value": round(sum(
                float(o.get("total_amount") or 0) for o in open_orders
            ), 2),
        },
        "orders": orders[:200],
        "fulfillments": fulfillments[:200],
        "shipments": shipments[:200],
        "as_of": now_iso(),
    }
