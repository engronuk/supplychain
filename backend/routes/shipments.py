"""Shipment endpoints — Track A lifecycle.

Canonical 8-state machine: created → ready_for_dispatch → assigned → loaded
→ in_transit → arrived → delivered, plus cancelled (terminal).

Lifecycle transitions live in `services.shipment_lifecycle`.
OTP delivery code generation/verification lives in `services.otp`.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from core import PartyRole, db, now_iso
from models import (
    Shipment, ShipmentCreate, ShipmentLine, ShipmentStatusUpdate, ShipmentTransition,
)
from services.auth import get_current_user as require_auth
from services import otp as otp_service
from services import shipment_lifecycle

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _safe_shipment(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Strip internal fields (bcrypt hash) before returning to clients."""
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("delivery_code", None)          # never expose the hash
    doc.pop("delivery_code_history", None)  # contains issuer ids only — hide by default
    return doc


def _scope_query(user: Dict[str, Any], q: Dict[str, Any]) -> Dict[str, Any]:
    """Force the caller's tenant onto every shipment list."""
    role = user.get("role")
    if role == "super_admin":
        return q
    eid = user.get("entity_id") or ""
    if role == "driver":
        did = user.get("driver_id") or user.get("entity_id")
        return {**q, "driver_id": did}
    # manufacturer / distributor / wholesaler / retailer
    return {**q, "$or": [
        {"owner_org_id": eid},
        {"manufacturer_id": eid},
        {"distributor_id": eid},
        {"wholesaler_id": eid},
        {"retailer_id": eid},
        {"from_id": eid},
        {"to_id": eid},
    ]}


# ---------------------------------------------------------------------------
# List + read
# ---------------------------------------------------------------------------
@router.get("/shipments", response_model=List[Dict[str, Any]])
async def list_shipments(
    user: Dict[str, Any] = Depends(require_auth),
    status: Optional[str] = Query(None),
    driver_id: Optional[str] = None,
    vehicle_id: Optional[str] = None,
    distributor_id: Optional[str] = None,
    retailer_id: Optional[str] = None,
    wholesaler_id: Optional[str] = None,
    manufacturer_id: Optional[str] = None,
    party_role: Optional[str] = None,
    party_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if driver_id:
        q["driver_id"] = driver_id
    if vehicle_id:
        q["vehicle_id"] = vehicle_id
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    if wholesaler_id:
        q["wholesaler_id"] = wholesaler_id
    if manufacturer_id:
        q["manufacturer_id"] = manufacturer_id
    if party_role and party_id:
        q[f"{party_role}_id"] = party_id

    q = _scope_query(user, q)
    cursor = db.shipments.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)
    rows = await cursor.to_list(limit)
    return [_safe_shipment(r) for r in rows]


@router.get("/shipments/{shipment_id}", response_model=Dict[str, Any])
async def get_shipment(
    shipment_id: str,
    user: Dict[str, Any] = Depends(require_auth),
):
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    shipment_lifecycle.assert_tenant_access(user, shp)
    return _safe_shipment(shp)


