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
    "route_planned":       ("route",    "info"),
    "route_replanned":     ("route",    "info"),
    "route_completed":     ("route",    "info"),
    "delay_predicted":     ("route",    "warning"),
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
    try:
        await _fanout_notifications(event)
    except Exception:
        logger.exception("[events] notification fan-out failed for %s", event_type)
    return event


# ---------------------------------------------------------------------------
# In-app notification fan-out — the event bus feeds the bell icon.
# ---------------------------------------------------------------------------
# Events that should also notify the *destination* party of the shipment,
# phrased from their perspective. {ref} is the tracking/route code.
_DEST_NOTIFY: Dict[str, tuple] = {
    "shipment_created":   ("Inbound shipment {ref} on the way", "info"),
    "delay_detected":     ("Inbound shipment {ref} is running late", "warning"),
    "vehicle_breakdown":  ("Inbound shipment {ref} held up — truck breakdown", "critical"),
    "route_deviation":    ("Inbound shipment {ref} is off its approved route", "critical"),
    "delivery_completed": ("Shipment {ref} delivered", "info"),
    "delivery_failed":    ("Delivery attempt for {ref} failed", "warning"),
}
# Info-severity events the manufacturer ops team still wants in their feed.
_MFR_INFO_NOTIFY = {"delivery_completed", "route_completed",
                    "route_planned", "route_replanned"}
_DEDUPE_WINDOW_MIN = 45


async def notify(
    target_type: str,
    target_id: str,
    title: str,
    message: str,
    *,
    ntype: str = "system",
    severity: str = "info",
    dedupe_key: Optional[str] = None,
) -> None:
    """Insert an in-app notification (popover feed). `dedupe_key` suppresses
    repeats of the same alert for the same target within a 45-min window."""
    if not target_id:
        return
    if dedupe_key:
        cutoff = (datetime.now(timezone.utc)
                  - timedelta(minutes=_DEDUPE_WINDOW_MIN)).isoformat()
        dup = await db.notifications.find_one(
            {"target_type": target_type, "target_id": target_id,
             "dedupe_key": dedupe_key, "created_at": {"$gte": cutoff}},
            {"_id": 1})
        if dup:
            return
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "target_type": target_type, "target_id": target_id,
        "title": title, "message": message,
        "type": ntype, "severity": severity,
        "dedupe_key": dedupe_key,
        "read": False, "created_at": now_iso(),
    })


async def _fanout_notifications(event: Dict[str, Any]) -> None:
    etype = event["event_type"]
    sev = event["severity"]
    key = f"{etype}:{event.get('vehicle_code') or event.get('ref_code') or ''}"

    # Manufacturer ops feed: every warning/critical + key milestones.
    # Dedupe only recurring alert types — milestone/info events (route
    # planned, replanned, delivered) are each distinct occurrences.
    if sev in ("warning", "critical") or etype in _MFR_INFO_NOTIFY:
        await notify("manufacturer", event["manufacturer_id"],
                     event["title"], event.get("detail") or event["title"],
                     ntype=event["category"], severity=sev,
                     dedupe_key=key if sev in ("warning", "critical") else None)

    # Destination party feed (distributor / wholesaler / retailer / warehouse).
    dest = _DEST_NOTIFY.get(etype)
    if dest and event.get("shipment_id"):
        sh = await db.shipments.find_one(
            {"id": event["shipment_id"]}, {"_id": 0, "to_id": 1, "to_role": 1})
        to_role, to_id = (sh or {}).get("to_role"), (sh or {}).get("to_id")
        if to_id and to_role in ("distributor", "wholesaler", "retailer", "warehouse"):
            title_tpl, dsev = dest
            ref = event.get("ref_code") or "—"
            await notify(to_role, to_id, title_tpl.format(ref=ref),
                         event.get("detail") or event["title"],
                         ntype=event["category"], severity=dsev,
                         dedupe_key=(f"{key}:{to_id}"
                                     if dsev in ("warning", "critical") else None))


async def purge_old() -> int:
    cutoff = (datetime.now(timezone.utc)
              - timedelta(days=EVENT_RETENTION_DAYS)).isoformat()
    res = await db.logistics_events.delete_many({"created_at": {"$lt": cutoff}})
    return res.deleted_count
