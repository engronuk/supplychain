"""LLM narrator — turns computed metrics into the live ecosystem feed +
daily executive summary.

Strict rule: the LLM is given STRUCTURED NUMERIC CONTEXT and asked to phrase
it, never to invent facts. All numbers come from intel_* collections.
"""
from __future__ import annotations

import json as _json
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from core import db, logger, new_id, now_iso
from services.ai_insights import generate_ai_insights

_FEED_CACHE: Dict[str, tuple[float, List[dict]]] = {}
_EXEC_CACHE: Dict[str, tuple[float, dict]] = {}


async def _gather_context(tenant_id: str) -> dict:
    """Pull the numerical facts the LLM needs to narrate accurately."""
    forecasts = await db.intel_forecasts.find(
        {"tenant_id": tenant_id, "days_remaining": {"$lt": 7}},
        {"_id": 0, "retailer_name": 1, "product_name": 1, "category": 1, "region": 1,
         "days_remaining": 1, "urgency": 1, "stockout_date": 1, "distributor_name": 1},
    ).sort("days_remaining", 1).to_list(20)
    anomalies = await db.intel_alerts.find(
        {"tenant_id": tenant_id, "category": "anomaly"},
        {"_id": 0, "title": 1, "detail": 1, "severity": 1, "region": 1, "retailer_name": 1},
    ).limit(10).to_list(10)
    logistics = await db.intel_alerts.find(
        {"tenant_id": tenant_id, "category": "logistics"},
        {"_id": 0, "title": 1, "detail": 1, "severity": 1},
    ).limit(10).to_list(10)
    churn = await db.intel_retailer_health.find(
        {"tenant_id": tenant_id, "churn_risk": "high"},
        {"_id": 0, "retailer_name": 1, "days_inactive": 1, "city": 1, "region": 1},
    ).limit(10).to_list(10)
    signals = (await db.intel_external_signals.find_one({"tenant_id": tenant_id}, {"_id": 0})) or {}
    signal_payload = signals.get("payload") or {}

    # Sales pulse
    distributors = await db.distributors.find(
        {"manufacturer_id": tenant_id}, {"_id": 0, "id": 1},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors]
    retailer_ids = [r["id"] async for r in db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0, "id": 1},
    )]
    from datetime import timedelta
    today = datetime.now(timezone.utc).date()
    last7 = (today - timedelta(days=6)).isoformat()
    prev7 = (today - timedelta(days=13)).isoformat()
    last_week = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": last7}}},
        {"$group": {"_id": None, "rev": {"$sum": "$revenue"}, "u": {"$sum": "$units"}}},
    ]).to_list(1)
    prev_week = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": {"$in": retailer_ids},
                    "date": {"$gte": prev7, "$lt": last7}}},
        {"$group": {"_id": None, "rev": {"$sum": "$revenue"}, "u": {"$sum": "$units"}}},
    ]).to_list(1)
    last_rev = (last_week[0]["rev"] if last_week else 0) or 0
    prev_rev = (prev_week[0]["rev"] if prev_week else 0) or 0
    wow_pct = round(((last_rev - prev_rev) / prev_rev) * 100, 1) if prev_rev else 0.0

    return {
        "wow_revenue_pct": wow_pct,
        "revenue_last_7d_naira": round(last_rev, 0),
        "forecasts_at_risk": forecasts,
        "anomalies": anomalies,
        "logistics_alerts": logistics,
        "churn_high_risk": churn,
        "weather_max_region": signal_payload.get("weather", {}).get("national", {}).get("max_rainfall_region"),
        "weather_rainfall_7d_mm": signal_payload.get("weather", {}).get("national", {}).get("rainfall_mm_7d"),
        "holiday_within_7d": bool(signal_payload.get("holiday_within_7d")),
        "salary_window": bool(signal_payload.get("salary_window")),
        "upcoming_holidays": signal_payload.get("upcoming") or [],
    }


