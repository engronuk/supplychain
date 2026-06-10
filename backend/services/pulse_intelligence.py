"""Proactive Intelligence Engine — Vertex AI powered, grounded in
real platform data (MongoDB) and *persisted* for hourly batch refresh.

The Manufacturer Command Center reads the latest snapshot from
`db.pulse_intelligence` (one document per manufacturer). The snapshot is
recomputed:

  • Hourly by the in-process APScheduler (see services/intel/scheduler.py)
  • On-demand by `POST /api/pulse/intelligence/recompute` (the "Recompute"
    button on the Command Center).

`compute_intelligence(mfr_id)` is the single entry point that:
  1. Pulls a *rich evidence pack* from MongoDB — combining the existing
     intel modules (forecasts / retailer health / delivery risk / anomalies
     / allocations / fulfillment activity / recent orders) so the
     manufacturer briefing reflects what is ACTUALLY happening on the
     platform, not synthetic telemetry alone.
  2. (Optionally) augments with the BigQuery sales-velocity signal.
  3. Feeds the evidence pack to Vertex AI Gemini under a **strict JSON
     schema** (response_mime_type=application/json + response_schema). The
     model is forced to emit severity, headline, ranked root-cause
     hypotheses with confidence + evidence, a 24h trajectory forecast, a
     priority-ordered list of recommended actions, and risk flags — PLUS a
     network-level executive briefing in the same call.
  4. Falls back to a deterministic evidence-only briefing if Vertex is
     rate-limited so the UI never shows blank.
  5. Upserts the result into `db.pulse_intelligence`.

This module is the only place that talks to Vertex AI for the Pulse system.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from core import db
from services import vertex_llm
from services.bigquery_client import full_table_id, get_client, run_query

logger = logging.getLogger(__name__)


# ===========================================================================
# Platform-grounded signal gathering (MongoDB)
# ===========================================================================
async def gather_platform_signals(mfr_id: str) -> Dict[str, Any]:
    """Pull a rich evidence pack from MongoDB describing what is actually
    happening on the platform RIGHT NOW for this manufacturer.

    Combines the existing intel layer (forecasts / retailer health / delivery
    risk / anomalies) with operational tables (orders, allocations,
    fulfillment, GRNs, stock requests). Returns a structured dict that the
    LLM can reason over.
    """
    now = datetime.now(timezone.utc)
    last_24h_iso = (now - timedelta(hours=24)).isoformat()
    last_7d_iso  = (now - timedelta(days=7)).isoformat()

    # 1. Tenant scope: distributors & retailers belonging to this manufacturer.
    distributors = await db.distributors.find(
        {"manufacturer_id": mfr_id}, {"_id": 0, "id": 1, "name": 1, "region": 1, "city": 1},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors]
    dist_by_id = {d["id"]: d for d in distributors}

    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}},
        {"_id": 0, "id": 1, "name": 1, "distributor_id": 1, "region": 1},
    ).to_list(50000)
    ret_count = len(retailers)
    ret_by_dist: Dict[str, int] = {}
    for r in retailers:
        ret_by_dist[r["distributor_id"]] = ret_by_dist.get(r["distributor_id"], 0) + 1

    # 2. Stock-exhaustion forecasts (already computed by services/intel/forecasts.py)
    forecasts = await db.intel_forecasts.find(
        {"tenant_id": mfr_id, "urgency": {"$in": ["critical", "high"]}},
        {"_id": 0},
    ).sort("days_remaining", 1).to_list(500)
    stockouts_by_region: Dict[str, Dict[str, Any]] = {}
    products_at_risk: Dict[str, Dict[str, Any]] = {}
    for f in forecasts:
        region = f.get("region") or "Unknown"
        rb = stockouts_by_region.setdefault(region, {
            "region": region, "shops_at_risk": 0,
            "critical_count": 0, "high_count": 0,
            "naira_at_risk": 0.0, "top_products": set(),
        })
        rb["shops_at_risk"] += 1
        rb[f"{f['urgency']}_count"] = rb.get(f"{f['urgency']}_count", 0) + 1
        rb["naira_at_risk"] += float(f.get("naira_at_risk", 0) or 0)
        if f.get("product_name"):
            rb["top_products"].add(f["product_name"])
        pn = f.get("product_name") or f.get("product_id") or "?"
        pb = products_at_risk.setdefault(pn, {
            "product_name": pn, "shops_at_risk": 0, "regions": set(),
            "min_days": float("inf"), "naira_at_risk": 0.0,
        })
        pb["shops_at_risk"] += 1
        pb["regions"].add(region)
        pb["min_days"] = min(pb["min_days"], float(f.get("days_remaining", 0) or 0))
        pb["naira_at_risk"] += float(f.get("naira_at_risk", 0) or 0)
    # Stringify sets for JSON
    for r in stockouts_by_region.values():
        r["top_products"] = list(r["top_products"])[:5]
    for p in products_at_risk.values():
        p["regions"] = list(p["regions"])
        if p["min_days"] == float("inf"):
            p["min_days"] = None
    top_products_at_risk = sorted(
        products_at_risk.values(),
        key=lambda x: -(x["shops_at_risk"]),
    )[:8]

    # 3. Retailer churn risk
    churn_high = await db.intel_retailer_health.count_documents(
        {"tenant_id": mfr_id, "churn_risk": "high"},
    )
    churn_medium = await db.intel_retailer_health.count_documents(
        {"tenant_id": mfr_id, "churn_risk": "medium"},
    )

    # 4. Delivery risk
    delivery_high = await db.intel_delivery_eta.count_documents(
        {"tenant_id": mfr_id, "risk": "high"},
    )
    delivery_high_samples = await db.intel_delivery_eta.find(
        {"tenant_id": mfr_id, "risk": "high"},
        {"_id": 0, "destination": 1, "expected_eta_days": 1, "delay_days": 1},
    ).limit(5).to_list(5)

    # 5. Recent anomalies (last 24h)
    anomalies = await db.intel_alerts.find(
        {"tenant_id": mfr_id, "category": "anomaly", "created_at": {"$gte": last_24h_iso}},
        {"_id": 0, "retailer_name": 1, "region": 1, "kind": 1, "score": 1, "message": 1},
    ).sort("score", -1).limit(8).to_list(8)

    # 6. Allocation & fulfillment activity (last 7d)
    allocs_pending = await db.order_allocations.count_documents(
        {"manufacturer_id": mfr_id, "status": "pending"},
    )
    allocs_done_7d = await db.order_allocations.count_documents(
        {"manufacturer_id": mfr_id, "status": "allocated", "created_at": {"$gte": last_7d_iso}},
    )
    fulfillment_pending = await db.fulfillment_orders.count_documents(
        {"manufacturer_id": mfr_id, "status": {"$in": ["pending", "picking", "packing"]}},
    )
    fulfillment_done_24h = await db.fulfillment_orders.count_documents(
        {"manufacturer_id": mfr_id, "status": "dispatched", "updated_at": {"$gte": last_24h_iso}},
    )

    # 7. Recent orders (distributor → manufacturer)
    orders_24h = await db.orders.find(
        {"manufacturer_id": mfr_id, "created_at": {"$gte": last_24h_iso}},
        {"_id": 0, "id": 1, "distributor_id": 1, "total_value": 1, "status": 1, "created_at": 1},
    ).to_list(500)
    orders_revenue_24h = sum(float(o.get("total_value", 0) or 0) for o in orders_24h)
    orders_7d_count = await db.orders.count_documents(
        {"manufacturer_id": mfr_id, "created_at": {"$gte": last_7d_iso}},
    )

    # 8. Stock requests (retailers → distributors, but tells manufacturer about pull demand)
    requests_24h = await db.requests.count_documents(
        {"distributor_id": {"$in": dist_ids}, "created_at": {"$gte": last_24h_iso}},
    )
    requests_7d = await db.requests.count_documents(
        {"distributor_id": {"$in": dist_ids}, "created_at": {"$gte": last_7d_iso}},
    )

    # 9. Distributor performance — top 5 by 24h order revenue
    rev_by_dist: Dict[str, float] = {}
    for o in orders_24h:
        did = o.get("distributor_id")
        if not did:
            continue
        rev_by_dist[did] = rev_by_dist.get(did, 0.0) + float(o.get("total_value", 0) or 0)
    top_distributors = sorted(
        ({"distributor_id": did, "name": dist_by_id.get(did, {}).get("name", "?"),
          "region": dist_by_id.get(did, {}).get("region", ""),
          "city":   dist_by_id.get(did, {}).get("city", ""),
          "revenue_24h": round(rv, 0),
          "retailer_count": ret_by_dist.get(did, 0)}
         for did, rv in rev_by_dist.items()),
        key=lambda x: -x["revenue_24h"],
    )[:5]

    # 10. Recent ingestion-quality marker (so the LLM knows if data is fresh)
    last_order = await db.orders.find_one(
        {"manufacturer_id": mfr_id},
        {"_id": 0, "created_at": 1},
        sort=[("created_at", -1)],
    )

    return {
        "as_of":                     now.isoformat(),
        "manufacturer_id":           mfr_id,
        "network": {
            "distributors":          len(distributors),
            "retailers":             ret_count,
        },
        "demand_signals": {
            "orders_count_24h":      len(orders_24h),
            "orders_revenue_24h":    round(orders_revenue_24h, 0),
            "orders_count_7d":       orders_7d_count,
            "stock_requests_24h":    requests_24h,
            "stock_requests_7d":     requests_7d,
        },
        "execution": {
            "allocations_pending":   allocs_pending,
            "allocations_done_7d":   allocs_done_7d,
            "fulfillment_pending":   fulfillment_pending,
            "fulfillment_dispatched_24h": fulfillment_done_24h,
        },
        "risk_signals": {
            "shops_at_risk_total":   sum(r["shops_at_risk"] for r in stockouts_by_region.values()),
            "stockouts_by_region":   list(stockouts_by_region.values()),
            "top_products_at_risk":  top_products_at_risk,
            "churn_high_retailers":  churn_high,
            "churn_medium_retailers": churn_medium,
            "delivery_high_risk":    delivery_high,
            "delivery_samples":      [{
                "destination":         d.get("destination"),
                "expected_eta_days":   d.get("expected_eta_days"),
                "delay_days":          d.get("delay_days"),
            } for d in delivery_high_samples],
            "anomalies_24h":         anomalies,
        },
        "top_distributors_24h":      top_distributors,
        "data_freshness": {
            "last_order_at":         (last_order or {}).get("created_at"),
        },
    }


# ===========================================================================
# Combined platform + BQ briefing — Vertex AI with strict schema
# ===========================================================================
PLATFORM_BRIEFING_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "executive_summary": {
            "type": "OBJECT",
            "properties": {
                "headline":   {"type": "STRING"},
                "narrative":  {"type": "STRING"},
                "themes":     {"type": "ARRAY", "items": {"type": "STRING"}},
                "top_action": {"type": "STRING"},
            },
            "required": ["headline", "narrative", "themes", "top_action"],
        },
        "briefings": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "scope":       {"type": "STRING", "enum": ["NETWORK", "REGION", "DISTRIBUTOR", "PRODUCT"]},
                    "scope_label": {"type": "STRING"},
                    "severity":    {"type": "STRING", "enum": ["CRITICAL", "HIGH", "MEDIUM", "INFO"]},
                    "signal_type": {"type": "STRING", "enum": [
                        "STOCKOUT_RISK", "DEMAND_SPIKE", "DEMAND_SLUMP",
                        "DELIVERY_RISK", "CHURN_RISK", "ALLOCATION_BACKLOG",
                        "FULFILLMENT_BACKLOG", "PROMOTIONAL_OPPORTUNITY",
                    ]},
                    "headline":    {"type": "STRING"},
                    "narrative":   {"type": "STRING"},
                    "hypotheses": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "hypothesis": {"type": "STRING"},
                                "confidence": {"type": "NUMBER"},
                                "evidence":   {"type": "STRING"},
                            },
                            "required": ["hypothesis", "confidence", "evidence"],
                        },
                    },
                    "trajectory_24h": {
                        "type": "OBJECT",
                        "properties": {
                            "expected_units":         {"type": "NUMBER"},
                            "expected_revenue_naira": {"type": "NUMBER"},
                            "confidence":             {"type": "NUMBER"},
                        },
                        "required": ["expected_units", "expected_revenue_naira", "confidence"],
                    },
                    "recommended_actions": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "action":    {"type": "STRING"},
                                "priority":  {"type": "INTEGER"},
                                "rationale": {"type": "STRING"},
                                "owner":     {"type": "STRING", "enum": [
                                    "Supply Planning", "Trade Marketing", "Sales Ops",
                                    "Warehouse Ops", "Finance",
                                ]},
                            },
                            "required": ["action", "priority", "rationale", "owner"],
                        },
                    },
                    "risk_flags": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["scope", "scope_label", "severity", "signal_type",
                             "headline", "narrative", "hypotheses",
                             "recommended_actions", "risk_flags"],
            },
        },
    },
    "required": ["executive_summary", "briefings"],
}


PLATFORM_SYSTEM_PROMPT = """You are a senior FMCG supply-chain demand intelligence analyst working for a Nigerian manufacturer. You are given a STRUCTURED EVIDENCE PACK describing what is actually happening on the manufacturer's platform RIGHT NOW (distributor network size, retailer count, last-24h orders/revenue, allocation & fulfillment backlog, stock-exhaustion risk by region & product, churn risk, delivery risk, anomaly alerts, top distributors).

