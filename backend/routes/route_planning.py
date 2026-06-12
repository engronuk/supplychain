"""Phase 2 — Route Planning Center API.

  GET  /api/logistics/route-planning              — dispatch board payload
  POST /api/logistics/route-planning/preview      — optimized multi-stop preview
  POST /api/logistics/route-planning/dispatch     — create + dispatch a route
  GET  /api/logistics/route-planning/routes/{id}  — execution detail + audit trail

A planned route bundles 1-N delivery stops (existing pending shipments and/or
ad-hoc deliveries) onto one truck. Sequencing and road geometry come from the
Google Routes API (optimizeWaypointOrder); the control-tower simulation then
executes the route stop by stop, emitting events at every milestone.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, now_iso
from routes.allocation import _scope_manufacturer
from services.auth import get_current_user
from services.control_tower_sim import DRIVER_POOL, coords_for
from services.logistics_events import emit, notify
from services.routing import get_multi_stop_route

router = APIRouter()

PENDING_STATUSES = ["pending", "awaiting_dispatch", "picking", "queued"]
MAX_STOPS = 8


class StopIn(BaseModel):
    shipment_id: Optional[str] = None
    dest_id: Optional[str] = None
    dest_type: Optional[str] = None               # distributor | wholesaler
    items: Optional[List[Dict[str, Any]]] = None  # ad-hoc: [{product_id, quantity}]


class RoutePlanIn(BaseModel):
    origin_id: str
    stops: List[StopIn]
    optimize: bool = True
    vehicle_id: Optional[str] = None
    driver_name: Optional[str] = None
    manufacturer_id: Optional[str] = None


# ---------------------------------------------------------------------------
async def _dest_map(ids: List[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    if not ids:
        return out
    async for d in db.distributors.find(
            {"id": {"$in": ids}},
            {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1}):
        out[d["id"]] = {"dest_type": "distributor", "name": d.get("name"),
                        "city": d.get("city"), "region": d.get("region")}
    missing = [i for i in ids if i not in out]
    if missing:
        async for o in db.organizations.find(
                {"id": {"$in": missing}},
                {"_id": 0, "id": 1, "organization_name": 1, "organization_type": 1,
                 "city": 1, "region": 1}):
            out[o["id"]] = {"dest_type": o.get("organization_type") or "organization",
                            "name": o.get("organization_name"),
                            "city": o.get("city"), "region": o.get("region")}
    return out


async def _resolve_plan(mfr: str, payload: RoutePlanIn) -> Dict[str, Any]:
    """Validate the payload, geocode stops and compute the road route."""
    origin = await db.organizations.find_one(
        {"id": payload.origin_id, "parent_organization_id": mfr},
        {"_id": 0, "organization_name": 1, "city": 1, "region": 1})
    if not origin:
        raise HTTPException(404, "Origin warehouse not found")
    o_lat, o_lng = coords_for(origin.get("city"), origin.get("region"))

    if not payload.stops:
        raise HTTPException(400, "At least one stop is required")
    if len(payload.stops) > MAX_STOPS:
        raise HTTPException(400, f"A route supports at most {MAX_STOPS} stops")

    resolved: List[Dict[str, Any]] = []
    for s in payload.stops:
        if s.shipment_id:
            sh = await db.shipments.find_one(
                {"id": s.shipment_id, "manufacturer_id": mfr}, {"_id": 0})
            if not sh:
                raise HTTPException(404, f"Shipment {s.shipment_id} not found")
            if sh.get("status") not in PENDING_STATUSES:
                raise HTTPException(
                    400, f"Shipment {sh.get('tracking_code') or s.shipment_id[:8]} "
                         "is not pending dispatch")
            if sh.get("from_id") != payload.origin_id:
                raise HTTPException(
                    400, "All shipments on a route must share the origin warehouse")
            d = (await _dest_map([sh.get("to_id")])).get(sh.get("to_id")) or {}
            lat, lng = coords_for(d.get("city"), d.get("region"))
            resolved.append({
                "shipment_id": sh["id"],
                "tracking_code": sh.get("tracking_code") or sh["id"][:8].upper(),
                "dest_id": sh.get("to_id"),
                "dest_type": d.get("dest_type") or sh.get("to_role"),
                "dest_name": d.get("name") or "—",
                "city": d.get("city"), "region": d.get("region"),
                "lat": lat, "lng": lng,
                "units": sum(int(i.get("quantity") or 0) for i in (sh.get("items") or [])),
                "items": sh.get("items") or [],
                "ad_hoc": False,
            })
        else:
            if not s.dest_id:
                raise HTTPException(400, "Each stop needs a shipment_id or a dest_id")
            d = (await _dest_map([s.dest_id])).get(s.dest_id)
            if not d:
                raise HTTPException(404, "Destination not found")
            items = [i for i in (s.items or []) if int(i.get("quantity") or 0) > 0]
            if not items:
                raise HTTPException(
                    400, f"Ad-hoc stop to {d.get('name')} needs at least one item")
            lat, lng = coords_for(d.get("city"), d.get("region"))
            resolved.append({
                "shipment_id": None, "tracking_code": None,
                "dest_id": s.dest_id, "dest_type": s.dest_type or d.get("dest_type"),
                "dest_name": d.get("name"),
                "city": d.get("city"), "region": d.get("region"),
                "lat": lat, "lng": lng,
                "units": sum(int(i.get("quantity") or 0) for i in items),
                "items": items,
                "ad_hoc": True,
            })

    # Jitter stops that share a city centroid so legs never collapse to zero.
    seen: Dict[tuple, int] = {}
    for r in resolved:
        key = (round(r["lat"], 3), round(r["lng"], 3))
        n = seen.get(key, 0)
        if n:
            r["lat"] += 0.004 * n
            r["lng"] += 0.004 * n
        seen[key] = n + 1

    route = await get_multi_stop_route(
        (o_lat, o_lng), [(r["lat"], r["lng"]) for r in resolved],
        optimize=payload.optimize)

    ordered: List[Dict[str, Any]] = []
    cum_km = cum_min = 0.0
    total_km = route["total_km"] or 1.0
    for pos, idx in enumerate(route["order"]):
        leg = route["legs"][pos]
        cum_km += leg["distance_km"]
        cum_min += leg["duration_min"]
        ordered.append({
            **resolved[idx],
            "seq": pos + 1,
            "leg_km": leg["distance_km"], "leg_min": leg["duration_min"],
            "cum_km": round(cum_km, 1), "cum_min": round(cum_min),
            "threshold": min(1.0, round(cum_km / total_km, 4)),
        })
    if ordered:
        ordered[-1]["threshold"] = 1.0

    return {
        "origin": {"id": payload.origin_id, "name": origin.get("organization_name"),
                   "city": origin.get("city"), "lat": o_lat, "lng": o_lng},
        "stops": ordered,
        "total_km": route["total_km"], "total_min": route["total_min"],
        "total_units": sum(s["units"] for s in ordered),
        "polyline": route["polyline"], "source": route["source"],
        "optimized": payload.optimize and len(resolved) > 1,
    }


async def _enrich_items(mfr: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ids = [i.get("product_id") for i in items]
    prods = {p["id"]: p async for p in db.products.find(
        {"id": {"$in": ids}, "manufacturer_id": mfr},
        {"_id": 0, "id": 1, "name": 1, "sku": 1})}
    out = []
    for i in items:
        p = prods.get(i.get("product_id"))
        if not p:
            raise HTTPException(404, "Product not found in your catalog")
        out.append({"product_id": p["id"], "product_name": p.get("name"),
                    "sku": p.get("sku"), "quantity": int(i.get("quantity") or 0)})
    return out


async def _move_stock_out(mfr: str, warehouse_id: str,
                          items: List[Dict[str, Any]], shipment_id: str) -> None:
    """Warehouse stock movement for ad-hoc route shipments (best effort)."""
    for it in items:
        row = await db.inventory.find_one(
            {"owner_type": "warehouse", "owner_id": warehouse_id,
             "product_id": it["product_id"]},
            {"_id": 0, "id": 1, "quantity": 1, "in_transit": 1})
        if not row:
            continue
        qty = int(it["quantity"])
        await db.inventory.update_one({"id": row["id"]}, {"$set": {
            "quantity": max(0, int(row.get("quantity") or 0) - qty),
            "in_transit": int(row.get("in_transit") or 0) + qty,
            "updated_at": now_iso(), "last_movement_at": now_iso(),
        }})
        await db.inventory_movements.insert_one({
            "id": str(uuid.uuid4()),
            "owner_type": "warehouse", "owner_id": warehouse_id,
            "product_id": it["product_id"], "delta": -qty,
            "kind": "route_dispatch", "ref_id": shipment_id,
            "manufacturer_id": mfr, "created_at": now_iso(),
        })


# ===========================================================================
@router.get("/logistics/route-planning")
async def route_planning_board(manufacturer_id: Optional[str] = None,
                               user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    now = datetime.now(timezone.utc)

    wh_orgs = await db.organizations.find(
        {"organization_type": "warehouse", "parent_organization_id": mfr},
        {"_id": 0, "id": 1, "organization_name": 1, "city": 1, "region": 1},
    ).to_list(50)
    warehouses = []
    for w in wh_orgs:
        lat, lng = coords_for(w.get("city"), w.get("region"))
        warehouses.append({"id": w["id"], "name": w["organization_name"],
                           "city": w.get("city"), "region": w.get("region"),
                           "lat": lat, "lng": lng})

    # Shipments already riding a truck or an active route are not plannable.
    assigned = set(await db.vehicles.distinct(
        "ref_id", {"ref_type": "shipment", "status": {"$ne": "idle"}}))
    async for rv in db.vehicles.find(
            {"ref_type": "route",
             "status": {"$in": ["in_transit", "stopped", "breakdown"]}},
            {"_id": 0, "stops.shipment_id": 1}):
        assigned.update(st.get("shipment_id") for st in (rv.get("stops") or []))

    raw = await db.shipments.find(
        {"manufacturer_id": mfr, "status": {"$in": PENDING_STATUSES},
         "id": {"$nin": list(assigned)}},
        {"_id": 0}).sort("created_at", 1).to_list(80)
    dest_lookup = await _dest_map(list({s.get("to_id") for s in raw if s.get("to_id")}))

    pending = []
    for s in raw:
        d = dest_lookup.get(s.get("to_id")) or {}
        first = (s.get("items") or [{}])[0]
        lat, lng = coords_for(d.get("city"), d.get("region"))
        age_h = None
        try:
            age_h = round((now - datetime.fromisoformat(
                (s.get("created_at") or "").replace("Z", "+00:00"))
            ).total_seconds() / 3600)
        except (ValueError, TypeError):
            pass
        pending.append({
            "id": s["id"],
            "tracking_code": s.get("tracking_code") or s["id"][:8].upper(),
            "status": s.get("status"),
            "from_id": s.get("from_id"),
            "to_id": s.get("to_id"),
            "to_role": d.get("dest_type") or s.get("to_role"),
            "to_name": d.get("name") or "—",
            "to_city": d.get("city"), "to_region": d.get("region"),
            "lat": lat, "lng": lng,
            "units": sum(int(i.get("quantity") or 0) for i in (s.get("items") or [])),
            "skus": len(s.get("items") or []),
            "product": first.get("product_name") or "Mixed SKUs",
            "age_hours": age_h,
        })

    idle = await db.vehicles.find(
        {"manufacturer_id": mfr, "status": "idle"},
        {"_id": 0, "id": 1, "code": 1, "plate": 1, "driver_name": 1}).to_list(40)

    dists = []
    async for d in db.distributors.find(
            {"manufacturer_id": mfr},
            {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1}):
        lat, lng = coords_for(d.get("city"), d.get("region"))
        dists.append({"id": d["id"], "name": d.get("name"), "type": "distributor",
                      "city": d.get("city"), "region": d.get("region"),
                      "lat": lat, "lng": lng})
    whos = []
    async for o in db.organizations.find(
            {"organization_type": "wholesaler",
             "parent_organization_id": {"$in": [d["id"] for d in dists]}},
            {"_id": 0, "id": 1, "organization_name": 1, "city": 1, "region": 1}):
        lat, lng = coords_for(o.get("city"), o.get("region"))
        whos.append({"id": o["id"], "name": o.get("organization_name"),
                     "type": "wholesaler", "city": o.get("city"),
                     "region": o.get("region"), "lat": lat, "lng": lng})

    products = await db.products.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1, "name": 1, "sku": 1}).to_list(60)

    routes = await db.planned_routes.find(
        {"manufacturer_id": mfr}, {"_id": 0, "polyline": 0},
    ).sort("created_at", -1).to_list(30)
    rv_by_route = {v["ref_id"]: v async for v in db.vehicles.find(
        {"ref_type": "route", "ref_id": {"$in": [r["id"] for r in routes]}},
        {"_id": 0, "ref_id": 1, "route_progress": 1, "status": 1, "eta_minutes": 1})}
    for r in routes:
        v = rv_by_route.get(r["id"])
        r["progress_pct"] = (100 if r.get("status") == "completed"
                             else round(float((v or {}).get("route_progress") or 0) * 100))
        r["vehicle_status"] = (v or {}).get("status")
        r["eta_minutes"] = (v or {}).get("eta_minutes")
        r["stops_delivered"] = sum(1 for st in (r.get("stops") or [])
                                   if st.get("status") == "delivered")

    return {"pending_shipments": pending, "warehouses": warehouses,
            "idle_vehicles": idle, "destinations": dists + whos,
            "products": products, "routes": routes, "generated_at": now_iso()}


# ===========================================================================
@router.post("/logistics/route-planning/preview")
async def preview_route(payload: RoutePlanIn,
                        user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, payload.manufacturer_id)
    return await _resolve_plan(mfr, payload)


# ===========================================================================
@router.post("/logistics/route-planning/dispatch")
async def dispatch_route(payload: RoutePlanIn,
                         user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, payload.manufacturer_id)
    rng = random.Random()
    plan = await _resolve_plan(mfr, payload)
    now = now_iso()
    origin = plan["origin"]
    route_id = str(uuid.uuid4())

    # Materialize ad-hoc stops as real shipments; flip existing ones to transit.
    for st in plan["stops"]:
        if st["ad_hoc"]:
            items = await _enrich_items(mfr, st["items"])
            sid = str(uuid.uuid4())
            tracking = uuid.uuid4().hex[:8].upper()
            await db.shipments.insert_one({
                "id": sid, "manufacturer_id": mfr,
                "from_role": "warehouse", "from_id": origin["id"],
                "to_role": st["dest_type"], "to_id": st["dest_id"],
                "items": items, "tracking_code": tracking,
                "status": "in_transit", "source": "route_planner",
                "created_at": now, "dispatched_at": now,
            })
            await _move_stock_out(mfr, origin["id"], items, sid)
            st["shipment_id"] = sid
            st["tracking_code"] = tracking
            await emit(mfr, "shipment_created",
                       f"Shipment {tracking} created via route planner",
                       f"{st['units']:,} units → {st['dest_name']}",
                       shipment_id=sid, ref_code=tracking,
                       lat=origin["lat"], lng=origin["lng"],
                       location_name=origin["name"],
                       meta={"route_id": route_id})
        else:
            await db.shipments.update_one(
                {"id": st["shipment_id"], "manufacturer_id": mfr,
                 "status": {"$in": PENDING_STATUSES}},
                {"$set": {"status": "in_transit", "dispatched_at": now}})

    # Vehicle: reuse a chosen idle truck or commission a new one.
    driver = (payload.driver_name or "").strip()
    reuse = None
    if payload.vehicle_id:
        reuse = await db.vehicles.find_one(
            {"id": payload.vehicle_id, "manufacturer_id": mfr, "status": "idle"},
            {"_id": 0})
        if not reuse:
            raise HTTPException(400, "Selected vehicle is no longer idle")

    seq = await db.counters.find_one_and_update(
        {"_id": "route_seq"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    code = f"RT-{int(seq['seq']):03d}"
    total_units = plan["total_units"]
    last = plan["stops"][-1]
    vstops = [{"seq": s["seq"], "shipment_id": s["shipment_id"],
               "tracking_code": s["tracking_code"], "dest_id": s["dest_id"],
               "dest_name": s["dest_name"], "lat": s["lat"], "lng": s["lng"],
               "units": s["units"], "threshold": s["threshold"],
               "delivered": False}
              for s in plan["stops"]]
    vehicle_fields = {
        "manufacturer_id": mfr, "status": "in_transit",
        "lat": origin["lat"], "lng": origin["lng"],
        "origin_name": origin["name"],
        "origin_lat": origin["lat"], "origin_lng": origin["lng"],
        "dest_name": last["dest_name"], "dest_lat": last["lat"], "dest_lng": last["lng"],
        "route_polyline": plan["polyline"], "route_km": plan["total_km"],
        "route_source": plan["source"], "route_progress": 0.0, "progress": 0.0,
        "speed_kmh": rng.randint(48, 70), "eta_minutes": plan["total_min"],
        "ref_type": "route", "ref_id": route_id, "shipment_code": code,
        "units": total_units, "stops": vstops,
        "deviation": None, "stopped_since": None, "breakdown_since": None,
        "exception_ticks": 0, "fences_inside": [], "updated_at": now,
    }
    if reuse:
        vehicle_id, vcode = reuse["id"], reuse["code"]
        driver = driver or reuse.get("driver_name") or rng.choice(DRIVER_POOL)
        await db.vehicles.update_one(
            {"id": vehicle_id}, {"$set": {**vehicle_fields, "driver_name": driver}})
    else:
        vseq = await db.counters.find_one_and_update(
            {"_id": "vehicle_seq"}, {"$inc": {"seq": 1}},
            upsert=True, return_document=True)
        vehicle_id, vcode = str(uuid.uuid4()), f"TK-{int(vseq['seq']):03d}"
        driver = driver or rng.choice(DRIVER_POOL)
        await db.vehicles.insert_one({
            **vehicle_fields,
            "id": vehicle_id, "code": vcode,
            "plate": f"{rng.choice(['LAG', 'KJA', 'ABJ', 'KAN', 'PHC', 'ENU'])}-"
                     f"{rng.randint(100, 999)}-{rng.choice(['XA', 'KR', 'BD', 'EP'])}",
            "driver_name": driver,
            "driver_phone": f"+234 80{rng.randint(2, 9)} {rng.randint(100, 999)} "
                            f"{rng.randint(1000, 9999)}",
            "fuel_pct": rng.randint(60, 96),
            "created_at": now,
        })

    route_doc = {
        "id": route_id, "code": code, "manufacturer_id": mfr,
        "origin_id": origin["id"], "origin_name": origin["name"],
        "origin_lat": origin["lat"], "origin_lng": origin["lng"],
        "stops": [{**{k: s.get(k) for k in (
            "seq", "shipment_id", "tracking_code", "dest_id", "dest_type",
            "dest_name", "city", "region", "lat", "lng", "units",
            "leg_km", "leg_min", "cum_km", "cum_min", "threshold", "ad_hoc")},
            "status": "pending", "delivered_at": None} for s in plan["stops"]],
        "vehicle_id": vehicle_id, "vehicle_code": vcode, "driver_name": driver,
        "status": "dispatched", "optimized": plan["optimized"],
        "total_km": plan["total_km"], "total_min": plan["total_min"],
        "total_units": total_units, "route_source": plan["source"],
        "polyline": plan["polyline"],
        "created_at": now, "dispatched_at": now, "updated_at": now,
    }
    await db.planned_routes.insert_one(dict(route_doc))

    n = len(vstops)
    await emit(mfr, "route_planned",
               f"Route {code} planned — {n} stop{'s' if n != 1 else ''}",
               f"{origin['name']} → {' → '.join(s['dest_name'] for s in plan['stops'])} · "
               f"{plan['total_km']} km · "
               f"{'optimized' if plan['optimized'] else 'manual'} sequence",
               vehicle_id=vehicle_id, vehicle_code=vcode,
               lat=origin["lat"], lng=origin["lng"], location_name=origin["name"],
               meta={"route_id": route_id})
    await emit(mfr, "vehicle_dispatched",
               f"Truck {vcode} dispatched on route {code}",
               f"Driver {driver} · {total_units:,} units · {plan['total_km']} km",
               vehicle_id=vehicle_id, vehicle_code=vcode,
               lat=origin["lat"], lng=origin["lng"], location_name=origin["name"],
               meta={"route_id": route_id})
    for s in plan["stops"]:
        await emit(mfr, "shipment_loaded",
                   f"Shipment {s['tracking_code']} loaded — stop {s['seq']} of {n}",
                   f"{vcode} → {s['dest_name']} · {s['units']:,} units",
                   vehicle_id=vehicle_id, vehicle_code=vcode,
                   shipment_id=s["shipment_id"], ref_code=s["tracking_code"],
                   meta={"route_id": route_id, "seq": s["seq"]})
    await notify("warehouse", origin["id"],
                 f"Route {code} dispatched from your warehouse",
                 f"{vcode} · driver {driver} · {n} stop{'s' if n != 1 else ''} · "
                 f"{total_units:,} units · {plan['total_km']} km",
                 ntype="route")

    route_doc.pop("polyline", None)
    return {"route": route_doc, "vehicle_code": vcode}


# ===========================================================================
@router.get("/logistics/route-planning/routes/{route_id}")
async def route_detail(route_id: str,
                       user: Dict[str, Any] = Depends(get_current_user)):
    mfr = await _scope_manufacturer(user, None)
    r = await db.planned_routes.find_one(
        {"id": route_id, "manufacturer_id": mfr}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Route not found")
    v = await db.vehicles.find_one(
        {"id": r.get("vehicle_id")},
        {"_id": 0, "code": 1, "status": 1, "lat": 1, "lng": 1, "route_progress": 1,
         "eta_minutes": 1, "speed_kmh": 1, "fuel_pct": 1,
         "driver_name": 1, "driver_phone": 1, "ref_id": 1})
    if v and v.get("ref_id") != route_id:
        # Truck has been re-assigned to a newer route since completion.
        v = {k: v[k] for k in ("code", "driver_name", "driver_phone") if k in v}
    ship_ids = [st.get("shipment_id") for st in (r.get("stops") or [])
                if st.get("shipment_id")]
    events = await db.logistics_events.find(
        {"$or": [{"meta.route_id": route_id},
                 {"shipment_id": {"$in": ship_ids}}]},
        {"_id": 0}).sort("created_at", 1).to_list(200)
    r["progress_pct"] = (100 if r.get("status") == "completed"
                         else round(float((v or {}).get("route_progress") or 0) * 100))
    return {"route": r, "vehicle": v, "events": events}
