"""LLM narrator — role-aware ecosystem feed + executive summary.

Each role gets its own narration, scoped strictly to its operating context:
  - Manufacturer: full national view (all distributors, all regions)
  - Distributor: only their retailers + their primary region
  - Retailer: only their own shop

The LLM is given STRUCTURED NUMERIC CONTEXT and asked to phrase it; it never
invents numbers. All facts originate in the intel_* collections.
"""
from __future__ import annotations

import json as _json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from core import db, logger, new_id, now_iso
from services.ai_insights import generate_ai_insights
from services.intel.scoping import role_entity_context

# Cache keyed by (tenant_id, role, entity_id)
_FEED_CACHE: Dict[tuple, tuple[float, List[dict]]] = {}
_EXEC_CACHE: Dict[tuple, tuple[float, dict]] = {}


# ----------------------------------------------------------------------------
# Role-scoped context gathering
# ----------------------------------------------------------------------------
async def _gather_context(tenant_id: str, role: str, entity_id: str) -> dict:
    """Pull only the facts visible to (role, entity_id)."""
    rc = await role_entity_context(role, entity_id)
    retailer_ids = rc.get("retailer_ids") or []
    regions = rc.get("regions") or []
    # Manufacturer has no single primary region — leave it None so the LLM
    # narrates nationally instead of anchoring to the alphabetical first.
    primary_region = rc.get("primary_region")

    # --- Forecasts in scope
    fc_filter: Dict[str, Any] = {"tenant_id": tenant_id, "days_remaining": {"$lt": 7}}
    if role == "distributor":
        fc_filter["distributor_id"] = entity_id
    elif role == "retailer":
        fc_filter["retailer_id"] = entity_id
    forecasts = await db.intel_forecasts.find(
        fc_filter,
        {"_id": 0, "retailer_name": 1, "product_name": 1, "category": 1, "region": 1,
         "days_remaining": 1, "urgency": 1, "stockout_date": 1, "distributor_name": 1,
         "current_qty": 1, "adjusted_velocity": 1},
    ).sort("days_remaining", 1).to_list(20)

    # --- Anomalies in scope
    a_filter: Dict[str, Any] = {"tenant_id": tenant_id, "category": "anomaly"}
    if role == "distributor":
        a_filter["distributor_id"] = entity_id
    elif role == "retailer":
        a_filter["retailer_id"] = entity_id
    anomalies = await db.intel_alerts.find(
        a_filter,
        {"_id": 0, "title": 1, "detail": 1, "severity": 1, "region": 1, "retailer_name": 1},
    ).limit(10).to_list(10)

    # --- Logistics in scope
    l_filter: Dict[str, Any] = {"tenant_id": tenant_id, "category": "logistics"}
    if role == "distributor":
        l_filter["$or"] = [{"distributor_id": entity_id},
                           {"scope_id": entity_id}]
    elif role == "retailer":
        l_filter["retailer_id"] = entity_id
    logistics = await db.intel_alerts.find(
        l_filter, {"_id": 0, "title": 1, "detail": 1, "severity": 1, "region": 1},
    ).limit(10).to_list(10)

    # --- Churn in scope
    c_filter: Dict[str, Any] = {"tenant_id": tenant_id, "churn_risk": "high"}
    if role == "distributor":
        c_filter["distributor_id"] = entity_id
    elif role == "retailer":
        c_filter["retailer_id"] = entity_id  # rarely meaningful but consistent
    churn = await db.intel_retailer_health.find(
        c_filter,
        {"_id": 0, "retailer_name": 1, "days_inactive": 1, "city": 1, "region": 1},
    ).limit(10).to_list(10)

    # --- Sales pulse, scoped to retailers in scope
    today = datetime.now(timezone.utc).date()
    last7 = (today - timedelta(days=6)).isoformat()
    prev7 = (today - timedelta(days=13)).isoformat()
    sales_match: Dict[str, Any] = {}
    if retailer_ids:
        sales_match["retailer_id"] = {"$in": retailer_ids}
    if role == "retailer":
        sales_match["retailer_id"] = entity_id
    last_week = await db.daily_sales.aggregate([
        {"$match": {**sales_match, "date": {"$gte": last7}}},
        {"$group": {"_id": None, "rev": {"$sum": "$revenue"}, "u": {"$sum": "$units"}}},
    ]).to_list(1)
    prev_week = await db.daily_sales.aggregate([
        {"$match": {**sales_match, "date": {"$gte": prev7, "$lt": last7}}},
        {"$group": {"_id": None, "rev": {"$sum": "$revenue"}, "u": {"$sum": "$units"}}},
    ]).to_list(1)
    last_rev = (last_week[0]["rev"] if last_week else 0) or 0
    prev_rev = (prev_week[0]["rev"] if prev_week else 0) or 0
    wow_pct = round(((last_rev - prev_rev) / prev_rev) * 100, 1) if prev_rev else 0.0

    # --- External signals — narrow to the scope's region for distributor/retailer
    signals = (await db.intel_external_signals.find_one({"tenant_id": tenant_id}, {"_id": 0})) or {}
    signal_payload = signals.get("payload") or {}
    if role in ("distributor", "retailer") and primary_region:
        by_region = signal_payload.get("weather", {}).get("by_region", {}) or {}
        region_w = by_region.get(primary_region)
        weather_scope = {
            "primary_region": primary_region,
            "region_weather": region_w,
            "holiday_within_7d": signal_payload.get("holiday_within_7d"),
            "salary_window": signal_payload.get("salary_window"),
            "upcoming": (signal_payload.get("upcoming") or [])[:2],
        }
    else:
        weather_scope = {
            "national": signal_payload.get("weather", {}).get("national"),
            "by_region": signal_payload.get("weather", {}).get("by_region"),
            "holiday_within_7d": signal_payload.get("holiday_within_7d"),
            "salary_window": signal_payload.get("salary_window"),
            "upcoming": (signal_payload.get("upcoming") or [])[:3],
        }

    return {
        "tenant_id": tenant_id, "role": role,
        "scope_label": rc.get("distributor_name") or rc.get("retailer_name") or "national network",
        "primary_region": primary_region,
        "regions_in_scope": regions,
        "retailers_in_scope": len(retailer_ids),
        "wow_revenue_pct": wow_pct,
        "revenue_last_7d_naira": round(last_rev, 0),
        "forecasts_at_risk": forecasts,
        "anomalies": anomalies,
        "logistics_alerts": logistics,
        "churn_high_risk": churn,
        "external": weather_scope,
    }


