"""Vehicle / Fleet Registry endpoints — Track A3.

All endpoints are tenant-scoped by JWT.entity_id (super_admin can pass
owner_org_id query parameter to view another tenant).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from core import db, now_iso
from models import Vehicle, VehicleCreate, VehicleUpdate
from services.auth import get_current_user

router = APIRouter()


def _scope_filter(user: Dict[str, Any], owner_org_id: Optional[str]) -> Dict[str, Any]:
    role = user.get("role")
    if role == "super_admin":
        if owner_org_id:
            return {"owner_org_id": owner_org_id}
        return {}
    if role in ("manufacturer", "distributor", "wholesaler"):
        return {"owner_org_id": user.get("entity_id") or ""}
    if role == "driver":
        # drivers can only see their own currently-assigned vehicle, by id
        return {"current_driver_id": user.get("entity_id")}
    raise HTTPException(403, "Forbidden")


async def _assert_owner(user: Dict[str, Any], v: Dict[str, Any]) -> None:
    role = user.get("role")
    if role == "super_admin":
        return
    if v.get("owner_org_id") != user.get("entity_id"):
        raise HTTPException(403, "Vehicle does not belong to this org")


async def _next_vehicle_code() -> str:
    seq = await db.counters.find_one_and_update(
        {"_id": "vehicle_seq"},
        {"$inc": {"seq": 1}},
        upsert=True, return_document=True,
    )
    return f"TK-{int(seq['seq']):03d}"


@router.get("/vehicles", response_model=List[Dict[str, Any]])
async def list_vehicles(
    user: Dict[str, Any] = Depends(get_current_user),
    status: Optional[str] = None,
    owner_org_id: Optional[str] = None,
    driver_id: Optional[str] = None,
    include_simulator: bool = False,
):
    q = _scope_filter(user, owner_org_id)
    if status:
        q["status"] = status
    if driver_id:
        q["current_driver_id"] = driver_id
    # Default: hide legacy simulator vehicles from operator-facing listings.
    # Pass include_simulator=true to opt in (Command Centre v2 union view).
    if not include_simulator:
        q["source"] = {"$in": ["manual", "seed"]}
    rows = await db.vehicles.find(q, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    return rows


@router.post("/vehicles", response_model=Dict[str, Any])
async def create_vehicle(
    payload: VehicleCreate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = user.get("role")
    if role not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, "Only dispatcher roles can create vehicles")
    if role == "super_admin":
        raise HTTPException(422, "super_admin must impersonate — not yet implemented")
    eid = user.get("entity_id") or ""

    # uniqueness
    dup = await db.vehicles.find_one(
        {"owner_org_id": eid, "registration_number": payload.registration_number},
        {"_id": 1},
    )
    if dup:
        raise HTTPException(409, "registration_number already exists in your fleet")

    veh = Vehicle(
        vehicle_code=await _next_vehicle_code(),
        registration_number=payload.registration_number,
        vehicle_type=payload.vehicle_type,
        make=payload.make,
        model=payload.model,
        year=payload.year,
        colour=payload.colour,
        capacity_units=payload.capacity_units,
        capacity_weight_kg=payload.capacity_weight_kg,
        owner_org_id=eid,
        owner_org_type=role,
        home_warehouse_id=payload.home_warehouse_id,
        insurance_expiry=payload.insurance_expiry,
        roadworthiness_expiry=payload.roadworthiness_expiry,
        source="manual",
    )
    doc = veh.dict()
    await db.vehicles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/vehicles/{vehicle_id}", response_model=Dict[str, Any])
async def get_vehicle(
    vehicle_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    return v


@router.patch("/vehicles/{vehicle_id}", response_model=Dict[str, Any])
async def update_vehicle(
    vehicle_id: str,
    payload: VehicleUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    updates = {k: val for k, val in payload.dict(exclude_unset=True).items() if val is not None}
    if updates:
        # cannot reduce capacity below what's currently on board
        if "capacity_units" in updates and v.get("status") in ("loading", "in_transit"):
            shp = await db.shipments.find_one(
                {"id": v.get("current_shipment_id")},
                {"_id": 0, "total_units": 1, "items": 1},
            )
            if shp:
                onboard = shp.get("total_units") or sum(
                    int(it.get("quantity") or 0) for it in (shp.get("items") or []))
                if updates["capacity_units"] < int(onboard or 0):
                    raise HTTPException(
                        409, f"capacity_units cannot drop below current load of {onboard}")
        updates["updated_at"] = now_iso()
        await db.vehicles.update_one({"id": vehicle_id}, {"$set": updates})
    fresh = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    return fresh or {}


@router.post("/vehicles/{vehicle_id}/set-maintenance", response_model=Dict[str, Any])
async def set_maintenance(
    vehicle_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    if v.get("status") == "in_transit":
        raise HTTPException(409, "Cannot put a moving vehicle into maintenance")
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"status": "maintenance",
                  "current_shipment_id": None,
                  "current_driver_id": None,
                  "updated_at": now_iso()}},
    )
    return {"ok": True, "vehicle_id": vehicle_id}


@router.post("/vehicles/{vehicle_id}/complete-service", response_model=Dict[str, Any])
async def complete_service(
    vehicle_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    update = {"status": "available", "last_service_at": now_iso(),
              "updated_at": now_iso()}
    if "odometer_km" in body and body["odometer_km"] is not None:
        update["odometer_km"] = float(body["odometer_km"])
    await db.vehicles.update_one({"id": vehicle_id}, {"$set": update})
    return {"ok": True, "vehicle_id": vehicle_id}


@router.post("/vehicles/{vehicle_id}/set-offline", response_model=Dict[str, Any])
async def set_offline(
    vehicle_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    if v.get("status") == "in_transit":
        raise HTTPException(409, "Cannot take a moving vehicle offline")
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"status": "offline",
                  "current_shipment_id": None,
                  "current_driver_id": None,
                  "updated_at": now_iso()}},
    )
    return {"ok": True, "vehicle_id": vehicle_id}


@router.post("/vehicles/{vehicle_id}/set-online", response_model=Dict[str, Any])
async def set_online(
    vehicle_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    if v.get("status") not in ("offline", "maintenance"):
        raise HTTPException(409, "Vehicle is already active")
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"status": "available", "updated_at": now_iso()}},
    )
    return {"ok": True, "vehicle_id": vehicle_id}


@router.post("/vehicles/{vehicle_id}/decommission", response_model=Dict[str, Any])
async def decommission_vehicle(
    vehicle_id: str,
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    if v.get("status") == "in_transit":
        raise HTTPException(409, "Cannot decommission an in-transit vehicle")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "reason is required")
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"is_active": False, "status": "offline",
                  "decommissioned_at": now_iso(),
                  "current_shipment_id": None,
                  "current_driver_id": None,
                  "updated_at": now_iso()}},
    )
    return {"ok": True, "vehicle_id": vehicle_id, "reason": reason}


@router.get("/vehicles/{vehicle_id}/history", response_model=List[Dict[str, Any]])
async def vehicle_history(
    vehicle_id: str,
    days: int = Query(30, ge=1, le=365),
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    rows = await db.shipments.find(
        {"vehicle_id": vehicle_id},
        {"_id": 0, "delivery_code": 0},
    ).sort("created_at", -1).limit(200).to_list(200)
    return rows


@router.get("/vehicles/{vehicle_id}/utilization", response_model=Dict[str, Any])
async def vehicle_utilization(
    vehicle_id: str,
    days: int = Query(30, ge=1, le=365),
    user: Dict[str, Any] = Depends(get_current_user),
):
    v = await db.vehicles.find_one({"id": vehicle_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Vehicle not found")
    await _assert_owner(user, v)
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"vehicle_id": vehicle_id, "created_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$status", "count": {"$sum": 1},
                    "units": {"$sum": {"$ifNull": ["$total_units", 0]}}}},
    ]
    agg = {}
    async for row in db.shipments.aggregate(pipeline):
        agg[row["_id"] or "unknown"] = {"count": row["count"], "units": row["units"]}
    trips = sum(v["count"] for v in agg.values())
    return {
        "vehicle_id": vehicle_id,
        "days": days,
        "trips": trips,
        "by_status": agg,
        "delivered_trips": agg.get("delivered", {}).get("count", 0),
        "cancelled_trips": agg.get("cancelled", {}).get("count", 0),
    }
