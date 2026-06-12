"""Phase 3 — AI Delay Prediction Engine (Vertex AI Gemini).

Builds live telemetry features for every active truck, scores delay risk
deterministically, then asks Gemini to reason over the fleet and produce a
per-vehicle delay probability / predicted delay / recommendation. Results
are cached in `delay_predictions` (one doc per manufacturer, TTL ~10 min)
and every new high-risk call emits a `delay_predicted` event into the
logistics event bus so the Control Tower feed sees it too.

Falls back to heuristic-only predictions when Vertex AI is unavailable —
the panel never goes blank.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from core import db, logger, now_iso
from services import vertex_llm
from services.logistics_events import emit

PRED_TTL_MIN = 10
ACTIVE_STATUSES = ["in_transit", "stopped", "breakdown"]

PREDICTION_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "vehicle_code":        {"type": "STRING"},
            "delay_probability":   {"type": "NUMBER"},
            "predicted_delay_min": {"type": "INTEGER"},
            "risk_level":          {"type": "STRING", "enum": ["high", "medium", "low"]},
            "reason":              {"type": "STRING"},
            "recommendation":      {"type": "STRING"},
        },
        "required": ["vehicle_code", "delay_probability", "predicted_delay_min",
                     "risk_level", "reason", "recommendation"],
    },
}

SYSTEM_PROMPT = (
    "You are the delay-prediction engine of a Nigerian FMCG logistics control "
    "tower. You receive live telemetry for every active delivery truck. For "
    "EACH vehicle, estimate the probability (0.0-1.0) that its delivery will "
    "be late, the expected delay in minutes, a risk level, a one-sentence "
    "reason grounded ONLY in the supplied telemetry, and one short, concrete "
    "dispatcher recommendation. Consider: breakdowns and unscheduled stops "
    "are severe; active route deviations and low speed (<40 km/h) raise risk; "
    "many recent exceptions raise risk; low fuel (<20%) raises risk; healthy "
    "trucks cruising on schedule are low risk (probability ≤ 0.15). Return "
    "one entry per vehicle_code, no extras."
)


# ---------------------------------------------------------------------------
def _risk_score(v: Dict[str, Any], exceptions_24h: int) -> int:
    score = 0
    if v.get("status") == "breakdown":
        score += 55
    elif v.get("status") == "stopped":
        score += 30
    if (v.get("deviation") or {}).get("active"):
        score += 25
    if v.get("status") == "in_transit" and (v.get("speed_kmh") or 55) < 40:
        score += 20
    if (v.get("fuel_pct") or 100) < 20:
        score += 15
    score += min(24, exceptions_24h * 8)
    return min(100, score)


def _level(score: int) -> str:
    return "high" if score >= 60 else "medium" if score >= 30 else "low"


async def _fleet_features(mfr: str) -> List[Dict[str, Any]]:
    vehicles = await db.vehicles.find(
        {"manufacturer_id": mfr, "status": {"$in": ACTIVE_STATUSES}},
        {"_id": 0, "route_polyline": 0, "stops": 0}).to_list(60)
    cutoff24 = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    feats = []
    for v in vehicles:
        exc = await db.logistics_events.count_documents(
            {"vehicle_id": v["id"], "severity": {"$in": ["warning", "critical"]},
             "created_at": {"$gte": cutoff24}})
        progress = float(v.get("route_progress") or 0)
        score = _risk_score(v, exc)
        feats.append({
            "vehicle_id": v["id"],
            "vehicle_code": v.get("code"),
            "ref_type": v.get("ref_type"),
            "ref_id": v.get("ref_id"),
            "ref_code": v.get("shipment_code"),
            "dest_name": v.get("dest_name"),
            "driver_name": v.get("driver_name"),
            "status": v.get("status"),
            "progress_pct": round(progress * 100),
            "speed_kmh": v.get("speed_kmh"),
            "fuel_pct": v.get("fuel_pct"),
            "eta_minutes": v.get("eta_minutes"),
            "remaining_km": round(float(v.get("route_km") or 0) * (1 - progress), 1),
            "deviation_active": bool((v.get("deviation") or {}).get("active")),
            "deviation_km": (v.get("deviation") or {}).get("offset_km"),
            "exceptions_24h": exc,
            "units": v.get("units"),
            "heuristic_score": score,
        })
    return feats


def _heuristic_item(f: Dict[str, Any]) -> Dict[str, Any]:
    score = f["heuristic_score"]
    level = _level(score)
    reasons = []
    if f["status"] == "breakdown":
        reasons.append("vehicle breakdown reported")
    if f["status"] == "stopped":
        reasons.append("unscheduled stop in progress")
    if f["deviation_active"]:
        reasons.append(f"{f.get('deviation_km')} km off approved route")
    if f["status"] == "in_transit" and (f.get("speed_kmh") or 55) < 40:
        reasons.append("crawling below 40 km/h")
    if (f.get("fuel_pct") or 100) < 20:
        reasons.append("fuel critically low")
    if f["exceptions_24h"] >= 2:
        reasons.append(f"{f['exceptions_24h']} exceptions in 24h")
    delay = {"high": 0.45, "medium": 0.22, "low": 0.04}[level]
    return {
        "vehicle_code": f["vehicle_code"],
        "delay_probability": round(min(0.95, max(0.05, score / 100)), 2),
        "predicted_delay_min": int((f.get("eta_minutes") or 60) * delay) + (90 if f["status"] == "breakdown" else 0),
        "risk_level": level,
        "reason": (", ".join(reasons) or "cruising on schedule with no exceptions").capitalize(),
        "recommendation": ("Dispatch recovery and reassign cargo" if f["status"] == "breakdown"
                           else "Call the driver to verify the stop" if f["status"] == "stopped"
                           else "Contact driver and monitor closely" if level != "low"
                           else "No action needed"),
    }


async def _vertex_predict(feats: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    payload = [{k: f[k] for k in (
        "vehicle_code", "status", "progress_pct", "speed_kmh", "fuel_pct",
        "eta_minutes", "remaining_km", "deviation_active", "deviation_km",
        "exceptions_24h", "dest_name", "heuristic_score")} for f in feats]
    out = await vertex_llm.complete_json(
        system=SYSTEM_PROMPT,
        user="LIVE FLEET TELEMETRY:\n" + json.dumps(payload, default=str),
        response_schema=PREDICTION_SCHEMA,
        temperature=0.2,
        max_output_tokens=4096,
    )
    if isinstance(out, list) and out:
        return out
    return None


async def refresh_predictions(mfr: str) -> Dict[str, Any]:
    feats = await _fleet_features(mfr)
    source = "heuristic"
    raw: Optional[List[Dict[str, Any]]] = None
    if feats and vertex_llm.is_configured():
        try:
            raw = await _vertex_predict(feats)
            if raw:
                source = "vertex-ai"
        except Exception as e:
            logger.warning("[delay_predictor] Vertex prediction failed (%s) — heuristic fallback", e)
    if raw is None:
        raw = [_heuristic_item(f) for f in feats]

    by_code = {f["vehicle_code"]: f for f in feats}
    items: List[Dict[str, Any]] = []
    for it in raw:
        f = by_code.get(it.get("vehicle_code"))
        if not f:
            continue
        level = it.get("risk_level")
        if level not in ("high", "medium", "low"):
            level = _level(f["heuristic_score"])
        try:
            prob = max(0.0, min(1.0, float(it.get("delay_probability") or 0)))
        except (TypeError, ValueError):
            prob = f["heuristic_score"] / 100
        try:
            delay_min = max(0, int(it.get("predicted_delay_min") or 0))
        except (TypeError, ValueError):
            delay_min = 0
        items.append({
            "vehicle_id": f["vehicle_id"], "vehicle_code": f["vehicle_code"],
            "ref_type": f["ref_type"], "ref_id": f["ref_id"], "ref_code": f["ref_code"],
            "dest_name": f["dest_name"], "driver_name": f["driver_name"],
            "status": f["status"], "progress_pct": f["progress_pct"],
            "eta_minutes": f["eta_minutes"], "units": f["units"],
            "risk_level": level,
            "probability": round(prob, 2),
            "predicted_delay_min": delay_min,
            "reason": str(it.get("reason") or "")[:300],
            "recommendation": str(it.get("recommendation") or "")[:200],
            "features": {k: f[k] for k in (
                "speed_kmh", "fuel_pct", "remaining_km", "deviation_active",
                "exceptions_24h", "heuristic_score")},
        })
    order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda x: (order[x["risk_level"]], -x["probability"]))

    doc = {
        "id": str(uuid.uuid4()), "manufacturer_id": mfr,
        "items": items, "source": source,
        "counts": {lv: sum(1 for i in items if i["risk_level"] == lv)
                   for lv in ("high", "medium", "low")},
        "fleet_scored": len(items),
        "created_at": now_iso(),
    }
    await db.delay_predictions.delete_many({"manufacturer_id": mfr})
    await db.delay_predictions.insert_one(dict(doc))

    # High-risk predictions enter the event bus (deduped per vehicle/hour).
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=60)).isoformat()
    for it in items:
        if it["risk_level"] != "high":
            continue
        recent = await db.logistics_events.find_one(
            {"manufacturer_id": mfr, "event_type": "delay_predicted",
             "vehicle_id": it["vehicle_id"], "created_at": {"$gte": cutoff}},
            {"_id": 1})
        if recent:
            continue
        await emit(mfr, "delay_predicted",
                   f"AI predicts delay for truck {it['vehicle_code']}",
                   f"{int(it['probability'] * 100)}% probability · "
                   f"~{it['predicted_delay_min']} min late → {it.get('dest_name')} · "
                   f"{it['reason']}",
                   vehicle_id=it["vehicle_id"], vehicle_code=it["vehicle_code"],
                   ref_code=it.get("ref_code"),
                   meta={"probability": it["probability"],
                         "predicted_delay_min": it["predicted_delay_min"],
                         "source": source})
    doc.pop("_id", None)
    return doc


async def get_predictions(mfr: str, force: bool = False) -> Dict[str, Any]:
    if not force:
        latest = await db.delay_predictions.find_one(
            {"manufacturer_id": mfr}, {"_id": 0}, sort=[("created_at", -1)])
        if latest:
            try:
                age_min = (datetime.now(timezone.utc) - datetime.fromisoformat(
                    latest["created_at"].replace("Z", "+00:00"))).total_seconds() / 60
                if age_min < PRED_TTL_MIN:
                    return latest
            except (ValueError, TypeError, KeyError):
                pass
    return await refresh_predictions(mfr)
