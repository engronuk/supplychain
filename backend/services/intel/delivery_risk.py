"""Delivery & logistics risk — predicts late shipments + dynamic ETAs.

Combines:
  - Historical delivery time per (from_region → to_region) lane
  - Current in-transit duration vs lane baseline
  - External multiplier (heavy rain / holiday → +1-2 days)

Output → db.intel_alerts with category='logistics' + db.intel_delivery_eta keyed by shipment.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from core import db, new_id, now_iso

DEFAULT_LANE_DAYS = 3.0  # if we have no history


async def _lane_baseline(tenant_id: str) -> Dict[Tuple[str, str], float]:
    """Build (from_region, to_region) → median historical days."""
    pipeline = [
        {"$match": {"manufacturer_id": tenant_id, "status": "received",
                    "dispatched_at": {"$ne": None}, "received_at": {"$ne": None}}},
    ]
    rows = [r async for r in db.shipments.aggregate(pipeline)]
    if not rows:
        return {}
    # Resolve regions
    dist_region: Dict[str, str] = {}
    async for d in db.distributors.find({"manufacturer_id": tenant_id}, {"_id": 0, "id": 1, "region": 1}):
        dist_region[d["id"]] = d.get("region") or "—"
    rid_region: Dict[str, str] = {}
    async for r in db.retailers.find({}, {"_id": 0, "id": 1, "region": 1}):
        rid_region[r["id"]] = r.get("region") or "—"

    lane_buckets: Dict[Tuple[str, str], List[float]] = {}
    for s in rows:
        try:
            dispatched = datetime.fromisoformat(s["dispatched_at"].replace("Z", "+00:00"))
            received = datetime.fromisoformat(s["received_at"].replace("Z", "+00:00"))
            days = (received - dispatched).total_seconds() / 86400
        except Exception:
            continue
        from_role, to_role = s.get("from_role", ""), s.get("to_role", "")
        from_id, to_id = s.get("from_id", ""), s.get("to_id", "")
        from_reg = "mfg" if from_role == "manufacturer" else dist_region.get(from_id, "—")
        to_reg = dist_region.get(to_id, "—") if to_role == "distributor" else rid_region.get(to_id, "—")
        lane_buckets.setdefault((from_reg, to_reg), []).append(days)
    out: Dict[Tuple[str, str], float] = {}
    for k, v in lane_buckets.items():
        v_sorted = sorted(v)
        out[k] = v_sorted[len(v_sorted) // 2]
    return out


def _ext_multiplier(signals: Dict, region: str) -> float:
    if not signals:
        return 1.0
    w = (signals.get("weather") or {}).get("by_region") or {}
    region_signal = w.get(region) or {}
    rainfall = float(region_signal.get("rainfall_mm_7d", 0))
    mult = 1.0
    if rainfall > 50:
        mult += 0.3
    elif rainfall > 25:
        mult += 0.15
    if signals.get("holiday_within_3d"):
        mult += 0.2
    return round(mult, 2)


async def compute_delivery_risk(tenant_id: str) -> dict:
    """Score every in-transit / pending shipment with a delay risk + dynamic ETA."""
    in_flight = await db.shipments.find(
        {"manufacturer_id": {"$in": ["", tenant_id]},
         "status": {"$in": ["in_transit", "pending"]}},
        {"_id": 0},
    ).to_list(5000)
    # Also include dist→retailer shipments where the distributor belongs to this tenant
    if not in_flight:
        # try distributor-scoped
        dist_ids = [d["id"] async for d in db.distributors.find(
            {"manufacturer_id": tenant_id}, {"_id": 0, "id": 1},
        )]
        in_flight = await db.shipments.find(
            {"$or": [{"manufacturer_id": tenant_id},
                     {"from_id": {"$in": dist_ids}}, {"to_id": {"$in": dist_ids}}],
             "status": {"$in": ["in_transit", "pending"]}}, {"_id": 0},
        ).to_list(5000)

    baseline = await _lane_baseline(tenant_id)
    signals_doc = await db.intel_external_signals.find_one({"tenant_id": tenant_id}, {"_id": 0})
    signals = (signals_doc or {}).get("payload") or {}

    dist_region: Dict[str, str] = {}
    async for d in db.distributors.find({"manufacturer_id": tenant_id}, {"_id": 0, "id": 1, "region": 1}):
        dist_region[d["id"]] = d.get("region") or "—"
    rid_region: Dict[str, str] = {}
    async for r in db.retailers.find({}, {"_id": 0, "id": 1, "region": 1, "name": 1, "distributor_id": 1}):
        rid_region[r["id"]] = r.get("region") or "—"

    now = datetime.now(timezone.utc)
    docs: List[dict] = []
    alerts: List[dict] = []
    now_str = now_iso()
    for s in in_flight:
        from_role, to_role = s.get("from_role", ""), s.get("to_role", "")
        from_id, to_id = s.get("from_id", ""), s.get("to_id", "")
        from_reg = "mfg" if from_role == "manufacturer" else dist_region.get(from_id, "—")
        to_reg = dist_region.get(to_id, "—") if to_role == "distributor" else rid_region.get(to_id, "—")
        lane_days = baseline.get((from_reg, to_reg), DEFAULT_LANE_DAYS)
        ext = _ext_multiplier(signals, to_reg)
        expected_days = round(lane_days * ext, 1)
        try:
            dispatched = (s.get("dispatched_at") or s.get("created_at") or now_str)
            dt = datetime.fromisoformat(dispatched.replace("Z", "+00:00"))
        except Exception:
            dt = now
        elapsed = (now - dt).total_seconds() / 86400
        eta_days = max(0, round(expected_days - elapsed, 1))
        eta_date = (now + timedelta(days=eta_days)).date().isoformat()
        risk = "high" if elapsed > expected_days * 1.5 else \
               "medium" if elapsed > expected_days else "low"
        docs.append({
            "id": s["id"],
            "tenant_id": tenant_id,
            "shipment_id": s["id"],
            "tracking_code": s.get("tracking_code", ""),
            "status": s.get("status"),
            "from_role": from_role, "to_role": to_role,
            "from_id": from_id, "to_id": to_id,
            "from_region": from_reg, "to_region": to_reg,
            "lane_baseline_days": round(lane_days, 1),
            "external_multiplier": ext,
            "expected_days": expected_days,
            "elapsed_days": round(elapsed, 1),
            "eta_days": eta_days,
            "eta_date": eta_date,
            "risk": risk,
            "updated_at": now_str,
        })
        if risk == "high":
            alerts.append({
                "id": new_id(),
                "tenant_id": tenant_id,
                "category": "logistics",
                "kind": "delivery_delay",
                "severity": "warning",
                "scope_role": "distributor" if to_role == "distributor" else "retailer",
                "scope_id": to_id,
                "distributor_id": to_id if to_role == "distributor" else "",
                "retailer_id": to_id if to_role == "retailer" else "",
                "title": f"Shipment {s.get('tracking_code', '')} likely late",
                "detail": f"Elapsed {round(elapsed,1)}d vs expected {expected_days}d on {from_reg} → {to_reg}.{' Rain elevating risk.' if ext > 1.15 else ''}",
                "metric": round(elapsed, 1),
                "baseline": expected_days,
                "created_at": now_str,
            })

    await db.intel_delivery_eta.delete_many({"tenant_id": tenant_id})
    if docs:
        await db.intel_delivery_eta.insert_many(docs)
    await db.intel_alerts.delete_many({"tenant_id": tenant_id, "category": "logistics"})
    if alerts:
        await db.intel_alerts.insert_many(alerts)
    return {"shipments": len(docs), "alerts": len(alerts)}