async def generate_feed(tenant_id: str, ttl_seconds: int = 300) -> List[dict]:
    """5-12 short narrated insights for the ecosystem feed. Cached briefly."""
    cached = _FEED_CACHE.get(tenant_id)
    if cached and cached[0] > time.time():
        return cached[1]

    ctx = await _gather_context(tenant_id)
    # Build a JSON context string — the LLM ONLY narrates this; no invention.
    context_str = _json.dumps(ctx, default=str, indent=2)[:8000]

    instr = (
        "You are the narrator for a live FMCG supply-chain command center. "
        "Read the JSON ecosystem state below and produce 6-10 SHORT live-feed items "
        "(<= 140 chars each). Each item must be one of:\n"
        " - tone: 'positive' | 'warning' | 'critical' | 'info'\n"
        " - icon: one of trending-up, trending-down, sparkles, alert-octagon, alert-triangle, "
        "clock, shield-check, trophy, info, cloud-rain, truck, package, store, gauge\n"
        " - category: 'sales' | 'stock' | 'logistics' | 'retailer' | 'external' | 'recommendation'\n"
        " - title: <= 70 chars, no markdown\n"
        " - detail: <= 140 chars, single concrete sentence, NEVER invent numbers not in the JSON\n"
        " - region: optional region name if relevant\n"
        "Return STRICT JSON array only — no prose."
    )
    items = await generate_ai_insights(
        prompt_id=f"intel-feed-{tenant_id}",
        kind="intel_feed",
        context=instr + "\n\nECOSYSTEM STATE:\n" + context_str,
    )
    # Persist + cache
    now = now_iso()
    enriched = []
    for it in items:
        enriched.append({
            "id": new_id(),
            "tenant_id": tenant_id,
            "tone": it.get("tone", "info"),
            "icon": it.get("icon", "info"),
            "category": it.get("category", "info"),
            "title": str(it.get("title", "")).strip()[:90],
            "detail": str(it.get("detail", "")).strip()[:180],
            "region": str(it.get("region", "")).strip() or None,
            "created_at": now,
        })
    if enriched:
        await db.intel_insights.delete_many({"tenant_id": tenant_id})
        await db.intel_insights.insert_many(enriched)
    _FEED_CACHE[tenant_id] = (time.time() + ttl_seconds, enriched)
    return enriched


async def generate_exec_summary(tenant_id: str, ttl_seconds: int = 1800) -> dict:
    """A short executive paragraph + 3-5 key bullets + a single recommended action."""
    cached = _EXEC_CACHE.get(tenant_id)
    if cached and cached[0] > time.time():
        return cached[1]

    ctx = await _gather_context(tenant_id)

    # Top recommendation if any
    top_rec = await db.intel_recommendations.find_one(
        {"tenant_id": tenant_id}, {"_id": 0},
        sort=[("urgency", -1)],
    )
    ctx["top_recommendation"] = (
        {"title": top_rec["title"], "urgency": top_rec["urgency"],
         "detail": top_rec.get("detail", "")} if top_rec else None
    )

    context_str = _json.dumps(ctx, default=str, indent=2)[:9000]

    api_key = __import__("os").environ.get("EMERGENT_LLM_KEY")
    bullets: List[dict] = []
    headline = "Operational pulse stable."
    if api_key:
        try:
            from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
            system = (
                "You are the executive briefing voice of TradeKonekt — a Nigerian "
                "FMCG supply-chain intelligence platform. Read the JSON state and "
                "produce STRICT JSON with this shape:\n"
                "{\n"
                "  \"headline\": <= 110 chars, one line — the single most important fact today,\n"
                "  \"bullets\": [\n"
                "    {\"tone\":\"positive|warning|critical|info\", \"icon\":\"trending-up|alert-octagon|truck|cloud-rain|sparkles|info\", \"text\":<=140 chars}\n"
                "  ],   // 3 to 5 items\n"
                "  \"recommendation\": <= 160 chars, ONE concrete action\n"
                "}\n"
                "Use Nigerian Naira (₦). Never invent numbers not in the JSON."
            )
            chat = LlmChat(
                api_key=api_key,
                session_id=f"intel-exec-{tenant_id}",
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
            rec_text = ""
    else:
        rec_text = ""

    if not bullets:
        bullets = [{
            "tone": "info", "icon": "info",
            "text": f"Revenue last 7d: ₦{int(ctx['revenue_last_7d_naira']):,} ({ctx['wow_revenue_pct']:+.1f}% W/W).",
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
            "holiday_within_7d": ctx["holiday_within_7d"],
            "salary_window": ctx["salary_window"],
            "rainfall_7d_mm": ctx.get("weather_rainfall_7d_mm"),
        },
        "generated_at": now_iso(),
        "model": "claude-sonnet-4-5-20250929",
    }

    await db.intel_executive_summaries.update_one(
        {"tenant_id": tenant_id},
        {"$set": summary},
        upsert=True,
    )
    _EXEC_CACHE[tenant_id] = (time.time() + ttl_seconds, summary)
    return summary