# ----------------------------------------------------------------------------
# Feed generation
# ----------------------------------------------------------------------------
def _role_phrasing(role: str, scope_label: str, primary_region: Optional[str]) -> str:
    if role == "manufacturer":
        return (
            "You are narrating the manufacturer's central operations command center. "
            "Cover the whole network (all regions / distributors). Use phrases like "
            "'across the network', 'nationally', '6 distributors in the South-East'."
        )
    if role == "distributor":
        region = primary_region or "your region"
        return (
            f"You are narrating the distributor command center for '{scope_label}' "
            f"based in {region}. ONLY mention this distributor's own retailers, their "
            f"products, and {region}. NEVER mention other distributors by name or "
            f"reference network-wide stats."
        )
    if role == "retailer":
        return (
            f"You are narrating the shop intelligence pane for retailer '{scope_label}'. "
            f"ONLY discuss this shop's own stock, sales, and incoming shipments. "
            f"NEVER mention other retailers, distributors or the wider network."
        )
    return "Narrate the data accurately."


async def generate_feed(tenant_id: str, role: str = "manufacturer",
                        entity_id: Optional[str] = None,
                        ttl_seconds: int = 300) -> List[dict]:
    """5-12 short narrated insights for the given role+entity. Cached briefly."""
    entity_id = entity_id or tenant_id
    key = (tenant_id, role, entity_id)
    cached = _FEED_CACHE.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    ctx = await _gather_context(tenant_id, role, entity_id)
    context_str = _json.dumps(ctx, default=str, indent=2)[:8000]
    phrasing = _role_phrasing(role, ctx.get("scope_label", ""), ctx.get("primary_region"))

    instr = (
        f"{phrasing}\n\n"
        "Read the JSON state below and produce 6-10 SHORT live-feed items "
        "(<= 140 chars each). Strict rules:\n"
        " - tone: 'positive' | 'warning' | 'critical' | 'info'\n"
        " - icon: one of trending-up, trending-down, sparkles, alert-octagon, alert-triangle, "
        "clock, shield-check, trophy, info, cloud-rain, truck, package, store, gauge\n"
        " - category: 'sales' | 'stock' | 'logistics' | 'retailer' | 'external' | 'recommendation'\n"
        " - title: <= 70 chars, no markdown\n"
        " - detail: <= 140 chars, single concrete sentence — NEVER invent numbers not in the JSON\n"
        " - region: optional region name if relevant\n"
        "If 'retailers_in_scope' is 0 or numbers are mostly empty, produce 3-5 baseline "
        "items only (e.g., 'No critical stockouts in scope') rather than padding.\n"
        "Return STRICT JSON array only — no prose."
    )
    items = await generate_ai_insights(
        prompt_id=f"intel-feed-{tenant_id}-{role}-{entity_id}",
        kind="intel_feed",
        context=instr + "\n\nECOSYSTEM STATE:\n" + context_str,
    )

    now = now_iso()
    enriched = []
    for it in items:
        enriched.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "scope_role": role,
            "scope_id": entity_id,
            "tone": it.get("tone", "info"),
            "icon": it.get("icon", "info"),
            "category": it.get("category", "info"),
            "title": str(it.get("title", "")).strip()[:90],
            "detail": str(it.get("detail", "")).strip()[:180],
            "region": str(it.get("region", "")).strip() or None,
            "created_at": now,
        })
    if enriched:
        # Replace only items for THIS scope, leave other roles' feeds alone
        await db.intel_insights.delete_many({
            "tenant_id": tenant_id, "scope_role": role, "scope_id": entity_id,
        })
        await db.intel_insights.insert_many(enriched)
    _FEED_CACHE[key] = (time.time() + ttl_seconds, enriched)
    return enriched