Produce a JSON object containing:

  • `executive_summary` — a single COO-grade synthesis:
      - headline: ≤ 14 words, the ONE thing the COO needs to know.
      - narrative: 2–3 sentences referencing ₦ revenue impact, specific
        regions, real numbers from the evidence pack. NO bullets, NO line
        breaks.
      - themes: 2–4 short tag phrases.
      - top_action: the single highest-priority action across the network.

  • `briefings` — 4 to 8 ranked briefing objects, each addressing ONE
    meaningful operational signal. For EACH briefing:
      - scope: NETWORK / REGION / DISTRIBUTOR / PRODUCT (most appropriate level).
      - scope_label: e.g. "Lagos", "OMO Multi-Active", "Suara & Co (Lagos)", "Network".
      - severity:
          CRITICAL = network-wide threat OR many shops/regions affected.
          HIGH     = significant but contained.
          MEDIUM   = noteworthy.
          INFO     = small, statistically-weak signal.
      - signal_type: from the enum.
      - headline: ≤ 12 words, action-oriented.
      - narrative: 2 sentences. CITE actual numbers from the evidence
        (units, ₦ revenue, region, shop count, days remaining, %). Use ₦ for Naira.
      - hypotheses: 2–3 RANKED candidate causes. confidence ∈ [0,1].
        evidence must cite a specific datapoint from the evidence pack.
        NEVER invent a number that's not in the evidence.
      - trajectory_24h: project the next 24h units & revenue if relevant
        (set to 0 / 0 / 0.3 if not applicable).
      - recommended_actions: 2–4 concrete, owner-assigned actions. Owner ∈
        {Supply Planning, Trade Marketing, Sales Ops, Warehouse Ops, Finance}.
        Priority 1 = do first.
      - risk_flags: short snake_case tags like
        stockout_risk_72h, single_distributor_dependency,
        allocation_backlog, regional_concentration_risk,
        delivery_delays_compounding, momentum_decelerating.

