"""Manufacturer Logistics Command Center.

Mission-control aggregator + CRUD for the /manufacturer/logistics-center page:

  GET   /api/logistics/overview                     — full page payload
  GET   /api/logistics/transfers                    — transfer orders list
  POST  /api/logistics/transfers                    — create inter-warehouse transfer
  PATCH /api/logistics/transfers/{id}/advance       — deliver / cancel a transfer
  POST  /api/logistics/requests/{id}/decide         — approve / reject / modify replenishment
  POST  /api/logistics/ai-recommendation/recompute  — Vertex AI smart allocation
  POST  /api/logistics/ai-recommendation/execute    — execute the AI transfer

Collections:
  vehicles                     — truck fleet w/ GPS positions
  transfer_orders              — inter-warehouse stock movements
  replenishment_requests       — warehouse / wholesaler replenishment queue
  logistics_ai_recommendations — cached Vertex AI allocation advice (per tenant)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, new_id, now_iso
from routes.allocation import _scope_manufacturer
from services.auth import get_current_user

router = APIRouter()

# ---------------------------------------------------------------------------
# Nigeria geo lookup (warehouse cities + regional centroids)
# ---------------------------------------------------------------------------
CITY_COORDS: Dict[str, Tuple[float, float]] = {
    "lagos": (6.5244, 3.3792), "ikeja": (6.6018, 3.3515), "apapa": (6.4500, 3.3590),
    "ajah": (6.4698, 3.5852), "ibadan": (7.3775, 3.9470), "onitsha": (6.1450, 6.7850),
    "port harcourt": (4.8156, 7.0498), "abuja": (9.0765, 7.3986),
    "bauchi": (10.3158, 9.8442), "kano": (12.0022, 8.5920), "enugu": (6.4584, 7.5464),
    "kaduna": (10.5105, 7.4165), "jos": (9.8965, 8.8583), "benin city": (6.3350, 5.6037),
    "calabar": (4.9757, 8.3417), "maiduguri": (11.8311, 13.1510), "aba": (5.1216, 7.3733),
}
REGION_COORDS: Dict[str, Tuple[float, float]] = {
    "lagos": (6.5244, 3.3792), "south west": (7.3775, 3.9470),
    "south east": (6.1450, 6.7850), "south south": (4.8156, 7.0498),
    "north central": (9.0765, 7.3986), "north east": (10.3158, 9.8442),
    "north west": (12.0022, 8.5920),
}


def coords_for(city: Optional[str], region: Optional[str]) -> Tuple[float, float]:
    c = (city or "").strip().lower()
    if c in CITY_COORDS:
        return CITY_COORDS[c]
    r = (region or "").strip().lower()
    if r in REGION_COORDS:
        return REGION_COORDS[r]
    return (6.5244, 3.3792)  # Lagos fallback


def _days_since(iso: Optional[str], now: datetime) -> Optional[float]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return round((now - dt).total_seconds() / 86400.0, 1)
    except (ValueError, TypeError):
        return None


async def _next_seq(name: str) -> int:
    doc = await db.counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    return int((doc or {}).get("seq", 1))


async def _tenant_warehouses(mfr: str) -> List[Dict[str, Any]]:
    return await db.organizations.find(
        {"organization_type": "warehouse", "parent_organization_id": mfr},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "region": 1, "city": 1, "state": 1},
    ).to_list(50)


async def _warehouse_stock_rollup(wh_ids: List[str], price_by_pid: Dict[str, float]):
    """Per-warehouse units / value / low-stock SKU counts in one pass."""
    agg: Dict[str, Dict[str, Any]] = {
        w: {"units": 0, "value": 0.0, "low": 0, "skus": 0} for w in wh_ids
    }
    async for r in db.inventory.find(
        {"owner_type": "warehouse", "owner_id": {"$in": wh_ids}},
        {"_id": 0, "owner_id": 1, "product_id": 1, "quantity": 1,
         "reserved": 1, "reorder_level": 1},
    ):
        a = agg.get(r["owner_id"])
        if a is None:
            continue
        q = int(r.get("quantity") or 0)
        a["units"] += q
        a["value"] += q * price_by_pid.get(r.get("product_id"), 0.0)
        a["skus"] += 1
        if q <= int(r.get("reorder_level") or 0):
            a["low"] += 1
    return agg


def _wh_health(units: int, low: int, skus: int) -> str:
    if units <= 0 or (skus and low / skus > 0.5):
        return "critical"
    if skus and low / skus > 0.2:
        return "low"
    return "healthy"


# ===========================================================================
# OVERVIEW — single round-trip page payload
# ===========================================================================
@router.get("/logistics/overview")
async def logistics_overview(
    manufacturer_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    now = datetime.now(timezone.utc)

    warehouses = await _tenant_warehouses(mfr)
    wh_ids = [w["id"] for w in warehouses]
    wh_by_id = {w["id"]: w for w in warehouses}

    products = await db.products.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1, "name": 1, "unit_price": 1},
    ).to_list(None)
    price_by_pid = {p["id"]: float(p.get("unit_price") or 0) for p in products}
    name_by_pid = {p["id"]: p.get("name", "Unknown") for p in products}

    stock = await _warehouse_stock_rollup(wh_ids, price_by_pid)

    # ---- map: warehouses ---------------------------------------------------
    map_warehouses = []
    for w in warehouses:
        lat, lng = coords_for(w.get("city"), w.get("region"))
        s = stock.get(w["id"], {"units": 0, "value": 0.0, "low": 0, "skus": 0})
        map_warehouses.append({
            "id": w["id"], "name": w["organization_name"],
            "city": w.get("city") or "", "region": w.get("region") or "",
            "lat": lat, "lng": lng,
            "units": s["units"], "value": round(s["value"], 2),
            "low_stock_skus": s["low"], "total_skus": s["skus"],
            "health": _wh_health(s["units"], s["low"], s["skus"]),
        })

    # ---- orders ------------------------------------------------------------
    orders = await db.distributor_orders.find(
        {"manufacturer_id": mfr},
        {"_id": 0, "id": 1, "status": 1, "created_at": 1, "items": 1,
         "distributor_id": 1, "priority": 1},
    ).to_list(None)
    open_orders = [o for o in orders if o.get("status") not in ("rejected",)]
    open_count = len(open_orders)

    # ---- shipments (active + delayed) ---------------------------------------
    distributors = {d["id"]: d for d in await db.distributors.find(
        {"manufacturer_id": mfr},
        {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1, "state": 1},
    ).to_list(None)}
    active_ship = await db.shipments.find(
        {"manufacturer_id": mfr, "status": {"$in": ["pending", "in_transit"]}},
        {"_id": 0, "id": 1, "tracking_code": 1, "status": 1, "to_id": 1, "to_role": 1,
         "from_id": 1, "items": 1, "created_at": 1, "dispatched_at": 1, "is_transfer": 1},
    ).to_list(2000)

    pending_shipments = 0
    delayed = []
    routes = []
    for s in active_ship:
        pending_shipments += 1
        dit = _days_since(s.get("dispatched_at"), now)
        age = _days_since(s.get("created_at"), now)
        is_delayed = (
            (s["status"] == "in_transit" and dit is not None and dit > 4)
            or (s["status"] == "pending" and age is not None and age > 3)
        )
        if is_delayed:
            delayed.append(s)
        # Route lines: only in-transit shipments make a moving lane on the map.
        if s["status"] == "in_transit" and len(routes) < 12:
            if s.get("is_transfer") or s.get("to_role") == "warehouse":
                dest = wh_by_id.get(s.get("to_id"))
                to_name = dest["organization_name"] if dest else "Warehouse"
                to_lat, to_lng = coords_for((dest or {}).get("city"), (dest or {}).get("region"))
            else:
                dest = distributors.get(s.get("to_id"))
                to_name = (dest or {}).get("name") or "Distributor"
                to_lat, to_lng = coords_for((dest or {}).get("city"), (dest or {}).get("region"))
            origin = wh_by_id.get(s.get("from_id"))
            if origin:
                from_name = origin["organization_name"]
                from_lat, from_lng = coords_for(origin.get("city"), origin.get("region"))
            else:
                from_name = "HQ · Lagos"
                from_lat, from_lng = CITY_COORDS["lagos"]
            routes.append({
                "id": s["id"],
                "tracking_code": s.get("tracking_code") or s["id"][:8].upper(),
                "status": "delayed" if is_delayed else "in_transit",
                "units": sum(int(i.get("quantity") or 0) for i in (s.get("items") or [])),
                "from": {"name": from_name, "lat": from_lat, "lng": from_lng},
                "to": {"name": to_name, "lat": to_lat, "lng": to_lng},
            })

    # ---- trucks --------------------------------------------------------------
    trucks = await db.vehicles.find(
        {"manufacturer_id": mfr}, {"_id": 0},
    ).to_list(100)

    # ---- KPIs ----------------------------------------------------------------
    total_units = sum(s["units"] for s in stock.values())
    total_value = sum(s["value"] for s in stock.values())
    regions = len({w.get("region") for w in warehouses if w.get("region")})

    cutoff_7 = (now - timedelta(days=7)).isoformat()
    cutoff_14 = (now - timedelta(days=14)).isoformat()
    cur_o = sum(1 for o in orders if (o.get("created_at") or "") >= cutoff_7)
    prev_o = sum(1 for o in orders if cutoff_14 <= (o.get("created_at") or "") < cutoff_7)
    open_growth = round((cur_o - prev_o) / prev_o * 100, 1) if prev_o else 0.0

    # Forecast accuracy: mean confidence across the tenant's live forecasts.
    acc_rows = await db.intel_forecasts.aggregate([
        {"$match": {"tenant_id": mfr}},
        {"$group": {"_id": None, "c": {"$avg": "$confidence"}}},
    ]).to_list(1)
    forecast_accuracy = round(float((acc_rows[0]["c"] if acc_rows else 0.92)) * 100, 1)

    kpis = {
        "total_inventory_units": total_units,
        "warehouses": len(warehouses),
        "regions": regions,
        "open_orders": open_count,
        "open_orders_growth_pct": open_growth,
        "pending_shipments": pending_shipments,
        "delayed_shipments": len(delayed),
        "inventory_value": round(total_value, 2),
        "forecast_accuracy": forecast_accuracy,
    }

    # ---- alerts ---------------------------------------------------------------
    alerts: List[Dict[str, Any]] = []
    for w in map_warehouses:
        if w["health"] == "critical":
            detail = (
                f"{w['low_stock_skus']} of {w['total_skus']} SKUs at/below reorder level · {w['units']:,} units on hand"
                if w["total_skus"]
                else "No stock on hand — replenishment required"
            )
            alerts.append({
                "id": f"wh-{w['id']}", "severity": "critical", "kind": "safety_stock",
                "title": f"{w['name']} below safety stock",
                "detail": detail,
                "at": now.isoformat(),
            })
    for s in delayed[:3]:
        if s.get("is_transfer") or s.get("to_role") == "warehouse":
            dest_name = (wh_by_id.get(s.get("to_id")) or {}).get("organization_name")
        else:
            dest_name = (distributors.get(s.get("to_id")) or {}).get("name")
        dit = _days_since(s.get("dispatched_at"), now) or _days_since(s.get("created_at"), now) or 0
        alerts.append({
            "id": f"ship-{s['id']}", "severity": "critical", "kind": "shipment_delayed",
            "title": f"Shipment {s.get('tracking_code') or s['id'][:8].upper()} delayed",
            "detail": f"{dit:.1f} days in transit to {dest_name or 'destination'}",
            "at": s.get("dispatched_at") or s.get("created_at"),
        })
    for t in trucks:
        if t.get("status") == "stopped":
            alerts.append({
                "id": f"trk-{t['id']}", "severity": "warning", "kind": "truck_stopped",
                "title": f"Truck {t.get('code')} stopped unexpectedly",
                "detail": f"En route {t.get('origin_name')} → {t.get('dest_name')} · driver {t.get('driver_name')}",
                "at": t.get("updated_at") or now.isoformat(),
            })
    # Regional demand surges from the forecast engine.
    reg_rows = await db.intel_forecasts.aggregate([
        {"$match": {"tenant_id": mfr}},
        {"$group": {"_id": "$region", "mult": {"$avg": "$external_multiplier"},
                    "velocity": {"$sum": "$adjusted_velocity"}}},
        {"$sort": {"mult": -1}},
    ]).to_list(10)
    if reg_rows:
        top = reg_rows[0]
        surge = round((float(top.get("mult") or 1) - 1) * 100)
        if surge >= 10:
            alerts.append({
                "id": f"demand-{top['_id']}", "severity": "warning", "kind": "demand_surge",
                "title": f"{top['_id']} demand increased {surge}%",
                "detail": "External-signal adjusted demand is trending above baseline",
                "at": now.isoformat(),
            })
    open_bo = await db.back_orders.count_documents({"manufacturer_id": mfr, "status": {"$in": ["open", "partial"]}})
    if open_bo:
        alerts.append({
            "id": "backorders", "severity": "warning", "kind": "back_orders",
            "title": f"{open_bo} open back-order{'s' if open_bo != 1 else ''} awaiting stock",
            "detail": "Demand could not be fully allocated from current warehouse inventory",
            "at": now.isoformat(),
        })
    async for a in db.intel_alerts.find(
        {"tenant_id": mfr}, {"_id": 0, "id": 1, "severity": 1, "title": 1, "detail": 1, "created_at": 1},
    ).sort("created_at", -1).limit(4):
        sev = a.get("severity") or "info"
        alerts.append({
            "id": a.get("id"), "severity": "warning" if sev == "warning" else ("critical" if sev == "critical" else "info"),
            "kind": "intel", "title": a.get("title") or "Network signal",
            "detail": a.get("detail") or "", "at": a.get("created_at"),
        })
    sev_rank = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda x: (sev_rank.get(x["severity"], 3), x.get("at") or ""), )
    alerts = alerts[:12]

    # ---- allocation queue ------------------------------------------------------
    queue_orders = sorted(
        [o for o in orders if o.get("status") in ("pending", "awaiting_allocation")],
        key=lambda o: o.get("created_at") or "", reverse=True,
    )[:6]
    # Availability across all tenant warehouses per product (one aggregation).
    avail_by_pid: Dict[str, int] = {}
    async for r in db.inventory.aggregate([
        {"$match": {"owner_type": "warehouse", "owner_id": {"$in": wh_ids}}},
        {"$group": {"_id": "$product_id",
                    "avail": {"$sum": {"$subtract": [
                        {"$ifNull": ["$quantity", 0]}, {"$ifNull": ["$reserved", 0]}]}}}},
    ]):
        avail_by_pid[r["_id"]] = max(0, int(r.get("avail") or 0))
    allocation_queue = []
    for o in queue_orders:
        d = distributors.get(o.get("distributor_id")) or {}
        units = sum(int(i.get("quantity") or 0) for i in (o.get("items") or []))
        value = sum(price_by_pid.get(i.get("product_id"), 0) * int(i.get("quantity") or 0)
                    for i in (o.get("items") or []))
        available = sum(min(int(i.get("quantity") or 0), avail_by_pid.get(i.get("product_id"), 0))
                        for i in (o.get("items") or []))
        allocation_queue.append({
            "order_id": o["id"],
            "number": f"REQ-{o['id'][:4].upper()}",
            "distributor_name": d.get("name") or "Unknown",
            "region": d.get("region") or d.get("state") or "",
            "requested_units": units,
            "available_units": available,
            "total_value": round(value, 2),
            "priority": o.get("priority") or ("high" if available < units else "normal"),
            "status": o.get("status"),
            "created_at": o.get("created_at"),
        })

    # ---- authorization center ----------------------------------------------------
    rep_reqs = await db.replenishment_requests.find(
        {"manufacturer_id": mfr, "status": "pending"}, {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    authorization = {
        "warehouse": [r for r in rep_reqs if r.get("requester_type") == "warehouse"],
        "wholesaler": [r for r in rep_reqs if r.get("requester_type") == "wholesaler"],
        "distributor": allocation_queue,  # pending POs double as distributor requests
    }

    # ---- transfers -----------------------------------------------------------------
    transfers_active = await db.transfer_orders.find(
        {"manufacturer_id": mfr, "status": {"$in": ["processing", "in_transit"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(8)
    transfers_total = await db.transfer_orders.count_documents({"manufacturer_id": mfr})

    # ---- pipeline funnel --------------------------------------------------------------
    st_count: Dict[str, int] = {}
    for o in orders:
        st_count[o.get("status") or "pending"] = st_count.get(o.get("status") or "pending", 0) + 1
    allocated = sum(st_count.get(s, 0) for s in
                    ("allocated", "partially_allocated", "fulfillment_in_progress", "completed"))
    # Completed orders implicitly passed through pick/pack/ship, so each later
    # stage is the union of its fulfillment evidence + completed orders.
    completed_ids = {o["id"] for o in orders if o.get("status") == "completed"}
    fo_orders: Dict[str, set] = {"picked": set(), "packed": set(), "shipped": set()}
    async for fo in db.fulfillment_orders.find(
        {"manufacturer_id": mfr}, {"_id": 0, "order_id": 1, "status": 1},
    ):
        st = fo.get("status")
        oid = fo.get("order_id")
        if st in ("picked", "loaded", "delivered"):
            fo_orders["picked"].add(oid)
        if st in ("loaded", "delivered"):
            fo_orders["packed"].add(oid)
        if st == "delivered":
            fo_orders["shipped"].add(oid)
    pipeline = {
        "open": open_count,
        "allocated": allocated,
        "picked": len(fo_orders["picked"] | completed_ids),
        "packed": len(fo_orders["packed"] | completed_ids),
        "shipped": len(fo_orders["shipped"] | completed_ids),
        "delivered": len(completed_ids),
    }

    # ---- demand forecast --------------------------------------------------------------
    prod_rows = await db.intel_forecasts.aggregate([
        {"$match": {"tenant_id": mfr}},
        {"$group": {"_id": "$product_id", "name": {"$first": "$product_name"},
                    "velocity": {"$sum": "$adjusted_velocity"},
                    "mult": {"$avg": "$external_multiplier"}}},
        {"$sort": {"velocity": -1}},
        {"$limit": 1},
    ]).to_list(1)
    top_product = None
    if prod_rows:
        r = prod_rows[0]
        today_units = int(round(float(r.get("velocity") or 0)))
        mult = float(r.get("mult") or 1)
        top_product = {
            "product_name": r.get("name") or name_by_pid.get(r["_id"], "—"),
            "today_units": today_units,
            "next_week_units": int(round(today_units * mult)),
            "pct": round((mult - 1) * 100, 1),
        }
    # Regional growth: prefer the real 7d-vs-prev-7d sales trend per region;
    # fall back to the external-signal multiplier when a region has no sales.
    region_by_retailer: Dict[str, str] = {}
    async for rt in db.retailers.find({}, {"_id": 0, "id": 1, "region": 1}):
        region_by_retailer[rt["id"]] = rt.get("region") or ""
    day7 = (now - timedelta(days=7)).date().isoformat()
    day14 = (now - timedelta(days=14)).date().isoformat()
    reg_rev: Dict[str, Dict[str, float]] = {}
    async for s in db.daily_sales.find(
        {"date": {"$gte": day14}}, {"_id": 0, "retailer_id": 1, "date": 1, "revenue": 1},
    ):
        region = region_by_retailer.get(s.get("retailer_id") or "")
        if not region:
            continue
        bucket = reg_rev.setdefault(region, {"cur": 0.0, "prev": 0.0})
        bucket["cur" if s["date"] >= day7 else "prev"] += float(s.get("revenue") or 0)
    regional_forecast = []
    for r in reg_rows[:6]:
        region = r.get("_id")
        if not region:
            continue
        rev = reg_rev.get(region)
        if rev and rev["prev"] > 0:
            pct = round((rev["cur"] - rev["prev"]) / rev["prev"] * 100, 1)
        else:
            pct = round((float(r.get("mult") or 1) - 1) * 100, 1)
        regional_forecast.append({"region": region, "pct": pct})
    regional_forecast.sort(key=lambda x: -x["pct"])
    wh_by_region = {(w.get("region") or "").lower(): w for w in map_warehouses}
    stockouts = []
    async for f in db.intel_forecasts.find(
        {"tenant_id": mfr, "urgency": {"$in": ["critical", "high"]}},
        {"_id": 0, "product_name": 1, "region": 1, "days_remaining": 1, "urgency": 1},
    ).sort("days_remaining", 1).limit(4):
        w = wh_by_region.get((f.get("region") or "").lower())
        stockouts.append({
            "warehouse_name": (w or {}).get("name") or f"{f.get('region')} network",
            "region": f.get("region"),
            "product_name": f.get("product_name"),
            "days": round(float(f.get("days_remaining") or 0), 1),
            "risk": "high" if float(f.get("days_remaining") or 99) < 5 else "medium",
        })

    ai_rec = await db.logistics_ai_recommendations.find_one(
        {"manufacturer_id": mfr}, {"_id": 0},
    )

    return {
        "kpis": kpis,
        "map": {"warehouses": map_warehouses, "routes": routes, "trucks": trucks,
                "demand_overlay": [
                    {"region": r["region"], "pct": r["pct"],
                     "lat": REGION_COORDS.get(r["region"].lower(), (9.08, 8.68))[0],
                     "lng": REGION_COORDS.get(r["region"].lower(), (9.08, 8.68))[1]}
                    for r in regional_forecast
                ]},
        "alerts": alerts,
        "allocation_queue": allocation_queue,
        "authorization": authorization,
        "transfers": {"active": transfers_active, "total": transfers_total},
        "pipeline": pipeline,
        "forecast": {"top_product": top_product, "regional": regional_forecast,
                     "stockouts": stockouts},
        "ai_recommendation": ai_rec,
        "generated_at": now.isoformat(),
    }


# ===========================================================================
# TRANSFERS
# ===========================================================================
class TransferPayload(BaseModel):
    from_warehouse_id: str
    to_warehouse_id: str
    product_id: str
    quantity: int = Field(..., gt=0)
    reason: str = "rebalancing"


async def _assign_vehicle(mfr: str, transfer: Dict[str, Any],
                          from_wh: Dict[str, Any], to_wh: Dict[str, Any]) -> Dict[str, Any]:
    """Attach an idle truck (or commission a new one) to a transfer."""
    o_lat, o_lng = coords_for(from_wh.get("city"), from_wh.get("region"))
    d_lat, d_lng = coords_for(to_wh.get("city"), to_wh.get("region"))
    vehicle = await db.vehicles.find_one({"manufacturer_id": mfr, "status": "idle"}, {"_id": 0})
    if not vehicle:
        seq = await _next_seq("vehicle_seq")
        vehicle = {
            "id": new_id(), "code": f"TK-{seq:03d}", "manufacturer_id": mfr,
            "driver_name": "Pool Driver", "driver_phone": "",
            "status": "idle", "lat": o_lat, "lng": o_lng,
            "created_at": now_iso(),
        }
        await db.vehicles.insert_one(dict(vehicle))
    update = {
        "status": "in_transit",
        "lat": o_lat + (d_lat - o_lat) * 0.08,
        "lng": o_lng + (d_lng - o_lng) * 0.08,
        "origin_name": from_wh["organization_name"], "origin_lat": o_lat, "origin_lng": o_lng,
        "dest_name": to_wh["organization_name"], "dest_lat": d_lat, "dest_lng": d_lng,
        "eta_minutes": 8 * 60, "speed_kmh": 62,
        "ref_type": "transfer", "ref_id": transfer["id"],
        "updated_at": now_iso(),
    }
    await db.vehicles.update_one({"id": vehicle["id"]}, {"$set": update})
    return {**vehicle, **update}


async def _create_transfer(mfr: str, payload: TransferPayload, user: Dict[str, Any],
                           source: str = "manual") -> Dict[str, Any]:
    if payload.from_warehouse_id == payload.to_warehouse_id:
        raise HTTPException(400, "Source and destination warehouses must differ")
    from_wh = await db.organizations.find_one(
        {"id": payload.from_warehouse_id, "organization_type": "warehouse",
         "parent_organization_id": mfr}, {"_id": 0})
    to_wh = await db.organizations.find_one(
        {"id": payload.to_warehouse_id, "organization_type": "warehouse",
         "parent_organization_id": mfr}, {"_id": 0})
    if not from_wh or not to_wh:
        raise HTTPException(404, "Warehouse not found in your tenant")
    product = await db.products.find_one({"id": payload.product_id, "manufacturer_id": mfr}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")

    inv = await db.inventory.find_one(
        {"owner_type": "warehouse", "owner_id": payload.from_warehouse_id,
         "product_id": payload.product_id}, {"_id": 0})
    available = max(0, int((inv or {}).get("quantity") or 0) - int((inv or {}).get("reserved") or 0))
    if payload.quantity > available:
        raise HTTPException(400, f"Insufficient stock at source: requested {payload.quantity:,}, available {available:,}")

    seq = await _next_seq("transfer_seq")
    eta = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
    transfer = {
        "id": new_id(),
        "transfer_number": f"TRF-{seq + 100}",
        "manufacturer_id": mfr,
        "from_warehouse_id": from_wh["id"], "from_warehouse_name": from_wh["organization_name"],
        "to_warehouse_id": to_wh["id"], "to_warehouse_name": to_wh["organization_name"],
        "product_id": product["id"], "product_name": product.get("name"),
        "quantity": payload.quantity,
        "reason": payload.reason,
        "status": "in_transit",
        "source": source,
        "eta": eta,
        "created_by": user.get("email") or user.get("id", ""),
        "created_at": now_iso(),
        "dispatched_at": now_iso(),
    }

    # Decrement source stock now; destination is credited on delivery.
    await db.inventory.update_one(
        {"owner_type": "warehouse", "owner_id": from_wh["id"], "product_id": product["id"]},
        {"$inc": {"quantity": -payload.quantity}, "$set": {"updated_at": now_iso()}},
    )

    # Mirror into shipments (is_transfer) so the WMS transfers list stays canonical.
    shipment = {
        "id": new_id(), "from_role": "warehouse", "from_id": from_wh["id"],
        "to_role": "warehouse", "to_id": to_wh["id"],
        "manufacturer_id": mfr, "distributor_id": "", "retailer_id": "",
        "organization_id": from_wh["id"], "is_transfer": True,
        "items": [{"product_id": product["id"], "quantity": payload.quantity}],
        "status": "in_transit",
        "tracking_code": transfer["transfer_number"],
        "notes": f"Inter-warehouse transfer · {payload.reason}",
        "created_at": now_iso(), "dispatched_at": now_iso(),
    }
    await db.shipments.insert_one(dict(shipment))
    transfer["shipment_id"] = shipment["id"]

    await db.transfer_orders.insert_one(dict(transfer))
    vehicle = await _assign_vehicle(mfr, transfer, from_wh, to_wh)
    await db.transfer_orders.update_one(
        {"id": transfer["id"]}, {"$set": {"vehicle_id": vehicle["id"], "vehicle_code": vehicle["code"]}})
    transfer["vehicle_id"] = vehicle["id"]
    transfer["vehicle_code"] = vehicle["code"]
    return transfer


@router.get("/logistics/transfers")
async def list_transfer_orders(
    manufacturer_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    rows = await db.transfer_orders.find(
        {"manufacturer_id": mfr}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return rows


@router.post("/logistics/transfers")
async def create_transfer_order(
    payload: TransferPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    return await _create_transfer(mfr, payload, user)


class AdvancePayload(BaseModel):
    action: str  # deliver | cancel


@router.patch("/logistics/transfers/{transfer_id}/advance")
async def advance_transfer(
    transfer_id: str,
    payload: AdvancePayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    t = await db.transfer_orders.find_one({"id": transfer_id, "manufacturer_id": mfr}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Transfer not found")
    if t["status"] not in ("processing", "in_transit"):
        raise HTTPException(400, f"Transfer already {t['status']}")

    if payload.action == "deliver":
        await db.inventory.update_one(
            {"owner_type": "warehouse", "owner_id": t["to_warehouse_id"],
             "product_id": t["product_id"]},
            {"$inc": {"quantity": t["quantity"]},
             "$setOnInsert": {"id": new_id(), "owner_type": "warehouse",
                              "owner_id": t["to_warehouse_id"],
                              "product_id": t["product_id"],
                              "reserved": 0, "reorder_level": 0,
                              "created_at": now_iso()},
             "$set": {"updated_at": now_iso()}},
            upsert=True,
        )
        update = {"status": "delivered", "delivered_at": now_iso()}
        if t.get("shipment_id"):
            await db.shipments.update_one(
                {"id": t["shipment_id"]},
                {"$set": {"status": "received", "received_at": now_iso()}})
    elif payload.action == "cancel":
        # Restore the source stock that was decremented on creation.
        await db.inventory.update_one(
            {"owner_type": "warehouse", "owner_id": t["from_warehouse_id"],
             "product_id": t["product_id"]},
            {"$inc": {"quantity": t["quantity"]}, "$set": {"updated_at": now_iso()}},
        )
        update = {"status": "cancelled", "cancelled_at": now_iso()}
        if t.get("shipment_id"):
            await db.shipments.delete_one({"id": t["shipment_id"]})
    else:
        raise HTTPException(400, "action must be 'deliver' or 'cancel'")

    await db.transfer_orders.update_one({"id": transfer_id}, {"$set": update})
    # Park the truck at its destination.
    if t.get("vehicle_id"):
        v = await db.vehicles.find_one({"id": t["vehicle_id"]}, {"_id": 0})
        if v:
            await db.vehicles.update_one(
                {"id": t["vehicle_id"]},
                {"$set": {"status": "idle",
                          "lat": v.get("dest_lat") or v.get("lat"),
                          "lng": v.get("dest_lng") or v.get("lng"),
                          "ref_type": None, "ref_id": None,
                          "updated_at": now_iso()}})
    return {**t, **update}


# ===========================================================================
# REPLENISHMENT REQUEST DECISIONS
# ===========================================================================
class DecidePayload(BaseModel):
    action: str  # approve | reject | modify
    quantity: Optional[int] = Field(None, gt=0)


@router.post("/logistics/requests/{request_id}/decide")
async def decide_replenishment(
    request_id: str,
    payload: DecidePayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    req = await db.replenishment_requests.find_one(
        {"id": request_id, "manufacturer_id": mfr}, {"_id": 0})
    if not req:
        raise HTTPException(404, "Request not found")
    if req.get("status") != "pending":
        raise HTTPException(400, f"Request already {req.get('status')}")

    if payload.action == "reject":
        update = {"status": "rejected", "decided_at": now_iso(),
                  "decided_by": user.get("email", "")}
        await db.replenishment_requests.update_one({"id": request_id}, {"$set": update})
        return {**req, **update}

    if payload.action not in ("approve", "modify"):
        raise HTTPException(400, "action must be approve, reject or modify")
    qty = payload.quantity if (payload.action == "modify" and payload.quantity) else int(req["quantity"])

    transfer = None
    if req.get("requester_type") == "warehouse":
        # Source: the tenant warehouse holding the most available stock of this
        # product (excluding the requester itself).
        best = await db.inventory.aggregate([
            {"$match": {"owner_type": "warehouse", "product_id": req["product_id"],
                        "owner_id": {"$ne": req["requester_id"]}}},
            {"$project": {"owner_id": 1, "avail": {"$subtract": [
                {"$ifNull": ["$quantity", 0]}, {"$ifNull": ["$reserved", 0]}]}}},
            {"$sort": {"avail": -1}}, {"$limit": 5},
        ]).to_list(5)
        wh_ids = [w["id"] for w in await _tenant_warehouses(mfr)]
        source = next((b for b in best if b["owner_id"] in wh_ids and b["avail"] > 0), None)
        if not source:
            raise HTTPException(400, "No tenant warehouse has available stock for this product")
        give = min(qty, int(source["avail"]))
        transfer = await _create_transfer(mfr, TransferPayload(
            from_warehouse_id=source["owner_id"],
            to_warehouse_id=req["requester_id"],
            product_id=req["product_id"],
            quantity=give,
            reason="replenishment",
        ), user, source="authorization")

    update = {
        "status": "approved", "approved_quantity": qty,
        "decided_at": now_iso(), "decided_by": user.get("email", ""),
        "transfer_id": (transfer or {}).get("id"),
        "transfer_number": (transfer or {}).get("transfer_number"),
    }
    await db.replenishment_requests.update_one({"id": request_id}, {"$set": update})
    return {**req, **update, "transfer": transfer}


# ===========================================================================
# VERTEX AI — Smart Allocation Recommendation
# ===========================================================================
AI_REC_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "from_warehouse_id": {"type": "STRING"},
        "to_warehouse_id": {"type": "STRING"},
        "product_id": {"type": "STRING"},
        "quantity": {"type": "INTEGER"},
        "reason_code": {"type": "STRING", "enum": [
            "stockout_prevention", "rebalancing", "demand_surge", "emergency"]},
        "narrative": {"type": "STRING"},
        "projected_stockout_days": {"type": "NUMBER"},
        "confidence": {"type": "NUMBER"},
    },
    "required": ["from_warehouse_id", "to_warehouse_id", "product_id",
                 "quantity", "reason_code", "narrative"],
}


async def _build_ai_context(mfr: str) -> Dict[str, Any]:
    warehouses = await _tenant_warehouses(mfr)
    wh_ids = [w["id"] for w in warehouses]
    products = await db.products.find(
        {"manufacturer_id": mfr}, {"_id": 0, "id": 1, "name": 1, "unit_price": 1},
    ).to_list(None)
    price_by_pid = {p["id"]: float(p.get("unit_price") or 0) for p in products}
    name_by_pid = {p["id"]: p.get("name") for p in products}

    inv_rows: Dict[str, List[Dict[str, Any]]] = {w: [] for w in wh_ids}
    async for r in db.inventory.find(
        {"owner_type": "warehouse", "owner_id": {"$in": wh_ids}},
        {"_id": 0, "owner_id": 1, "product_id": 1, "quantity": 1, "reserved": 1, "reorder_level": 1},
    ):
        inv_rows[r["owner_id"]].append(r)

    wh_summaries = []
    for w in warehouses:
        rows = inv_rows.get(w["id"], [])
        units = sum(int(r.get("quantity") or 0) for r in rows)
        low = sorted(
            (r for r in rows if int(r.get("quantity") or 0) <= int(r.get("reorder_level") or 0)),
            key=lambda r: int(r.get("quantity") or 0),
        )[:5]
        top = sorted(rows, key=lambda r: -(int(r.get("quantity") or 0) - int(r.get("reserved") or 0)))[:5]
        wh_summaries.append({
            "warehouse_id": w["id"], "name": w["organization_name"],
            "region": w.get("region"), "total_units": units,
            "low_stock": [{"product_id": r["product_id"],
                           "product": name_by_pid.get(r["product_id"]),
                           "qty": r.get("quantity"), "reorder_level": r.get("reorder_level")} for r in low],
            "most_available": [{"product_id": r["product_id"],
                                "product": name_by_pid.get(r["product_id"]),
                                "available": max(0, int(r.get("quantity") or 0) - int(r.get("reserved") or 0))} for r in top],
        })

    reg_rows = await db.intel_forecasts.aggregate([
        {"$match": {"tenant_id": mfr}},
        {"$group": {"_id": "$region", "mult": {"$avg": "$external_multiplier"},
                    "velocity": {"$sum": "$adjusted_velocity"}}},
    ]).to_list(10)
    back_orders = await db.back_orders.find(
        {"manufacturer_id": mfr, "status": {"$in": ["open", "partial"]}},
        {"_id": 0, "items": 1},
    ).to_list(50)
    bo_units: Dict[str, int] = {}
    for bo in back_orders:
        for it in bo.get("items") or []:
            pid = it.get("product_id")
            bo_units[pid] = bo_units.get(pid, 0) + int(it.get("quantity") or 0)

    return {
        "warehouses": wh_summaries,
        "regional_demand": [
            {"region": r["_id"], "growth_pct": round((float(r.get("mult") or 1) - 1) * 100, 1),
             "daily_velocity_units": round(float(r.get("velocity") or 0))}
            for r in reg_rows if r.get("_id")
        ],
        "open_back_orders": [
            {"product_id": pid, "product": name_by_pid.get(pid), "units": u}
            for pid, u in sorted(bo_units.items(), key=lambda kv: -kv[1])[:8]
        ],
        "_price_by_pid": price_by_pid,
        "_name_by_pid": name_by_pid,
        "_warehouses_raw": warehouses,
    }


def _rule_based_recommendation(ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Deterministic fallback: richest source → weakest destination."""
    whs = ctx["warehouses"]
    stocked = [w for w in whs if w["total_units"] > 0 and w["most_available"]]
    if not stocked:
        return None
    dest = min(whs, key=lambda w: w["total_units"])
    source = max((w for w in stocked if w["warehouse_id"] != dest["warehouse_id"]),
                 key=lambda w: w["total_units"], default=None)
    if not source:
        return None
    item = source["most_available"][0]
    qty = max(100, min(int(item["available"] * 0.2), 5000))
    return {
        "from_warehouse_id": source["warehouse_id"],
        "to_warehouse_id": dest["warehouse_id"],
        "product_id": item["product_id"],
        "quantity": qty,
        "reason_code": "rebalancing",
        "narrative": (f"{dest['name']} holds only {dest['total_units']:,} units while "
                      f"{source['name']} has {item['available']:,} available units of "
                      f"{item['product']}. Rebalancing protects regional service levels."),
        "projected_stockout_days": 5,
        "confidence": 0.55,
    }