@router.get("/shipments/{shipment_id}/timeline", response_model=Dict[str, Any])
async def shipment_timeline(
    shipment_id: str,
    user: Dict[str, Any] = Depends(require_auth),
):
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    shipment_lifecycle.assert_tenant_access(user, shp)

    events = await db.logistics_events.find(
        {"shipment_id": shipment_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)

    return {
        "shipment_id": shipment_id,
        "current_status": shp.get("status"),
        "tracking_code": shp.get("tracking_code"),
        "timeline": shp.get("status_history") or [],
        "logistics_events": events,
    }


# ---------------------------------------------------------------------------
# Create + lifecycle transitions
# ---------------------------------------------------------------------------
@router.post("/shipments", response_model=Dict[str, Any])
async def create_shipment(
    payload: ShipmentCreate,
    user: Dict[str, Any] = Depends(require_auth),
):
    role = user.get("role")
    eid = user.get("entity_id") or ""
    if role not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, "Only dispatcher roles can create shipments")

    # derive owner_org_id from caller's JWT (super_admin can pass through)
    if role == "super_admin":
        owner_id = payload.from_id
        owner_type = payload.from_role
    else:
        owner_id = eid
        owner_type = role

    # build the shipment
    items_dicts = [it.dict() for it in payload.items]
    total_units = sum(int(it.get("quantity") or 0) for it in items_dicts)
    shp = Shipment(
        from_role=payload.from_role,
        from_id=payload.from_id,
        to_role=payload.to_role,
        to_id=payload.to_id,
        items=[ShipmentLine(**it) for it in items_dicts],
        notes=payload.notes,
        po_id=payload.po_id,
        owner_org_id=owner_id,
        owner_org_type=owner_type if owner_type in ("manufacturer", "distributor", "wholesaler") else None,
        total_units=total_units,
        source="manual",
    )
    doc = shp.dict()
    doc["status_history"] = [{
        "from_status": None,
        "to_status": "created",
        "at": doc["created_at"],
        "by_user_id": user.get("id"),
        "by_role": role,
        "notes": "Shipment created",
    }]

    # 5-tier denorm
    if payload.from_role == "manufacturer":
        doc["manufacturer_id"] = payload.from_id
    if payload.from_role == "distributor":
        doc["distributor_id"] = payload.from_id
    if payload.from_role == "wholesaler":
        doc["wholesaler_id"] = payload.from_id
    if payload.to_role == "retailer":
        doc["retailer_id"] = payload.to_id
    if payload.to_role == "wholesaler":
        doc["wholesaler_id"] = doc.get("wholesaler_id") or payload.to_id
    if payload.to_role == "distributor":
        doc["distributor_id"] = doc.get("distributor_id") or payload.to_id

    await db.shipments.insert_one(doc)
    await db.shipment_status_history.insert_one({
        "id": shp.id + "-create",
        "shipment_id": shp.id,
        "owner_org_id": owner_id,
        "from_status": None,
        "to_status": "created",
        "at": doc["created_at"],
        "by_user_id": user.get("id"),
        "by_role": role,
        "created_at": doc["created_at"],
    })
    return _safe_shipment(doc)


