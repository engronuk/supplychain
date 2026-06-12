"""Konekt Copilot — executable actions.

The copilot planner (routes/logistics_ai.py) lets Gemini attach an `action`
proposal to its reply. The dispatcher confirms it in the chat UI, then
`execute_action` runs the operation against live system state, emitting
control-tower events (which fan out to in-app notifications) and returning
a human-readable result message.
"""
from __future__ import annotations

import random
from typing import Any, Dict, List

from core import db, now_iso
from services.logistics_events import emit
from services.routing import get_multi_stop_route, get_route

ACTION_TYPES = {"reroute_vehicle", "resolve_exception",
                "dispatch_adhoc", "acknowledge_events"}


# ---------------------------------------------------------------------------
async def build_action_context(mfr: str) -> str:
    """Entity ids the planner needs to fill action params correctly."""
    parts: List[str] = ["ACTIONABLE ENTITIES (use these EXACT ids in action params):"]
    whs = await db.organizations.find(
        {"organization_type": "warehouse", "parent_organization_id": mfr},
        {"_id": 0, "id": 1, "organization_name": 1, "city": 1}).to_list(15)
    if whs:
        parts.append("WAREHOUSES:")
        parts += [f"- {w['id']} = {w.get('organization_name')} ({w.get('city')})"
                  for w in whs]
    dists = await db.distributors.find(
        {"manufacturer_id": mfr},
        {"_id": 0, "id": 1, "name": 1, "region": 1}).to_list(150)
    if dists:
        parts.append("DESTINATIONS (distributors):")
        parts += [f"- {d['id']} = {d.get('name')} ({d.get('region')})" for d in dists]
    whos = await db.organizations.find(
        {"organization_type": "wholesaler",
         "parent_organization_id": {"$in": [d["id"] for d in dists]}},
        {"_id": 0, "id": 1, "organization_name": 1, "region": 1}).to_list(30)
    if whos:
        parts.append("DESTINATIONS (wholesalers):")
        parts += [f"- {o['id']} = {o.get('organization_name')} ({o.get('region')})"
                  for o in whos]
    prods = await db.products.find(
        {"manufacturer_id": mfr},
        {"_id": 0, "id": 1, "name": 1, "sku": 1}).to_list(60)
    if prods:
        parts.append("PRODUCTS:")
        parts += [f"- {p['id']} = {p.get('name')} [{p.get('sku')}]" for p in prods]
    return "\n".join(parts)


# ---------------------------------------------------------------------------
async def execute_action(mfr: str, user: Dict[str, Any],
                          action: Dict[str, Any]) -> Dict[str, Any]:
    """Run a confirmed copilot action. Raises ValueError with a readable
    message when the action can no longer be applied."""
    atype = action.get("type")
    params = action.get("params") or {}
    if atype == "reroute_vehicle":
        return await _reroute_vehicle(mfr, params)
    if atype == "resolve_exception":
        return await _resolve_exception(mfr, params)
    if atype == "dispatch_adhoc":
        return await _dispatch_adhoc(mfr, user, params)
    if atype == "acknowledge_events":
        return await _acknowledge_events(mfr)
    raise ValueError(f"Unknown action type: {atype}")


async def _find_vehicle(mfr: str, code: str) -> Dict[str, Any]:
    v = await db.vehicles.find_one(
        {"manufacturer_id": mfr, "code": (code or "").strip().upper()}, {"_id": 0})
    if not v:
        raise ValueError(f"Truck {code} was not found in your fleet")
    return v


# ---------------------------------------------------------------------------
async def _reroute_vehicle(mfr: str, params: Dict[str, Any]) -> Dict[str, Any]:
    v = await _find_vehicle(mfr, params.get("vehicle_code"))
    if v.get("status") == "idle":
        raise ValueError(f"Truck {v['code']} is idle — there is no active trip to re-route")
    cur = (float(v.get("lat") or 0), float(v.get("lng") or 0))
    had_deviation = bool((v.get("deviation") or {}).get("active"))

    all_stops = v.get("stops") or []
    remaining = [st for st in all_stops if not st.get("delivered")]
    if remaining:
        route = await get_multi_stop_route(
            cur, [(st["lat"], st["lng"]) for st in remaining], optimize=False)
        total = route["total_km"] or 1.0
        cum = 0.0
        for pos, idx in enumerate(route["order"]):
            cum += route["legs"][pos]["distance_km"]
            remaining[idx]["threshold"] = min(1.0, round(cum / total, 4))
        remaining[-1]["threshold"] = 1.0
        polyline, total_km, total_min, source = (
            route["polyline"], route["total_km"], route["total_min"], route["source"])
    else:
        if v.get("dest_lat") is None:
            raise ValueError(f"Truck {v['code']} has no destination on record")
        r = await get_route(cur, (v["dest_lat"], v["dest_lng"]))
        polyline, total_km, total_min, source = (
            r["polyline"], r["distance_km"], r["duration_min"], r["source"])

    speed = int(v.get("speed_kmh") or 0)
    if speed < 40:
        speed = random.randint(48, 68)
    update = {
        "status": "in_transit",
        "origin_lat": cur[0], "origin_lng": cur[1],
        "route_polyline": polyline, "route_km": total_km,
        "route_source": source, "route_progress": 0.0, "progress": 0.0,
        "eta_minutes": total_min, "speed_kmh": speed,
        "deviation": None, "stopped_since": None, "breakdown_since": None,
        "exception_ticks": 0, "updated_at": now_iso(),
    }
    if all_stops:
        update["stops"] = all_stops
    await db.vehicles.update_one({"id": v["id"]}, {"$set": update})
    if v.get("ref_type") == "route" and v.get("ref_id"):
        await db.planned_routes.update_one(
            {"id": v["ref_id"]},
            {"$set": {"polyline": polyline, "updated_at": now_iso()}})

    if had_deviation:
        await emit(mfr, "deviation_resolved",
                   f"Truck {v['code']} back on approved route",
                   "Corrective route issued by Konekt Copilot",
                   vehicle_id=v["id"], vehicle_code=v["code"],
                   lat=cur[0], lng=cur[1])
    await emit(mfr, "route_replanned",
               f"Truck {v['code']} re-routed by Copilot",
               f"New corridor: {total_km} km · ETA {total_min} min · "
               f"{source} routing",
               vehicle_id=v["id"], vehicle_code=v["code"],
               shipment_id=v.get("ref_id") if v.get("ref_type") == "shipment" else None,
               ref_code=v.get("shipment_code"),
               lat=cur[0], lng=cur[1])
    return {"message": f"Truck {v['code']} re-routed from its current position — "
                       f"new ETA {total_min} min over {total_km} km "
                       f"({len(remaining)} stop(s) remaining)."
                       if remaining else
                       f"Truck {v['code']} re-routed — new ETA {total_min} min "
                       f"over {total_km} km to {v.get('dest_name') or 'destination'}."}


