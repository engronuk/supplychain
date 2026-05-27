"""Proactive Intelligence Layer — public API endpoints.

All endpoints are tenant-scoped: callers pass role + entity_id, we resolve
the tenant_id and apply role-aware visibility filters. Recommendations are
read-only (no execute endpoint by design — POC safety).
"""
from __future__ import annotations

import json as _json
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from core import db, logger, now_iso
from services.intel.narrator import generate_exec_summary, generate_feed
from services.intel.scheduler import run_initial_pass
from services.intel.scoping import resolve_tenant, tenant_filter

router = APIRouter()

VALID_ROLES = ("manufacturer", "distributor", "retailer")


async def _tenant_or_404(role: str, entity_id: str) -> str:
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role '{role}'")
    tid = await resolve_tenant(role, entity_id)
    if not tid:
        raise HTTPException(404, "Tenant not found for role/entity_id")
    return tid


# ============================================================================
# Live ecosystem feed
# ============================================================================
@router.get("/intel/feed")
async def intel_feed(role: str, entity_id: str, limit: int = Query(20, ge=1, le=80)):
    tid = await _tenant_or_404(role, entity_id)
    # Look up the scope-specific feed first; fall back to on-demand generation
    items = await db.intel_insights.find(
        {"tenant_id": tid, "scope_role": role, "scope_id": entity_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit).to_list(limit)
    if not items:
        items = await generate_feed(tid, role, entity_id)
        items = items[:limit]
    return {"items": items, "tenant_id": tid, "scope_role": role,
            "scope_id": entity_id, "as_of": now_iso()}


# ============================================================================
# Executive summary widget
# ============================================================================
@router.get("/intel/exec-summary")
async def intel_exec_summary(role: str, entity_id: str):
    tid = await _tenant_or_404(role, entity_id)
    cached = await db.intel_executive_summaries.find_one(
        {"tenant_id": tid, "scope_role": role, "scope_id": entity_id}, {"_id": 0},
    )
    if cached:
        return cached
    return await generate_exec_summary(tid, role, entity_id)


@router.post("/intel/exec-summary/regenerate")
async def intel_exec_summary_regen(role: str, entity_id: str):
    tid = await _tenant_or_404(role, entity_id)
    return await generate_exec_summary(tid, role, entity_id, ttl_seconds=10)


# ============================================================================
# Stock exhaustion forecasts
# ============================================================================
@router.get("/intel/forecasts/stockout")
async def intel_forecasts(
    role: str, entity_id: str,
    urgency: Optional[str] = None,
    region: Optional[str] = None,
    distributor_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
):
    tid = await _tenant_or_404(role, entity_id)
    flt: Dict[str, Any] = {"tenant_id": tid}
    if urgency:
        flt["urgency"] = urgency
    if region:
        flt["region"] = region
    if distributor_id:
        flt["distributor_id"] = distributor_id
    if role == "distributor":
        flt["distributor_id"] = entity_id
    elif role == "retailer":
        flt["retailer_id"] = entity_id
    rows = await db.intel_forecasts.find(flt, {"_id": 0}).sort("days_remaining", 1).limit(limit).to_list(limit)
    # Region rollup
    region_rollup: Dict[str, dict] = {}
    for f in rows:
        r = region_rollup.setdefault(f.get("region") or "—", {
            "region": f.get("region") or "—",
            "at_risk_shops": 0, "critical": 0,
        })
        r["at_risk_shops"] += 1
        if f["urgency"] == "critical":
            r["critical"] += 1
    return {
        "rows": rows,
        "region_rollup": sorted(region_rollup.values(), key=lambda x: -x["at_risk_shops"]),
        "total": len(rows),
    }


# ============================================================================
# Alerts
# ============================================================================
@router.get("/intel/alerts")
async def intel_alerts(
    role: str, entity_id: str,
    category: Optional[str] = None,
    severity: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
):
    tid = await _tenant_or_404(role, entity_id)
    flt = await tenant_filter(tid, role, entity_id)
    if category:
        flt["category"] = category
    if severity:
        flt["severity"] = severity
    rows = await db.intel_alerts.find(flt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"rows": rows, "total": len(rows)}


# ============================================================================
# Recommendations
# ============================================================================
@router.get("/intel/recommendations")
async def intel_recommendations(
    role: str, entity_id: str,
    urgency: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
):
    tid = await _tenant_or_404(role, entity_id)
    flt = await tenant_filter(tid, role, entity_id)
    if urgency:
        flt["urgency"] = urgency
    if category:
        flt["category"] = category
    rows = await db.intel_recommendations.find(flt, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"rows": rows, "total": len(rows)}


class RecAck(BaseModel):
    status: str = "acknowledged"


@router.patch("/intel/recommendations/{rec_id}")
async def intel_rec_ack(rec_id: str, role: str, entity_id: str, payload: RecAck):
    """Mark a recommendation as acknowledged (read-only; no auto-execute)."""
    tid = await _tenant_or_404(role, entity_id)
    res = await db.intel_recommendations.update_one(
        {"id": rec_id, "tenant_id": tid},
        {"$set": {"status": payload.status, "ack_role": role,
                  "ack_entity_id": entity_id, "ack_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Recommendation not found")
    return {"ok": True, "status": payload.status}


# ============================================================================
# Retailer health
# ============================================================================
@router.get("/intel/retailer-health")
async def intel_retailer_health(
    role: str, entity_id: str,
    churn_risk: Optional[str] = None,
    limit: int = Query(200, ge=1, le=2000),
):
    tid = await _tenant_or_404(role, entity_id)
    flt: Dict[str, Any] = {"tenant_id": tid}
    if churn_risk:
        flt["churn_risk"] = churn_risk
    if role == "distributor":
        flt["distributor_id"] = entity_id
    elif role == "retailer":
        flt["retailer_id"] = entity_id
    rows = await db.intel_retailer_health.find(flt, {"_id": 0}).sort("health_score", 1).limit(limit).to_list(limit)
    return {"rows": rows, "total": len(rows)}


# ============================================================================
# Delivery ETAs
# ============================================================================
@router.get("/intel/delivery-eta")
async def intel_delivery_eta(role: str, entity_id: str, risk: Optional[str] = None):
    tid = await _tenant_or_404(role, entity_id)
    flt: Dict[str, Any] = {"tenant_id": tid}
    if risk:
        flt["risk"] = risk
    if role == "distributor":
        flt["$or"] = [{"from_id": entity_id}, {"to_id": entity_id}]
    elif role == "retailer":
        flt["to_id"] = entity_id
    rows = await db.intel_delivery_eta.find(flt, {"_id": 0}).sort("eta_days", 1).limit(500).to_list(500)
    return {"rows": rows, "total": len(rows)}


# ============================================================================
# External signals (weather + holidays)
# ============================================================================
@router.get("/intel/external")
async def intel_external(role: str, entity_id: str):
    tid = await _tenant_or_404(role, entity_id)
    doc = await db.intel_external_signals.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    return doc


# ============================================================================
# Manual recompute (debug / on-demand)
# ============================================================================
@router.post("/intel/recompute")
async def intel_recompute(role: str = "manufacturer", entity_id: Optional[str] = None):
    """Force a full recompute pass. If entity_id is omitted, runs across all tenants."""
    if entity_id and role in VALID_ROLES:
        tid = await _tenant_or_404(role, entity_id)
        from services.intel.scheduler import (
            detect_anomalies, compute_stock_exhaustion, compute_delivery_risk,
            score_retailers, generate_recommendations, refresh_external_signals,
        )
        await refresh_external_signals(tid)
        await compute_stock_exhaustion(tid)
        await detect_anomalies(tid)
        await score_retailers(tid)
        await compute_delivery_risk(tid)
        await generate_recommendations(tid)
        await generate_feed(tid, role, entity_id, ttl_seconds=60)
        await generate_exec_summary(tid, role, entity_id, ttl_seconds=60)
        return {"ok": True, "tenant_id": tid, "scope_role": role, "scope_id": entity_id}
    await run_initial_pass()
    return {"ok": True, "scope": "all tenants"}


# ============================================================================
# Unified Sabi — role-aware copilot (manufacturer / distributor / retailer)
# ============================================================================
class CopilotMsg(BaseModel):
    role: str
    entity_id: str
    message: str
    history: List[Dict[str, str]] = []
    session_id: Optional[str] = None


@router.post("/intel/copilot")
async def intel_copilot(payload: CopilotMsg):
    """Sabi as an executive copilot for all roles.

    The retailer-only assistant remains at /api/retailer/{id}/assistant (with
    Sales Book actions). This endpoint is the BI/exec voice: it answers
    natural-language questions over the intel layer + ecosystem state, with
    tenant scoping enforced.
    """
    tid = await _tenant_or_404(payload.role, payload.entity_id)
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "Copilot unavailable: missing LLM key")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"emergentintegrations unavailable: {e}")

    # Build a compact tenant-scoped context bundle the LLM can consult.
    ctx = await _copilot_context(tid, payload.role, payload.entity_id)
    role_phrase = {
        "manufacturer": "you are advising the manufacturer's central operations team",
        "distributor": "you are advising the distributor's regional operations team",
        "retailer": "you are advising the retailer's owner",
    }[payload.role]
    system = (
        f"You are 'Sabi', the executive copilot for TradeKonekt's proactive intelligence layer. "
        f"{role_phrase}. Be brief, factual, and concrete. Use Nigerian Naira (₦). "
        f"NEVER invent numbers — use only those in the ECOSYSTEM JSON. "
        f"NEVER mention other tenants by name. If asked about competitors or other brands "
        f"reply 'I can only see this tenant's data.' Keep responses under 200 words "
        f"unless the user explicitly asks for a long-form plan. "
        f"You may end with a single fenced JSON block ```json{{\"action\":...}}``` ONLY if the "
        f"user explicitly asks to do something (eg 'mark as actioned')."
    )
    # Light auto-routing: cheap by default, complex queries get Sonnet.
    text_for_routing = payload.message or ""
    use_sonnet = (
        len(text_for_routing) > 280
        or bool(re.search(
            r"\b(draft|create|prepare|build|design|generate|forecast|projection|strategy|roadmap)\b",
            text_for_routing, re.IGNORECASE,
        ))
        or re.search(r"\b\d+[-\s]?day\b", text_for_routing) is not None
    )
    provider, model = (
        ("anthropic", "claude-sonnet-4-5-20250929") if use_sonnet
        else ("gemini", "gemini-2.5-flash")
    )

    session_id = payload.session_id or f"intel-copilot-{tid}-{payload.role}-{payload.entity_id}"
    chat = LlmChat(
        api_key=api_key, session_id=session_id,
        system_message=system + "\n\nECOSYSTEM JSON:\n" + _json.dumps(ctx, default=str)[:9000],
    ).with_model(provider, model)

    for h in (payload.history or [])[-6:]:
        if h.get("role") == "user":
            try:
                await chat.send_message(UserMessage(text=str(h.get("content", ""))))
            except Exception:
                break

    try:
        resp = await chat.send_message(UserMessage(text=payload.message))
    except Exception as e:
        logger.exception("Copilot LLM call failed")
        raise HTTPException(502, f"Copilot error: {e}")
    return {
        "reply": str(resp or "").strip(),
        "tenant_id": tid, "role": payload.role,
        "session_id": session_id,
        "model": model, "provider": provider,
    }


async def _copilot_context(tid: str, role: str, entity_id: str) -> dict:
    """Compact JSON the copilot can read — pulled from the intel collections."""
    exec_s = await db.intel_executive_summaries.find_one({"tenant_id": tid}, {"_id": 0}) or {}
    feed = await db.intel_insights.find(
        await tenant_filter(tid, role, entity_id), {"_id": 0},
    ).sort("created_at", -1).limit(15).to_list(15)
    forecasts = await db.intel_forecasts.find(
        {"tenant_id": tid, "urgency": {"$in": ["critical", "high"]}},
        {"_id": 0, "product_name": 1, "retailer_name": 1, "days_remaining": 1,
         "urgency": 1, "stockout_date": 1, "region": 1},
    ).sort("days_remaining", 1).limit(15).to_list(15)
    recs = await db.intel_recommendations.find(
        await tenant_filter(tid, role, entity_id),
        {"_id": 0, "title": 1, "detail": 1, "urgency": 1, "category": 1},
    ).limit(10).to_list(10)
    signals = await db.intel_external_signals.find_one({"tenant_id": tid}, {"_id": 0}) or {}

    role_extras: Dict[str, Any] = {}
    if role == "retailer":
        # Reuse retailer context already used by Sabi to keep answers coherent
        from services.retailer import build_retailer_context  # local import
        try:
            role_extras["retailer_state"] = _json.loads(await build_retailer_context(entity_id))
        except Exception:
            pass
    elif role == "distributor":
        role_extras["distributor_id"] = entity_id
        role_extras["retailer_count"] = await db.retailers.count_documents({"distributor_id": entity_id})

    return {
        "tenant_id": tid, "role": role,
        "exec_summary": {k: v for k, v in exec_s.items() if k not in ("_id",)},
        "feed": feed,
        "stockout_forecasts": forecasts,
        "recommendations": recs,
        "external_signals": (signals.get("payload") or {}),
        **role_extras,
    }
