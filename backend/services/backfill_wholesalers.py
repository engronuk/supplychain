"""Wholesaler ↔ organizations backfill.

The codebase has two collections that historically tracked wholesalers:

* ``wholesalers`` — dedicated table consumed by Fleet, distributor reports,
  ``seed_fleet_production`` and other Track A surfaces.
* ``organizations`` (where ``organization_type="wholesaler"``) — populated
  by the org-graph simulator and consumed by the distributor dashboard
  network panel, the wholesaler search index, and several intelligence
  views.

Per the **2026-06-23 single-source-of-truth audit** the
``wholesalers`` collection is the canonical table. This backfill keeps
both tables in agreement by **mirroring** the contents of
``organizations`` (filtered to ``organization_type=wholesaler``) into the
``wholesalers`` table on every backend boot AND every 5 minutes via a
scheduled job. The mirror is one-way (orgs → wholesalers); nothing in the
codebase writes to the ``wholesalers`` table, so the reverse direction is
not required today.

The backfill is idempotent — only inserts missing rows and only updates
fields that have actually drifted.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core import db, logger


FIELDS_TO_MIRROR = (
    "name", "manufacturer_id", "distributor_id", "city", "state",
    "region", "address", "latitude", "longitude", "contact_email",
    "contact_phone", "organization_code", "is_active",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _org_to_wholesaler(org: Dict[str, Any]) -> Dict[str, Any]:
    """Project an ``organizations`` row into the ``wholesalers`` schema."""
    meta = org.get("metadata") or {}
    distributor_id = (
        meta.get("distributor_id")
        or (org.get("parent_id") if org.get("parent_type") == "distributor" else None)
        or org.get("distributor_id")
    )
    manufacturer_id = meta.get("manufacturer_id") or org.get("manufacturer_id")
    return {
        "id": org["id"],
        "name": org.get("organization_name") or org.get("name"),
        "manufacturer_id": manufacturer_id,
        "distributor_id": distributor_id,
        "city": org.get("city"),
        "state": org.get("state"),
        "region": org.get("region"),
        "address": org.get("address"),
        "latitude": org.get("latitude"),
        "longitude": org.get("longitude"),
        "contact_email": org.get("contact_email"),
        "contact_phone": org.get("contact_phone"),
        "organization_code": org.get("organization_code"),
        "is_active": (org.get("status") or "active") == "active",
        # Provenance — lets downstream code tell mirrored rows apart from
        # rows hand-created in the wholesalers table if that ever happens.
        "synced_from_organizations": True,
        "synced_at": _now_iso(),
    }


async def backfill_wholesalers() -> Dict[str, Any]:
    """Mirror every ``organizations`` wholesaler row into the
    ``wholesalers`` table. Returns counts. Safe to call repeatedly."""
    inserted = 0
    updated = 0
    skipped = 0
    scanned = 0

    cursor = db.organizations.find({"organization_type": "wholesaler"}, {"_id": 0})
    async for org in cursor:
        scanned += 1
        if not org.get("id"):
            skipped += 1
            continue
        projected = _org_to_wholesaler(org)
        if not projected["name"]:
            # Unnameable — skip rather than write a junk row
            skipped += 1
            continue
        existing = await db.wholesalers.find_one({"id": projected["id"]}, {"_id": 0})
        if not existing:
            projected["created_at"] = _now_iso()
            projected["updated_at"] = projected["synced_at"]
            await db.wholesalers.insert_one(projected)
            inserted += 1
            continue
        # Compare only the mirrored fields — anything else stays as-is
        drift: Dict[str, Any] = {}
        for f in FIELDS_TO_MIRROR:
            if existing.get(f) != projected.get(f):
                drift[f] = projected.get(f)
        if drift:
            drift["synced_at"] = projected["synced_at"]
            drift["updated_at"] = projected["synced_at"]
            await db.wholesalers.update_one(
                {"id": projected["id"]},
                {"$set": drift},
            )
            updated += 1
        else:
            skipped += 1

    summary = {"scanned": scanned, "inserted": inserted,
               "updated": updated, "skipped": skipped}
    if inserted or updated:
        logger.info("Wholesaler backfill: %s", summary)
    return summary


async def backfill_wholesalers_job() -> Optional[Dict[str, Any]]:
    """Scheduler wrapper — swallows errors so a transient blip never kills
    the APScheduler heartbeat."""
    try:
        return await backfill_wholesalers()
    except Exception:
        logger.exception("Periodic wholesaler backfill failed")
        return None