async def _compute_ai_recommendation(mfr: str) -> Dict[str, Any]:
    import json as _json
    from services import vertex_llm

    ctx = await _build_ai_context(mfr)
    name_by_pid = ctx.pop("_name_by_pid")
    ctx.pop("_price_by_pid")
    wh_raw = {w["id"]: w for w in ctx.pop("_warehouses_raw")}

    rec, ai_status = None, "fallback_rules"
    if vertex_llm.is_configured():
        try:
            system = (
                "You are the supply-chain allocation strategist for a Nigerian FMCG "
                "manufacturer. Given live warehouse stock, regional demand growth and "
                "open back-orders, recommend EXACTLY ONE inter-warehouse stock transfer "
                "that best prevents a stockout or rebalances the network. Use ONLY "
                "warehouse_id and product_id values present in the data. quantity must "
                "not exceed the source warehouse's available units for that product. "
                "narrative: 1-2 crisp executive sentences explaining the why, citing numbers."
            )
            out = await vertex_llm.complete_json(
                system=system,
                user=_json.dumps(ctx, default=str),
                response_schema=AI_REC_SCHEMA,
                temperature=0.2,
                max_output_tokens=1024,
            )
            if isinstance(out, dict) and out.get("from_warehouse_id") in wh_raw \
                    and out.get("to_warehouse_id") in wh_raw \
                    and out.get("product_id") in name_by_pid \
                    and out.get("from_warehouse_id") != out.get("to_warehouse_id"):
                rec, ai_status = out, "vertex_ai"
        except Exception:
            logger.exception("[logistics] Vertex AI recommendation failed — using rules")
    if rec is None:
        rec = _rule_based_recommendation(ctx)
    if rec is None:
        raise HTTPException(409, "Not enough warehouse stock data to compute a recommendation")

    # Clamp quantity to actual availability at the source.
    inv = await db.inventory.find_one(
        {"owner_type": "warehouse", "owner_id": rec["from_warehouse_id"],
         "product_id": rec["product_id"]}, {"_id": 0})
    available = max(0, int((inv or {}).get("quantity") or 0) - int((inv or {}).get("reserved") or 0))
    rec["quantity"] = max(1, min(int(rec.get("quantity") or 1), available)) if available else 0

    doc = {
        "manufacturer_id": mfr,
        "from_warehouse_id": rec["from_warehouse_id"],
        "from_warehouse_name": wh_raw[rec["from_warehouse_id"]]["organization_name"],
        "to_warehouse_id": rec["to_warehouse_id"],
        "to_warehouse_name": wh_raw[rec["to_warehouse_id"]]["organization_name"],
        "product_id": rec["product_id"],
        "product_name": name_by_pid.get(rec["product_id"]),
        "quantity": rec["quantity"],
        "reason_code": rec.get("reason_code") or "rebalancing",
        "narrative": rec.get("narrative") or "",
        "projected_stockout_days": rec.get("projected_stockout_days"),
        "confidence": rec.get("confidence"),
        "ai_status": ai_status,
        "executed": False,
        "generated_at": now_iso(),
    }
    await db.logistics_ai_recommendations.replace_one(
        {"manufacturer_id": mfr}, doc, upsert=True)
    return doc


@router.post("/logistics/ai-recommendation/recompute")
async def recompute_ai_recommendation(
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    return await _compute_ai_recommendation(mfr)


@router.post("/logistics/ai-recommendation/execute")
async def execute_ai_recommendation(
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    rec = await db.logistics_ai_recommendations.find_one({"manufacturer_id": mfr}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "No recommendation to execute — recompute first")
    if rec.get("executed"):
        raise HTTPException(400, "Recommendation already executed")
    if not rec.get("quantity"):
        raise HTTPException(400, "Recommendation has no transferable quantity")
    transfer = await _create_transfer(mfr, TransferPayload(
        from_warehouse_id=rec["from_warehouse_id"],
        to_warehouse_id=rec["to_warehouse_id"],
        product_id=rec["product_id"],
        quantity=int(rec["quantity"]),
        reason=rec.get("reason_code") or "stockout_prevention",
    ), user, source="ai")
    await db.logistics_ai_recommendations.update_one(
        {"manufacturer_id": mfr},
        {"$set": {"executed": True, "executed_at": now_iso(),
                  "transfer_id": transfer["id"],
                  "transfer_number": transfer["transfer_number"]}})
    return {"recommendation": {**rec, "executed": True}, "transfer": transfer}

