"""Shipment lifecycle service — 8-state machine + transition guards.

The canonical 8 states:
    created → ready_for_dispatch → assigned → loaded → in_transit
            → arrived → delivered
    + cancelled (any non-terminal)

Each `transition()` call:
  1. validates the (from → to) edge against ALLOWED_TRANSITIONS
  2. enforces role-based access via _ROLE_GUARD
  3. enforces tenant scope via shipment.owner_org_id
  4. updates the shipment doc (status, timestamps, side-effect fields)
  5. appends a ShipmentTransition to status_history
  6. mirrors the event to db.shipment_status_history (audit)
  7. applies driver/vehicle side-effects when applicable
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException

from core import db, now_iso

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
ALLOWED_TRANSITIONS: Dict[str, list[str]] = {
    "created":            ["ready_for_dispatch", "cancelled"],
    "ready_for_dispatch": ["assigned", "cancelled"],
    "assigned":           ["loaded", "cancelled"],
    "loaded":             ["in_transit", "cancelled"],
    "in_transit":         ["arrived", "cancelled"],
    "arrived":            ["delivered", "cancelled"],
    "delivered":          [],   # terminal
    "cancelled":          [],   # terminal
    # legacy states allowed to flow into the canonical machine
    "pending":            ["ready_for_dispatch", "cancelled"],
    "shipped":            ["arrived", "delivered", "cancelled"],
    "received":           [],
}

TERMINAL = {"delivered", "cancelled"}

# Who can drive each transition. driver-self is enforced separately
# (shipment.driver_id == jwt.driver_id).
_DISPATCHER_ROLES = {"manufacturer", "distributor", "wholesaler", "super_admin"}
_DRIVER_OR_DISPATCHER = _DISPATCHER_ROLES | {"driver"}
_DRIVER_ONLY = {"driver", "super_admin"}

_ROLE_GUARD: Dict[str, set[str]] = {
    "ready_for_dispatch": _DISPATCHER_ROLES,
    "assigned":           _DISPATCHER_ROLES,
    "loaded":             _DRIVER_OR_DISPATCHER,
    "in_transit":         _DRIVER_OR_DISPATCHER,
    "arrived":            _DRIVER_OR_DISPATCHER,
    "delivered":          _DRIVER_ONLY,
    "cancelled":          _DISPATCHER_ROLES,
}

# Timestamp field updated by each transition
_TIMESTAMP_FIELD: Dict[str, str] = {
    "ready_for_dispatch": "ready_at",
    "assigned":           "assigned_at",
    "loaded":             "loaded_at",
    "in_transit":         "dispatched_at",
    "arrived":            "arrived_at",
    "delivered":          "delivered_at",
    "cancelled":          "cancelled_at",
}


# ---------------------------------------------------------------------------
# Tenant guard
# ---------------------------------------------------------------------------
def assert_tenant_access(user: Dict[str, Any], shp: Dict[str, Any]) -> None:
    """Raise 403 unless the caller is super_admin OR the shipment owner OR
    the assigned driver."""
    role = user.get("role")
    if role == "super_admin":
        return
    eid = user.get("entity_id") or ""
    owner = shp.get("owner_org_id") or shp.get("manufacturer_id") or ""
    if role == "driver":
        # drivers can read/write only their own shipments
        did = user.get("driver_id") or user.get("entity_id")
        if shp.get("driver_id") == did:
            return
        raise HTTPException(403, "Forbidden — not your shipment")
    if eid and eid == owner:
        return
    raise HTTPException(403, "Forbidden — not your tenant")


# ---------------------------------------------------------------------------
# Side-effect helpers (inventory + driver/vehicle status sync)
# ---------------------------------------------------------------------------
async def _move_inventory(shp: Dict[str, Any], direction: str) -> None:
    """Idempotent inventory mutation tied to (shipment_id, direction).

    direction = "out" debits the from-side on `loaded` transition.
    direction = "in"  credits the to-side on `delivered` transition.
    direction = "reverse" reverses any earlier movement (on cancel).
    """
    if direction == "out":
        owner_type, owner_id = shp.get("from_role"), shp.get("from_id")
        sign = -1
        kind = f"shipment_load_{shp['id']}"
    elif direction == "in":
        owner_type, owner_id = shp.get("to_role"), shp.get("to_id")
        sign = +1
        kind = f"shipment_deliver_{shp['id']}"
    elif direction == "reverse":
        # reverse only the load (deliveries are already credited if delivered)
        owner_type, owner_id = shp.get("from_role"), shp.get("from_id")
        sign = +1
        kind = f"shipment_reverse_{shp['id']}"
    else:
        return

    if not owner_type or not owner_id:
        return

    # idempotency — skip if we've already moved this leg
    seen = await db.inventory_movements.find_one(
        {"kind": kind}, {"_id": 1})
    if seen:
        return

    for it in (shp.get("items") or []):
        qty = int(it.get("quantity") or 0)
        if qty <= 0:
            continue
        await db.inventory.update_one(
            {"owner_type": owner_type, "owner_id": owner_id,
             "product_id": it["product_id"]},
            {"$inc": {"quantity": sign * qty},
             "$set": {"updated_at": now_iso(),
                      "last_movement_at": now_iso()}},
            upsert=True,
        )
        await db.inventory_movements.insert_one({
            "id": str(uuid.uuid4()),
            "owner_type": owner_type,
            "owner_id": owner_id,
            "product_id": it["product_id"],
            "delta": sign * qty,
            "kind": kind,
            "ref_id": shp["id"],
            "ref_type": "shipment",
            "manufacturer_id": shp.get("manufacturer_id"),
            "created_at": now_iso(),
        })


async def _sync_driver_status(driver_id: Optional[str], status: Optional[str],
                              shipment_id: Optional[str] = None,
                              vehicle_id: Optional[str] = None,
                              clear_assignment: bool = False) -> None:
    if not driver_id:
        return
    update: Dict[str, Any] = {"updated_at": now_iso()}
    if status:
        update["status"] = status
    if clear_assignment:
        update["assigned_shipment_id"] = None
        update["assigned_vehicle_id"] = None
    else:
        if shipment_id is not None:
            update["assigned_shipment_id"] = shipment_id
        if vehicle_id is not None:
            update["assigned_vehicle_id"] = vehicle_id
    await db.drivers.update_one({"id": driver_id}, {"$set": update})


async def _sync_vehicle_status(vehicle_id: Optional[str], status: Optional[str],
                               shipment_id: Optional[str] = None,
                               driver_id: Optional[str] = None,
                               clear_assignment: bool = False) -> None:
    if not vehicle_id:
        return
    update: Dict[str, Any] = {"updated_at": now_iso()}
    if status:
        update["status"] = status
    if clear_assignment:
        update["current_shipment_id"] = None
        update["current_driver_id"] = None
    else:
        if shipment_id is not None:
            update["current_shipment_id"] = shipment_id
        if driver_id is not None:
            update["current_driver_id"] = driver_id
    await db.vehicles.update_one({"id": vehicle_id}, {"$set": update})


# ---------------------------------------------------------------------------
# Core transition function
# ---------------------------------------------------------------------------
async def transition(
    *,
    shipment_id: str,
    to_status: str,
    user: Dict[str, Any],
    notes: Optional[str] = None,
    reason: Optional[str] = None,
    extra_fields: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")

    assert_tenant_access(user, shp)

    cur = (shp.get("status") or "created").lower()
    allowed_next = ALLOWED_TRANSITIONS.get(cur, [])
    if to_status not in allowed_next:
        raise HTTPException(409, {
            "code": "INVALID_TRANSITION",
            "from_status": cur,
            "to_status": to_status,
            "allowed_next": allowed_next,
        })

    role = user.get("role") or ""
    guard = _ROLE_GUARD.get(to_status, set())
    if role not in guard:
        raise HTTPException(403, {
            "code": "FORBIDDEN_ROLE",
            "role": role,
            "to_status": to_status,
            "allowed_roles": sorted(guard),
        })

    # Drivers may only act on their own assigned shipment
    if role == "driver":
        did = user.get("driver_id") or user.get("entity_id")
        if shp.get("driver_id") != did:
            raise HTTPException(403, "Forbidden — not the assigned driver")

    now = now_iso()
    update: Dict[str, Any] = {
        "status": to_status,
        "updated_at": now,
    }
    ts_field = _TIMESTAMP_FIELD.get(to_status)
    if ts_field:
        update[ts_field] = now
    if to_status == "cancelled":
        update["cancelled_reason"] = reason or notes or "Cancelled"

    if extra_fields:
        update.update({k: v for k, v in extra_fields.items() if v is not None})

    transition_doc = {
        "from_status": cur,
        "to_status": to_status,
        "at": now,
        "by_user_id": user.get("id"),
        "by_role": role,
        "reason": reason,
        "notes": notes,
        "driver_id": update.get("driver_id") or shp.get("driver_id"),
        "vehicle_id": update.get("vehicle_id") or shp.get("vehicle_id"),
    }

    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": update, "$push": {"status_history": transition_doc}},
    )

    # mirror to global audit collection
    await db.shipment_status_history.insert_one({
        "id": str(uuid.uuid4()),
        "shipment_id": shipment_id,
        "owner_org_id": shp.get("owner_org_id"),
        **transition_doc,
        "created_at": now,
    })

    # ---- side effects ----------------------------------------------------
    drv = update.get("driver_id") or shp.get("driver_id")
    veh = update.get("vehicle_id") or shp.get("vehicle_id")

    if to_status == "assigned":
        await _sync_driver_status(drv, "assigned",
                                  shipment_id=shipment_id, vehicle_id=veh)
        await _sync_vehicle_status(veh, "loading",
                                   shipment_id=shipment_id, driver_id=drv)
    elif to_status == "loaded":
        await _move_inventory(shp, "out")
    elif to_status == "in_transit":
        await _sync_driver_status(drv, "on_trip")
        await _sync_vehicle_status(veh, "in_transit")
    elif to_status == "delivered":
        await _move_inventory(shp, "in")
        await _sync_driver_status(drv, "available", clear_assignment=True)
        await _sync_vehicle_status(veh, "available", clear_assignment=True)
    elif to_status == "cancelled":
        # reverse inventory only if loaded but not yet delivered
        if cur in ("loaded", "in_transit", "arrived"):
            await _move_inventory(shp, "reverse")
        await _sync_driver_status(drv, "available", clear_assignment=True)
        await _sync_vehicle_status(veh, "available", clear_assignment=True)

    fresh = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    return fresh or {}