ANCHOR ALL NUMBERS to the evidence pack. If the evidence pack says
"shops_at_risk_total: 23", you must NOT say "30+ shops at risk". If a
section is empty, treat it as 0. Return STRICT JSON matching the schema.
No prose outside JSON.
"""


async def compute_intelligence(mfr_id: str) -> Dict[str, Any]:
    """End-to-end compute + persist for one manufacturer.

    Pulls platform signals from Mongo (+ optional BQ velocity signal),
    invokes Vertex AI with the strict JSON schema, falls back to evidence-
    only on quota error, and **upserts** the result into
    `db.pulse_intelligence` keyed by manufacturer_id.
    """
    now_dt = datetime.now(timezone.utc)
    platform = await gather_platform_signals(mfr_id)

    bq_signals: List[Dict[str, Any]] = []
    if get_client() is not None:
        try:
            bq_signals = gather_signals(mfr_id, limit=4)
        except Exception:
            logger.exception("[pulse_intel] BQ velocity signal failed (non-fatal)")

    payload: Dict[str, Any]
    if not vertex_llm.is_configured():
        payload = _evidence_only_intelligence(platform, bq_signals)
        payload["ai_status"] = "vertex_not_configured"
    else:
        evidence_pack = {**platform, "bq_velocity_signals": bq_signals}
        import json as _json
        try:
            out = await vertex_llm.complete_json(
                system=PLATFORM_SYSTEM_PROMPT,
                user=_json.dumps(evidence_pack, default=str),
                response_schema=PLATFORM_BRIEFING_SCHEMA,
                temperature=0.2,
                max_output_tokens=7000,
            )
            if isinstance(out, dict) and out.get("briefings"):
                payload = {
                    "briefings":         out.get("briefings") or [],
                    "executive_summary": out.get("executive_summary"),
                    "ai_status":         "vertex_ai",
                }
            else:
                payload = _evidence_only_intelligence(platform, bq_signals)
                payload["ai_status"] = "fallback: empty_response"
        except Exception as e:
            logger.warning("[pulse_intel] Vertex AI failed (%s) — using evidence-only fallback", e)
            payload = _evidence_only_intelligence(platform, bq_signals)
            payload["ai_status"] = f"fallback: {type(e).__name__}"

    doc = {
        "manufacturer_id":   mfr_id,
        "generated_at":      now_dt.isoformat(),
        "next_compute_at":   (now_dt + timedelta(hours=1)).isoformat(),
        "briefings":         payload.get("briefings") or [],
        "executive_summary": payload.get("executive_summary"),
        "ai_status":         payload.get("ai_status") or "unknown",
        "signal_count":      len(platform.get("risk_signals", {}).get("top_products_at_risk", [])) + len(bq_signals),
        "evidence":          platform,
    }
    await db.pulse_intelligence.update_one(
        {"manufacturer_id": mfr_id},
        {"$set": doc},
        upsert=True,
    )
    return doc


async def latest_intelligence(mfr_id: str) -> Optional[Dict[str, Any]]:
    """Return the last persisted snapshot for this manufacturer, if any."""
    doc = await db.pulse_intelligence.find_one(
        {"manufacturer_id": mfr_id}, {"_id": 0},
    )
    return doc


# ===========================================================================
# Deterministic fallback briefing — derived from platform evidence alone.
# Used when Vertex AI is unavailable / quota-exhausted.
# ===========================================================================
def _evidence_only_intelligence(platform: Dict[str, Any], bq_signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    briefings: List[Dict[str, Any]] = []
    risk = platform.get("risk_signals", {})
    demand = platform.get("demand_signals", {})
    execn = platform.get("execution", {})

    # 1) Per-region stockout risk
    for r in (risk.get("stockouts_by_region") or [])[:4]:
        shops = r.get("shops_at_risk", 0)
        crit = r.get("critical_count", 0)
        if shops <= 0:
            continue
        sev = "CRITICAL" if crit >= 3 else "HIGH" if shops >= 5 else "MEDIUM"
        briefings.append({
            "scope": "REGION",
            "scope_label": r["region"],
            "severity": sev,
            "signal_type": "STOCKOUT_RISK",
            "headline": f"{shops} retailer{'s' if shops != 1 else ''} approaching stockout in {r['region']}",
            "narrative": (
                f"In {r['region']}, {shops} retailers are running low (≤10 days cover). "
                f"{crit} of them are CRITICAL. Top SKUs at risk: {', '.join(r.get('top_products') or [])[:120]}."
            ),
            "hypotheses": [
                {"hypothesis": "Reorder cadence slipping — retailers' last orders are aged.",
                 "confidence": 0.65,
                 "evidence": f"{shops} shops below 10-day cover in {r['region']}"}
            ],
            "trajectory_24h": {"expected_units": 0, "expected_revenue_naira": 0, "confidence": 0.4},
            "recommended_actions": [
                {"priority": 1, "owner": "Supply Planning",
                 "action": f"Trigger replenishment push to {r['region']} distributors within 24h",
                 "rationale": f"{crit} retailers are critical; risk of revenue loss + churn."},
                {"priority": 2, "owner": "Sales Ops",
                 "action": f"Call top retailers in {r['region']} to confirm restock dates.",
                 "rationale": "Phone outreach catches retailers slow to use the app."},
            ],
            "risk_flags": ["stockout_risk_72h", "regional_concentration_risk"],
        })

    # 2) Top products at risk
    for p in (risk.get("top_products_at_risk") or [])[:3]:
        if p["shops_at_risk"] <= 0:
            continue
        briefings.append({
            "scope": "PRODUCT",
            "scope_label": p["product_name"],
            "severity": "HIGH" if p["shops_at_risk"] >= 5 else "MEDIUM",
            "signal_type": "STOCKOUT_RISK",
            "headline": f"{p['product_name']} is at risk in {len(p.get('regions') or [])} region(s)",
            "narrative": (
                f"{p['product_name']} is running low at {p['shops_at_risk']} retailers across "
                f"{', '.join(p.get('regions') or [])[:80]}. Minimum days remaining: {p['min_days'] or 'N/A'}."
            ),
            "hypotheses": [{
                "hypothesis": "Demand outpacing supply allocation for this SKU.",
                "confidence": 0.6,
                "evidence": f"At-risk shops: {p['shops_at_risk']}, regions affected: {len(p.get('regions') or [])}",
            }],
            "trajectory_24h": {"expected_units": 0, "expected_revenue_naira": 0, "confidence": 0.4},
            "recommended_actions": [
                {"priority": 1, "owner": "Supply Planning",
                 "action": f"Allocate additional units of {p['product_name']} to affected regions.",
                 "rationale": f"{p['shops_at_risk']} shops at risk of stockout."},
            ],
            "risk_flags": ["stockout_risk_72h", "multi_region_pressure"],
        })

    # 3) Allocation / fulfillment backlog
    if execn.get("allocations_pending", 0) >= 5:
        briefings.append({
            "scope": "NETWORK",
            "scope_label": "Allocation queue",
            "severity": "HIGH" if execn["allocations_pending"] >= 15 else "MEDIUM",
            "signal_type": "ALLOCATION_BACKLOG",
            "headline": f"{execn['allocations_pending']} orders awaiting your allocation",
            "narrative": (
                f"{execn['allocations_pending']} distributor orders are queued in the Allocation Center. "
                f"You allocated {execn.get('allocations_done_7d', 0)} orders in the last 7 days."
            ),
            "hypotheses": [{
                "hypothesis": "Allocation throughput is below demand intake.",
                "confidence": 0.6,
                "evidence": f"Pending: {execn['allocations_pending']}, completed 7d: {execn.get('allocations_done_7d', 0)}",
            }],
            "trajectory_24h": {"expected_units": 0, "expected_revenue_naira": 0, "confidence": 0.4},
            "recommended_actions": [
                {"priority": 1, "owner": "Supply Planning",
                 "action": "Process the allocation backlog today.",
                 "rationale": "Pending orders delay fulfillment downstream and risk stockouts."},
            ],
            "risk_flags": ["allocation_backlog"],
        })

    # 4) Delivery risk
    if risk.get("delivery_high_risk", 0) > 0:
        briefings.append({
            "scope": "NETWORK",
            "scope_label": "Inbound deliveries",
            "severity": "MEDIUM",
            "signal_type": "DELIVERY_RISK",
            "headline": f"{risk['delivery_high_risk']} deliveries flagged as high-risk for delay",
            "narrative": (
                f"{risk['delivery_high_risk']} active shipments are showing high delay risk. "
                f"Affected destinations include: {', '.join((d.get('destination') or '?') for d in (risk.get('delivery_samples') or [])[:3])}."
            ),
            "hypotheses": [{
                "hypothesis": "Logistics constraints (vehicle availability, route congestion).",
                "confidence": 0.55,
                "evidence": f"{risk['delivery_high_risk']} high-risk shipments",
            }],
            "trajectory_24h": {"expected_units": 0, "expected_revenue_naira": 0, "confidence": 0.4},
            "recommended_actions": [
                {"priority": 1, "owner": "Warehouse Ops",
                 "action": "Escalate the high-risk shipments and confirm carrier ETAs.",
                 "rationale": "Delivery delays compound stockout risk downstream."},
            ],
            "risk_flags": ["delivery_delays_compounding"],
        })

    # 5) Churn risk
    if risk.get("churn_high_retailers", 0) > 0:
        briefings.append({
            "scope": "NETWORK",
            "scope_label": "Retailer churn",
            "severity": "MEDIUM",
            "signal_type": "CHURN_RISK",
            "headline": f"{risk['churn_high_retailers']} retailers at high churn risk",
            "narrative": (
                f"{risk['churn_high_retailers']} retailers have not ordered recently and are at high churn risk. "
                f"A further {risk.get('churn_medium_retailers', 0)} are at medium risk."
            ),
            "hypotheses": [{
                "hypothesis": "Inactivity suggests competitor displacement or operational issues at retailer end.",
                "confidence": 0.55,
                "evidence": f"High churn risk: {risk['churn_high_retailers']}",
            }],
            "trajectory_24h": {"expected_units": 0, "expected_revenue_naira": 0, "confidence": 0.4},
            "recommended_actions": [
                {"priority": 1, "owner": "Sales Ops",
                 "action": "Deploy field reps to re-engage the high-risk retailers this week.",
                 "rationale": "Each lost retailer is a recurring revenue loss."},
            ],
            "risk_flags": ["churn_risk"],
        })

    # 6) BQ velocity spikes (if any)
    for s in bq_signals[:2]:
        vel = float(s.get("velocity_ratio_14d") or 0)
        if vel < 1.5 and vel > 0.5:
            continue
        sev = "HIGH" if (vel >= 2 or vel <= 0.5) else "MEDIUM"
        sig_type = "DEMAND_SPIKE" if vel >= 1.5 else "DEMAND_SLUMP"
        briefings.append({
            "scope": "PRODUCT",
            "scope_label": s.get("product_name") or "?",
            "severity": sev,
            "signal_type": sig_type,
            "headline": f"{s.get('product_name')} — {sig_type.replace('_',' ').lower()} in {s.get('region')} ({vel:.1f}× baseline)",
            "narrative": f"{s.get('product_name')} sold {int(s.get('units_24h',0)):,} units in {s.get('region')} (last 24h) — {vel:.1f}× the 14-day baseline.",
            "hypotheses": [{
                "hypothesis": "Recent demand momentum shift detected by BigQuery telemetry.",
                "confidence": 0.55, "evidence": f"velocity_ratio_14d={vel:.2f}",
            }],
            "trajectory_24h": {"expected_units": int((s.get('units_24h') or 0) * 1.0),
                               "expected_revenue_naira": int((s.get('rev_24h') or 0) * 1.0),
                               "confidence": 0.5},
            "recommended_actions": [{
                "priority": 1, "owner": "Supply Planning",
                "action": f"Verify stock availability in {s.get('region')} for {s.get('product_name')}.",
                "rationale": "Confirm whether spike/slump matches inventory + promotion calendar.",
            }],
            "risk_flags": ["bq_velocity_signal"],
        })

    # Order by severity
    sev_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}
    briefings.sort(key=lambda x: sev_order.get(x.get("severity"), 9))

    # Network-level executive synthesis
    shops_at_risk = risk.get("shops_at_risk_total", 0)
    crit_briefings = sum(1 for b in briefings if b["severity"] == "CRITICAL")
    high_briefings = sum(1 for b in briefings if b["severity"] == "HIGH")
    exec_summary = {
        "headline": (
            f"{crit_briefings} critical + {high_briefings} high-severity signals across the network"
            if (crit_briefings + high_briefings) > 0
            else "Network is operating within normal envelopes"
        ),
        "narrative": (
            f"Last 24h: {demand.get('orders_count_24h',0)} distributor orders worth ₦{demand.get('orders_revenue_24h',0):,.0f}, "
            f"{demand.get('stock_requests_24h',0)} retailer stock requests. "
            f"{shops_at_risk} retailers approaching stockout, {execn.get('allocations_pending',0)} orders pending allocation, "
            f"{execn.get('fulfillment_pending',0)} fulfillment orders in flight. "
            "Vertex AI synthesis temporarily unavailable; rule-based briefing in use."
        ),
        "themes": list({b["signal_type"] for b in briefings})[:4],
        "top_action": (briefings[0]["recommended_actions"][0]["action"] if briefings else "Continue monitoring."),
    }

    return {"briefings": briefings, "executive_summary": exec_summary}


# ===========================================================================
# Legacy BigQuery-only signal-gathering kept for backward compatibility.
# ===========================================================================
def gather_signals(mfr_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Return the top-N (region, product) BigQuery velocity signals."""
    if get_client() is None:
        return []


    sql = f"""
    WITH base AS (
      SELECT
        region, product_id,
        product_name,
        TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), occurred_at, HOUR) AS h_ago,
        units_sold,
        CAST(value_naira AS FLOAT64) AS rev,
        distributor_id,
        occurred_at,
      FROM `{full_table_id()}`
      WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
        AND (@mfr = "" OR manufacturer_id = @mfr)
    ),
    windows AS (
      SELECT region, product_id,
        ANY_VALUE(product_name) AS product_name,
        SUM(IF(h_ago <  24, units_sold, 0))                          AS units_24h,
        SUM(IF(h_ago <  24, rev,        0))                          AS rev_24h,
        SUM(IF(h_ago BETWEEN 24 AND 47, units_sold, 0))              AS units_prev_24h,
        SUM(IF(h_ago <  168, units_sold, 0)) / 7.0                   AS avg_daily_7d,
        SUM(IF(h_ago BETWEEN 24 AND 336, units_sold, 0)) / 13.0      AS avg_daily_13d_excl,
        COUNT(DISTINCT IF(h_ago < 24, distributor_id, NULL))         AS active_distributors_24h,
        APPROX_TOP_COUNT(IF(h_ago < 24, distributor_id, NULL), 3)    AS top_drivers_24h,
        COUNTIF(h_ago < 24)                                          AS events_24h,
      FROM base
      GROUP BY region, product_id
    ),
    stats AS (
      SELECT region, product_id,
        STDDEV_SAMP(daily_units) AS sd_daily_units
      FROM (
        SELECT region, product_id,
          DATE(occurred_at) AS d, SUM(units_sold) AS daily_units
        FROM base
        WHERE h_ago BETWEEN 24 AND 336
        GROUP BY region, product_id, d
      )
      GROUP BY region, product_id
    ),
    spread AS (
      SELECT product_id, COUNT(DISTINCT region) AS regions_active_24h
      FROM base
      WHERE h_ago < 24
      GROUP BY product_id
    )
    SELECT
      w.region, w.product_id, w.product_name,
      w.units_24h, w.units_prev_24h, w.events_24h,
      w.avg_daily_7d, w.avg_daily_13d_excl,
      w.active_distributors_24h,
      w.top_drivers_24h,
      s.sd_daily_units,
      sp.regions_active_24h,
      SAFE_DIVIDE(w.units_24h, w.avg_daily_13d_excl) AS velocity_ratio_14d,
      SAFE_DIVIDE(w.units_24h, w.avg_daily_7d)        AS velocity_ratio_7d,
      SAFE_DIVIDE(w.units_24h - w.units_prev_24h, NULLIF(w.units_prev_24h, 0)) AS dod_delta,
      SAFE_DIVIDE(w.units_24h - w.avg_daily_13d_excl, NULLIF(s.sd_daily_units, 0)) AS z_score,
      w.rev_24h
    FROM windows w
    LEFT JOIN stats  s USING (region, product_id)
    LEFT JOIN spread sp USING (product_id)
    WHERE w.units_24h > 0 AND w.avg_daily_13d_excl > 0
      AND (
        SAFE_DIVIDE(w.units_24h, w.avg_daily_13d_excl) >= 1.4   -- spike OR
        OR SAFE_DIVIDE(w.units_24h, w.avg_daily_13d_excl) <= 0.5 -- slump
      )
    ORDER BY ABS(LN(SAFE_DIVIDE(w.units_24h, w.avg_daily_13d_excl))) DESC
    LIMIT @limit
    """
    params = [
        bigquery.ScalarQueryParameter("mfr",   "STRING", mfr_id or ""),
        bigquery.ScalarQueryParameter("limit", "INT64",  limit),
    ]
    try:
        rows = run_query(sql, params=params)
    except Exception:
        logger.exception("[pulse_intel] evidence query failed")
        return []

    # Flatten APPROX_TOP_COUNT structs → list of {value, count}
    for r in rows:
        td = r.get("top_drivers_24h") or []
        r["top_drivers_24h"] = [
            {"distributor_id": d.get("value"), "events": d.get("count")}
            for d in td if d.get("value")
        ]
        # Surface numeric types JSON-safely
        for k in (
            "units_24h", "units_prev_24h", "events_24h", "avg_daily_7d",
            "avg_daily_13d_excl", "active_distributors_24h", "sd_daily_units",
            "regions_active_24h", "velocity_ratio_14d", "velocity_ratio_7d",
            "dod_delta", "z_score", "rev_24h",
        ):
            if r.get(k) is not None:
                r[k] = float(r[k]) if isinstance(r[k], (int, float)) else r[k]
    return rows