# ----------------------------------------------------------------------------
# Executive summary
# ----------------------------------------------------------------------------
async def generate_exec_summary(tenant_id: str, role: str = "manufacturer",
                                entity_id: Optional[str] = None,
                                ttl_seconds: int = 1800) -> dict:
    """Headline + 3-5 bullets + recommendation — strictly role-scoped."""
    entity_id = entity_id or tenant_id
    key = (tenant_id, role, entity_id)
    cached = _EXEC_CACHE.get(key)
    if cached and cached[0] > time.time():
        return cached[1]

    ctx = await _gather_context(tenant_id, role, entity_id)
    rec_filter: Dict[str, Any] = {"tenant_id": tenant_id, "scope_role": role}
    if role != "manufacturer":
        rec_filter["scope_id"] = entity_id
    top_rec = await db.intel_recommendations.find_one(
        rec_filter, {"_id": 0}, sort=[("urgency", -1)],
    )
    ctx["top_recommendation"] = (
        {"title": top_rec["title"], "urgency": top_rec["urgency"],
         "detail": top_rec.get("detail", "")} if top_rec else None
    )

    context_str = _json.dumps(ctx, default=str, indent=2)[:9000]
    phrasing = _role_phrasing(role, ctx.get("scope_label", ""), ctx.get("primary_region"))

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    bullets: List[dict] = []
    headline = "Operations stable — no urgent action."
    rec_text = ""

    if api_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            system = (
                f"You are the executive briefing voice of TradeKonekt. {phrasing} "
                "Read the JSON state and produce STRICT JSON:\n"
                "{\n"
                "  \"headline\": <= 110 chars — the single most important fact for THIS scope,\n"
                "  \"bullets\": [\n"
                "    {\"tone\":\"positive|warning|critical|info\", \"icon\":\"trending-up|alert-octagon|truck|cloud-rain|sparkles|info\", \"text\":<=140 chars}\n"
                "  ],   // 3 to 5 items, scope-specific\n"
                "  \"recommendation\": <= 160 chars, ONE concrete action FOR THIS ROLE\n"
                "}\n"
                "Use Nigerian Naira (₦). Never invent numbers not in the JSON. "
                "If retailers_in_scope is 0 say so plainly; never pretend coverage you don't have."
            )
            chat = LlmChat(
                api_key=api_key,
                session_id=f"intel-exec-{tenant_id}-{role}-{entity_id}",
                system_message=system,
            ).with_model("anthropic", "claude-sonnet-4-5-20250929")
            resp = await chat.send_message(UserMessage(text=context_str))
            text = str(resp or "").strip()
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if m:
                parsed = _json.loads(m.group(0))
                headline = str(parsed.get("headline") or headline)[:140]
                bullets = []
                for b in (parsed.get("bullets") or [])[:5]:
                    bullets.append({
                        "tone": str(b.get("tone", "info")),
                        "icon": str(b.get("icon", "info")),
                        "text": str(b.get("text", "")).strip()[:180],
                    })
                rec_text = str(parsed.get("recommendation") or "").strip()[:200]
        except Exception:
            logger.exception("Exec summary LLM call failed")

    if not bullets:
        bullets = [{
            "tone": "info", "icon": "info",
            "text": f"Revenue last 7d in scope: ₦{int(ctx['revenue_last_7d_naira']):,} ({ctx['wow_revenue_pct']:+.1f}% W/W).",
        }]
        if ctx.get("forecasts_at_risk"):
            f = ctx["forecasts_at_risk"][0]
            bullets.append({
                "tone": "warning", "icon": "alert-triangle",
                "text": f"{f['product_name']} at {f['retailer_name']} stockout ~{f['days_remaining']:.0f}d.",
            })
        if ctx.get("logistics_alerts"):
            bullets.append({
                "tone": "warning", "icon": "truck",
                "text": ctx["logistics_alerts"][0]["title"],
            })

    summary = {
        "id": new_id(),
        "tenant_id": tenant_id,
        "scope_role": role,
        "scope_id": entity_id,
        "headline": headline,
        "bullets": bullets,
        "recommendation": rec_text or (top_rec["title"] if top_rec else "No urgent action required."),
        "context_metrics": {
            "wow_revenue_pct": ctx["wow_revenue_pct"],
            "revenue_last_7d": ctx["revenue_last_7d_naira"],
            "forecasts_at_risk": len(ctx["forecasts_at_risk"]),
            "anomalies": len(ctx["anomalies"]),
            "logistics_alerts": len(ctx["logistics_alerts"]),
            "churn_high": len(ctx["churn_high_risk"]),
            "primary_region": ctx.get("primary_region"),
            "retailers_in_scope": ctx.get("retailers_in_scope"),
        },
        "generated_at": now_iso(),
        "model": "claude-sonnet-4-5-20250929",
    }

    await db.intel_executive_summaries.update_one(
        {"tenant_id": tenant_id, "scope_role": role, "scope_id": entity_id},
        {"$set": summary}, upsert=True,
    )
    _EXEC_CACHE[key] = (time.time() + ttl_seconds, summary)
    return summary
