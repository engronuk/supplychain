"""Phase B aggregation endpoints — fleet overview, driver workload,
assignment-history (driver + vehicle), fleet-level vehicle utilization.

These read-only endpoints power the dispatcher UI (Roster, Dispatch Console,
Command Centre v2). They are intentionally heavy-read, light-write — no
mutations live here.

Auth: standard `get_current_user`. Tenant scoping:
- super_admin → can pass any `?org_id=` to inspect any tenant.
- manufacturer / distributor / wholesaler → scoped to own employer_org_id;
  any other org_id silently coerces back to the caller's own.
- driver / retailer → 403.

Source contract: all responses are deterministic, JSON-serialisable, no
ObjectIds, no embedded auth tokens.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, now_iso
from services.auth import get_current_user as require_auth
from services.fleet_compliance import tenant_compliance_summary


router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
ALLOWED_DISPATCHER_ROLES = ("manufacturer", "distributor", "wholesaler", "super_admin")


def _resolve_tenant(user: Dict[str, Any], org_id: Optional[str]) -> str:
    """Return the tenant the caller is allowed to read. Coerces non-super_admin
    requests to their own ``entity_id``; raises 403 for non-dispatchers."""
    role = user.get("role")
    if role not in ALLOWED_DISPATCHER_ROLES:
        raise HTTPException(403, {
            "code": "FORBIDDEN_ROLE",
            "role": role,
            "allowed_roles": list(ALLOWED_DISPATCHER_ROLES),
        })
    if role == "super_admin":
        return org_id or ""  # empty = cross-tenant (global) view
    own = user.get("entity_id") or user.get("manufacturer_id") or ""
    return own


def _tenant_filter(field: str, tenant_id: str) -> Dict[str, Any]:
    """Apply tenant filter — empty string means no filter (super_admin global)."""
    return {field: tenant_id} if tenant_id else {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# 1. Driver assignment history
# ---------------------------------------------------------------------------
@router.get("/drivers/{driver_id}/assignment-history", response_model=List[Dict[str, Any]])
async def driver_assignment_history(
    driver_id: str,
    user: Dict[str, Any] = Depends(require_auth),
    limit: int = Query(100, ge=1, le=500),
    from_iso: Optional[str] = Query(None, alias="from"),
    to_iso: Optional[str] = Query(None, alias="to"),
):
    """Unified per-driver timeline:
    * assign + reassign-in/out events from ``shipment_status_history`` and
      from each shipment's embedded ``status_history`` array (for reassigns
      that don't change the lifecycle state).
    * driver-self events: accept, reject.

    Output is sorted desc by ``at``.
    """
    drv = await db.drivers.find_one(
        {"id": driver_id},
        {"_id": 0, "id": 1, "employer_org_id": 1},
    )
    if not drv:
        raise HTTPException(404, "Driver not found")
    tenant = _resolve_tenant(user, drv.get("employer_org_id"))
    if tenant and tenant != drv["employer_org_id"]:
        raise HTTPException(403, "Driver does not belong to this org")

    # ---- Pull all shipments that ever referenced this driver --------
    q: Dict[str, Any] = {
        "$or": [
            {"driver_id": driver_id},
            {"status_history.driver_id": driver_id},
        ]
    }
    if from_iso or to_iso:
        date_range: Dict[str, Any] = {}
        if from_iso:
            date_range["$gte"] = from_iso
        if to_iso:
            date_range["$lte"] = to_iso
        q["updated_at"] = date_range

    shipments = await db.shipments.find(
        q, {"_id": 0, "id": 1, "driver_id": 1, "vehicle_id": 1,
            "status": 1, "status_history": 1, "created_at": 1,
            "delivered_at": 1, "from_role": 1, "to_role": 1, "to_id": 1},
    ).sort("updated_at", -1).limit(limit * 3).to_list(limit * 3)

    events: List[Dict[str, Any]] = []
    for shp in shipments:
        sid = shp["id"]
        for h in (shp.get("status_history") or []):
            # only retain rows actually involving this driver
            if h.get("driver_id") and h["driver_id"] != driver_id:
                continue
            note = (h.get("notes") or "").lower()
            event_type = None
            if h.get("to_status") == "assigned" and h.get("from_status") in (
                    "created", "ready_for_dispatch", None):
                event_type = "assign"
            elif "reassigned driver" in note:
                event_type = "reassign-in" if h.get("driver_id") == driver_id else "reassign-out"
            elif h.get("to_status") == "delivered":
                event_type = "complete"
            elif h.get("to_status") == "cancelled":
                event_type = "cancel"
            elif h.get("to_status") in ("loaded", "in_transit", "arrived"):
                event_type = h["to_status"]
            else:
                continue
            events.append({
                "shipment_id": sid,
                "vehicle_id": shp.get("vehicle_id"),
                "from_status": h.get("from_status"),
                "to_status": h.get("to_status"),
                "event_type": event_type,
                "at": h.get("at"),
                "by_user_id": h.get("by_user_id"),
                "by_role": h.get("by_role"),
                "notes": h.get("notes"),
                "destination_role": shp.get("to_role"),
                "destination_id": shp.get("to_id"),
            })
    events.sort(key=lambda e: e.get("at") or "", reverse=True)
    return events[:limit]


# ---------------------------------------------------------------------------
# 2. Vehicle assignment history
# ---------------------------------------------------------------------------
@router.get("/vehicles/{vehicle_id}/assignment-history", response_model=List[Dict[str, Any]])
async def vehicle_assignment_history(
    vehicle_id: str,
    user: Dict[str, Any] = Depends(require_auth),
    limit: int = Query(100, ge=1, le=500),
    from_iso: Optional[str] = Query(None, alias="from"),
    to_iso: Optional[str] = Query(None, alias="to"),
):
    """Same shape as driver_assignment_history but vehicle-centric."""
    veh = await db.vehicles.find_one(
        {"id": vehicle_id},
        {"_id": 0, "id": 1, "owner_org_id": 1},
    )
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    tenant = _resolve_tenant(user, veh.get("owner_org_id"))
    if tenant and tenant != veh["owner_org_id"]:
        raise HTTPException(403, "Vehicle does not belong to this org")

    q: Dict[str, Any] = {
        "$or": [
            {"vehicle_id": vehicle_id},
            {"status_history.vehicle_id": vehicle_id},
        ]
    }
    if from_iso or to_iso:
        date_range: Dict[str, Any] = {}
        if from_iso:
            date_range["$gte"] = from_iso
        if to_iso:
            date_range["$lte"] = to_iso
        q["updated_at"] = date_range

    shipments = await db.shipments.find(
        q, {"_id": 0, "id": 1, "vehicle_id": 1, "driver_id": 1,
            "status": 1, "status_history": 1, "created_at": 1,
            "delivered_at": 1, "to_role": 1, "to_id": 1},
    ).sort("updated_at", -1).limit(limit * 3).to_list(limit * 3)

    events: List[Dict[str, Any]] = []
    for shp in shipments:
        sid = shp["id"]
        for h in (shp.get("status_history") or []):
            if h.get("vehicle_id") and h["vehicle_id"] != vehicle_id:
                continue
            note = (h.get("notes") or "").lower()
            event_type = None
            if h.get("to_status") == "assigned":
                event_type = "assign"
            elif "reassigned vehicle" in note:
                event_type = "reassign-in" if h.get("vehicle_id") == vehicle_id else "reassign-out"
            elif h.get("to_status") in ("loaded", "in_transit", "arrived", "delivered", "cancelled"):
                event_type = h["to_status"]
            else:
                continue
            events.append({
                "shipment_id": sid,
                "driver_id": shp.get("driver_id"),
                "from_status": h.get("from_status"),
                "to_status": h.get("to_status"),
                "event_type": event_type,
                "at": h.get("at"),
                "by_user_id": h.get("by_user_id"),
                "by_role": h.get("by_role"),
                "notes": h.get("notes"),
                "destination_role": shp.get("to_role"),
                "destination_id": shp.get("to_id"),
            })
    events.sort(key=lambda e: e.get("at") or "", reverse=True)
    return events[:limit]


# ---------------------------------------------------------------------------
# 3. Driver workload — one row per driver in the tenant
# ---------------------------------------------------------------------------
@router.get("/drivers/workload", response_model=List[Dict[str, Any]])
async def drivers_workload(
    user: Dict[str, Any] = Depends(require_auth),
    employer_org_id: Optional[str] = Query(None),
    warehouse_id: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
):
    """One row per active driver with live counters:
    * active_shipments: drivers' shipments currently in ``assigned / loaded /
      in_transit / arrived``.
    * accepted_today / delivered_today: counts since 00:00 UTC today.
    * on_time_pct_7d: rolling 7-day on-time percentage.
    * hours_on_shift: minutes since the driver flipped ``online`` (presence).
    """
    tenant = _resolve_tenant(user, employer_org_id)

    drv_filter: Dict[str, Any] = {"is_active": True}
    drv_filter.update(_tenant_filter("employer_org_id", tenant))
    if warehouse_id:
        drv_filter["home_warehouse_id"] = warehouse_id

    drivers = await db.drivers.find(
        drv_filter,
        {"_id": 0, "id": 1, "employee_number": 1, "full_name": 1, "first_name": 1,
         "last_name": 1, "status": 1, "phone": 1, "assigned_vehicle_id": 1,
         "assigned_shipment_id": 1, "last_seen_at": 1, "last_login_at": 1,
         "deliveries_30d": 1, "on_time_pct_30d": 1, "avg_pod_time_min": 1,
         "home_warehouse_id": 1},
    ).limit(limit).to_list(limit)

    if not drivers:
        return []

    driver_ids = [d["id"] for d in drivers]
    today_iso = _now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_ago_iso = (_now() - timedelta(days=7)).isoformat()

    # Active shipments per driver (status ∈ assigned, loaded, in_transit, arrived)
    active_pipeline = [
        {"$match": {"driver_id": {"$in": driver_ids},
                    "status": {"$in": ["assigned", "loaded", "in_transit", "arrived"]}}},
        {"$group": {"_id": "$driver_id", "n": {"$sum": 1}}},
    ]
    active_map: Dict[str, int] = {}
    async for row in db.shipments.aggregate(active_pipeline):
        active_map[row["_id"]] = row["n"]

    # Delivered today (status_history.to_status=delivered with at >= today)
    delivered_pipeline = [
        {"$match": {"driver_id": {"$in": driver_ids},
                    "status": "delivered",
                    "delivered_at": {"$gte": today_iso}}},
        {"$group": {"_id": "$driver_id", "n": {"$sum": 1}}},
    ]
    delivered_today_map: Dict[str, int] = {}
    async for row in db.shipments.aggregate(delivered_pipeline):
        delivered_today_map[row["_id"]] = row["n"]

    # Accepted today — uses status_history with reason "accept" or to_status=loaded since today
    accepted_pipeline = [
        {"$match": {"driver_id": {"$in": driver_ids}}},
        {"$unwind": "$status_history"},
        {"$match": {"status_history.to_status": "loaded",
                    "status_history.at": {"$gte": today_iso}}},
        {"$group": {"_id": "$driver_id", "n": {"$sum": 1}}},
    ]
    accepted_today_map: Dict[str, int] = {}
    async for row in db.shipments.aggregate(accepted_pipeline):
        accepted_today_map[row["_id"]] = row["n"]

    # On-time % 7d = delivered shipments in 7d whose delivered_at <= eta
    ontime_pipeline = [
        {"$match": {"driver_id": {"$in": driver_ids},
                    "status": "delivered",
                    "delivered_at": {"$gte": week_ago_iso}}},
        {"$group": {
            "_id": "$driver_id",
            "total": {"$sum": 1},
            "on_time": {"$sum": {
                "$cond": [
                    {"$or": [
                        {"$eq": ["$eta", None]},
                        {"$lte": ["$delivered_at", "$eta"]},
                    ]},
                    1, 0,
                ]
            }},
        }},
    ]
    ontime_map: Dict[str, Dict[str, int]] = {}
    async for row in db.shipments.aggregate(ontime_pipeline):
        ontime_map[row["_id"]] = {"total": row["total"], "on_time": row["on_time"]}

    out: List[Dict[str, Any]] = []
    now_dt = _now()
    for d in drivers:
        did = d["id"]
        ot = ontime_map.get(did)
        on_time_pct_7d = round(100 * ot["on_time"] / ot["total"], 1) if ot and ot["total"] else None

        hours_on_shift: Optional[float] = None
        login_iso = d.get("last_login_at")
        if d.get("status") != "offline" and login_iso:
            try:
                login_dt = datetime.fromisoformat(login_iso.replace("Z", "+00:00"))
                hours_on_shift = round((now_dt - login_dt).total_seconds() / 3600, 2)
            except ValueError:
                hours_on_shift = None

        out.append({
            "driver_id": did,
            "employee_number": d.get("employee_number"),
            "name": d.get("full_name") or
                    f"{d.get('first_name','')} {d.get('last_name','')}".strip(),
            "status": d.get("status"),
            "phone": d.get("phone"),
            "home_warehouse_id": d.get("home_warehouse_id"),
            "assigned_vehicle_id": d.get("assigned_vehicle_id"),
            "assigned_shipment_id": d.get("assigned_shipment_id"),
            "active_shipments": active_map.get(did, 0),
            "accepted_today": accepted_today_map.get(did, 0),
            "delivered_today": delivered_today_map.get(did, 0),
            "on_time_pct_7d": on_time_pct_7d,
            "on_time_pct_30d": d.get("on_time_pct_30d"),
            "deliveries_30d": d.get("deliveries_30d") or 0,
            "avg_pod_time_min": d.get("avg_pod_time_min"),
            "hours_on_shift": hours_on_shift,
            "last_seen_at": d.get("last_seen_at"),
        })
    # Sort by busiest first
    out.sort(key=lambda r: (-r["active_shipments"], -r["deliveries_30d"]))
    return out


# ---------------------------------------------------------------------------
# 4. Fleet-wide vehicle utilization (companion to /vehicles/{id}/utilization)
# ---------------------------------------------------------------------------
@router.get("/vehicles/utilization", response_model=List[Dict[str, Any]])
async def vehicles_utilization_fleet(
    user: Dict[str, Any] = Depends(require_auth),
    owner_org_id: Optional[str] = Query(None),
    from_iso: Optional[str] = Query(None, alias="from"),
    to_iso: Optional[str] = Query(None, alias="to"),
    limit: int = Query(500, ge=1, le=2000),
):
    """One row per active vehicle: trip count, units carried, status mix."""
    tenant = _resolve_tenant(user, owner_org_id)
    veh_filter: Dict[str, Any] = {"is_active": True}
    veh_filter.update(_tenant_filter("owner_org_id", tenant))
    if tenant:
        # exclude legacy simulator rows from the dispatcher view; they live in
        # the same collection but aren't part of the operator's real fleet.
        veh_filter["source"] = {"$in": ["manual", "seed"]}

    vehicles = await db.vehicles.find(
        veh_filter,
        {"_id": 0, "id": 1, "vehicle_code": 1, "registration_number": 1,
         "vehicle_type": 1, "status": 1, "capacity_units": 1,
         "capacity_weight_kg": 1, "odometer_km": 1, "last_service_at": 1,
         "next_service_due_km": 1, "insurance_expiry": 1,
         "roadworthiness_expiry": 1, "current_driver_id": 1,
         "current_shipment_id": 1, "assigned_driver_id": 1},
    ).limit(limit).to_list(limit)
    if not vehicles:
        return []

    ids = [v["id"] for v in vehicles]
    start_iso = from_iso or (_now() - timedelta(days=30)).isoformat()
    end_iso = to_iso or _now().isoformat()

    # Aggregate trips, total units, delivered count from shipments
    pipeline = [
        {"$match": {"vehicle_id": {"$in": ids},
                    "created_at": {"$gte": start_iso, "$lte": end_iso}}},
        {"$group": {
            "_id": "$vehicle_id",
            "trips": {"$sum": 1},
            "delivered": {"$sum": {"$cond": [{"$eq": ["$status", "delivered"]}, 1, 0]}},
            "cancelled": {"$sum": {"$cond": [{"$eq": ["$status", "cancelled"]}, 1, 0]}},
            "units_carried": {"$sum": {"$ifNull": ["$total_units", 0]}},
            "value_carried": {"$sum": {"$ifNull": ["$total_value", 0]}},
        }},
    ]
    agg: Dict[str, Dict[str, Any]] = {}
    async for row in db.shipments.aggregate(pipeline):
        agg[row["_id"]] = row

    out: List[Dict[str, Any]] = []
    for v in vehicles:
        a = agg.get(v["id"]) or {}
        out.append({
            "vehicle_id": v["id"],
            "vehicle_code": v.get("vehicle_code"),
            "registration_number": v.get("registration_number"),
            "vehicle_type": v.get("vehicle_type"),
            "status": v.get("status"),
            "capacity_units": v.get("capacity_units"),
            "capacity_weight_kg": v.get("capacity_weight_kg"),
            "odometer_km": v.get("odometer_km") or 0,
            "trips": a.get("trips", 0),
            "delivered": a.get("delivered", 0),
            "cancelled": a.get("cancelled", 0),
            "units_carried": a.get("units_carried", 0),
            "value_carried": a.get("value_carried", 0),
            "current_driver_id": v.get("current_driver_id"),
            "current_shipment_id": v.get("current_shipment_id"),
            "assigned_driver_id": v.get("assigned_driver_id"),
            "last_service_at": v.get("last_service_at"),
            "next_service_due_km": v.get("next_service_due_km"),
            "insurance_expiry": v.get("insurance_expiry"),
            "roadworthiness_expiry": v.get("roadworthiness_expiry"),
        })
    out.sort(key=lambda r: -r["trips"])
    return out


# ---------------------------------------------------------------------------
# 5. Fleet overview — single dispatcher dashboard cube
# ---------------------------------------------------------------------------
@router.get("/fleet/overview", response_model=Dict[str, Any])
async def fleet_overview(
    user: Dict[str, Any] = Depends(require_auth),
    org_id: Optional[str] = Query(None),
):
    """One-call dispatcher dashboard.

    Drivers by status + vehicles by status + shipments by status + due-soon
    compliance counters + the top 5 active drivers + the top 5 utilised
    vehicles (last 30 days). Tenant scoped (super_admin can pass org_id).
    """
    tenant = _resolve_tenant(user, org_id)

    # Filters scoped to Track A fleet only (exclude legacy sim rows)
    drv_f: Dict[str, Any] = {"is_active": True}
    drv_f.update(_tenant_filter("employer_org_id", tenant))

    veh_f: Dict[str, Any] = {"is_active": True}
    veh_f.update(_tenant_filter("owner_org_id", tenant))
    if tenant:
        veh_f["source"] = {"$in": ["manual", "seed"]}

    shp_f: Dict[str, Any] = {}
    shp_f.update(_tenant_filter("owner_org_id", tenant))

    # Drivers by status
    drv_status_map: Dict[str, int] = {}
    async for r in db.drivers.aggregate([
        {"$match": drv_f},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]):
        drv_status_map[r["_id"] or "unknown"] = r["n"]

    # Vehicles by status
    veh_status_map: Dict[str, int] = {}
    async for r in db.vehicles.aggregate([
        {"$match": veh_f},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]):
        veh_status_map[r["_id"] or "unknown"] = r["n"]

    # Shipments by status (current open + recent)
    shp_status_map: Dict[str, int] = {}
    async for r in db.shipments.aggregate([
        {"$match": shp_f},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]):
        shp_status_map[r["_id"] or "unknown"] = r["n"]

    # Compliance — unified bucket counters powered by job_compliance_check.
    now = _now()
    compliance = await tenant_compliance_summary(tenant)
    # Back-compat: keep the granular "X due in 30 days" counters next to
    # the new four-bucket shape so downstream code is not broken.
    soon_iso = (now + timedelta(days=30)).isoformat()
    today_iso = now.isoformat()

    licences_due = await db.drivers.count_documents({
        **drv_f,
        "licence_expiry": {"$gte": today_iso, "$lte": soon_iso},
    })
    insurance_due = await db.vehicles.count_documents({
        **veh_f,
        "insurance_expiry": {"$gte": today_iso, "$lte": soon_iso},
    })
    roadworthiness_due = await db.vehicles.count_documents({
        **veh_f,
        "roadworthiness_expiry": {"$gte": today_iso, "$lte": soon_iso},
    })

    # Top-5 busiest drivers (by active shipments)
    top_drivers: List[Dict[str, Any]] = []
    drv_ids = [d["id"] async for d in db.drivers.find(drv_f, {"_id": 0, "id": 1})]
    if drv_ids:
        async for r in db.shipments.aggregate([
            {"$match": {"driver_id": {"$in": drv_ids},
                        "status": {"$in": ["assigned", "loaded", "in_transit", "arrived"]}}},
            {"$group": {"_id": "$driver_id", "active": {"$sum": 1}}},
            {"$sort": {"active": -1}},
            {"$limit": 5},
        ]):
            drv_doc = await db.drivers.find_one(
                {"id": r["_id"]},
                {"_id": 0, "id": 1, "employee_number": 1, "full_name": 1, "status": 1},
            )
            if drv_doc:
                top_drivers.append({**drv_doc, "active_shipments": r["active"]})

    # Top-5 utilised vehicles (last 30 days)
    top_vehicles: List[Dict[str, Any]] = []
    veh_ids = [v["id"] async for v in db.vehicles.find(veh_f, {"_id": 0, "id": 1})]
    if veh_ids:
        cutoff = (now - timedelta(days=30)).isoformat()
        async for r in db.shipments.aggregate([
            {"$match": {"vehicle_id": {"$in": veh_ids},
                        "created_at": {"$gte": cutoff}}},
            {"$group": {"_id": "$vehicle_id",
                        "trips": {"$sum": 1},
                        "units": {"$sum": {"$ifNull": ["$total_units", 0]}}}},
            {"$sort": {"trips": -1}},
            {"$limit": 5},
        ]):
            veh_doc = await db.vehicles.find_one(
                {"id": r["_id"]},
                {"_id": 0, "id": 1, "vehicle_code": 1, "registration_number": 1,
                 "status": 1, "capacity_units": 1},
            )
            if veh_doc:
                top_vehicles.append({**veh_doc, "trips_30d": r["trips"],
                                     "units_30d": r["units"]})

    return {
        "tenant_id": tenant or "global",
        "scope": "global" if not tenant else "tenant",
        "generated_at": now_iso(),
        "drivers": {
            "total": sum(drv_status_map.values()),
            "by_status": drv_status_map,
            "available": drv_status_map.get("available", 0),
            "assigned": drv_status_map.get("assigned", 0),
            "on_trip": drv_status_map.get("on_trip", 0),
            "offline": drv_status_map.get("offline", 0),
        },
        "vehicles": {
            "total": sum(veh_status_map.values()),
            "by_status": veh_status_map,
            "available": veh_status_map.get("available", 0),
            "in_transit": veh_status_map.get("in_transit", 0),
            "loading": veh_status_map.get("loading", 0),
            "maintenance": veh_status_map.get("maintenance", 0),
            "offline": veh_status_map.get("offline", 0),
        },
        "shipments": {
            "total": sum(shp_status_map.values()),
            "by_status": shp_status_map,
            "open": sum(shp_status_map.get(s, 0) for s in
                        ("created", "ready_for_dispatch", "assigned",
                         "loaded", "in_transit", "arrived")),
            "delivered": shp_status_map.get("delivered", 0),
            "cancelled": shp_status_map.get("cancelled", 0),
        },
        "compliance": {
            **compliance,                               # critical, warning, expiring_30d, expired, counts
            "licences_due_30d": licences_due,           # legacy granular counters
            "insurance_due_30d": insurance_due,
            "roadworthiness_due_30d": roadworthiness_due,
        },
        "top_drivers": top_drivers,
        "top_vehicles": top_vehicles,
    }


# ---------------------------------------------------------------------------
# 6. Default driver-vehicle pairing endpoints
# ---------------------------------------------------------------------------
@router.post("/vehicles/{vehicle_id}/assign-default-driver", response_model=Dict[str, Any])
async def assign_default_driver(
    vehicle_id: str,
    body: Dict[str, Any],
    user: Dict[str, Any] = Depends(require_auth),
):
    """Persist a default ``assigned_driver_id`` on the vehicle.

    This is a long-lived pairing — independent of any active shipment. The
    Dispatch Console can use this to pre-fill the driver picker when this
    vehicle is selected.
    """
    if user.get("role") not in ALLOWED_DISPATCHER_ROLES:
        raise HTTPException(403, "Only dispatchers can pair drivers")
    driver_id = body.get("driver_id")
    if not driver_id:
        raise HTTPException(422, "driver_id is required")

    veh = await db.vehicles.find_one(
        {"id": vehicle_id},
        {"_id": 0, "id": 1, "owner_org_id": 1, "is_active": 1},
    )
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    if not veh.get("is_active"):
        raise HTTPException(409, "Vehicle is decommissioned")
    tenant = _resolve_tenant(user, veh.get("owner_org_id"))
    if tenant and tenant != veh["owner_org_id"]:
        raise HTTPException(403, "Vehicle does not belong to this org")

    drv = await db.drivers.find_one(
        {"id": driver_id},
        {"_id": 0, "id": 1, "employer_org_id": 1, "is_active": 1},
    )
    if not drv:
        raise HTTPException(404, "Driver not found")
    if not drv.get("is_active"):
        raise HTTPException(409, "Driver is deactivated")
    if drv.get("employer_org_id") != veh.get("owner_org_id"):
        raise HTTPException(409, "Driver and vehicle belong to different orgs")

    now = now_iso()
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"assigned_driver_id": driver_id, "updated_at": now}},
    )
    return {"ok": True, "vehicle_id": vehicle_id,
            "assigned_driver_id": driver_id, "at": now}


@router.post("/vehicles/{vehicle_id}/clear-default-driver", response_model=Dict[str, Any])
async def clear_default_driver(
    vehicle_id: str,
    user: Dict[str, Any] = Depends(require_auth),
):
    if user.get("role") not in ALLOWED_DISPATCHER_ROLES:
        raise HTTPException(403, "Only dispatchers can clear pairings")
    veh = await db.vehicles.find_one(
        {"id": vehicle_id},
        {"_id": 0, "id": 1, "owner_org_id": 1},
    )
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    tenant = _resolve_tenant(user, veh.get("owner_org_id"))
    if tenant and tenant != veh["owner_org_id"]:
        raise HTTPException(403, "Vehicle does not belong to this org")

    now = now_iso()
    await db.vehicles.update_one(
        {"id": vehicle_id},
        {"$set": {"assigned_driver_id": None, "updated_at": now}},
    )
    return {"ok": True, "vehicle_id": vehicle_id, "assigned_driver_id": None,
            "at": now}
