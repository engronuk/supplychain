"""Logistics Control Tower API — event-driven operational cockpit.

  GET  /api/logistics/control-tower            — full tower payload
  GET  /api/logistics/events                   — event/alert feed (filters)
  POST /api/logistics/events/{event_id}/ack    — acknowledge an alert
  GET  /api/logistics/shipment-timeline/{id}   — event audit trail per shipment
  GET  /api/logistics/geofences                — virtual boundaries
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from core import db, now_iso
from routes.allocation import _scope_manufacturer
from services.auth import get_current_user
from services.control_tower_sim import coords_for, maybe_tick

router = APIRouter()


async def _tenant_ids(mfr: str) -> Dict[str, List[str]]:
    wh = [o["id"] async for o in db.organizations.find(
        {"organization_type": "warehouse", "parent_organization_id": mfr}, {"_id": 0, "id": 1})]
    dist = [d["id"] async for d in db.distributors.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1})]
    who = [o["id"] async for o in db.organizations.find(
        {"organization_type": "wholesaler", "parent_organization_id": {"$in": dist}},
        {"_id": 0, "id": 1})]
    rtl = [r["id"] async for r in db.retailers.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1})]
    return {"warehouse": wh, "distributor": dist, "wholesaler": who, "retailer": rtl}


async def _units_by_owner(owner_type: str, ids: List[str]) -> Dict[str, Dict[str, float]]:
    """owner_id → {units, velocity} in one aggregation."""
    out: Dict[str, Dict[str, float]] = {}
    if not ids:
        return out
    async for row in db.inventory.aggregate([
        {"$match": {"owner_type": owner_type, "owner_id": {"$in": ids}}},
        {"$group": {"_id": "$owner_id",
                    "units": {"$sum": "$quantity"},
                    "velocity": {"$sum": "$velocity"}}},
    ]):
        out[row["_id"]] = {"units": int(row["units"] or 0),
                           "velocity": float(row["velocity"] or 0)}
    return out


def _cover_days(units: int, velocity: float) -> Optional[float]:
    if velocity <= 0:
        return None
    return round(units / velocity, 1)


def _risk(cover: Optional[float]) -> str:
    if cover is None:
        return "unknown"
    if cover < 3:
        return "high"
    if cover < 7:
        return "medium"
    return "low"


# ===========================================================================
@router.get("/logistics/control-tower")
async def control_tower(manufacturer_id: Optional[str] = None,
                        user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    # Self-healing simulation: if no background scheduler is ticking in this
    # deployment, viewing the tower kicks one off (non-blocking).
    await maybe_tick()
    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()
    ids = await _tenant_ids(mfr)

    # ---- Fleet -------------------------------------------------------------
    vehicles = await db.vehicles.find(
        {"manufacturer_id": mfr}, {"_id": 0}).to_list(100)
    active = [v for v in vehicles if v.get("status") in ("in_transit", "stopped", "breakdown")]
    deviations_active = sum(1 for v in active if (v.get("deviation") or {}).get("active"))
    breakdowns_active = sum(1 for v in active if v.get("status") == "breakdown")
    stops_active = sum(1 for v in active if v.get("status") == "stopped")

    # ---- Shipments (unified live feed) --------------------------------------
    vehicle_by_ref = {v.get("ref_id"): v for v in vehicles if v.get("ref_id")}
    # Multi-stop route vehicles carry several shipments — map each to its truck.
    for v in vehicles:
        for st in (v.get("stops") or []):
            sid = st.get("shipment_id")
            if sid and sid not in vehicle_by_ref:
                vehicle_by_ref[sid] = v
    horizon = (now - timedelta(days=14)).isoformat()
    raw_shipments = await db.shipments.find(
        {"manufacturer_id": mfr,
         "$or": [{"status": "in_transit"}, {"created_at": {"$gte": horizon}}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(120)

    dist_names = {d["id"]: d async for d in db.distributors.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1})}
    prod_names = {p["id"]: p["name"] async for p in db.products.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1, "name": 1})}
    # Non-distributor destinations (warehouses, wholesalers, retailers) so
    # every movement leg — factory→WH, WH→wholesaler, wholesaler→distributor,
    # WH→retailer — resolves a real name on the board.
    other_ids = list({s.get("to_id") for s in raw_shipments
                      if s.get("to_id") and s.get("to_id") not in dist_names})
    org_dests: Dict[str, Dict[str, Any]] = {}
    if other_ids:
        async for o in db.organizations.find(
                {"id": {"$in": other_ids}},
                {"_id": 0, "id": 1, "organization_name": 1, "city": 1, "region": 1}):
            org_dests[o["id"]] = {"name": o.get("organization_name"),
                                  "city": o.get("city"), "region": o.get("region")}
        missing = [i for i in other_ids if i not in org_dests]
        if missing:
            async for r in db.retailers.find(
                    {"id": {"$in": missing}},
                    {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1}):
                org_dests[r["id"]] = {"name": r.get("name"),
                                      "city": r.get("city"), "region": r.get("region")}

    shipments_live = []
    delayed = 0
    in_transit_count = 0
    for s in raw_shipments:
        v = vehicle_by_ref.get(s["id"])
        units = sum(int(i.get("quantity") or 0) for i in (s.get("items") or []))
        to = (dist_names.get(s.get("to_id"))
              or org_dests.get(s.get("to_id")) or {})
        status = s.get("status") or "pending"
        is_delayed = status == "delayed" or (
            (v.get("deviation") or {}).get("active") if v else False)
        if status == "in_transit":
            in_transit_count += 1
            if s.get("dispatched_at"):
                try:
                    age_d = (now - datetime.fromisoformat(
                        s["dispatched_at"].replace("Z", "+00:00"))).total_seconds() / 86400
                    if age_d > 4:
                        is_delayed = True
                except (ValueError, TypeError):
                    pass
        if is_delayed:
            delayed += 1
        first_pid = (s.get("items") or [{}])[0].get("product_id")
        shipments_live.append({
            "id": s["id"],
            "tracking_code": s.get("tracking_code") or s["id"][:8].upper(),
            "product": prod_names.get(first_pid, "Mixed SKUs"),
            "skus": len(s.get("items") or []),
            "units": units,
            "owner": "In transit" if status in ("in_transit", "dispatched")
                     else ("Distributor" if status in ("received", "delivered", "completed")
                           else "Warehouse"),
            "from_role": s.get("from_role") or "warehouse",
            "to_role": s.get("to_role"),
            "to_name": to.get("name") or "—",
            "to_city": to.get("city") or "",
            "to_region": to.get("region") or "",
            "status": "delayed" if is_delayed and status == "in_transit" else status,
            "eta_minutes": (0 if status in ("received", "delivered", "completed")
                            else (v.get("eta_minutes") if v else None)),
            "route_progress": (100 if status in ("received", "delivered", "completed")
                               else (round(float(v.get("route_progress") or 0) * 100)
                                     if v else None)),
            "driver": v.get("driver_name") if v else None,
            "vehicle_code": v.get("code") if v else None,
            "items": [{"name": prod_names.get(i.get("product_id"), "Item"),
                       "quantity": int(i.get("quantity") or 0)}
                      for i in (s.get("items") or [])[:8]],
            "dispatched_at": s.get("dispatched_at"),
            "received_at": s.get("received_at"),
            "created_at": s.get("created_at"),
        })

    # ---- Geofence breaches today --------------------------------------------
    breaches_today = await db.logistics_events.count_documents({
        "manufacturer_id": mfr,
        "event_type": {"$in": ["geofence_enter", "geofence_exit",
                               "warehouse_arrived", "warehouse_departed"]},
        "created_at": {"$gte": today_iso},
    })

    # ---- Tier inventory (inventory-in-transit view) --------------------------
    tier_units: Dict[str, int] = {}
    for tier in ("warehouse", "distributor", "wholesaler", "retailer"):
        agg = await _units_by_owner(tier, ids[tier])
        tier_units[tier] = sum(x["units"] for x in agg.values())
    in_transit_units = 0
    async for row in db.shipments.aggregate([
        {"$match": {"manufacturer_id": mfr, "status": "in_transit"}},
        {"$unwind": "$items"},
        {"$group": {"_id": None, "u": {"$sum": "$items.quantity"}}},
    ]):
        in_transit_units = int(row["u"] or 0)

    # ---- Digital twin --------------------------------------------------------
    wh_orgs = await db.organizations.find(
        {"organization_type": "warehouse", "parent_organization_id": mfr},
        {"_id": 0, "id": 1, "organization_name": 1, "city": 1, "region": 1},
    ).to_list(50)
    wh_units = await _units_by_owner("warehouse", ids["warehouse"])
    twin_warehouses = []
    for w in wh_orgs:
        u = wh_units.get(w["id"], {}).get("units", 0)
        capacity = max(50000, int(u * 1.6 // 10000 + 1) * 10000)
        lat, lng = coords_for(w.get("city"), w.get("region"))
        twin_warehouses.append({
            "id": w["id"], "name": w["organization_name"],
            "city": w.get("city"), "region": w.get("region"),
            "units": u, "capacity": capacity,
            "utilization_pct": round(u / capacity * 100, 1),
            "lat": lat, "lng": lng,
        })

    who_orgs = await db.organizations.find(
        {"id": {"$in": ids["wholesaler"]}},
        {"_id": 0, "id": 1, "organization_name": 1, "city": 1, "region": 1},
    ).to_list(100)
    who_units = await _units_by_owner("wholesaler", ids["wholesaler"])
    pending_by_who: Dict[str, int] = {}
    async for row in db.wholesaler_orders.aggregate([
        {"$match": {"wholesaler_id": {"$in": ids["wholesaler"]},
                    "status": {"$in": ["pending", "submitted", "processing"]}}},
        {"$group": {"_id": "$wholesaler_id", "n": {"$sum": 1}}},
    ]):
        pending_by_who[row["_id"]] = int(row["n"])
    twin_wholesalers = []
    for w in who_orgs:
        agg = who_units.get(w["id"], {"units": 0, "velocity": 0})
        cover = _cover_days(agg["units"], agg["velocity"] or agg["units"] / 60 or 1)
        lat, lng = coords_for(w.get("city"), w.get("region"))
        twin_wholesalers.append({
            "id": w["id"], "name": w["organization_name"],
            "city": w.get("city"), "region": w.get("region"),
            "units": agg["units"],
            "orders_pending": pending_by_who.get(w["id"], 0),
            "stock_cover_days": cover,
            "lat": lat, "lng": lng,
        })

    dist_units = await _units_by_owner("distributor", ids["distributor"])
    twin_distributors = []
    for did, d in dist_names.items():
        agg = dist_units.get(did, {"units": 0, "velocity": 0})
        cover = _cover_days(agg["units"], agg["velocity"] or agg["units"] / 45 or 1)
        lat, lng = coords_for(d.get("city"), d.get("region"))
        twin_distributors.append({
            "id": did, "name": d.get("name"),
            "city": d.get("city"), "region": d.get("region"),
            "units": agg["units"],
            "stock_cover_days": cover,
            "risk": _risk(cover),
            "lat": lat, "lng": lng,
        })
    risk_rank = {"high": 0, "medium": 1, "unknown": 2, "low": 3}
    twin_distributors.sort(key=lambda x: (risk_rank.get(x["risk"], 3),
                                          x["stock_cover_days"] or 999))

    # ---- Retailer clusters for the map ---------------------------------------
    retailer_clusters = []
    async for row in db.retailers.aggregate([
        {"$match": {"manufacturer_id": mfr}},
        {"$group": {"_id": {"city": "$city", "region": "$region"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}, {"$limit": 40},
    ]):
        city = row["_id"].get("city")
        region = row["_id"].get("region")
        lat, lng = coords_for(city, region)
        retailer_clusters.append({"city": city or region or "—", "count": int(row["n"]),
                                  "lat": lat, "lng": lng})

    # ---- Events feed ----------------------------------------------------------
    events = await db.logistics_events.find(
        {"manufacturer_id": mfr}, {"_id": 0},
    ).sort("created_at", -1).to_list(30)
    unacked_critical = await db.logistics_events.count_documents(
        {"manufacturer_id": mfr, "severity": "critical", "acknowledged": False})

    # ---- On-time % (last 30 days deliveries) ----------------------------------
    cutoff30 = (now - timedelta(days=30)).isoformat()
    total_recv, on_time = 0, 0
    async for s in db.shipments.find(
            {"manufacturer_id": mfr, "status": "received",
             "received_at": {"$gte": cutoff30}},
            {"_id": 0, "dispatched_at": 1, "received_at": 1}):
        total_recv += 1
        try:
            d1 = datetime.fromisoformat(s["dispatched_at"].replace("Z", "+00:00"))
            d2 = datetime.fromisoformat(s["received_at"].replace("Z", "+00:00"))
            if (d2 - d1).total_seconds() <= 4 * 86400:
                on_time += 1
        except (ValueError, TypeError, AttributeError, KeyError):
            on_time += 1

    return {
        "kpis": {
            "active_shipments": in_transit_count,
            "delayed": delayed,
            "deviations_active": deviations_active,
            "unauthorized_stops": stops_active,
            "breakdowns_active": breakdowns_active,
            "geofence_events_today": breaches_today,
            "in_transit_units": in_transit_units,
            "on_time_pct": round(on_time / total_recv * 100, 1) if total_recv else None,
            "unacked_critical": unacked_critical,
            "fleet_active": len(active),
            "fleet_total": len(vehicles),
        },
        "fleet": vehicles,
        "shipments": shipments_live,
        "tier_inventory": {
            "warehouse": tier_units["warehouse"],
            "in_transit": in_transit_units,
            "wholesaler": tier_units["wholesaler"],
            "distributor": tier_units["distributor"],
            "retailer": tier_units["retailer"],
        },
        "digital_twin": {
            "warehouses": twin_warehouses,
            "wholesalers": twin_wholesalers,
            "distributors": twin_distributors[:15],
            "distributors_total": len(twin_distributors),
            "distributors_at_risk": sum(1 for d in twin_distributors if d["risk"] == "high"),
        },
        "retailer_clusters": retailer_clusters,
        "events": events,
        "generated_at": now_iso(),
    }


# ===========================================================================
@router.get("/logistics/wholesalers/{wholesaler_id}/pending-orders")
async def wholesaler_pending_orders(wholesaler_id: str,
                                    user: Dict[str, Any] = Depends(get_current_user)):
    """What's behind a wholesaler's 'pending' badge on the digital twin."""
    await _scope_manufacturer(user, None)
    org = await db.organizations.find_one(
        {"id": wholesaler_id}, {"_id": 0, "organization_name": 1})
    rows = await db.wholesaler_orders.find(
        {"wholesaler_id": wholesaler_id,
         "status": {"$in": ["pending", "submitted", "processing"]}},
        {"_id": 0, "id": 1, "order_number": 1, "status": 1, "lines": 1,
         "items": 1, "total_units": 1, "distributor": 1, "distributor_name": 1,
         "created_at": 1, "requested_delivery_date": 1},
    ).sort("created_at", -1).to_list(25)
    orders = []
    for o in rows:
        lines = o.get("lines") or o.get("items") or []
        units = o.get("total_units") or sum(
            int(ln.get("quantity") or 0) for ln in lines)
        dist = o.get("distributor")
        placed_by = ((dist.get("name") if isinstance(dist, dict) else dist)
                     or o.get("distributor_name") or "Distributor")
        orders.append({
            "id": o["id"],
            "order_number": o.get("order_number") or o["id"][:8].upper(),
            "status": o.get("status"),
            "placed_by": placed_by,
            "lines": len(lines),
            "units": int(units or 0),
            "created_at": o.get("created_at"),
            "requested_delivery_date": o.get("requested_delivery_date"),
            "items": [{"name": ln.get("product_name") or ln.get("name") or "Item",
                       "quantity": int(ln.get("quantity") or 0)}
                      for ln in lines[:8]],
        })
    return {"wholesaler_id": wholesaler_id,
            "wholesaler_name": (org or {}).get("organization_name"),
            "orders": orders}


@router.get("/logistics/events")
async def list_events(manufacturer_id: Optional[str] = None,
                      category: Optional[str] = None,
                      severity: Optional[str] = None,
                      unacked: bool = False,
                      limit: int = 80,
                      user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    q: Dict[str, Any] = {"manufacturer_id": mfr}
    if category:
        q["category"] = category
    if severity:
        q["severity"] = severity
    if unacked:
        q["acknowledged"] = False
    events = await db.logistics_events.find(q, {"_id": 0}) \
        .sort("created_at", -1).to_list(min(limit, 200))
    counts: Dict[str, int] = {}
    async for row in db.logistics_events.aggregate([
        {"$match": {"manufacturer_id": mfr}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = int(row["n"])
    return {"events": events, "category_counts": counts}


@router.post("/logistics/events/{event_id}/ack")
async def ack_event(event_id: str,
                    user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, None) if user.get("role") != "super_admin" else None
    q: Dict[str, Any] = {"id": event_id}
    if mfr:
        q["manufacturer_id"] = mfr
    res = await db.logistics_events.update_one(
        q, {"$set": {"acknowledged": True, "acknowledged_at": now_iso()}})
    if not res.matched_count:
        raise HTTPException(404, "Event not found")
    return {"acknowledged": True}


# ===========================================================================
@router.get("/logistics/shipment-timeline/{shipment_id}")
async def shipment_timeline(shipment_id: str,
                            user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, None)
    s = await db.shipments.find_one(
        {"id": shipment_id, "manufacturer_id": mfr}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Shipment not found")
    events = await db.logistics_events.find(
        {"shipment_id": shipment_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(100)

    # Synthesize lifecycle milestones from the shipment record, then merge
    # the live event stream so the timeline is a complete audit trail.
    milestones = [{"event_type": "shipment_created", "title": "Shipment created",
                   "created_at": s.get("created_at"), "severity": "info",
                   "detail": f"Tracking {s.get('tracking_code') or shipment_id[:8]}"}]
    if s.get("dispatched_at"):
        milestones.append({"event_type": "vehicle_dispatched", "title": "Dispatched",
                           "created_at": s["dispatched_at"], "severity": "info",
                           "detail": "Left origin facility"})
    if s.get("received_at"):
        milestones.append({"event_type": "delivery_completed", "title": "Delivered & accepted",
                           "created_at": s["received_at"], "severity": "info",
                           "detail": "Received by destination"})
    seen_types = {e["event_type"] for e in events}
    merged = events + [m for m in milestones if m["event_type"] not in seen_types]
    merged.sort(key=lambda e: e.get("created_at") or "")
    return {"shipment": s, "timeline": merged}


@router.get("/logistics/geofences")
async def list_geofences(manufacturer_id: Optional[str] = None,
                         user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    fences = await db.geofences.find(
        {"manufacturer_id": mfr}, {"_id": 0}).to_list(100)
    return {"geofences": fences}