# ---------------------------------------------------------------------------
# Per-signal Gemini briefing — structured JSON.
# ---------------------------------------------------------------------------
INTEL_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "briefings": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "product_id":  {"type": "STRING"},
                    "region":      {"type": "STRING"},
                    "severity":    {"type": "STRING", "enum": ["CRITICAL", "HIGH", "MEDIUM", "INFO"]},
                    "signal_type": {"type": "STRING", "enum": ["DEMAND_SPIKE", "DEMAND_SLUMP", "STABLE_GROWTH", "VOLATILE"]},
                    "headline":    {"type": "STRING"},
                    "narrative":   {"type": "STRING"},
                    "hypotheses": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "hypothesis": {"type": "STRING"},
                                "confidence": {"type": "NUMBER"},
                                "evidence":   {"type": "STRING"},
                            },
                            "required": ["hypothesis", "confidence", "evidence"],
                        },
                    },
                    "trajectory_24h": {
                        "type": "OBJECT",
                        "properties": {
                            "expected_units":         {"type": "NUMBER"},
                            "expected_revenue_naira": {"type": "NUMBER"},
                            "confidence":             {"type": "NUMBER"},
                        },
                        "required": ["expected_units", "expected_revenue_naira", "confidence"],
                    },
                    "recommended_actions": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "action":    {"type": "STRING"},
                                "priority":  {"type": "INTEGER"},
                                "rationale": {"type": "STRING"},
                                "owner":     {"type": "STRING", "enum": ["Supply Planning", "Trade Marketing", "Sales Ops", "Warehouse Ops", "Finance"]},
                            },
                            "required": ["action", "priority", "rationale", "owner"],
                        },
                    },
                    "risk_flags": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["product_id", "region", "severity", "signal_type",
                             "headline", "narrative", "hypotheses",
                             "trajectory_24h", "recommended_actions", "risk_flags"],
            },
        },
    },
    "required": ["briefings"],
}


