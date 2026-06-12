"""Phase 3 — Logistics AI: delay predictions, copilot chat, demand↔delivery.

  GET  /api/logistics/predictions        — AI delay-risk scoring of the fleet
  POST /api/logistics/copilot/chat       — multi-turn grounded copilot (Gemini)
  GET  /api/logistics/copilot/history    — session transcript
  GET  /api/logistics/demand-delivery    — region-level demand↔delivery correlation
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from routes.allocation import _scope_manufacturer
from routes.control_tower import _cover_days, _units_by_owner
from services import vertex_llm
from services.copilot_actions import (ACTION_TYPES, build_action_context,
                                      execute_action)
from services.auth import get_current_user
from services.delay_predictor import get_predictions

router = APIRouter()

DD_TTL_MIN = 15


# ===========================================================================
# Delay predictions
# ===========================================================================
@router.get("/logistics/predictions")
async def delay_predictions(refresh: bool = False,
                            manufacturer_id: Optional[str] = None,
                            user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    return await get_predictions(mfr, force=refresh)


# ===========================================================================
# Logistics Copilot — multi-turn, grounded in live control-tower data
# ===========================================================================
class CopilotIn(BaseModel):
    message: str
    session_id: Optional[str] = None
    manufacturer_id: Optional[str] = None


COPILOT_SYSTEM = (
    "You are \"Konekt Copilot\", the AI logistics co-pilot for {mfr_name} on the "
    "TradeKonekt supply-chain platform. Today is {today}.\n"
    "You see LIVE control-tower data below. Answer dispatcher questions about "
    "the fleet, shipments, planned routes, exceptions, delay risk and delivery "
    "performance.\n"
    "Rules:\n"
    "- Ground every answer ONLY in the context; never invent numbers.\n"
    "- Cite truck codes (TK-xxx), route codes (RT-xxx) and tracking codes.\n"
    "- Be concise: max ~150 words, short bullet points where helpful.\n"
    "- If the answer isn't in the context, say so and name the data you'd need.\n"
    "- Severity matters: lead with breakdowns, deviations and high delay risk.\n\n"
    "ACTIONS YOU CAN TAKE (executed only after the dispatcher confirms in chat):\n"
    "1. reroute_vehicle — recompute the road route for a truck from its current "
    "position (fixes deviations, refreshes the ETA). Needs vehicle_code.\n"
    "2. resolve_exception — clear a breakdown / unscheduled stop / deviation and "
    "put the truck back in transit. Needs vehicle_code.\n"
    "3. dispatch_adhoc — create and dispatch a new delivery route from a "
    "warehouse to a distributor or wholesaler. Needs warehouse_id, dest_id and "
    "items [{{product_id, quantity}}] — use the EXACT ids listed under "
    "ACTIONABLE ENTITIES, never names. If the user gives no quantity, propose "
    "100 units per product and say so in your reply. If no warehouse is named, "
    "pick the first listed warehouse and say which one you chose.\n"
    "4. acknowledge_events — mark every open control-tower event as acknowledged.\n"
    "When the user asks you to DO one of these things, fill `action` with the "
    "params plus a one-line `summary`, and use `reply` to explain what you are "
    "about to do and that it awaits their confirmation. NEVER claim an action "
    "is already done — the system executes it only after the user confirms. "
    "For pure questions set `action` to null.\n\n"
    "LIVE CONTEXT:\n{context}"
)

COPILOT_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reply": {"type": "STRING"},
        "action": {
            "type": "OBJECT",
            "nullable": True,
            "properties": {
                "type": {"type": "STRING",
                         "enum": ["reroute_vehicle", "resolve_exception",
                                  "dispatch_adhoc", "acknowledge_events"]},
                "summary": {"type": "STRING"},
                "vehicle_code": {"type": "STRING", "nullable": True},
                "warehouse_id": {"type": "STRING", "nullable": True},
                "dest_id": {"type": "STRING", "nullable": True},
                "items": {
                    "type": "ARRAY", "nullable": True,
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "product_id": {"type": "STRING"},
                            "quantity": {"type": "INTEGER"},
                        },
                        "required": ["product_id", "quantity"],
                    },
                },
            },
            "required": ["type", "summary"],
        },
    },
    "required": ["reply"],
}


def _validate_action(raw: Optional[Dict[str, Any]], mfr: str,
                     session_id: str) -> Optional[Dict[str, Any]]:
    """Turn the model's action payload into a persistable proposal, or None."""
    if not isinstance(raw, dict) or raw.get("type") not in ACTION_TYPES:
        return None
    atype = raw["type"]
    params: Dict[str, Any] = {}
    for k in ("vehicle_code", "warehouse_id", "dest_id"):
        if raw.get(k):
            params[k] = str(raw[k]).strip()
    if isinstance(raw.get("items"), list):
        items = [{"product_id": str(i.get("product_id")),
                  "quantity": int(i.get("quantity") or 0)}
                 for i in raw["items"] if isinstance(i, dict) and i.get("product_id")]
        items = [i for i in items if i["quantity"] > 0]
        if items:
            params["items"] = items
    ok = (atype == "acknowledge_events"
          or (atype in ("reroute_vehicle", "resolve_exception")
              and params.get("vehicle_code"))
          or (atype == "dispatch_adhoc" and params.get("warehouse_id")
              and params.get("dest_id") and params.get("items")))
    if not ok:
        return None
    return {"id": str(uuid.uuid4()), "manufacturer_id": mfr,
            "session_id": session_id, "type": atype, "params": params,
            "summary": str(raw.get("summary") or atype.replace("_", " ")).strip()[:240],
            "status": "proposed", "result": None,
            "created_at": now_iso(), "executed_at": None}


