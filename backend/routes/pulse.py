"""Real-Time Pulse API — distributor/retailer sales-event ingestion.

POST /api/pulse/event           — single sales event → streaming insert
POST /api/pulse/events:batch    — bulk (≤ 500) sales events
GET  /api/pulse/health          — verify GCP connectivity, dataset ready
GET  /api/pulse/by-region       — aggregated sales for the Manufacturer
                                  Command Center map
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from google.cloud import bigquery
from pydantic import BaseModel, Field

from services.auth import get_current_user
from services.bigquery_client import (
    ensure_dataset_and_table, full_table_id, get_client, insert_events, run_query,
)

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class PulseEvent(BaseModel):
    region: str = Field(..., min_length=1, max_length=120)
    product_id: str
    product_name: Optional[str] = None
    distributor_id: str
    retailer_id: Optional[str] = None
    units_sold: int = Field(..., gt=0)
    value_naira: float = Field(..., ge=0)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    occurred_at: Optional[datetime] = None
    manufacturer_id: Optional[str] = None


class PulseBatch(BaseModel):
    events: List[PulseEvent] = Field(..., min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_bq_row(ev: PulseEvent, manufacturer_id: Optional[str]) -> Dict[str, Any]:
    return {
        "event_id":        str(uuid.uuid4()),
        "region":          ev.region,
        "product_id":      ev.product_id,
        "product_name":    ev.product_name,
        "distributor_id":  ev.distributor_id,
        "retailer_id":     ev.retailer_id,
        "units_sold":      ev.units_sold,
        "value_naira":     str(ev.value_naira),  # NUMERIC accepts string
        "latitude":        ev.latitude,
        "longitude":       ev.longitude,
        "occurred_at":     (ev.occurred_at or datetime.now(timezone.utc)).isoformat(),
        "ingested_at":     datetime.now(timezone.utc).isoformat(),
        "manufacturer_id": ev.manufacturer_id or manufacturer_id,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/pulse/health")
async def pulse_health():
    """PUBLIC ops endpoint — verifies GCP connectivity + dataset bootstrap so
    operators can confirm Cloud Run can reach BigQuery and Vertex AI without
    needing a JWT. Returns provisioned table info (no secrets)."""
    if get_client() is None:
        raise HTTPException(503, "GCP not configured — missing GCP_PROJECT_ID (or GOOGLE_CLOUD_PROJECT) env var")
    try:
        info = ensure_dataset_and_table()
    except Exception as e:
        logger.exception("[pulse] bootstrap failed")
        raise HTTPException(500, f"BigQuery bootstrap failed: {e}")
    # Bonus: probe Vertex AI as well so health covers both services at once.
    try:
        from services import vertex_llm
        info["vertex_ai_configured"] = vertex_llm.is_configured()
        info["vertex_ai_model"] = vertex_llm.DEFAULT_MODEL
    except Exception:
        info["vertex_ai_configured"] = False
    return info


@router.post("/pulse/event")
async def post_event(
    event: PulseEvent,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = user.get("manufacturer_id") or user.get("organization_id")
    row = _to_bq_row(event, manufacturer_id=mfr)
    try:
        errors = insert_events([row])
    except Exception as e:
        logger.exception("[pulse] insert failed")
        raise HTTPException(500, f"BigQuery insert failed: {e}")
    if errors:
        raise HTTPException(500, f"BigQuery rejected row: {errors}")
    return {"status": "accepted", "event_id": row["event_id"]}


@router.post("/pulse/events:batch")
async def post_batch(
    payload: PulseBatch,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = user.get("manufacturer_id") or user.get("organization_id")
    rows = [_to_bq_row(e, manufacturer_id=mfr) for e in payload.events]
    try:
        errors = insert_events(rows)
    except Exception as e:
        logger.exception("[pulse] batch insert failed")
        raise HTTPException(500, f"BigQuery insert failed: {e}")
    if errors:
        raise HTTPException(500, f"BigQuery rejected rows: {errors}")
    return {"status": "accepted", "count": len(rows)}


@router.get("/pulse/by-region")
async def by_region(
    hours: int = 24,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Aggregated sales per region for the last N hours. Powers the
    Manufacturer Command Center map."""
    if get_client() is None:
        raise HTTPException(503, "GCP not configured")
    mfr = user.get("manufacturer_id") or user.get("organization_id") or ""
    q = f"""
        SELECT
          region,
          SUM(units_sold)  AS units,
          SUM(CAST(value_naira AS FLOAT64)) AS revenue,
          COUNT(*)         AS events,
          AVG(latitude)    AS latitude,
          AVG(longitude)   AS longitude
        FROM `{full_table_id()}`
        WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hours HOUR)
          AND (@mfr = "" OR manufacturer_id = @mfr)
        GROUP BY region
        ORDER BY revenue DESC
    """
    params = [
        bigquery.ScalarQueryParameter("hours", "INT64", hours),
        bigquery.ScalarQueryParameter("mfr",   "STRING", mfr),
    ]
    try:
        rows = run_query(q, params=params)
    except Exception as e:
        logger.exception("[pulse] by-region query failed")
        raise HTTPException(500, f"BigQuery query failed: {e}")
    for r in rows:
        # Ensure JSON-safe shapes for numeric columns
        if r.get("revenue") is not None:
            r["revenue"] = float(r["revenue"])
    return {"window_hours": hours, "rows": rows}


@router.get("/pulse/alerts")
async def alerts(user: Dict[str, Any] = Depends(get_current_user)):
    """Proactive-restock candidates: SKUs whose 24h velocity is ≥ 1.5× the
    trailing 14-day daily average."""
    if get_client() is None:
        raise HTTPException(503, "GCP not configured")
    mfr = user.get("manufacturer_id") or user.get("organization_id") or ""
    q = f"""
        WITH recent AS (
          SELECT region, product_id, ANY_VALUE(product_name) AS product_name,
                 SUM(units_sold) AS units_24h
          FROM `{full_table_id()}`
          WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
            AND (@mfr = "" OR manufacturer_id = @mfr)
          GROUP BY region, product_id
        ),
        history AS (
          SELECT region, product_id,
                 SUM(units_sold) / 14.0 AS avg_daily_units_14d
          FROM `{full_table_id()}`
          WHERE occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
            AND occurred_at <  TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
            AND (@mfr = "" OR manufacturer_id = @mfr)
          GROUP BY region, product_id
        )
        SELECT r.region, r.product_id, r.product_name,
               r.units_24h, h.avg_daily_units_14d,
               SAFE_DIVIDE(r.units_24h, h.avg_daily_units_14d) AS velocity_ratio
        FROM recent r JOIN history h
          ON r.region = h.region AND r.product_id = h.product_id
        WHERE SAFE_DIVIDE(r.units_24h, h.avg_daily_units_14d) >= 1.5
        ORDER BY velocity_ratio DESC
        LIMIT 50
    """
    params = [bigquery.ScalarQueryParameter("mfr", "STRING", mfr)]
    try:
        rows = run_query(q, params=params)
    except Exception as e:
        logger.exception("[pulse] alerts query failed")
        raise HTTPException(500, f"BigQuery query failed: {e}")
    return {"generated_at": datetime.now(timezone.utc).isoformat(), "alerts": rows}


@router.get("/pulse/alerts/enriched")
async def alerts_enriched(user: Dict[str, Any] = Depends(get_current_user)):
    """Alerts + one-sentence Gemini explanation per row. Graceful degrade."""
    raw = await alerts(user)
    from services import vertex_llm
    if not vertex_llm.is_configured() or not raw.get("alerts"):
        return raw

    system = (
        "You are a supply-chain demand analyst. For each row, return ONE short "
        "sentence (< 25 words) explaining the spike and the next action. Use ₦ for Naira. "
        "Return STRICT JSON array of objects with keys 'product_id','region','text' "
        "in the same order as the input."
    )
    import json as _json
    import re
    payload = _json.dumps([{
        "region": r["region"], "product_id": r["product_id"],
        "product_name": r.get("product_name"),
        "units_24h": r["units_24h"],
        "avg_daily_units_14d": float(r["avg_daily_units_14d"] or 0),
        "velocity_ratio": float(r["velocity_ratio"] or 0),
    } for r in raw["alerts"]])
    try:
        text = await vertex_llm.complete(system=system, user=payload, max_output_tokens=1200, temperature=0.3)
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if m:
            explanations = _json.loads(m.group(0))
            for r, e in zip(raw["alerts"], explanations):
                r["explanation"] = (e.get("text") or "").strip()
    except Exception:
        logger.exception("[pulse] gemini enrichment failed")
    return raw


@router.get("/pulse/intelligence")
async def intelligence(user: Dict[str, Any] = Depends(get_current_user)):
    """Proactive Intelligence Center — multi-signal evidence + structured
    Vertex AI briefings + a network-level executive summary.

    This is the canonical AI surface for the Manufacturer Command Center.
    Cached for 90 seconds per manufacturer to stay within Vertex AI quota.
    """
    if get_client() is None:
        raise HTTPException(503, "GCP not configured")
    from services import pulse_intelligence as pi
    from services import vertex_llm
    import time

    mfr = user.get("manufacturer_id") or user.get("organization_id") or ""

    # In-memory cache (TTL 90s). Vertex AI calls cost quota; the underlying
    # BQ window only refreshes when new events land, so a short cache is safe.
    global _INTEL_CACHE  # type: ignore[name-defined]
    try:
        cache = _INTEL_CACHE
    except NameError:
        cache = {}
        globals()["_INTEL_CACHE"] = cache
    now = time.time()
    hit = cache.get(mfr)
    if hit and (now - hit["t"]) < 300:
        return {**hit["payload"], "cached": True}

    signals = pi.gather_signals(mfr)
    if not signals:
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "briefings": [],
            "executive_summary": None,
            "signal_count": 0,
            "vertex_ai_used": vertex_llm.is_configured(),
        }
        cache[mfr] = {"t": now, "payload": payload}
        return payload

    intel = await pi.generate_intelligence(signals)
    payload = {
        "generated_at":      datetime.now(timezone.utc).isoformat(),
        "briefings":         intel.get("briefings") or [],
        "executive_summary": intel.get("executive_summary"),
        "signal_count":      len(signals),
        "vertex_ai_used":    vertex_llm.is_configured(),
        "ai_status":         intel.get("ai_status") or "unknown",
    }
    cache[mfr] = {"t": now, "payload": payload}
    return payload

