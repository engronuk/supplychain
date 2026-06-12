"""Logistics event bus — the control tower is event-driven.

Every logistics action (shipment lifecycle, vehicle motion exception,
geofence transition, delivery) emits an immutable event into the
`logistics_events` collection. The Command Center UI, alert feed, shipment
timelines, and future analytics/AI layers all read from this stream.

Event doc shape:
    id, manufacturer_id, event_type, category, severity,
    title, detail, vehicle_id, vehicle_code, shipment_id, ref_code,
    lat, lng, location_name, meta{}, acknowledged, acknowledged_at,
    created_at
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from core import db, logger, now_iso

# event_type → (category, default severity)
EVENT_TYPES: Dict[str, tuple] = {
    "shipment_created":    ("shipment", "info"),
    "shipment_loaded":     ("shipment", "info"),
    "vehicle_dispatched":  ("vehicle",  "info"),
    "warehouse_arrived":   ("geofence", "info"),
    "warehouse_departed":  ("geofence", "info"),
    "geofence_enter":      ("geofence", "info"),
    "geofence_exit":       ("geofence", "info"),
    "route_deviation":     ("route",    "critical"),
    "deviation_resolved":  ("route",    "info"),
    "unauthorized_stop":   ("route",    "warning"),
    "stop_resolved":       ("route",    "info"),
    "delay_detected":      ("shipment", "warning"),
    "vehicle_breakdown":   ("vehicle",  "critical"),
    "breakdown_resolved":  ("vehicle",  "info"),
    "delivery_attempt":    ("delivery", "info"),
    "delivery_completed":  ("delivery", "info"),
    "delivery_failed":     ("delivery", "warning"),
    "inventory_low":       ("inventory", "warning"),
    "vehicle_idle":        ("vehicle",  "warning"),
}

EVENT_RETENTION_DAYS = 14


async def emit(
    manufacturer_id: str,
    event_type: str,
    title: str,
    detail: str = "",
    *,
    severity: Optional[str] = None,
    vehicle_id: Optional[str] = None,
    vehicle_code: Optional[str] = None,
    shipment_id: Optional[str] = None,
    ref_code: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    location_name: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    category, default_sev = EVENT_TYPES.get(event_type, ("shipment", "info"))
    event = {
        "id": str(uuid.uuid4()),
        "manufacturer_id": manufacturer_id,
        "event_type": event_type,
        "category": category,
        "severity": severity or default_sev,
        "title": title,
        "detail": detail,
        "vehicle_id": vehicle_id,
        "vehicle_code": vehicle_code,
        "shipment_id": shipment_id,
        "ref_code": ref_code,
        "lat": lat,
        "lng": lng,
        "location_name": location_name,
        "meta": meta or {},
        "acknowledged": False,
        "acknowledged_at": None,
        "created_at": now_iso(),
    }
    try:
        await db.logistics_events.insert_one(dict(event))
    except Exception:
        logger.exception("[events] failed to emit %s", event_type)
    event.pop("_id", None)
    return event


async def purge_old() -> int:
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=EVENT_RETENTION_DAYS)).isoformat()
    res = await db.logistics_events.delete_many({"created_at": {"$lt": cutoff}})
    return res.deleted_count