EXEC_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "headline":   {"type": "STRING"},
        "narrative":  {"type": "STRING"},
        "themes":     {"type": "ARRAY", "items": {"type": "STRING"}},
        "top_action": {"type": "STRING"},
    },
    "required": ["headline", "narrative", "themes", "top_action"],
}


# Combined schema — produces briefings AND the executive summary in ONE call
# to halve Vertex AI quota consumption.
COMBINED_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "briefings":         INTEL_SCHEMA["properties"]["briefings"],
        "executive_summary": EXEC_SCHEMA,
    },
    "required": ["briefings", "executive_summary"],
}


SYSTEM_PROMPT_INTEL = (
    "You are a senior FMCG supply-chain demand intelligence analyst working for a "
    "Nigerian manufacturer. You receive an *evidence pack* of statistical signals "
    "per (region, product) over the last 24h vs the trailing 14 days. "
    "For EACH row in the input, return a briefing object that:\n"
    "  • Classifies severity using these rules:\n"
    "      CRITICAL = |z_score| ≥ 3 OR velocity_ratio_14d ≥ 3 OR ≤ 0.33\n"
    "      HIGH     = |z_score| ≥ 2 OR velocity_ratio_14d ≥ 2 OR ≤ 0.5\n"
    "      MEDIUM   = otherwise but still flagged\n"
    "      INFO     = small statistically-weak signal\n"
    "  • Picks signal_type: DEMAND_SPIKE (>1.5×), DEMAND_SLUMP (<0.66×), STABLE_GROWTH, VOLATILE.\n"
    "  • headline: ≤ 12 words, action-oriented.\n"
    "  • narrative: 2 sentences. Reference the actual numbers — units, ₦ revenue, "
    "    velocity multiplier, region, day-over-day delta. Use ₦ for Naira.\n"
    "  • hypotheses: 2-3 RANKED candidate causes. confidence ∈ [0,1]. "
    "    evidence must cite a specific datapoint from the evidence row "
    "    (distributor concentration, regional spread, day-over-day delta, "
    "    z-score). DO NOT invent data not in the row.\n"
    "  • trajectory_24h: project the next 24h units & revenue using the recent "
    "    momentum (units_24h, dod_delta, velocity_ratio_7d). Set confidence "
    "    based on stability (lower sd_daily_units ⇒ higher confidence). "
    "    Revenue ≈ projected_units × (rev_24h / units_24h).\n"
    "  • recommended_actions: 2-4 concrete actions, each assigned an owner from "
    "    the enum and priority 1 (do first) → 4. Allocation, promo verification, "
    "    inventory transfer, and pricing reviews are all valid. Avoid generic advice.\n"
    "  • risk_flags: short snake_case tags (e.g. stockout_risk_72h, "
    "    single_distributor_dependency, unauthorized_promo_suspected, "
    "    regional_concentration_risk, momentum_decelerating).\n"
    "Return STRICT JSON matching the schema. No prose outside JSON."
)