async def _copilot_context(mfr: str) -> str:
    parts: List[str] = []

    vehicles = await db.vehicles.find(
        {"manufacturer_id": mfr},
        {"_id": 0, "code": 1, "status": 1, "driver_name": 1, "dest_name": 1,
         "route_progress": 1, "eta_minutes": 1, "speed_kmh": 1, "fuel_pct": 1,
         "shipment_code": 1, "deviation": 1, "units": 1}).to_list(80)
    active = [v for v in vehicles if v.get("status") != "idle"]
    parts.append(f"FLEET: {len(active)} active / {len(vehicles)} trucks "
                 f"({sum(1 for v in active if v['status'] == 'breakdown')} breakdown, "
                 f"{sum(1 for v in active if v['status'] == 'stopped')} stopped)")
    for v in active[:25]:
        dev = " DEVIATION" if (v.get("deviation") or {}).get("active") else ""
        parts.append(
            f"- {v.get('code')} [{v.get('status')}{dev}] ref {v.get('shipment_code')} → "
            f"{v.get('dest_name')} · {round(float(v.get('route_progress') or 0) * 100)}% · "
            f"ETA {v.get('eta_minutes')}min · {v.get('speed_kmh')}km/h · "
            f"fuel {v.get('fuel_pct')}% · driver {v.get('driver_name')} · "
            f"{v.get('units') or 0} units")

    cutoff14 = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    counts: Dict[str, int] = {}
    async for row in db.shipments.aggregate([
            {"$match": {"manufacturer_id": mfr, "created_at": {"$gte": cutoff14}}},
            {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        counts[row["_id"] or "unknown"] = row["n"]
    parts.append("SHIPMENTS (14d): " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    routes = await db.planned_routes.find(
        {"manufacturer_id": mfr}, {"_id": 0, "polyline": 0},
    ).sort("created_at", -1).to_list(8)
    if routes:
        parts.append("PLANNED ROUTES (latest):")
        for r in routes:
            done = sum(1 for st in (r.get("stops") or []) if st.get("status") == "delivered")
            parts.append(f"- {r.get('code')} [{r.get('status')}] {r.get('vehicle_code')} · "
                         f"{done}/{len(r.get('stops') or [])} stops delivered · "
                         f"{r.get('total_km')} km · origin {r.get('origin_name')}")

    events = await db.logistics_events.find(
        {"manufacturer_id": mfr}, {"_id": 0, "severity": 1, "title": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(15)
    if events:
        parts.append("RECENT EVENTS:")
        for e in events:
            parts.append(f"- [{e.get('severity')}] {e.get('title')} "
                         f"({(e.get('created_at') or '')[11:16]} UTC)")

    pred = await db.delay_predictions.find_one(
        {"manufacturer_id": mfr}, {"_id": 0}, sort=[("created_at", -1)])
    if pred and pred.get("items"):
        parts.append(f"AI DELAY PREDICTIONS ({pred.get('source')}):")
        for it in pred["items"][:8]:
            parts.append(f"- {it['vehicle_code']}: {it['risk_level']} risk, "
                         f"{int(it['probability'] * 100)}%, ~{it['predicted_delay_min']}min late "
                         f"— {it['reason']}")

    dists = [d async for d in db.distributors.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1, "name": 1, "region": 1})]
    dist_units = await _units_by_owner("distributor", [d["id"] for d in dists])
    risky = []
    for d in dists:
        agg = dist_units.get(d["id"])
        if not agg:
            continue
        cover = _cover_days(agg["units"], agg["velocity"])
        if cover is not None and cover < 7:
            risky.append((cover, f"- {d['name']} ({d.get('region')}): "
                                 f"{agg['units']:,} units, {cover}d cover"))
    if risky:
        parts.append("DISTRIBUTORS AT STOCK RISK (<7d cover):")
        parts.extend(t for _, t in sorted(risky)[:6])

    return "\n".join(parts)[:14000]


@router.post("/logistics/copilot/chat")
async def copilot_chat(payload: CopilotIn,
                       user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, payload.manufacturer_id)
    if not vertex_llm.is_configured():
        raise HTTPException(503, "Copilot unavailable: Vertex AI is not configured")
    message = (payload.message or "").strip()[:2000]
    if not message:
        raise HTTPException(400, "Message is required")
    session_id = payload.session_id or f"copilot-{user.get('id')}"

    org = await db.organizations.find_one({"id": mfr}, {"_id": 0, "organization_name": 1})
    context = await _copilot_context(mfr)
    action_ctx = await build_action_context(mfr)
    system = COPILOT_SYSTEM.format(
        mfr_name=(org or {}).get("organization_name") or "the manufacturer",
        today=datetime.now(timezone.utc).date().isoformat(),
        context=context + "\n\n" + action_ctx)

    rows = await db.copilot_messages.find(
        {"manufacturer_id": mfr, "session_id": session_id},
        {"_id": 0, "role": 1, "content": 1},
    ).sort("created_at", -1).to_list(12)
    history = [{"role": r["role"] if r["role"] == "user" else "model",
                "content": r["content"]} for r in reversed(rows)]

    reply = ""
    raw_action: Optional[Dict[str, Any]] = None
    try:
        data = await vertex_llm.complete_json(
            system=system, user=message, history=history,
            response_schema=COPILOT_SCHEMA, temperature=0.4,
            max_output_tokens=1400)
        if isinstance(data, dict):
            reply = str(data.get("reply") or "").strip()
            raw_action = data.get("action") if isinstance(data.get("action"), dict) else None
    except Exception as e:
        msg = str(e)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            raise HTTPException(503, "Copilot is briefly busy (AI rate limit). Try again in a minute.")
        logger.warning("[copilot] structured chat failed (%s) — plain fallback", e)
        try:
            reply = await vertex_llm.complete(
                system=system, user=message, history=history,
                temperature=0.4, max_output_tokens=900)
        except Exception as e2:
            logger.exception("[copilot] chat failed")
            raise HTTPException(502, f"Copilot error: {e2}")

    action_doc = _validate_action(raw_action, mfr, session_id)
    if action_doc:
        await db.copilot_actions.insert_one(dict(action_doc))
        action_doc.pop("_id", None)
    if not reply:
        reply = (f"I can do that: {action_doc['summary']} — confirm below to execute."
                 if action_doc else
                 "I couldn't produce an answer for that — try rephrasing.")

    now = now_iso()
    await db.copilot_messages.insert_many([
        {"id": str(uuid.uuid4()), "manufacturer_id": mfr, "session_id": session_id,
         "role": "user", "content": message, "created_at": now},
        {"id": str(uuid.uuid4()), "manufacturer_id": mfr, "session_id": session_id,
         "role": "assistant", "content": reply,
         "action_id": (action_doc or {}).get("id"), "created_at": now_iso()},
    ])
    return {"reply": reply, "action": action_doc, "session_id": session_id,
            "model": vertex_llm.DEFAULT_MODEL, "provider": "vertex-ai"}


@router.get("/logistics/copilot/history")
async def copilot_history(session_id: Optional[str] = None,
                          manufacturer_id: Optional[str] = None,
                          user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    sid = session_id or f"copilot-{user.get('id')}"
    messages = await db.copilot_messages.find(
        {"manufacturer_id": mfr, "session_id": sid},
        {"_id": 0, "role": 1, "content": 1, "created_at": 1, "action_id": 1},
    ).sort("created_at", 1).to_list(60)
    act_ids = [m["action_id"] for m in messages if m.get("action_id")]
    actions: Dict[str, Dict[str, Any]] = {}
    if act_ids:
        async for a in db.copilot_actions.find(
                {"id": {"$in": act_ids}}, {"_id": 0}):
            actions[a["id"]] = a
    for m in messages:
        aid = m.pop("action_id", None)
        if aid and aid in actions:
            m["action"] = actions[aid]
    return {"session_id": sid, "messages": messages}


# ===========================================================================
# Copilot actions — confirm-before-execute
# ===========================================================================
@router.post("/logistics/copilot/actions/{action_id}/execute")
async def copilot_execute_action(action_id: str,
                                 user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, None)
    a = await db.copilot_actions.find_one(
        {"id": action_id, "manufacturer_id": mfr}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Action not found")
    if a["status"] == "executed":
        return {"action": a}  # idempotent
    if a["status"] == "dismissed":
        raise HTTPException(400, "This action was dismissed")
    try:
        result = await execute_action(mfr, user, a)
        a.update({"status": "executed", "result": result,
                  "executed_at": now_iso()})
    except HTTPException as e:
        a.update({"status": "failed", "result": {"message": str(e.detail)},
                  "executed_at": now_iso()})
    except Exception as e:
        logger.exception("[copilot] action %s failed", action_id)
        a.update({"status": "failed", "result": {"message": str(e)},
                  "executed_at": now_iso()})
    await db.copilot_actions.update_one(
        {"id": action_id},
        {"$set": {k: a[k] for k in ("status", "result", "executed_at")}})
    return {"action": a}


@router.post("/logistics/copilot/actions/{action_id}/dismiss")
async def copilot_dismiss_action(action_id: str,
                                 user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, None)
    a = await db.copilot_actions.find_one(
        {"id": action_id, "manufacturer_id": mfr}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Action not found")
    if a["status"] == "proposed":
        a["status"] = "dismissed"
        await db.copilot_actions.update_one(
            {"id": action_id}, {"$set": {"status": "dismissed"}})
    return {"action": a}


# ===========================================================================
# Demand ↔ Delivery correlation
# ===========================================================================
DD_INSIGHT_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "region":   {"type": "STRING"},
            "severity": {"type": "STRING", "enum": ["high", "medium", "info"]},
            "headline": {"type": "STRING"},
            "detail":   {"type": "STRING"},
        },
        "required": ["region", "severity", "headline", "detail"],
    },
}


async def _demand_delivery_regions(mfr: str) -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    d7 = (now - timedelta(days=7)).date().isoformat()
    d14 = (now - timedelta(days=14)).date().isoformat()
    cutoff30 = (now - timedelta(days=30)).isoformat()

    # Region maps -----------------------------------------------------------
    dist_region: Dict[str, str] = {}
    async for d in db.distributors.find({"manufacturer_id": mfr},
                                        {"_id": 0, "id": 1, "region": 1}):
        dist_region[d["id"]] = d.get("region") or "Unknown"
    org_region: Dict[str, str] = {}
    async for o in db.organizations.find(
            {"organization_type": "wholesaler",
             "parent_organization_id": {"$in": list(dist_region.keys())}},
            {"_id": 0, "id": 1, "region": 1, "parent_organization_id": 1}):
        org_region[o["id"]] = (o.get("region")
                               or dist_region.get(o.get("parent_organization_id"))
                               or "Unknown")

    # Demand: retail sell-through by region, last 7d vs prior 7d ------------
    ret_units: Dict[str, Dict[str, int]] = {}
    async for row in db.daily_sales.aggregate([
            {"$match": {"manufacturer_id": mfr, "date": {"$gte": d14}}},
            {"$group": {"_id": {"r": "$retailer_id",
                                "recent": {"$gte": ["$date", d7]}},
                        "units": {"$sum": "$units"}}}]):
        rid = row["_id"].get("r")
        key = "recent" if row["_id"].get("recent") else "prev"
        ret_units.setdefault(rid, {"recent": 0, "prev": 0})[key] += int(row["units"] or 0)
    ret_region: Dict[str, str] = {}
    if ret_units:
        async for r in db.retailers.find({"id": {"$in": list(ret_units.keys())}},
                                         {"_id": 0, "id": 1, "region": 1}):
            ret_region[r["id"]] = r.get("region") or "Unknown"

    demand: Dict[str, Dict[str, int]] = {}
    for rid, vals in ret_units.items():
        reg = ret_region.get(rid, "Unknown")
        bucket = demand.setdefault(reg, {"recent": 0, "prev": 0})
        bucket["recent"] += vals["recent"]
        bucket["prev"] += vals["prev"]

    # Delivery: shipments dispatched in 30d, by destination region ----------
    delivery: Dict[str, Dict[str, Any]] = {}
    async for s in db.shipments.find(
            {"manufacturer_id": mfr, "dispatched_at": {"$gte": cutoff30}},
            {"_id": 0, "status": 1, "to_id": 1, "dispatched_at": 1, "received_at": 1}):
        reg = dist_region.get(s.get("to_id")) or org_region.get(s.get("to_id")) or "Unknown"
        b = delivery.setdefault(reg, {"dispatched": 0, "received": 0,
                                      "lead_hours": [], "in_transit": 0, "delayed": 0})
        b["dispatched"] += 1
        st = s.get("status")
        if st in ("in_transit",):
            b["in_transit"] += 1
        elif st == "delayed":
            b["delayed"] += 1
            b["in_transit"] += 1
        elif st in ("received", "delivered", "completed"):
            b["received"] += 1
            try:
                dt0 = datetime.fromisoformat(s["dispatched_at"].replace("Z", "+00:00"))
                dt1 = datetime.fromisoformat(s["received_at"].replace("Z", "+00:00"))
                b["lead_hours"].append((dt1 - dt0).total_seconds() / 3600)
            except (KeyError, AttributeError, ValueError, TypeError):
                pass

    # Stock cover: distributor inventory by region. Velocity is often not
    # tracked at distributor level — fall back to retail daily demand.
    dist_units = await _units_by_owner("distributor", list(dist_region.keys()))
    region_units: Dict[str, int] = {}
    region_velocity: Dict[str, float] = {}
    for did, reg in dist_region.items():
        agg = dist_units.get(did)
        if not agg:
            continue
        region_units[reg] = region_units.get(reg, 0) + agg["units"]
        region_velocity[reg] = region_velocity.get(reg, 0.0) + agg["velocity"]

    regions = sorted((set(demand) | set(delivery) | set(region_units)) - {"Unknown"})
    rows = []
    for reg in regions:
        dm = demand.get(reg, {"recent": 0, "prev": 0})
        dl = delivery.get(reg, {"dispatched": 0, "received": 0,
                                "lead_hours": [], "in_transit": 0, "delayed": 0})
        trend = (round((dm["recent"] - dm["prev"]) / dm["prev"] * 100, 1)
                 if dm["prev"] > 0 else (100.0 if dm["recent"] else 0.0))
        leads = dl["lead_hours"]
        avg_lead_h = round(sum(leads) / len(leads), 1) if leads else None
        daily_demand = region_velocity.get(reg) or (dm["recent"] / 7 if dm["recent"] else 0)
        avg_cover = (round(region_units[reg] / daily_demand, 1)
                     if reg in region_units and daily_demand > 0 else None)
        delayed_share = round(dl["delayed"] / dl["in_transit"], 2) if dl["in_transit"] else 0.0

        stressed = (delayed_share > 0.3
                    or (avg_cover is not None and avg_cover < 7)
                    or (avg_lead_h is not None and avg_lead_h > 96))
        if trend > 10 and stressed:
            pressure = "at_risk"
        elif (trend > 0 and stressed) or delayed_share > 0.5:
            pressure = "watch"
        else:
            pressure = "healthy"
        rows.append({
            "region": reg,
            "demand_units_7d": dm["recent"],
            "demand_trend_pct": trend,
            "deliveries_30d": dl["dispatched"],
            "avg_lead_hours": avg_lead_h,
            "in_transit_now": dl["in_transit"],
            "delayed_now": dl["delayed"],
            "delayed_share": delayed_share,
            "stock_cover_days": avg_cover,
            "pressure": pressure,
        })
    order = {"at_risk": 0, "watch": 1, "healthy": 2}
    rows.sort(key=lambda r: (order[r["pressure"]], -r["demand_units_7d"]))
    return rows


def _dd_fallback_insights(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for r in rows:
        if r["pressure"] == "healthy":
            continue
        bits = []
        if r["demand_trend_pct"] > 0:
            bits.append(f"demand up {r['demand_trend_pct']}% week-over-week")
        if r["delayed_now"]:
            bits.append(f"{r['delayed_now']} shipment(s) currently delayed")
        if r["stock_cover_days"] is not None and r["stock_cover_days"] < 7:
            bits.append(f"only {r['stock_cover_days']}d of distributor stock cover")
        out.append({
            "region": r["region"],
            "severity": "high" if r["pressure"] == "at_risk" else "medium",
            "headline": f"{r['region']}: demand outpacing delivery",
            "detail": (", ".join(bits) or "delivery performance lagging demand").capitalize() + ".",
        })
    if not out:
        out.append({"region": "Network", "severity": "info",
                    "headline": "Demand and delivery are in balance",
                    "detail": "No region shows demand growth outpacing delivery capacity right now."})
    return out[:4]


@router.get("/logistics/demand-delivery")
async def demand_delivery(refresh: bool = False,
                          manufacturer_id: Optional[str] = None,
                          user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    if not refresh:
        cached = await db.dd_insights.find_one(
            {"manufacturer_id": mfr}, {"_id": 0}, sort=[("created_at", -1)])
        if cached:
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(
                    cached["created_at"].replace("Z", "+00:00"))).total_seconds() / 60
                if age < DD_TTL_MIN:
                    return cached
            except (ValueError, TypeError, KeyError):
                pass

    rows = await _demand_delivery_regions(mfr)
    insights = None
    source = "heuristic"
    if rows and vertex_llm.is_configured():
        try:
            insights = await vertex_llm.complete_json(
                system=("You are a supply-chain analyst for a Nigerian FMCG "
                        "manufacturer. Given region-level demand vs delivery "
                        "data (demand_units_7d with week-over-week trend, "
                        "deliveries, lead times, delays, stock cover days), "
                        "write 2-4 sharp insights correlating demand "
                        "momentum with delivery performance and stock cover. "
                        "Flag regions where rising demand meets delivery "
                        "stress first. Be specific with the numbers given. "
                        "Do not invent data."),
                user="REGION DATA:\n" + json.dumps(rows, default=str),
                response_schema=DD_INSIGHT_SCHEMA,
                temperature=0.3,
                max_output_tokens=2048,
            )
            if isinstance(insights, list) and insights:
                source = "vertex-ai"
            else:
                insights = None
        except Exception as e:
            logger.warning("[demand-delivery] Vertex insights failed (%s)", e)
    if insights is None:
        insights = _dd_fallback_insights(rows)

    doc = {"id": str(uuid.uuid4()), "manufacturer_id": mfr,
           "regions": rows, "insights": insights[:4], "source": source,
           "created_at": now_iso()}
    await db.dd_insights.delete_many({"manufacturer_id": mfr})
    await db.dd_insights.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc
