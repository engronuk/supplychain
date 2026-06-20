"""Driver endpoints — Track A2 + A6.

Admin/dispatcher endpoints:  /api/drivers/...
Driver-self endpoints:       /api/driver/...
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from core import db, now_iso
from models import Driver, DriverCreate, DriverUpdate
from services.auth import get_current_user, hash_password

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _scope(user: Dict[str, Any]) -> Optional[str]:
    """Returns the tenant org id to filter by, or None for super_admin."""
    if user.get("role") == "super_admin":
        return None
    return user.get("entity_id") or ""


def _safe_driver(d: Dict[str, Any]) -> Dict[str, Any]:
    if not d:
        return d
    d.pop("_id", None)
    return d


async def _assert_owner(user: Dict[str, Any], driver_doc: Dict[str, Any]) -> None:
    if user.get("role") == "super_admin":
        return
    if driver_doc.get("employer_org_id") != user.get("entity_id"):
        raise HTTPException(403, "Driver does not belong to this org")


async def _ensure_user_account(driver: Dict[str, Any], password: str) -> str:
    """Create a User account for the driver if one doesn't already exist."""
    existing = await db.users.find_one({"email": driver["email"].lower()}, {"_id": 0})
    if existing:
        # Make sure their role is 'driver' (we don't overwrite other roles silently)
        if existing.get("role") not in ("driver", "super_admin"):
            raise HTTPException(409, f"User {driver['email']} already exists with role {existing['role']}")
        return existing["id"]

    user_id = str(uuid.uuid4())
    now = now_iso()
    await db.users.insert_one({
        "id": user_id,
        "email": driver["email"].lower(),
        "name": driver["full_name"],
        "role": "driver",
        "entity_id": driver["id"],
        "entity_type": "driver",
        "password_hash": hash_password(password),
        "status": "active",
        "must_change_password": True,
        "created_at": now,
        "updated_at": now,
    })
    return user_id


# ---------------------------------------------------------------------------
# Admin / Dispatcher endpoints — /api/drivers/...
# ---------------------------------------------------------------------------
@router.get("/drivers", response_model=List[Dict[str, Any]])
async def list_drivers(
    user: Dict[str, Any] = Depends(get_current_user),
    status: Optional[str] = None,
    employer_org_id: Optional[str] = None,
):
    if user.get("role") in ("driver", "retailer"):
        raise HTTPException(403, "Forbidden")
    q: Dict[str, Any] = {"is_active": True}
    scope = _scope(user)
    if scope is None:
        if employer_org_id:
            q["employer_org_id"] = employer_org_id
    else:
        q["employer_org_id"] = scope
    if status:
        q["status"] = status
    rows = await db.drivers.find(q, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
    return rows


@router.post("/drivers", response_model=Dict[str, Any])
async def create_driver(
    payload: DriverCreate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    role = user.get("role")
    if role not in ("manufacturer", "distributor", "wholesaler", "super_admin"):
        raise HTTPException(403, "Only dispatcher roles can create drivers")
    eid = user.get("entity_id") or ""
    if role == "super_admin":
        raise HTTPException(422, "super_admin must impersonate — not yet implemented")

    # uniqueness
    dup = await db.drivers.find_one(
        {"employer_org_id": eid, "employee_number": payload.employee_number},
        {"_id": 1},
    )
    if dup:
        raise HTTPException(409, "employee_number already exists in your org")
    if await db.users.find_one({"email": payload.email.lower()}, {"_id": 1}):
        raise HTTPException(409, "A user with that email already exists")

    full_name = f"{payload.first_name} {payload.last_name}".strip()
    driver = Driver(
        employee_number=payload.employee_number,
        first_name=payload.first_name,
        last_name=payload.last_name,
        full_name=full_name,
        phone=payload.phone,
        email=payload.email.lower(),
        licence_number=payload.licence_number,
        licence_class=payload.licence_class,
        licence_expiry=payload.licence_expiry,
        home_warehouse_id=payload.home_warehouse_id,
        employer_org_id=eid,
        employer_org_type=role,  # already constrained above
    )
    doc = driver.dict()
    doc["invited_at"] = now_iso()

    # Create the User account (default password = "TradeKonekt2026!"; force change on first login)
    default_password = "TradeKonekt2026!"
    user_id = await _ensure_user_account(doc, default_password)
    doc["user_id"] = user_id

    await db.drivers.insert_one(doc)
    return {**_safe_driver(doc),
            "_initial_password": default_password}   # surfaced once at creation


@router.get("/drivers/{driver_id}", response_model=Dict[str, Any])
async def get_driver(
    driver_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    await _assert_owner(user, d)
    return d


@router.patch("/drivers/{driver_id}", response_model=Dict[str, Any])
async def update_driver(
    driver_id: str,
    payload: DriverUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    await _assert_owner(user, d)

    updates = {k: v for k, v in payload.dict(exclude_unset=True).items() if v is not None}
    if updates:
        if "first_name" in updates or "last_name" in updates:
            fn = updates.get("first_name", d.get("first_name", ""))
            ln = updates.get("last_name", d.get("last_name", ""))
            updates["full_name"] = f"{fn} {ln}".strip()
        updates["updated_at"] = now_iso()
        await db.drivers.update_one({"id": driver_id}, {"$set": updates})
    fresh = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    return fresh or {}


@router.post("/drivers/{driver_id}/deactivate", response_model=Dict[str, Any])
async def deactivate_driver(
    driver_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    await _assert_owner(user, d)
    if d.get("status") in ("assigned", "on_trip"):
        raise HTTPException(409, "Cannot deactivate a driver mid-trip")
    await db.drivers.update_one(
        {"id": driver_id},
        {"$set": {"is_active": False, "status": "offline",
                  "deactivated_at": now_iso(),
                  "deactivation_reason": body.get("reason"),
                  "updated_at": now_iso()}},
    )
    if d.get("user_id"):
        await db.users.update_one({"id": d["user_id"]}, {"$set": {"status": "locked"}})
    return {"ok": True, "driver_id": driver_id}


@router.post("/drivers/{driver_id}/reactivate", response_model=Dict[str, Any])
async def reactivate_driver(
    driver_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    await _assert_owner(user, d)
    await db.drivers.update_one(
        {"id": driver_id},
        {"$set": {"is_active": True, "deactivated_at": None,
                  "deactivation_reason": None,
                  "updated_at": now_iso()}},
    )
    if d.get("user_id"):
        await db.users.update_one({"id": d["user_id"]}, {"$set": {"status": "active"}})
    return {"ok": True, "driver_id": driver_id}


@router.get("/drivers/{driver_id}/shipments", response_model=List[Dict[str, Any]])
async def driver_shipments_admin(
    driver_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
    status: Optional[str] = None,
):
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver not found")
    await _assert_owner(user, d)
    q: Dict[str, Any] = {"driver_id": driver_id}
    if status:
        q["status"] = status
    rows = await db.shipments.find(q, {"_id": 0, "delivery_code": 0}
                                   ).sort("created_at", -1).limit(200).to_list(200)
    return rows


# ---------------------------------------------------------------------------
# Driver-self endpoints — /api/driver/...
# ---------------------------------------------------------------------------
async def _require_driver(user: Dict[str, Any]) -> Dict[str, Any]:
    if user.get("role") != "driver":
        raise HTTPException(403, "Driver token required")
    driver_id = user.get("entity_id")
    d = await db.drivers.find_one({"id": driver_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Driver profile not found")
    if not d.get("is_active"):
        raise HTTPException(403, "Driver account is deactivated")
    return d


@router.get("/driver/me", response_model=Dict[str, Any])
async def driver_me(user: Dict[str, Any] = Depends(get_current_user)):
    return await _require_driver(user)


@router.post("/driver/me/online", response_model=Dict[str, Any])
async def driver_online(user: Dict[str, Any] = Depends(get_current_user)):
    d = await _require_driver(user)
    # do not overwrite assigned/on_trip — only flip from offline
    new_status = "available" if d.get("status") == "offline" else d.get("status")
    await db.drivers.update_one(
        {"id": d["id"]},
        {"$set": {"status": new_status, "last_seen_at": now_iso(),
                  "last_login_at": now_iso(), "updated_at": now_iso()}},
    )
    fresh = await db.drivers.find_one({"id": d["id"]}, {"_id": 0})
    return fresh or {}


@router.post("/driver/me/offline", response_model=Dict[str, Any])
async def driver_offline(user: Dict[str, Any] = Depends(get_current_user)):
    d = await _require_driver(user)
    if d.get("status") in ("assigned", "on_trip"):
        raise HTTPException(409, "Cannot go offline mid-trip")
    await db.drivers.update_one(
        {"id": d["id"]},
        {"$set": {"status": "offline", "updated_at": now_iso()}},
    )
    fresh = await db.drivers.find_one({"id": d["id"]}, {"_id": 0})
    return fresh or {}


@router.patch("/driver/me", response_model=Dict[str, Any])
async def driver_update_self(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await _require_driver(user)
    # self-edit is restricted
    allowed = {"phone", "email"}
    update = {k: v for k, v in body.items() if k in allowed and v is not None}
    if "email" in update:
        update["email"] = update["email"].lower()
    if update:
        update["updated_at"] = now_iso()
        await db.drivers.update_one({"id": d["id"]}, {"$set": update})
    fresh = await db.drivers.find_one({"id": d["id"]}, {"_id": 0})
    return fresh or {}


@router.post("/driver/me/location", response_model=Dict[str, Any])
async def driver_ping(
    body: Dict[str, Any] = Body(...),
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await _require_driver(user)
    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        raise HTTPException(422, "lat and lng are required")
    ping = {
        "id": str(uuid.uuid4()),
        "driver_id": d["id"],
        "employer_org_id": d.get("employer_org_id"),
        "lat": float(lat),
        "lng": float(lng),
        "accuracy_m": body.get("accuracy_m"),
        "heading": body.get("heading"),
        "speed_kmh": body.get("speed_kmh"),
        "ts": body.get("ts") or now_iso(),
        "created_at": now_iso(),
    }
    await db.driver_locations.insert_one(ping)
    await db.drivers.update_one(
        {"id": d["id"]},
        {"$set": {"last_seen_at": now_iso(),
                  "last_lat": float(lat), "last_lng": float(lng)}},
    )
    return {"ok": True}


@router.get("/driver/shipments", response_model=List[Dict[str, Any]])
async def driver_my_shipments(
    user: Dict[str, Any] = Depends(get_current_user),
    status: Optional[str] = None,
):
    d = await _require_driver(user)
    q: Dict[str, Any] = {"driver_id": d["id"]}
    if status:
        q["status"] = status
    rows = await db.shipments.find(q, {"_id": 0, "delivery_code": 0}
                                   ).sort("created_at", -1).limit(50).to_list(50)
    return rows


@router.get("/driver/shipments/{shipment_id}", response_model=Dict[str, Any])
async def driver_get_shipment(
    shipment_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await _require_driver(user)
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0, "delivery_code": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    if shp.get("driver_id") != d["id"]:
        raise HTTPException(403, "Not your shipment")
    return shp


@router.post("/driver/shipments/{shipment_id}/reject", response_model=Dict[str, Any])
async def driver_reject_shipment(
    shipment_id: str,
    body: Dict[str, Any] = Body(default_factory=dict),
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await _require_driver(user)
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    if shp.get("driver_id") != d["id"]:
        raise HTTPException(403, "Not your shipment")
    if shp.get("status") not in ("assigned",):
        raise HTTPException(409, f"Cannot reject in status {shp.get('status')}")

    now = now_iso()
    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {"driver_id": None, "vehicle_id": None,
                  "status": "ready_for_dispatch", "updated_at": now,
                  "assigned_at": None},
         "$push": {"status_history": {
             "from_status": "assigned",
             "to_status": "ready_for_dispatch",
             "at": now, "by_user_id": user.get("id"),
             "by_role": "driver",
             "reason": body.get("reason") or "Driver rejected assignment",
             "notes": body.get("notes"),
         }}},
    )
    await db.drivers.update_one(
        {"id": d["id"]},
        {"$set": {"status": "available", "assigned_shipment_id": None,
                  "assigned_vehicle_id": None, "updated_at": now}},
    )
    if shp.get("vehicle_id"):
        await db.vehicles.update_one(
            {"id": shp["vehicle_id"]},
            {"$set": {"status": "available", "current_shipment_id": None,
                      "current_driver_id": None, "updated_at": now}},
        )
    fresh = await db.shipments.find_one({"id": shipment_id}, {"_id": 0, "delivery_code": 0})
    return fresh or {}


@router.post("/driver/shipments/{shipment_id}/accept", response_model=Dict[str, Any])
async def driver_accept_shipment(
    shipment_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    d = await _require_driver(user)
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")
    if shp.get("driver_id") != d["id"]:
        raise HTTPException(403, "Not your shipment")
    # acceptance is implicit — but we record it on the timeline
    now = now_iso()
    await db.shipments.update_one(
        {"id": shipment_id},
        {"$push": {"status_history": {
            "from_status": shp.get("status"),
            "to_status": shp.get("status"),
            "at": now, "by_user_id": user.get("id"),
            "by_role": "driver",
            "notes": "Driver accepted assignment",
        }}, "$set": {"updated_at": now}},
    )
    return {"ok": True}