SYSTEM_PROMPT_EXEC = (
    "You are briefing a manufacturer's COO at 9am. Given the list of regional "
    "(product, region) demand briefings, write a network-level executive summary:\n"
    "  • headline: ≤ 14 words, the ONE thing the COO needs to know.\n"
    "  • narrative: 2-3 sentences synthesising the most material patterns "
    "    across regions and products. Reference ₦ revenue impact and specific "
    "    regions. NO bullet points, NO line breaks.\n"
    "  • themes: 2-4 short tag phrases (e.g. 'Abuja seasonal acceleration', "
    "    'Lagos distributor concentration', 'Kano slump').\n"
    "  • top_action: the single highest-priority action across the network."
)


SYSTEM_PROMPT_COMBINED = (
    SYSTEM_PROMPT_INTEL
    + "\n\nIn addition to the per-row briefings, also produce a network-level "
      "`executive_summary` object: a single COO-ready synthesis of the most "
      "material patterns across all rows.\n"
      "  • headline: ≤ 14 words, the ONE thing the COO needs to know.\n"
      "  • narrative: 2-3 sentences synthesising the most material patterns, "
      "    referencing ₦ revenue impact and specific regions.\n"
      "  • themes: 2-4 short tag phrases.\n"
      "  • top_action: the single highest-priority action across the network.\n"
      "Return ONE JSON object with both `briefings` and `executive_summary` keys."
)


