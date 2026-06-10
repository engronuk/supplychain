"""Proactive Intelligence Engine — Vertex AI powered.

For each (region, product) signal we expose to the Manufacturer Command
Center, we:

  1. Pull a *rich evidence pack* from BigQuery (multi-window velocity,
     day-over-day delta, statistical significance, distributor concentration,
     regional spread, top-distributor drivers).
  2. Feed the evidence pack to Vertex AI Gemini under a **strict JSON
     schema** (response_mime_type=application/json + response_schema). The
     model is forced to emit severity, headline, ranked root-cause
     hypotheses with confidence + evidence, a 24h trajectory forecast, a
     priority-ordered list of recommended actions, and risk flags.
  3. Generate a network-level *executive briefing* in a second pass —
     a 2–3 sentence synthesis a manufacturer COO can act on at a glance.

This module is the only place that talks to Vertex AI for the Pulse system.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from google.cloud import bigquery

from services.bigquery_client import full_table_id, get_client, run_query
from services import vertex_llm

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# BigQuery evidence pack — combines several signals into one row per
# (region, product). Limited to top-50 by composite signal score.
# ---------------------------------------------------------------------------
def gather_signals(mfr_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Return the top-N (region, product) signals worth AI analysis."""
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
