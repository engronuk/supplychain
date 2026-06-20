"""Track A backfill migration — Shipment + Vehicle schema v2.

Idempotent. Re-running is a no-op once `schema_version >= 2`.
Reversible: original `status` / `dispatched_at` / `received_at` are copied to
`_legacy_*` columns before being rewritten.

Usage:
    PYTHONPATH=/app/backend python /app/backend/scripts/migrate_logistics_v2.py

Or, in code:
    from scripts.migrate_logistics_v2 import migrate
    summary = await migrate()
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Dict

# allow `python migrate_logistics_v2.py` from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import db, now_iso  # noqa: E402

# ---------------------------------------------------------------------------
# Status mappings
# ---------------------------------------------------------------------------
SHIPMENT_STATUS_MAP: Dict[str, str] = {
    # legacy → canonical
    "pending":    "created",
    "in_transit": "in_transit",
    "received":   "delivered",
    # drift values found in live data
    "shipped":    "in_transit",
    "delivered":  "delivered",
    # already-canonical values pass through
    "created":             "created",
    "ready_for_dispatch":  "ready_for_dispatch",
    "assigned":            "assigned",
    "loaded":              "loaded",
    "arrived":             "arrived",
    "cancelled":           "cancelled",
}

VEHICLE_STATUS_MAP: Dict[str, str] = {
    "idle":        "available",
    "available":   "available",
    "loading":     "loading",
    "loaded":      "loading",
    "in_transit":  "in_transit",
    "stopped":     "in_transit",
    "breakdown":   "in_transit",
    "arrived":     "offline",
    "delivered":   "offline",
    "archived":    "offline",
    "completed":   "offline",
    "cancelled":   "offline",
    "maintenance": "maintenance",
    "offline":     "offline",
    # best-effort fallbacks for unexpected legacy noise
    "pending":     "available",
    "received":    "offline",
    "created":     "available",
}


async def _derive_owner_org(shp: Dict[str, Any]) -> tuple[str, str]:
    """Find (owner_org_id, owner_org_type) for a legacy shipment."""
    from_role = (shp.get("from_role") or "").lower()
    from_id = shp.get("from_id") or ""

    # Direct dispatcher cases
    if from_role in ("manufacturer", "distributor", "wholesaler"):
        return from_id, from_role

    # warehouse-dispatched → walk to manufacturer parent
    if from_role == "warehouse" and from_id:
        org = await db.organizations.find_one(
            {"id": from_id}, {"_id": 0, "parent_organization_id": 1, "organization_type": 1})
        if org and org.get("parent_organization_id"):
            return org["parent_organization_id"], "manufacturer"

    # last resort — keep the manufacturer denorm if present
    if shp.get("manufacturer_id"):
        return shp["manufacturer_id"], "manufacturer"

    return "", ""


def _synth_history(shp: Dict[str, Any], new_status: str) -> list[dict]:
    """Construct a minimal status_history for a backfilled shipment."""
    history: list[dict] = []
    created_at = shp.get("created_at") or now_iso()

    history.append({
        "from_status": None,
        "to_status": "created",
        "at": created_at,
        "by_role": "system",
        "notes": "Backfilled (v2 migration)",
    })

    if shp.get("dispatched_at") or new_status in ("in_transit", "arrived", "delivered"):
        history.append({
            "from_status": "created",
            "to_status": "in_transit",
            "at": shp.get("dispatched_at") or created_at,
            "by_role": "system",
            "notes": "Backfilled (v2 migration)",
        })

    if new_status == "delivered":
        history.append({
            "from_status": "in_transit",
            "to_status": "delivered",
            "at": shp.get("received_at") or shp.get("dispatched_at") or created_at,
            "by_role": "system",
            "notes": "Backfilled (v2 migration)",
        })

    if new_status == "cancelled":
        history.append({
            "from_status": "created",
            "to_status": "cancelled",
            "at": shp.get("cancelled_at") or created_at,
            "by_role": "system",
            "notes": "Backfilled (v2 migration)",
        })

    return history


async def migrate_shipments() -> Dict[str, int]:
    counter = {"total": 0, "migrated": 0, "skipped_already_v2": 0,
               "missing_owner": 0, "unknown_status": 0}
    while True:
        batch = await db.shipments.find(
            {"$or": [{"schema_version": {"$lt": 2}},
                     {"schema_version": {"$exists": False}}]},
        ).limit(200).to_list(200)
        if not batch:
            break
        for shp in batch:
            counter["total"] += 1
            if int(shp.get("schema_version") or 0) >= 2:
                counter["skipped_already_v2"] += 1
                continue

            legacy_status = (shp.get("status") or "pending").lower()
            new_status = SHIPMENT_STATUS_MAP.get(legacy_status)
            if not new_status:
                counter["unknown_status"] += 1
                new_status = "created"

            owner_id, owner_type = await _derive_owner_org(shp)
            if not owner_id:
                counter["missing_owner"] += 1

            update: Dict[str, Any] = {
                "_legacy_status": shp.get("status"),
                "_legacy_dispatched_at": shp.get("dispatched_at"),
                "_legacy_received_at": shp.get("received_at"),
                "status": new_status,
                "owner_org_id": owner_id,
                "owner_org_type": owner_type,
                "status_history": _synth_history(shp, new_status),
                "delivered_at": shp.get("received_at") if new_status == "delivered"
                                else shp.get("delivered_at"),
                "source": (
                    "simulator" if "sim" in str(shp.get("generated_by") or "").lower()
                    else "procurement" if shp.get("po_id")
                    else shp.get("source") or "manual"
                ),
                "schema_version": 2,
                "updated_at": now_iso(),
            }
            await db.shipments.update_one({"id": shp["id"]}, {"$set": update})
            counter["migrated"] += 1
    return counter


async def migrate_vehicles() -> Dict[str, int]:
    counter = {"total": 0, "migrated": 0, "skipped_already_v2": 0, "unknown_status": 0}
    while True:
        batch = await db.vehicles.find(
            {"$or": [{"schema_version": {"$lt": 2}},
                     {"schema_version": {"$exists": False}}]},
        ).limit(200).to_list(200)
        if not batch:
            break
        for v in batch:
            counter["total"] += 1
            if int(v.get("schema_version") or 0) >= 2:
                counter["skipped_already_v2"] += 1
                continue

            legacy_status = (v.get("status") or "idle").lower()
            new_status = VEHICLE_STATUS_MAP.get(legacy_status)
            if not new_status:
                counter["unknown_status"] += 1
                new_status = "available"

            mfr_id = v.get("manufacturer_id") or ""
            update: Dict[str, Any] = {
                "_legacy_status": v.get("status"),
                "status": new_status,
                "owner_org_id": mfr_id,
                "owner_org_type": "manufacturer" if mfr_id else None,
                "capacity_units": v.get("capacity_units") or 1000,
                "capacity_weight_kg": float(v.get("capacity_weight_kg") or 1500.0),
                "vehicle_type": v.get("vehicle_type") or "truck",
                "current_driver_id": None,
                "current_shipment_id": (
                    v.get("ref_id") if v.get("ref_type") == "shipment" else None
                ),
                "current_route_id": (
                    v.get("ref_id") if v.get("ref_type") == "route" else None
                ),
                "source": (
                    "simulator" if (v.get("code") or "").startswith("TK-")
                    else v.get("source") or "manual"
                ),
                "is_active": v.get("is_active") if v.get("is_active") is not None else True,
                "schema_version": 2,
                "updated_at": now_iso(),
            }
            await db.vehicles.update_one({"id": v["id"]}, {"$set": update})
            counter["migrated"] += 1
    return counter


async def normalize_drifted_statuses() -> Dict[str, int]:
    """Re-apply ``SHIPMENT_STATUS_MAP`` to v2 docs whose ``status`` slipped back
    to a legacy value (e.g. legacy callers writing ``received`` on a v2 doc).

    Only canonical 8-state values are kept untouched; anything else is mapped
    via :data:`SHIPMENT_STATUS_MAP`. Drift on canonical values is a no-op.
    """
    canonical = {"created", "ready_for_dispatch", "assigned", "loaded",
                 "in_transit", "arrived", "delivered", "cancelled"}
    counter = {"scanned": 0, "rewritten": 0}
    now = now_iso()

    cursor = db.shipments.find(
        {"schema_version": 2, "status": {"$nin": list(canonical)}},
        {"_id": 0, "id": 1, "status": 1, "received_at": 1, "dispatched_at": 1},
    )
    async for shp in cursor:
        counter["scanned"] += 1
        legacy = (shp.get("status") or "").lower()
        new_status = SHIPMENT_STATUS_MAP.get(legacy, "created")
        update = {
            "status": new_status,
            "updated_at": now,
        }
        if new_status == "delivered" and not shp.get("delivered_at"):
            update["delivered_at"] = shp.get("received_at") or now
        await db.shipments.update_one(
            {"id": shp["id"]},
            {"$set": update,
             "$push": {"status_history": {
                 "from_status": legacy or None,
                 "to_status": new_status,
                 "at": now,
                 "by_role": "system",
                 "notes": "Drift correction (v2 cascade)",
             }}},
        )
        counter["rewritten"] += 1
    return counter


async def cascade_terminal_associations() -> Dict[str, int]:
    """Free up drivers/vehicles whose linked shipment is terminal (delivered/cancelled).

    The initial v2 migration backfilled shipments to ``delivered`` but did not
    cascade the status update to the drivers/vehicles still pointing at those
    shipments. Re-running this is idempotent — once associations are cleared,
    subsequent passes are no-ops.
    """
    counter = {
        "drivers_scanned": 0,
        "drivers_freed": 0,
        "vehicles_scanned": 0,
        "vehicles_freed": 0,
    }
    now = now_iso()

    # ---- 1. Build a set of terminal shipment ids in batches --------------
    terminal_ids: set[str] = set()
    cursor = db.shipments.find(
        {"status": {"$in": ["delivered", "cancelled"]}},
        {"_id": 0, "id": 1},
    )
    async for doc in cursor:
        sid = doc.get("id")
        if sid:
            terminal_ids.add(sid)

    if not terminal_ids:
        return counter

    # ---- 2. Cascade drivers ---------------------------------------------
    drv_cursor = db.drivers.find(
        {"assigned_shipment_id": {"$in": list(terminal_ids)}},
        {"_id": 0, "id": 1, "status": 1, "assigned_shipment_id": 1},
    )
    async for d in drv_cursor:
        counter["drivers_scanned"] += 1
        await db.drivers.update_one(
            {"id": d["id"]},
            {"$set": {
                "status": "available",
                "assigned_shipment_id": None,
                "assigned_vehicle_id": None,
                "updated_at": now,
            }},
        )
        counter["drivers_freed"] += 1

    # ---- 3. Cascade vehicles --------------------------------------------
    veh_cursor = db.vehicles.find(
        {"current_shipment_id": {"$in": list(terminal_ids)}},
        {"_id": 0, "id": 1, "status": 1, "current_shipment_id": 1},
    )
    async for v in veh_cursor:
        counter["vehicles_scanned"] += 1
        # Preserve `maintenance` / `offline` if explicitly set by an admin —
        # but if status is offline *only* because of the legacy migration
        # (we wrote that ourselves) we still want to release the shipment
        # ref. Set status back to `available` for offline rows that still
        # carry a stale shipment id; leave `maintenance` rows alone status-wise.
        new_status = "available" if v.get("status") != "maintenance" else "maintenance"
        await db.vehicles.update_one(
            {"id": v["id"]},
            {"$set": {
                "status": new_status,
                "current_shipment_id": None,
                "current_driver_id": None,
                "current_route_id": None,
                "updated_at": now,
            }},
        )
        counter["vehicles_freed"] += 1

    return counter


async def migrate() -> Dict[str, Dict[str, int]]:
    return {
        "shipments": await migrate_shipments(),
        "vehicles": await migrate_vehicles(),
        "drift": await normalize_drifted_statuses(),
        "cascade": await cascade_terminal_associations(),
    }


if __name__ == "__main__":
    print("Running Track A logistics v2 migration…", flush=True)
    summary = asyncio.run(migrate())
    print("Summary:")
    for collection, counters in summary.items():
        print(f"  {collection}: {counters}")
    print("Done.")