@router.post("/shipments/{shipment_id}/ready")
async def ready_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(require_auth),
):
    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="ready_for_dispatch",
        user=user, notes=body.get("notes"),
    )
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/assign")
async def assign_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth),
):
    # Role check first — never leak driver/vehicle existence to non-dispatchers
    if user.get("role") not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, {
            "code": "FORBIDDEN_ROLE",
            "role": user.get("role"),
            "allowed_roles": ["manufacturer", "distributor", "wholesaler", "super_admin"],
        })

    driver_id = body.get("driver_id")
    vehicle_id = body.get("vehicle_id")
    route_id = body.get("route_id")
    if not driver_id or not vehicle_id:
        raise HTTPException(422, {"detail": [
            {"loc": ["body", "driver_id"], "msg": "Field required"},
            {"loc": ["body", "vehicle_id"], "msg": "Field required"},
        ]})

    # tenant + status checks happen inside transition; pre-check driver/vehicle
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0, "owner_org_id": 1, "status": 1})
    if not shp:
        raise HTTPException(404, "Shipment not found")

    drv = await db.drivers.find_one(
        {"id": driver_id},
        {"_id": 0, "employer_org_id": 1, "status": 1, "is_active": 1},
    )
    if not drv:
        raise HTTPException(404, "Driver not found")
    if not drv.get("is_active"):
        raise HTTPException(409, "Driver is not active")
    if drv.get("status") not in ("available", "offline", "assigned"):
        raise HTTPException(409, f"Driver state is {drv.get('status')} — must be available")
    if drv.get("employer_org_id") != shp.get("owner_org_id") and user.get("role") != "super_admin":
        raise HTTPException(403, "Driver does not belong to this org")

    veh = await db.vehicles.find_one(
        {"id": vehicle_id},
        {"_id": 0, "owner_org_id": 1, "status": 1, "is_active": 1},
    )
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    if veh.get("is_active") is False:
        raise HTTPException(409, "Vehicle is decommissioned")
    if veh.get("status") in ("maintenance", "offline"):
        raise HTTPException(409, f"Vehicle state is {veh.get('status')} — must be available")
    if veh.get("owner_org_id") != shp.get("owner_org_id") and user.get("role") != "super_admin":
        raise HTTPException(403, "Vehicle does not belong to this org")

    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="assigned",
        user=user, notes=body.get("notes"),
        extra_fields={"driver_id": driver_id, "vehicle_id": vehicle_id,
                      "route_id": route_id,
                      "dispatched_by_user_id": user.get("id")},
    )
    # auto-generate the OTP delivery code once the shipment is assigned.
    try:
        await otp_service.generate(shipment_id, user)
    except HTTPException:
        # generation failures are non-fatal at assign time; dispatcher can retry
        pass
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/load")
async def load_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(require_auth),
):
    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="loaded",
        user=user, notes=body.get("notes"),
    )
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/start-trip")
async def start_trip(
    shipment_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(require_auth),
):
    extra: Dict[str, Any] = {}
    if "eta_minutes" in body and body["eta_minutes"] is not None:
        extra["eta_minutes"] = int(body["eta_minutes"])
    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="in_transit",
        user=user, notes=body.get("notes"), extra_fields=extra,
    )
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/arrive")
async def arrive_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(require_auth),
):
    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="arrived",
        user=user, notes=body.get("notes"),
    )
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/deliver")
async def deliver_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth),
):
    """OTP-verified delivery. Body must contain `delivery_code`."""
    code = (body.get("delivery_code") or "").strip()
    if not code:
        raise HTTPException(422, "delivery_code is required")

    # verify (raises on mismatch / lock / expiry)
    await otp_service.verify(shipment_id, code, user)
    # now transition (driver-only)
    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="delivered",
        user=user, notes=body.get("notes"),
    )
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/cancel")
async def cancel_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth),
):
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "reason is required")
    result = await shipment_lifecycle.transition(
        shipment_id=shipment_id, to_status="cancelled",
        user=user, reason=reason,
    )
    return _safe_shipment(result)


@router.post("/shipments/{shipment_id}/reassign-driver")
async def reassign_driver(
    shipment_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth),
):
    new_driver_id = body.get("driver_id")
    if not new_driver_id:
        raise HTTPException(422, "driver_id is required")

    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    shipment_lifecycle.assert_tenant_access(user, shp)

    if user.get("role") not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, "Only dispatcher can reassign")
    if (shp.get("status") or "").lower() not in ("assigned", "loaded", "in_transit", "arrived"):
        raise HTTPException(409, f"Cannot reassign driver in status {shp.get('status')}")

    new_drv = await db.drivers.find_one({"id": new_driver_id},
                                        {"_id": 0, "employer_org_id": 1, "is_active": 1, "status": 1})
    if not new_drv:
        raise HTTPException(404, "Driver not found")
    if new_drv.get("employer_org_id") != shp.get("owner_org_id") and user.get("role") != "super_admin":
        raise HTTPException(403, "Driver does not belong to this org")
    if not new_drv.get("is_active") or new_drv.get("status") not in ("available", "offline", "assigned"):
        raise HTTPException(409, "Driver is not available")

    old_driver_id = shp.get("driver_id")
    if old_driver_id and old_driver_id != new_driver_id:
        await db.drivers.update_one(
            {"id": old_driver_id},
            {"$set": {"status": "available", "assigned_shipment_id": None,
                      "assigned_vehicle_id": None, "updated_at": now_iso()}},
        )

    now = now_iso()
    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {"driver_id": new_driver_id, "updated_at": now},
         "$push": {"status_history": {
             "from_status": shp.get("status"),
             "to_status": shp.get("status"),
             "at": now, "by_user_id": user.get("id"),
             "by_role": user.get("role"),
             "notes": "Reassigned driver",
             "reason": body.get("reason"),
             "driver_id": new_driver_id,
         }}},
    )
    # NEW driver gets the right status based on current shipment state
    new_status = ("on_trip" if shp.get("status") in ("in_transit", "arrived") else "assigned")
    await db.drivers.update_one(
        {"id": new_driver_id},
        {"$set": {"status": new_status, "assigned_shipment_id": shipment_id,
                  "assigned_vehicle_id": shp.get("vehicle_id"),
                  "updated_at": now}},
    )
    fresh = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    return _safe_shipment(fresh or {})