async def generate_intelligence(signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Single-call Gemini pipeline — returns {briefings, executive_summary, ai_status}.

    Halves Vertex AI quota consumption vs running briefings + exec in two
    separate calls, and gives the model holistic context for both outputs.
    If Vertex AI hits quota/error, returns a deterministic evidence-only
    fallback so the UI still surfaces actionable insight.
    """
    if not signals:
        return {"briefings": [], "executive_summary": None, "ai_status": "no_signals"}
    if not vertex_llm.is_configured():
        return {**_fallback_briefings(signals), "ai_status": "vertex_not_configured"}

    trim_cols = (
        "region", "product_id", "product_name",
        "units_24h", "units_prev_24h", "events_24h",
        "avg_daily_7d", "avg_daily_13d_excl",
        "active_distributors_24h", "regions_active_24h",
        "velocity_ratio_14d", "velocity_ratio_7d",
        "dod_delta", "z_score", "rev_24h",
        "top_drivers_24h",
    )
    payload = [{k: r.get(k) for k in trim_cols} for r in signals]

    import json as _json
    try:
        out = await vertex_llm.complete_json(
            system=SYSTEM_PROMPT_COMBINED,
            user=_json.dumps(payload, default=str),
            response_schema=COMBINED_SCHEMA,
            temperature=0.25,
            max_output_tokens=6500,
        )
    except Exception as e:
        logger.warning("[pulse_intel] vertex call failed (%s) — using evidence-only fallback", e)
        return {**_fallback_briefings(signals), "ai_status": f"fallback: {type(e).__name__}"}

    if not isinstance(out, dict) or not out.get("briefings"):
        return {**_fallback_briefings(signals), "ai_status": "fallback: empty_response"}

    briefings = out.get("briefings") or []
    exec_summary = out.get("executive_summary")

    # Stitch evidence back into each briefing.
    idx = {(r["product_id"], r["region"]): r for r in signals}
    for b in briefings:
        ev = idx.get((b.get("product_id"), b.get("region")))
        if not ev:
            continue
        b["evidence"] = _evidence_dict(ev)
        b["product_name"] = ev.get("product_name") or b.get("product_id")
    # Severity ordering for the UI.
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}
    briefings.sort(key=lambda x: (order.get(x.get("severity"), 9),
                                   -float((x.get("evidence") or {}).get("velocity_ratio_14d") or 0)))
    return {"briefings": briefings, "executive_summary": exec_summary, "ai_status": "vertex_ai"}


# ---------------------------------------------------------------------------
# Evidence-only fallback — deterministic briefings derived from BQ signals.
# Used when Vertex AI is unavailable so the UI never shows a blank panel.
# ---------------------------------------------------------------------------
def _evidence_dict(ev: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "units_24h":               ev.get("units_24h"),
        "units_prev_24h":          ev.get("units_prev_24h"),
        "avg_daily_7d":            ev.get("avg_daily_7d"),
        "avg_daily_13d_excl":      ev.get("avg_daily_13d_excl"),
        "velocity_ratio_14d":      ev.get("velocity_ratio_14d"),
        "velocity_ratio_7d":       ev.get("velocity_ratio_7d"),
        "dod_delta":               ev.get("dod_delta"),
        "z_score":                 ev.get("z_score"),
        "active_distributors_24h": ev.get("active_distributors_24h"),
        "regions_active_24h":      ev.get("regions_active_24h"),
        "rev_24h":                 ev.get("rev_24h"),
        "top_drivers_24h":         ev.get("top_drivers_24h"),
    }


def _fallback_briefings(signals: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Deterministic, evidence-only briefings used when Vertex AI is offline."""
    briefings: List[Dict[str, Any]] = []
    biggest_rev = 0.0
    biggest = None
    for ev in signals:
        vel = float(ev.get("velocity_ratio_14d") or 0)
        z = abs(float(ev.get("z_score") or 0))
        if   vel >= 3 or z >= 3:
            sev = "CRITICAL"
        elif vel >= 2 or z >= 2:
            sev = "HIGH"
        elif vel <= 0.33:
            sev = "CRITICAL"
        elif vel <= 0.5:
            sev = "HIGH"
        else:
            sev = "MEDIUM"
        if   vel >= 1.5:
            sig = "DEMAND_SPIKE"
        elif vel <= 0.66:
            sig = "DEMAND_SLUMP"
        else:
            sig = "STABLE_GROWTH"
        units = int(ev.get("units_24h") or 0)
        rev   = float(ev.get("rev_24h") or 0)
        if rev > biggest_rev:
            biggest_rev, biggest = rev, ev
        active = int(ev.get("active_distributors_24h") or 0)
        spread = int(ev.get("regions_active_24h") or 0)
        dod = float(ev.get("dod_delta") or 0)
        name = ev.get("product_name") or ev.get("product_id")
        region = ev.get("region")

        narrative = (
            f"{name} moved {units:,} units in {region} over the last 24h — "
            f"{vel:.1f}× the 14-day baseline ({float(ev.get('avg_daily_13d_excl') or 0):.0f}/day). "
            f"Day-over-day change: {dod*100:+.0f}%."
        )
        hyps = []
        td = ev.get("top_drivers_24h") or []
        if td and len(td) <= 2:
            hyps.append({"hypothesis": "Spike concentrated in 1-2 distributors (possible localised promo or order anomaly).",
                         "confidence": 0.6,
                         "evidence": f"Top 24h drivers: {', '.join(t.get('distributor_id','?') for t in td)}"})
        if spread <= 1:
            hyps.append({"hypothesis": "Geographically isolated to one region — local event, not network-wide demand.",
                         "confidence": 0.55,
                         "evidence": f"Product active in {spread} region(s) last 24h"})
        if abs(dod) > 0.5:
            hyps.append({"hypothesis": "Demand accelerating — momentum building, not noise.",
                         "confidence": 0.5,
                         "evidence": f"Day-over-day delta {dod*100:+.0f}%"})
        if not hyps:
            hyps.append({"hypothesis": "Statistically significant deviation from 14d norm.",
                         "confidence": 0.5,
                         "evidence": f"z-score {float(ev.get('z_score') or 0):.2f}"})

        # Trajectory: project 24h units via momentum * stable revenue/unit ratio.
        rate = (rev / units) if units else 0
        proj_units = int(units * (1 + max(dod, -0.5)))
        proj_rev = proj_units * rate

        actions = []
        if sig == "DEMAND_SPIKE" and sev in ("CRITICAL", "HIGH"):
            actions += [
                {"priority": 1, "owner": "Supply Planning",
                 "action": f"Allocate {max(units, 5000):,} additional units to {region} DC in next 24h",
                 "rationale": f"Current 24h velocity {vel:.1f}× baseline implies stock-out within 48-72h without intervention."},
                {"priority": 2, "owner": "Trade Marketing",
                 "action": "Verify whether a promotion or campaign is live in this region.",
                 "rationale": "Distinguish authorised promotional lift from unauthorised channel activity."},
            ]
        elif sig == "DEMAND_SLUMP":
            actions += [
                {"priority": 1, "owner": "Sales Ops",
                 "action": f"Investigate root cause of {region} slowdown for {name}",
                 "rationale": f"Run-rate down to {vel:.0%} of baseline — risk of inventory ageing."},
                {"priority": 2, "owner": "Trade Marketing",
                 "action": f"Consider a regional reactivation promo for {region}.",
                 "rationale": "Demand stimulation needed before product holds excess inventory."},
            ]
        else:
            actions += [{"priority": 1, "owner": "Sales Ops",
                         "action": "Monitor trajectory; no immediate action required.",
                         "rationale": "Within statistical noise band."}]

        flags = []
        if active <= 2:
            flags.append("single_distributor_dependency")
        if spread <= 1:
            flags.append("regional_concentration_risk")
        if vel >= 2:
            flags.append("stockout_risk_72h")
        if vel <= 0.5:
            flags.append("inventory_aging_risk")
        if abs(dod) > 0.6:
            flags.append("momentum_accelerating")

        briefings.append({
            "product_id":   ev.get("product_id"),
            "product_name": name,
            "region":       region,
            "severity":     sev,
            "signal_type":  sig,
            "headline":     f"{name} — {sig.replace('_',' ').title()} in {region} ({vel:.1f}× baseline)",
            "narrative":    narrative,
            "hypotheses":   hyps[:3],
            "trajectory_24h": {
                "expected_units":         proj_units,
                "expected_revenue_naira": round(proj_rev, 0),
                "confidence":             0.55,
            },
            "recommended_actions": actions,
            "risk_flags":          flags,
            "evidence":            _evidence_dict(ev),
        })

    # Order by severity.
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}
    briefings.sort(key=lambda x: (order.get(x.get("severity"), 9),
                                   -float((x.get("evidence") or {}).get("velocity_ratio_14d") or 0)))

    # Exec summary in fallback mode.
    if biggest is not None:
        big_name = biggest.get("product_name") or biggest.get("product_id")
        big_region = biggest.get("region")
        exec_summary = {
            "headline":  f"{len(briefings)} significant demand signals across the network",
            "narrative": (
                f"Top revenue mover is {big_name} in {big_region} (₦{biggest_rev:,.0f} in 24h). "
                f"Across the network, {sum(1 for b in briefings if b['severity']=='CRITICAL')} signals are "
                f"CRITICAL and {sum(1 for b in briefings if b['severity']=='HIGH')} are HIGH. "
                "Vertex AI synthesis temporarily unavailable; rule-based briefing in use."
            ),
            "themes":    list({b["signal_type"] for b in briefings})[:4],
            "top_action": (briefings[0]["recommended_actions"][0]["action"] if briefings else ""),
        }
    else:
        exec_summary = None

    return {"briefings": briefings, "executive_summary": exec_summary}


