"""Rule-based recommendation engine — produces read-only action cards.

Combines stock-exhaustion forecasts, retailer health, and delivery risk into
prioritized, scoped recommendations with confidence + urgency + impact.

Output → db.intel_recommendations (replace per tenant on each run).
"""
from __future__ import annotations

from typing import Dict, List

from core import db, new_id, now_iso


URGENCY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}


def _impact_for_units(units: int, unit_price: float) -> dict:
    naira = round(units * float(unit_price or 0), 2)
    return {"units": units, "naira": naira}


async def generate_recommendations(tenant_id: str) -> dict:
    """Build a ranked list of recommendations across stock, churn, logistics."""
    forecasts = await db.intel_forecasts.find(
        {"tenant_id": tenant_id, "days_remaining": {"$lt": 10}},
        {"_id": 0},
    ).sort("days_remaining", 1).to_list(2000)

    distributors_low: Dict[str, dict] = {}
    for f in forecasts:
        if f["urgency"] in ("critical", "high"):
            d = distributors_low.setdefault(f["distributor_id"], {
                "distributor_id": f["distributor_id"],
                "distributor_name": f["distributor_name"],
                "region": f["region"],
                "shops_at_risk": 0, "items_at_risk": 0,
                "products": set(), "naira_at_risk": 0.0,
            })
            d["shops_at_risk"] += 1
            d["items_at_risk"] += f.get("current_qty", 0)
            d["products"].add(f["product_name"])

    health_high = await db.intel_retailer_health.find(
        {"tenant_id": tenant_id, "churn_risk": "high"}, {"_id": 0},
    ).sort("days_inactive", -1).to_list(500)

    eta_high_risk = await db.intel_delivery_eta.find(
        {"tenant_id": tenant_id, "risk": "high"}, {"_id": 0},
    ).to_list(500)

    products = {p["id"]: p for p in await db.products.find(
        {"manufacturer_id": tenant_id}, {"_id": 0},
    ).to_list(5000)}

    recs: List[dict] = []
    now = now_iso()

    # 1) Per-distributor network replenishment — each distributor sees ONLY
    # the one scoped to themselves, never another distributor's.
    for d in distributors_low.values():
        top_products = list(d["products"])[:3]
        recs.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "scope_role": "distributor",
            "scope_id": d["distributor_id"],
            "category": "replenishment",
            "urgency": "critical" if d["shops_at_risk"] >= 5 else "high",
            "confidence": 0.85 if d["shops_at_risk"] >= 5 else 0.7,
            "title": f"Restock your network in {d.get('region','') or 'region'}",
            "detail": (
                f"{d['shops_at_risk']} of your retailer{'s' if d['shops_at_risk'] != 1 else ''} "
                f"approaching stockout. Top SKUs at risk: {', '.join(top_products)}."
            ),
            "impact": _impact_for_units(d["items_at_risk"], 1500),
            "distributor_id": d["distributor_id"],
            "region": d.get("region", ""),
            "actions": ["Schedule emergency replenishment shipment to affected retailers",
                        "Pull stock from over-stocked neighbouring retailers",
                        "Notify the central operations team if depot stock is low"],
            "status": "open",
            "created_at": now,
        })

    # 1b) Manufacturer-level rollup: how many distributors are in trouble?
    if distributors_low:
        critical_dists = sum(1 for d in distributors_low.values() if d["shops_at_risk"] >= 5)
        if critical_dists > 0:
            top_regions = sorted({d.get("region", "") for d in distributors_low.values() if d.get("region")})[:3]
            recs.append({
                "id": new_id(),
                "tenant_id": tenant_id,
                "scope_role": "manufacturer",
                "scope_id": tenant_id,
                "category": "replenishment",
                "urgency": "high",
                "confidence": 0.8,
                "title": f"{critical_dists} distributor{'s' if critical_dists != 1 else ''} need urgent replenishment",
                "detail": (
                    f"{critical_dists} distributor{'s' if critical_dists != 1 else ''} "
                    f"have 5+ retailers near stockout. Regions: {', '.join(top_regions) or 'multiple'}. "
                    f"Coordinate central inventory release."
                ),
                "impact": _impact_for_units(
                    sum(d["items_at_risk"] for d in distributors_low.values()), 1500),
                "region": ", ".join(top_regions),
                "actions": [
                    "Review central depot allocation",
                    "Authorize emergency dispatch to affected regions",
                    "Increase production batch for top-3 risk SKUs",
                ],
                "status": "open",
                "created_at": now,
            })

    # 2) Per-retailer critical stockouts (top 25)
    for f in forecasts[:25]:
        if f["urgency"] != "critical":
            continue
        p = products.get(f["product_id"]) or {}
        recs.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "scope_role": "distributor",
            "scope_id": f["distributor_id"],
            "category": "stockout",
            "urgency": "critical",
            "confidence": float(f["confidence"]),
            "title": f"Restock {f['retailer_name']} — {f['product_name']}",
            "detail": (
                f"~{f['days_remaining']} days of stock left at current pace "
                f"(velocity {f['adjusted_velocity']} u/day). Stockout ~{f['stockout_date']}."
            ),
            "impact": _impact_for_units(int(f["adjusted_velocity"] * 7),
                                        float(p.get("unit_price", 0))),
            "retailer_id": f["retailer_id"],
            "distributor_id": f["distributor_id"],
            "product_id": f["product_id"],
            "region": f.get("region", ""),
            "actions": [
                f"Send shipment of ~{int(f['adjusted_velocity'] * 14)} units within 48h",
                "Push restock notification to distributor's WhatsApp",
            ],
            "status": "open",
            "created_at": now,
        })

    # 3) Churn recovery
    for h in health_high[:15]:
        recs.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "scope_role": "distributor",
            "scope_id": h["distributor_id"],
            "category": "churn_recovery",
            "urgency": "medium",
            "confidence": 0.6,
            "title": f"Win back {h['retailer_name']}",
            "detail": f"{h['days_inactive']} days inactive in {h.get('city','')}. "
                       f"Health score {h['health_score']}/100. Try a personalized re-engagement call.",
            "impact": {"units": 0, "naira": float(h.get("revenue_30d", 0))},
            "retailer_id": h["retailer_id"],
            "distributor_id": h["distributor_id"],
            "region": h.get("region", ""),
            "actions": [
                "Distributor rep to call within 24h",
                "Offer one-time restock incentive",
                "Onboard to Sales Book if not active",
            ],
            "status": "open",
            "created_at": now,
        })

    # 4) Logistics escalation — scope to whoever the shipment is FROM
    # (manufacturer for mfg→dist, the source distributor for dist→retailer)
    for e in eta_high_risk[:10]:
        is_dist_to_retailer = e.get("from_role") == "distributor"
        scope_role = "distributor" if is_dist_to_retailer else "manufacturer"
        scope_id = e.get("from_id") if is_dist_to_retailer else tenant_id
        recs.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "scope_role": scope_role,
            "scope_id": scope_id,
            "category": "logistics",
            "urgency": "high",
            "confidence": 0.75,
            "title": f"Expedite shipment {e['tracking_code']}",
            "detail": (
                f"Elapsed {e['elapsed_days']}d vs expected {e['expected_days']}d on "
                f"{e['from_region']} → {e['to_region']}. "
                f"{'Weather adding ' + str(int((e['external_multiplier']-1)*100)) + '% delay.' if e['external_multiplier'] > 1.1 else ''}"
            ),
            "impact": {"units": 0, "naira": 0},
            "region": e.get("to_region", ""),
            "distributor_id": e.get("from_id") if is_dist_to_retailer else "",
            "actions": [
                "Contact carrier for status update",
                "Alert destination of revised ETA",
                "Consider alternate route" if e["external_multiplier"] > 1.2 else "Monitor closely",
            ],
            "status": "open",
            "created_at": now,
        })

    # Sort by urgency × confidence
    recs.sort(key=lambda r: (-URGENCY_RANK.get(r["urgency"], 0), -float(r.get("confidence", 0))))

    await db.intel_recommendations.delete_many({"tenant_id": tenant_id})
    if recs:
        await db.intel_recommendations.insert_many(recs)
    return {"recommendations": len(recs)}