# ---------------------------------------------------------------------------
async def _resolve_exception(mfr: str, params: Dict[str, Any]) -> Dict[str, Any]:
    v = await _find_vehicle(mfr, params.get("vehicle_code"))
    status = v.get("status")
    had_dev = bool((v.get("deviation") or {}).get("active"))
    if status not in ("breakdown", "stopped") and not had_dev:
        raise ValueError(f"Truck {v['code']} has no active exception to resolve")
    await db.vehicles.update_one({"id": v["id"]}, {"$set": {
        "status": "in_transit", "breakdown_since": None, "stopped_since": None,
        "deviation": None, "exception_ticks": 0,
        "speed_kmh": random.randint(45, 65), "updated_at": now_iso()}})
    if status == "breakdown":
        await emit(mfr, "breakdown_resolved",
                   f"Truck {v['code']} back on the road",
                   "Recovery completed — cleared via Konekt Copilot",
                   vehicle_id=v["id"], vehicle_code=v["code"],
                   lat=v.get("lat"), lng=v.get("lng"))
        what = "breakdown cleared"
    elif status == "stopped":
        await emit(mfr, "stop_resolved",
                   f"Truck {v['code']} moving again",
                   "Unscheduled stop cleared via Konekt Copilot",
                   vehicle_id=v["id"], vehicle_code=v["code"],
                   lat=v.get("lat"), lng=v.get("lng"))
        what = "unscheduled stop cleared"
    else:
        what = "deviation cleared"
    if had_dev:
        await emit(mfr, "deviation_resolved",
                   f"Truck {v['code']} back on approved route",
                   "Deviation cleared via Konekt Copilot",
                   vehicle_id=v["id"], vehicle_code=v["code"],
                   lat=v.get("lat"), lng=v.get("lng"))
    return {"message": f"Truck {v['code']} — {what}; resuming route to "
                       f"{v.get('dest_name') or 'destination'}."}


# ---------------------------------------------------------------------------
async def _dispatch_adhoc(mfr: str, user: Dict[str, Any],
                          params: Dict[str, Any]) -> Dict[str, Any]:
    # Lazy import: routes layer depends on services, not the other way around.
    from routes.route_planning import RoutePlanIn, StopIn, dispatch_route
    items = [{"product_id": str(i.get("product_id")),
              "quantity": int(i.get("quantity") or 0)}
             for i in (params.get("items") or []) if i.get("product_id")]
    items = [i for i in items if i["quantity"] > 0]
    if not params.get("warehouse_id") or not params.get("dest_id") or not items:
        raise ValueError("Dispatch needs a warehouse, a destination and at "
                         "least one product with a quantity")
    payload = RoutePlanIn(
        origin_id=params["warehouse_id"],
        stops=[StopIn(dest_id=params["dest_id"], items=items)],
        optimize=True, manufacturer_id=mfr)
    res = await dispatch_route(payload, user)
    r = res["route"]
    stop = r["stops"][0]
    return {"message": f"Route {r['code']} dispatched — truck {res['vehicle_code']} "
                       f"(driver {r['driver_name']}) is en route to "
                       f"{stop['dest_name']} with {r['total_units']:,} units "
                       f"over {r['total_km']} km.",
            "meta": {"route_id": r["id"], "route_code": r["code"],
                     "vehicle_code": res["vehicle_code"]}}


# ---------------------------------------------------------------------------
async def _acknowledge_events(mfr: str) -> Dict[str, Any]:
    res = await db.logistics_events.update_many(
        {"manufacturer_id": mfr, "acknowledged": False},
        {"$set": {"acknowledged": True, "acknowledged_at": now_iso()}})
    return {"message": f"Acknowledged {res.modified_count} open event(s) "
                       "in the control tower."}