async def generate_briefings(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Run Gemini over the evidence pack and return enriched per-signal briefings."""
    if not signals or not vertex_llm.is_configured():
        return []

    # Trim the payload to the columns Gemini actually needs to reason.
    trim_cols = (
        "region", "product_id", "product_name",
        "units_24h", "units_prev_24h", "events_24h",
        "avg_daily_7d", "avg_daily_13d_excl",
        "active_distributors_24h", "regions_active_24h",
        "velocity_ratio_14d", "velocity_ratio_7d",
        "dod_delta", "z_score", "rev_24h",
        "top_drivers_24h",
    )
    payload = [{k: r.get(k) for k in trim_cols} for r in signals]

    import json as _json
    try:
        out = await vertex_llm.complete_json(
            system=SYSTEM_PROMPT_INTEL,
            user=_json.dumps(payload, default=str),
            response_schema=INTEL_SCHEMA,
            temperature=0.25,
            max_output_tokens=6000,
        )
    except Exception:
        logger.exception("[pulse_intel] briefing generation failed")
        return []

    briefings = (out or {}).get("briefings") if isinstance(out, dict) else None
    if not briefings:
        return []

    # Stitch briefings back to original evidence rows by (product_id, region).
    idx = {(r["product_id"], r["region"]): r for r in signals}
    for b in briefings:
        key = (b.get("product_id"), b.get("region"))
        if key in idx:
            ev = idx[key]
            b["evidence"] = {
                "units_24h":             ev.get("units_24h"),
                "units_prev_24h":        ev.get("units_prev_24h"),
                "avg_daily_7d":          ev.get("avg_daily_7d"),
                "avg_daily_13d_excl":    ev.get("avg_daily_13d_excl"),
                "velocity_ratio_14d":    ev.get("velocity_ratio_14d"),
                "velocity_ratio_7d":     ev.get("velocity_ratio_7d"),
                "dod_delta":             ev.get("dod_delta"),
                "z_score":               ev.get("z_score"),
                "active_distributors_24h": ev.get("active_distributors_24h"),
                "regions_active_24h":    ev.get("regions_active_24h"),
                "rev_24h":               ev.get("rev_24h"),
                "top_drivers_24h":       ev.get("top_drivers_24h"),
            }
            b["product_name"] = ev.get("product_name") or b.get("product_id")
    # Rank: CRITICAL first, then HIGH, MEDIUM, INFO
    order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "INFO": 3}
    briefings.sort(key=lambda x: (order.get(x.get("severity"), 9), -float(x.get("evidence", {}).get("velocity_ratio_14d") or 0)))
    return briefings


async def generate_exec_summary(briefings: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """One-shot network-level COO briefing."""
    if not briefings or not vertex_llm.is_configured():
        return None
    import json as _json
    # Pass only the key fields per briefing — keeps the prompt tight.
    compact = [{
        "region":   b.get("region"),
        "product":  b.get("product_name") or b.get("product_id"),
        "severity": b.get("severity"),
        "signal":   b.get("signal_type"),
        "headline": b.get("headline"),
        "rev_24h":  (b.get("evidence") or {}).get("rev_24h"),
        "velocity": (b.get("evidence") or {}).get("velocity_ratio_14d"),
    } for b in briefings[:12]]
    try:
        return await vertex_llm.complete_json(
            system=SYSTEM_PROMPT_EXEC,
            user=_json.dumps(compact, default=str),
            response_schema=EXEC_SCHEMA,
            temperature=0.3,
            max_output_tokens=900,
        )
    except Exception:
        logger.exception("[pulse_intel] exec summary failed")
        return None