@router.post("/shipments/{shipment_id}/reassign-vehicle")
async def reassign_vehicle(
    shipment_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(require_auth),
):
    new_vehicle_id = body.get("vehicle_id")
    if not new_vehicle_id:
        raise HTTPException(422, "vehicle_id is required")

    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    shipment_lifecycle.assert_tenant_access(user, shp)

    if user.get("role") not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, "Only dispatcher can reassign")
    if (shp.get("status") or "").lower() not in ("assigned", "loaded", "in_transit", "arrived"):
        raise HTTPException(409, f"Cannot reassign vehicle in status {shp.get('status')}")

    new_veh = await db.vehicles.find_one(
        {"id": new_vehicle_id},
        {"_id": 0, "owner_org_id": 1, "is_active": 1, "status": 1},
    )
    if not new_veh:
        raise HTTPException(404, "Vehicle not found")
    if new_veh.get("owner_org_id") != shp.get("owner_org_id") and user.get("role") != "super_admin":
        raise HTTPException(403, "Vehicle does not belong to this org")
    if new_veh.get("is_active") is False or new_veh.get("status") in ("maintenance", "offline"):
        raise HTTPException(409, "Vehicle is not available")

    now = now_iso()
    old_vehicle_id = shp.get("vehicle_id")
    if old_vehicle_id and old_vehicle_id != new_vehicle_id:
        await db.vehicles.update_one(
            {"id": old_vehicle_id},
            {"$set": {"status": "available", "current_shipment_id": None,
                      "current_driver_id": None, "updated_at": now}},
        )

    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {"vehicle_id": new_vehicle_id, "updated_at": now},
         "$push": {"status_history": {
             "from_status": shp.get("status"),
             "to_status": shp.get("status"),
             "at": now, "by_user_id": user.get("id"),
             "by_role": user.get("role"),
             "notes": "Reassigned vehicle",
             "reason": body.get("reason"),
             "vehicle_id": new_vehicle_id,
         }}},
    )
    new_v_status = ("in_transit" if shp.get("status") in ("in_transit", "arrived") else "loading")
    await db.vehicles.update_one(
        {"id": new_vehicle_id},
        {"$set": {"status": new_v_status, "current_shipment_id": shipment_id,
                  "current_driver_id": shp.get("driver_id"), "updated_at": now}},
    )
    fresh = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    return _safe_shipment(fresh or {})


@router.post("/shipments/{shipment_id}/generate-delivery-code")
async def generate_delivery_code(
    shipment_id: str,
    user: Dict[str, Any] = Depends(require_auth),
):
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    shipment_lifecycle.assert_tenant_access(user, shp)
    if user.get("role") not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, "Only dispatcher can generate a delivery code")
    return await otp_service.generate(shipment_id, user)


# ---------------------------------------------------------------------------
# Deprecated — PATCH /status
# ---------------------------------------------------------------------------
@router.patch("/shipments/{shipment_id}/status", deprecated=True)
async def deprecated_patch_status(
    shipment_id: str,
    payload: ShipmentStatusUpdate,
    user: Dict[str, Any] = Depends(require_auth),
):
    raise HTTPException(
        410, {
            "code": "ENDPOINT_DEPRECATED",
            "message": "PATCH /shipments/{id}/status was removed in Track A. "
                       "Use /ready /assign /load /start-trip /arrive /deliver /cancel instead.",
            "replacement_endpoints": [
                "POST /api/shipments/{id}/ready",
                "POST /api/shipments/{id}/assign",
                "POST /api/shipments/{id}/load",
                "POST /api/shipments/{id}/start-trip",
                "POST /api/shipments/{id}/arrive",
                "POST /api/shipments/{id}/deliver",
                "POST /api/shipments/{id}/cancel",
            ],
        },
    )
