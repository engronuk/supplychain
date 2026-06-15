"""Control Tower simulation engine.

Runs on the scheduler every 2 minutes and keeps the Logistics Command Center
*alive*: trucks follow real road polylines, fences fire enter/exit events,
and a controlled stream of exceptions (deviations, unauthorized stops,
delays, breakdowns) occurs so the tower always has something to manage —
"a Control Tower should always have some exceptions occurring."

Responsibilities per tick:
  1. ensure_geofences() — 500 m virtual fences around every warehouse
  2. ensure_fleet()     — spawn vehicles for in-transit shipments (capped)
  3. advance vehicles along their road route (Directions API w/ fallback)
  4. roll exception dice per moving vehicle; manage active exception
     lifecycles (they self-resolve after a few ticks)
  5. geofence transition detection → events
  6. arrivals → delivery_completed events + shipment closure
  7. event stream retention purge

Everything is event-driven: each state change emits into logistics_events.
"""
from __future__ import annotations

import asyncio
import math
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from core import db, logger, now_iso
from services.logistics_events import emit, purge_old
from services.routing import get_route, haversine_km, point_along

TICK_MINUTES = 2.0
DEMO_SPEEDUP = 10            # 1 wall-clock minute == 10 trip minutes
MAX_ACTIVE_VEHICLES = 80     # across all tenants — every live shipment
                             # should have a trackable truck
SPAWN_PER_TICK = 18          # spread Google route calls across ticks
GEOFENCE_RADIUS_M = 500

# Network-leg generators: keep every tier of the chain moving so the cockpit
# always has a healthy fleet of trucks on the map (target ~40-70 active).
FACTORY_MAX_ACTIVE = 8       # factory→warehouse legs in transit per tenant
P_FACTORY_DISPATCH = 0.85    # per-tick chance when below the cap
WS_MAX_ACTIVE = 18           # wholesaler→distributor legs in transit (global)
P_WS_DISPATCH = 0.85
WS_STALE_HOURS = 36          # seeded in-transit wholesaler shipments older
                             # than this are closed quietly (no truck)

# Per-tick exception probabilities for a moving vehicle.
P_DEVIATION = 0.030
P_STOP = 0.040
P_DELAY = 0.050
P_BREAKDOWN = 0.012

DRIVER_POOL = [
    "John Adeyemi", "Musa Ibrahim", "Chinedu Okafor", "Tunde Bakare",
    "Emeka Eze", "Sani Abubakar", "Femi Adesina", "Ifeanyi Nwosu",
    "Yusuf Garba", "Segun Olawale", "Kelechi Obi", "Idris Mohammed",
    "Gbenga Ojo", "Uche Kalu", "Hassan Bello", "Damilola Ajayi",
]

CITY_COORDS: Dict[str, Tuple[float, float]] = {
    "lagos": (6.5244, 3.3792), "ikeja": (6.6018, 3.3515), "apapa": (6.4500, 3.3590),
    "surulere": (6.4926, 3.3576), "yaba": (6.5095, 3.3711), "lekki": (6.4478, 3.5735),
    "ikorodu": (6.6194, 3.5105), "agege": (6.6253, 3.3211), "oshodi": (6.5559, 3.3432),
    "ibadan": (7.3775, 3.9470), "abeokuta": (7.1475, 3.3619), "osogbo": (7.7827, 4.5418),
    "akure": (7.2571, 5.2058), "ado-ekiti": (7.6211, 5.2214), "ilorin": (8.4966, 4.5421),
    "ogbomoso": (8.1335, 4.2407), "enugu": (6.4584, 7.5464), "onitsha": (6.1450, 6.7850),
    "aba": (5.1216, 7.3733), "owerri": (5.4836, 7.0333), "awka": (6.2120, 7.0740),
    "abakaliki": (6.3249, 8.1137), "nnewi": (6.0190, 6.9170), "umuahia": (5.5320, 7.4860),
    "port harcourt": (4.8156, 7.0498), "benin city": (6.3350, 5.6037), "warri": (5.5167, 5.7500),
    "uyo": (5.0377, 7.9128), "calabar": (4.9757, 8.3417), "asaba": (6.1980, 6.7300),
    "yenagoa": (4.9267, 6.2676), "abuja": (9.0765, 7.3986), "jos": (9.8965, 8.8583),
    "makurdi": (7.7322, 8.5391), "minna": (9.5836, 6.5463), "lokoja": (7.7960, 6.7400),
    "lafia": (8.4939, 8.5152), "keffi": (8.8460, 7.8730), "maiduguri": (11.8311, 13.1510),
    "bauchi": (10.3158, 9.8442), "gombe": (10.2890, 11.1670), "yola": (9.2035, 12.4954),
    "damaturu": (11.7470, 11.9660), "jalingo": (8.8930, 11.3600), "kano": (12.0022, 8.5920),
    "kaduna": (10.5105, 7.4165), "sokoto": (13.0059, 5.2476), "katsina": (12.9908, 7.6018),
    "zaria": (11.0855, 7.7199), "gusau": (12.1628, 6.6614), "birnin kebbi": (12.4539, 4.1975),
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
    return REGION_COORDS.get(r, (6.5244, 3.3792))


_geofences_ensured = False


async def ensure_geofences() -> None:
    """500 m circular fences around every warehouse (idempotent)."""
    global _geofences_ensured
    if _geofences_ensured:
        return
    warehouses = await db.organizations.find(
        {"organization_type": "warehouse"},
        {"_id": 0, "id": 1, "organization_name": 1, "city": 1, "region": 1,
         "parent_organization_id": 1},
    ).to_list(100)
    for w in warehouses:
        lat, lng = coords_for(w.get("city"), w.get("region"))
        await db.geofences.update_one(
            {"facility_id": w["id"]},
            {"$set": {
                "id": str(uuid.uuid4()),
                "facility_id": w["id"],
                "name": w["organization_name"],
                "kind": "warehouse",
                "manufacturer_id": w.get("parent_organization_id"),
                "lat": lat, "lng": lng,
                "radius_m": GEOFENCE_RADIUS_M,
                "created_at": now_iso(),
            }, "$setOnInsert": {}},
            upsert=True,
        )
    _geofences_ensured = True


async def _spawn_vehicle(shipment: Dict[str, Any], rng: random.Random) -> Optional[Dict]:
    """Create a truck for an in-transit shipment, routed on real roads."""
    mfr = shipment.get("manufacturer_id")
    to_id = shipment.get("to_id") or shipment.get("distributor_id")
    tracking = shipment.get("tracking_code") or shipment.get("shipment_number")
    # Origin: the dispatching facility (warehouse / manufacturer HQ city).
    origin_org = await db.organizations.find_one(
        {"id": shipment.get("from_id")}, {"_id": 0, "organization_name": 1, "city": 1, "region": 1})
    dest_doc = (await db.distributors.find_one({"id": to_id},
                                               {"_id": 0, "name": 1, "city": 1, "region": 1})
                or await db.organizations.find_one({"id": to_id},
                                                   {"_id": 0, "organization_name": 1, "city": 1, "region": 1})
                or {})
    o_lat, o_lng = coords_for((origin_org or {}).get("city"), (origin_org or {}).get("region"))
    d_lat, d_lng = coords_for(dest_doc.get("city"), dest_doc.get("region"))
    if haversine_km((o_lat, o_lng), (d_lat, d_lng)) < 1.0:
        d_lat += rng.uniform(0.25, 0.6) * rng.choice([-1, 1])
        d_lng += rng.uniform(0.25, 0.6) * rng.choice([-1, 1])

    route = await get_route((o_lat, o_lng), (d_lat, d_lng))
    seq = await db.counters.find_one_and_update(
        {"_id": "vehicle_seq"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    code = f"TK-{int(seq['seq']):03d}"
    units = sum(int(i.get("quantity") or 0) for i in (shipment.get("items") or []))
    vehicle = {
        "id": str(uuid.uuid4()),
        "code": code,
        "plate": f"{rng.choice(['LAG', 'KJA', 'ABJ', 'KAN', 'PHC', 'ENU'])}-{rng.randint(100, 999)}-{rng.choice(['XA', 'KR', 'BD', 'EP'])}",
        "manufacturer_id": mfr,
        "driver_name": rng.choice(DRIVER_POOL),
        "driver_phone": f"+234 80{rng.randint(2, 9)} {rng.randint(100, 999)} {rng.randint(1000, 9999)}",
        "status": "in_transit",
        "lat": o_lat, "lng": o_lng,
        "origin_name": (origin_org or {}).get("organization_name") or "Warehouse",
        "origin_lat": o_lat, "origin_lng": o_lng,
        "dest_name": dest_doc.get("name") or dest_doc.get("organization_name") or "Distributor",
        "dest_lat": d_lat, "dest_lng": d_lng,
        "route_polyline": route["polyline"],
        "route_km": route["distance_km"],
        "route_source": route["source"],
        "route_progress": rng.uniform(0.02, 0.30),
        "speed_kmh": rng.randint(48, 72),
        "fuel_pct": rng.randint(55, 96),
        "eta_minutes": route["duration_min"],
        "ref_type": "shipment",
        "ref_id": shipment["id"],
        "shipment_code": tracking,
        "units": units,
        "deviation": None,
        "stopped_since": None,
        "breakdown_since": None,
        "exception_ticks": 0,
        "fences_inside": [],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.vehicles.insert_one(dict(vehicle))
    await emit(mfr, "vehicle_dispatched",
               f"Truck {code} dispatched",
               f"{vehicle['origin_name']} → {vehicle['dest_name']} · {units:,} units",
               vehicle_id=vehicle["id"], vehicle_code=code,
               shipment_id=shipment["id"], ref_code=tracking,
               lat=o_lat, lng=o_lng, location_name=vehicle["origin_name"])
    await emit(mfr, "shipment_loaded",
               f"Shipment {tracking or shipment['id'][:8]} loaded",
               f"Assigned to {code} · driver {vehicle['driver_name']}",
               vehicle_id=vehicle["id"], vehicle_code=code,
               shipment_id=shipment["id"], ref_code=shipment.get("tracking_code"))
    return vehicle


async def ensure_fleet(rng: random.Random) -> int:
    """Spawn trucks for in-transit shipments lacking one (capped fleet)."""
    active = await db.vehicles.count_documents(
        {"status": {"$in": ["in_transit", "stopped", "breakdown"]}})
    if active >= MAX_ACTIVE_VEHICLES:
        return 0
    assigned_ids = list(await db.vehicles.distinct(
        "ref_id", {"ref_type": "shipment", "status": {"$ne": "idle"}}))
    # Shipments riding on an active multi-stop planned route already have a truck.
    async for rv in db.vehicles.find(
            {"ref_type": "route", "status": {"$in": ["in_transit", "stopped", "breakdown"]}},
            {"_id": 0, "stops.shipment_id": 1}):
        assigned_ids.extend(st.get("shipment_id") for st in (rv.get("stops") or []))
    candidates = await db.shipments.find(
        {"status": "in_transit", "id": {"$nin": assigned_ids}},
        {"_id": 0, "id": 1, "manufacturer_id": 1, "from_id": 1, "to_id": 1,
         "from_role": 1, "items": 1, "tracking_code": 1},
    ).sort("created_at", -1).to_list(MAX_ACTIVE_VEHICLES * 2)
    # Keep every tier visible: first-mile (factory) and wholesaler legs are
    # rarer, so they take spawn slots before the bulk warehouse→distributor
    # backlog. Stable sort preserves newest-first within each group.
    candidates.sort(key=lambda s: 0 if s.get("from_role")
                    in ("manufacturer", "wholesaler") else 1)
    spawned = 0
    for s in candidates:
        if active + spawned >= MAX_ACTIVE_VEHICLES or spawned >= SPAWN_PER_TICK:
            break
        try:
            if await _spawn_vehicle(s, rng):
                spawned += 1
        except Exception:
            logger.exception("[tower] failed to spawn vehicle for shipment %s", s.get("id"))
    return spawned


def _offset_position(lat: float, lng: float, rng: random.Random,
                     km: float) -> Tuple[float, float]:
    bearing = rng.uniform(0, 2 * math.pi)
    deg = km / 111.0
    return (lat + deg * math.cos(bearing), lng + deg * math.sin(bearing))


# ===========================================================================
# Network-leg generators — first mile + wholesaler tier
# ===========================================================================
async def ensure_factory_replenishment(rng: random.Random) -> int:
    """First-mile leg: manufacturer plant → its warehouses.

    Creates real `shipments` docs (from_role=manufacturer, to_role=warehouse)
    which `ensure_fleet` then assigns a truck — full GPS / geofence /
    exception treatment like any other movement. On arrival the goods are
    received into the warehouse's inventory (`_receive_at_warehouse`)."""
    created = 0
    async for m in db.organizations.find(
            {"organization_type": "manufacturer"},
            {"_id": 0, "id": 1, "organization_name": 1}):
        mfr = m["id"]
        active = await db.shipments.count_documents(
            {"manufacturer_id": mfr, "from_role": "manufacturer",
             "to_role": "warehouse", "status": "in_transit"})
        if active >= FACTORY_MAX_ACTIVE or rng.random() > P_FACTORY_DISPATCH:
            continue
        whs = await db.organizations.find(
            {"organization_type": "warehouse", "parent_organization_id": mfr},
            {"_id": 0, "id": 1, "organization_name": 1}).to_list(20)
        prods = await db.products.find(
            {"manufacturer_id": mfr},
            {"_id": 0, "id": 1, "name": 1, "sku": 1}).to_list(40)
        if not whs or not prods:
            continue
        wh = rng.choice(whs)
        items = [{"product_id": p["id"], "product_name": p.get("name"),
                  "sku": p.get("sku"), "quantity": rng.randint(200, 800)}
                 for p in rng.sample(prods, k=min(len(prods), rng.randint(2, 4)))]
        units = sum(i["quantity"] for i in items)
        sid = str(uuid.uuid4())
        tracking = f"FAC-{uuid.uuid4().hex[:6].upper()}"
        now = now_iso()
        await db.shipments.insert_one({
            "id": sid, "manufacturer_id": mfr,
            "from_role": "manufacturer", "from_id": mfr,
            "to_role": "warehouse", "to_id": wh["id"],
            "items": items, "tracking_code": tracking,
            "status": "in_transit", "source": "factory_replenishment",
            "created_at": now, "dispatched_at": now,
        })
        await emit(mfr, "shipment_created",
                   f"Factory dispatch {tracking} → {wh['organization_name']}",
                   f"{units:,} units · {len(items)} SKUs · first-mile replenishment",
                   shipment_id=sid, ref_code=tracking)
        created += 1
    return created


async def ensure_wholesaler_dispatch(rng: random.Random) -> int:
    """Keep the wholesaler → distributor leg alive: periodically create a
    wholesaler shipment on a known lane (mirrors what the wholesaler
    fulfillment workflow produces). The bridge below then gives it a truck."""
    active = await db.wholesaler_shipments.count_documents(
        {"status": {"$in": ["loaded", "in_transit"]},
         "mirror_shipment_id": {"$exists": True}})
    if active >= WS_MAX_ACTIVE or rng.random() > P_WS_DISPATCH:
        return 0
    lanes = await db.wholesaler_shipments.aggregate([
        {"$group": {"_id": {"w": "$wholesaler_id", "d": "$distributor_id"}}},
        {"$sample": {"size": 1}},
    ]).to_list(1)
    if not lanes:
        return 0
    w_id, d_id = lanes[0]["_id"].get("w"), lanes[0]["_id"].get("d")
    dist = await db.distributors.find_one(
        {"id": d_id}, {"_id": 0, "id": 1, "manufacturer_id": 1, "name": 1,
                       "code": 1, "city": 1, "region": 1})
    worg = await db.organizations.find_one(
        {"id": w_id}, {"_id": 0, "organization_name": 1, "city": 1, "region": 1})
    if not dist or not worg or not dist.get("manufacturer_id"):
        return 0
    prods = await db.products.find(
        {"manufacturer_id": dist["manufacturer_id"]},
        {"_id": 0, "id": 1, "name": 1, "sku": 1}).to_list(60)
    if not prods:
        return 0
    items = [{"product_id": p["id"], "product_name": p.get("name"),
              "sku": p.get("sku"), "batch_number": "",
              "quantity": rng.randint(50, 200)}
             for p in rng.sample(prods, k=min(len(prods), rng.randint(1, 3)))]
    now = now_iso()
    year = datetime.now(timezone.utc).year
    num = f"WSHIP-{year}-{await db.wholesaler_shipments.count_documents({}) + 1:04d}"
    await db.wholesaler_shipments.insert_one({
        "id": str(uuid.uuid4()), "shipment_number": num,
        "wholesaler_id": w_id, "fulfillment_id": None,
        "order_id": None, "order_number": None,
        "distributor_id": d_id,
        "distributor": {"id": dist["id"], "name": dist.get("name"),
                        "code": dist.get("code"), "region": dist.get("region"),
                        "city": dist.get("city"), "address": None},
        "items": items, "total_units": sum(i["quantity"] for i in items),
        "status": "in_transit",
        "origin_lat": None, "origin_lng": None,
        "destination_lat": None, "destination_lng": None,
        "eta_minutes": 90, "shipment_date": now,
        "expected_delivery_date": (datetime.now(timezone.utc)
                                   + timedelta(days=1)).isoformat(),
        "status_history": [
            {"status": "created", "at": now, "by": "simulator",
             "note": "Shipment created by network simulator"},
            {"status": "in_transit", "at": now, "by": "simulator",
             "note": "Departed wholesaler dock"}],
        "source": "sim",
        "created_at": now, "loaded_at": now, "in_transit_at": now,
        "updated_at": now,
    })
    return 1


async def bridge_wholesaler_shipments() -> Dict[str, int]:
    """Sync the real procurement tables into the live logistics ledger.

    Iterates two procurement collections that the rest of the app writes to
    when wholesalers and retailers place orders:

      • ``wholesaler_purchase_orders`` — Dist → Wholesaler leg.
      • ``purchase_orders``           — Wholesaler → Retailer leg
                                        (only when supplier_type == wholesaler).

    For each PO that has transitioned to ``allocated`` / ``shipped`` /
    ``in_transit`` and does **not** yet have a mirror ``shipments`` doc,
    we mint a real shipment + vehicle so the truck shows up on the
    Control Tower live map (Distributors / Wholesalers / Retailers
    toggles).  Idempotent — uses ``mirror_shipment_id`` as the lock.
    """
    out = {"bridged_dist_whlsr": 0, "bridged_whlsr_retail": 0}
    rng = random.Random()
    now = now_iso()
    ACTIVE = {"allocated", "shipped", "in_transit"}

    # ------------------------- Dist → Wholesaler --------------------------
    async for po in db.wholesaler_purchase_orders.find(
        {"status": {"$in": list(ACTIVE)},
         "mirror_shipment_id": {"$exists": False}},
        {"_id": 0},
    ):
        supplier_id = po.get("supplier_id")
        if not supplier_id or po.get("supplier_type") != "distributor":
            continue
        dist = await db.distributors.find_one(
            {"id": supplier_id}, {"_id": 0, "manufacturer_id": 1, "name": 1, "city": 1, "region": 1})
        if not dist or not dist.get("manufacturer_id"):
            continue
        mfr = dist["manufacturer_id"]
        sid = str(uuid.uuid4())
        tracking = po.get("po_number") or sid[:8].upper()
        items = [{k: it.get(k) for k in ("product_id", "product_name", "sku", "quantity")}
                 for it in (po.get("items") or [])]
        await db.shipments.insert_one({
            "id": sid, "manufacturer_id": mfr,
            "from_role": "distributor", "from_id": supplier_id,
            "to_role": "wholesaler", "to_id": po.get("wholesaler_id"),
            "items": items, "tracking_code": tracking,
            "status": "in_transit", "source": "procurement",
            "wholesaler_purchase_order_id": po["id"],
            "po_number": po.get("po_number"),
            "total_amount": po.get("total_amount"),
            "created_at": now,
            "dispatched_at": po.get("shipped_at") or now,
        })
        await db.wholesaler_purchase_orders.update_one(
            {"id": po["id"]},
            {"$set": {"mirror_shipment_id": sid, "updated_at": now}},
        )
        ship_doc = {
            "id": sid, "manufacturer_id": mfr, "items": items,
            "from_id": supplier_id, "to_id": po.get("wholesaler_id"),
            "tracking_code": tracking,
        }
        await _spawn_vehicle(ship_doc, rng)
        await emit(mfr, "shipment_created",
                   f"PO {tracking} → {po.get('organization_id') or 'wholesaler'}",
                   f"{sum(int(i.get('quantity') or 0) for i in items):,} units · "
                   "distributor → wholesaler leg",
                   shipment_id=sid, ref_code=tracking)
        out["bridged_dist_whlsr"] += 1

    # ------------------------- Wholesaler → Retailer ----------------------
    async for po in db.purchase_orders.find(
        {"status": {"$in": list(ACTIVE)},
         "supplier_type": "wholesaler",
         "mirror_shipment_id": {"$exists": False}},
        {"_id": 0},
    ):
        whlsr_id = po.get("distributor_id")  # legacy field name = supplier
        if not whlsr_id:
            continue
        whlsr = await db.organizations.find_one(
            {"id": whlsr_id},
            {"_id": 0, "organization_name": 1, "parent_organization_id": 1, "city": 1, "region": 1})
        if not whlsr:
            continue
        # Walk parent chain to find manufacturer.
        mfr = None
        parent_id = whlsr.get("parent_organization_id")
        while parent_id:
            parent = await db.organizations.find_one(
                {"id": parent_id},
                {"_id": 0, "organization_type": 1, "parent_organization_id": 1, "id": 1})
            if not parent:
                break
            if parent.get("organization_type") == "manufacturer":
                mfr = parent_id
                break
            parent_id = parent.get("parent_organization_id")
        if not mfr:
            continue
        sid = str(uuid.uuid4())
        tracking = po.get("po_number") or sid[:8].upper()
        items = [{k: it.get(k) for k in ("product_id", "product_name", "sku", "quantity")}
                 for it in (po.get("items") or [])]
        await db.shipments.insert_one({
            "id": sid, "manufacturer_id": mfr,
            "from_role": "wholesaler", "from_id": whlsr_id,
            "to_role": "retailer", "to_id": po.get("retailer_id"),
            "items": items, "tracking_code": tracking,
            "status": "in_transit", "source": "procurement",
            "purchase_order_id": po["id"],
            "po_number": po.get("po_number"),
            "total_amount": po.get("total_amount"),
            "created_at": now,
            "dispatched_at": now,
        })
        await db.purchase_orders.update_one(
            {"id": po["id"]},
            {"$set": {"mirror_shipment_id": sid, "updated_at": now}},
        )
        ship_doc = {
            "id": sid, "manufacturer_id": mfr, "items": items,
            "from_id": whlsr_id, "to_id": po.get("retailer_id"),
            "tracking_code": tracking,
        }
        await _spawn_vehicle(ship_doc, rng)
        await emit(mfr, "shipment_created",
                   f"PO {tracking} → retailer",
                   f"{sum(int(i.get('quantity') or 0) for i in items):,} units · "
                   "wholesaler → retailer leg",
                   shipment_id=sid, ref_code=tracking)
        out["bridged_whlsr_retail"] += 1

    return out


async def _receive_at_warehouse(mfr: str, wh_id: str,
                                items: List[Dict[str, Any]],
                                ref_id: str) -> None:
    """Book a first-mile arrival into the warehouse's on-hand inventory."""
    for it in items:
        qty = int(it.get("quantity") or 0)
        pid = it.get("product_id")
        if qty <= 0 or not pid:
            continue
        row = await db.inventory.find_one(
            {"owner_type": "warehouse", "owner_id": wh_id, "product_id": pid},
            {"_id": 0, "id": 1, "quantity": 1})
        if row:
            await db.inventory.update_one({"id": row["id"]}, {"$set": {
                "quantity": int(row.get("quantity") or 0) + qty,
                "updated_at": now_iso(), "last_movement_at": now_iso()}})
        else:
            await db.inventory.insert_one({
                "id": str(uuid.uuid4()), "owner_type": "warehouse",
                "owner_id": wh_id, "product_id": pid,
                "quantity": qty, "in_transit": 0, "reorder_level": 100,
                "created_at": now_iso(), "updated_at": now_iso()})
        await db.inventory_movements.insert_one({
            "id": str(uuid.uuid4()), "owner_type": "warehouse",
            "owner_id": wh_id, "product_id": pid, "delta": qty,
            "kind": "factory_receipt", "ref_id": ref_id,
            "manufacturer_id": mfr, "created_at": now_iso()})


async def _complete_delivery(v: Dict[str, Any]) -> None:
    mfr = v.get("manufacturer_id")
    now = now_iso()
    if v.get("ref_type") == "shipment" and v.get("ref_id"):
        sh = await db.shipments.find_one(
            {"id": v["ref_id"]},
            {"_id": 0, "to_role": 1, "to_id": 1, "items": 1,
             "wholesaler_shipment_id": 1})
        await db.shipments.update_one(
            {"id": v["ref_id"], "status": "in_transit"},
            {"$set": {"status": "received", "received_at": now}})
        await db.distributor_orders.update_one(
            {"shipment_id": v["ref_id"], "status": "dispatched"},
            {"$set": {"status": "delivered", "delivered_at": now}})
        if sh:
            if sh.get("to_role") == "warehouse" and sh.get("to_id"):
                # First-mile arrival: goods land in warehouse inventory.
                try:
                    await _receive_at_warehouse(
                        mfr, sh["to_id"], sh.get("items") or [], v["ref_id"])
                except Exception:
                    logger.exception("[tower] warehouse receipt failed")
            if sh.get("wholesaler_shipment_id"):
                # Wholesaler→distributor leg: close out the wholesaler ledger.
                await db.wholesaler_shipments.update_one(
                    {"id": sh["wholesaler_shipment_id"]},
                    {"$set": {"status": "delivered", "delivered_at": now,
                              "updated_at": now},
                     "$push": {"status_history": {
                         "status": "delivered", "at": now, "by": "control-tower",
                         "note": f"Delivery confirmed by truck {v.get('code')}"}}})
    await emit(mfr, "delivery_completed",
               f"Truck {v['code']} delivered at {v.get('dest_name')}",
               f"{(v.get('units') or 0):,} units · shipment {v.get('shipment_code') or ''}".strip(),
               vehicle_id=v["id"], vehicle_code=v["code"],
               shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
               lat=v.get("dest_lat"), lng=v.get("dest_lng"),
               location_name=v.get("dest_name"))
    await db.vehicles.update_one({"id": v["id"]}, {"$set": {
        "status": "arrived", "arrived_at": now_iso(),
        "progress": 1.0, "route_progress": 1.0,
        "eta_minutes": 0, "speed_kmh": 0,
        "lat": v.get("dest_lat"), "lng": v.get("dest_lng"),
        "deviation": None, "stopped_since": None, "breakdown_since": None,
        "delivered_at": now_iso(), "updated_at": now_iso(),
    }})


async def _deliver_stop(v: Dict[str, Any], st: Dict[str, Any]) -> None:
    """Complete one stop of a multi-stop planned route."""
    mfr = v.get("manufacturer_id")
    now = now_iso()
    sid = st.get("shipment_id")
    if sid:
        await db.shipments.update_one(
            {"id": sid, "status": {"$in": ["in_transit", "delayed"]}},
            {"$set": {"status": "received", "received_at": now}})
        await db.distributor_orders.update_one(
            {"shipment_id": sid, "status": "dispatched"},
            {"$set": {"status": "delivered", "delivered_at": now}})
    await emit(mfr, "delivery_completed",
               f"Truck {v['code']} delivered stop {st.get('seq')} at {st.get('dest_name')}",
               f"Route {v.get('shipment_code') or ''} · {(st.get('units') or 0):,} units".strip(),
               vehicle_id=v["id"], vehicle_code=v["code"],
               shipment_id=sid, ref_code=st.get("tracking_code"),
               lat=st.get("lat"), lng=st.get("lng"),
               location_name=st.get("dest_name"),
               meta={"route_id": v.get("ref_id"), "seq": st.get("seq")})
    await db.planned_routes.update_one(
        {"id": v.get("ref_id"), "stops.seq": st.get("seq")},
        {"$set": {"stops.$.status": "delivered", "stops.$.delivered_at": now,
                  "status": "in_progress", "updated_at": now}})


async def _complete_route(v: Dict[str, Any]) -> None:
    """Final stop reached — close the planned route and park the truck."""
    mfr = v.get("manufacturer_id")
    now = now_iso()
    for st in (v.get("stops") or []):
        if not st.get("delivered"):
            await _deliver_stop(v, st)
            st["delivered"] = True
            st["delivered_at"] = now
    await db.planned_routes.update_one(
        {"id": v.get("ref_id")},
        {"$set": {"status": "completed", "completed_at": now, "updated_at": now}})
    await emit(mfr, "route_completed",
               f"Route {v.get('shipment_code')} completed by {v['code']}",
               f"{len(v.get('stops') or [])} stops delivered · "
               f"{(v.get('units') or 0):,} units",
               vehicle_id=v["id"], vehicle_code=v["code"],
               lat=v.get("dest_lat"), lng=v.get("dest_lng"),
               location_name=v.get("dest_name"),
               meta={"route_id": v.get("ref_id")})
    await db.vehicles.update_one({"id": v["id"]}, {"$set": {
        "status": "arrived", "arrived_at": now_iso(),
        "progress": 1.0, "route_progress": 1.0,
        "eta_minutes": 0, "speed_kmh": 0,
        "lat": v.get("dest_lat"), "lng": v.get("dest_lng"),
        "deviation": None, "stopped_since": None, "breakdown_since": None,
        "stops": [], "ref_type": None, "ref_id": None,
        "delivered_at": now_iso(), "updated_at": now_iso(),
    }})


async def _check_geofences(v: Dict[str, Any], fences: List[Dict[str, Any]],
                           lat: float, lng: float) -> List[str]:
    """Emit enter/exit events; return the new fences_inside list."""
    mfr = v.get("manufacturer_id")
    inside_prev = set(v.get("fences_inside") or [])
    inside_now = set()
    for f in fences:
        d_km = haversine_km((lat, lng), (f["lat"], f["lng"]))
        if d_km * 1000 <= (f.get("radius_m") or GEOFENCE_RADIUS_M) * 4:
            inside_now.add(f["facility_id"])
            if f["facility_id"] not in inside_prev:
                etype = "warehouse_arrived" if f.get("kind") == "warehouse" else "geofence_enter"
                await emit(mfr, etype,
                           f"Truck {v['code']} entered {f['name']}",
                           "Geofence boundary crossed (inbound)",
                           vehicle_id=v["id"], vehicle_code=v["code"],
                           shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
                           lat=lat, lng=lng, location_name=f["name"])
    for fid in inside_prev - inside_now:
        f = next((x for x in fences if x["facility_id"] == fid), None)
        if f:
            etype = "warehouse_departed" if f.get("kind") == "warehouse" else "geofence_exit"
            await emit(mfr, etype,
                       f"Truck {v['code']} departed {f['name']}",
                       "Geofence boundary crossed (outbound)",
                       vehicle_id=v["id"], vehicle_code=v["code"],
                       shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
                       lat=lat, lng=lng, location_name=f["name"])
    return sorted(inside_now)


async def tick() -> Dict[str, int]:
    """One control-tower heartbeat. Called by the scheduler every 2 min."""
    rng = random.Random()
    stats = {"moved": 0, "spawned": 0, "exceptions": 0, "delivered": 0}

    await ensure_geofences()
    # Keep every network leg flowing: factory → warehouse (first mile) and
    # wholesaler → distributor, then assign trucks to whatever is in transit.
    try:
        stats["factory_legs"] = await ensure_factory_replenishment(rng)
        stats["wholesaler_legs"] = await ensure_wholesaler_dispatch(rng)
        bridged = await bridge_wholesaler_shipments()
        stats["ws_bridged"] = bridged["bridged"]
    except Exception:
        logger.exception("[tower] network leg generators failed")
    stats["spawned"] = await ensure_fleet(rng)

    fences = await db.geofences.find({}, {"_id": 0}).to_list(200)

    async for v in db.vehicles.find(
            {"status": {"$in": ["in_transit", "stopped", "breakdown"]}}, {"_id": 0}):
        try:
            mfr = v.get("manufacturer_id")
            update: Dict[str, Any] = {"updated_at": now_iso()}

            # ---- Active exception lifecycles (self-resolve) ----------------
            if v["status"] == "breakdown":
                ticks_left = int(v.get("exception_ticks") or 0) - 1
                if ticks_left <= 0:
                    update.update({"status": "in_transit", "breakdown_since": None,
                                   "exception_ticks": 0,
                                   "speed_kmh": rng.randint(45, 65)})
                    await emit(mfr, "breakdown_resolved",
                               f"Truck {v['code']} back on the road",
                               "Mechanical issue resolved — resuming route",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               lat=v.get("lat"), lng=v.get("lng"))
                else:
                    update["exception_ticks"] = ticks_left
                await db.vehicles.update_one({"id": v["id"]}, {"$set": update})
                continue

            if v["status"] == "stopped":
                ticks_left = int(v.get("exception_ticks") or 0) - 1
                if ticks_left <= 0:
                    update.update({"status": "in_transit", "stopped_since": None,
                                   "exception_ticks": 0,
                                   "speed_kmh": rng.randint(45, 70)})
                    await emit(mfr, "stop_resolved",
                               f"Truck {v['code']} moving again",
                               "Unscheduled stop ended",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               lat=v.get("lat"), lng=v.get("lng"))
                else:
                    update["exception_ticks"] = ticks_left
                await db.vehicles.update_one({"id": v["id"]}, {"$set": update})
                continue

            # ---- Lazily fetch a road route for legacy linear vehicles ------
            polyline = v.get("route_polyline")
            if not polyline and v.get("dest_lat") is not None:
                try:
                    route = await get_route(
                        (v["origin_lat"], v["origin_lng"]),
                        (v["dest_lat"], v["dest_lng"]))
                    polyline = route["polyline"]
                    update.update({"route_polyline": polyline,
                                   "route_km": route["distance_km"],
                                   "route_source": route["source"]})
                    if v.get("route_progress") is None:
                        update["route_progress"] = float(v.get("progress") or 0.0)
                        v["route_progress"] = update["route_progress"]
                except Exception:
                    polyline = None

            # ---- Advance along the route -----------------------------------
            progress = float(v.get("route_progress")
                             if v.get("route_progress") is not None
                             else (v.get("progress") or 0.0))
            speed = float(v.get("speed_kmh") or 55)
            route_km = float(v.get("route_km") or update.get("route_km") or
                             haversine_km((v.get("origin_lat") or 0, v.get("origin_lng") or 0),
                                          (v.get("dest_lat") or 0, v.get("dest_lng") or 0)) * 1.3 or 100)
            km_this_tick = speed * (TICK_MINUTES * DEMO_SPEEDUP) / 60.0
            progress = min(1.0, progress + km_this_tick / max(route_km, 1.0))

            if polyline:
                lat, lng = point_along(polyline, progress)
            else:
                o_lat, o_lng = v.get("origin_lat") or 0, v.get("origin_lng") or 0
                d_lat, d_lng = v.get("dest_lat") or 0, v.get("dest_lng") or 0
                lat = o_lat + (d_lat - o_lat) * progress
                lng = o_lng + (d_lng - o_lng) * progress

            # ---- Deviation lifecycle ----------------------------------------
            deviation = v.get("deviation")
            if deviation and deviation.get("active"):
                ticks_left = int(v.get("exception_ticks") or 0) - 1
                if ticks_left <= 0:
                    deviation = None
                    update["exception_ticks"] = 0
                    await emit(mfr, "deviation_resolved",
                               f"Truck {v['code']} back on approved route",
                               "Route deviation corrected",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               lat=lat, lng=lng)
                else:
                    update["exception_ticks"] = ticks_left
                    off_km = float(deviation.get("offset_km") or 4.0)
                    lat, lng = _offset_position(lat, lng, rng, off_km)
            else:
                deviation = None

            # ---- Roll for new exceptions ------------------------------------
            if deviation is None and 0.05 < progress < 0.92:
                roll = rng.random()
                if roll < P_BREAKDOWN:
                    update.update({"status": "breakdown",
                                   "breakdown_since": now_iso(),
                                   "exception_ticks": rng.randint(3, 5),
                                   "speed_kmh": 0})
                    stats["exceptions"] += 1
                    await emit(mfr, "vehicle_breakdown",
                               f"Truck {v['code']} reported a breakdown",
                               f"Driver {v.get('driver_name')} · near {v.get('dest_name')} corridor · "
                               f"recovery dispatched",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
                               lat=lat, lng=lng)
                elif roll < P_BREAKDOWN + P_DEVIATION:
                    off_km = round(rng.uniform(3.0, 7.5), 1)
                    deviation = {"active": True, "offset_km": off_km,
                                 "started_at": now_iso()}
                    update["exception_ticks"] = rng.randint(2, 4)
                    stats["exceptions"] += 1
                    lat, lng = _offset_position(lat, lng, rng, off_km)
                    await emit(mfr, "route_deviation",
                               f"Truck {v['code']} is {off_km} km off approved route",
                               f"Driver {v.get('driver_name')} · contact driver · risk HIGH",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
                               lat=lat, lng=lng,
                               meta={"offset_km": off_km})
                elif roll < P_BREAKDOWN + P_DEVIATION + P_STOP:
                    update.update({"status": "stopped",
                                   "stopped_since": now_iso(),
                                   "exception_ticks": rng.randint(1, 3),
                                   "speed_kmh": 0})
                    stats["exceptions"] += 1
                    await emit(mfr, "unauthorized_stop",
                               f"Truck {v['code']} made an unscheduled stop",
                               f"Stationary off-route · driver {v.get('driver_name')}",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
                               lat=lat, lng=lng)
                elif roll < P_BREAKDOWN + P_DEVIATION + P_STOP + P_DELAY:
                    new_speed = rng.randint(22, 38)
                    update["speed_kmh"] = new_speed
                    stats["exceptions"] += 1
                    await emit(mfr, "delay_detected",
                               f"Truck {v['code']} slowed to {new_speed} km/h",
                               "Traffic congestion on corridor — ETA pushed back",
                               vehicle_id=v["id"], vehicle_code=v["code"],
                               shipment_id=v.get("ref_id"), ref_code=v.get("shipment_code"),
                               lat=lat, lng=lng)
                else:
                    # gentle speed jitter back toward cruising speed
                    update["speed_kmh"] = max(40, min(75, int(speed + rng.randint(-6, 8))))

            # ---- Fuel + ETA ---------------------------------------------------
            fuel = float(v.get("fuel_pct") or 80)
            update["fuel_pct"] = max(8, round(fuel - km_this_tick * 0.06, 1))
            remaining_km = max(0.0, route_km * (1 - progress))
            cruise = max(float(update.get("speed_kmh") or speed), 25)
            update["eta_minutes"] = round(remaining_km / cruise * 60)
            update.update({"lat": lat, "lng": lng,
                           "route_progress": progress, "progress": progress,
                           "deviation": deviation})

            # ---- Geofences ----------------------------------------------------
            update["fences_inside"] = await _check_geofences(v, fences, lat, lng)

            # ---- Multi-stop planned-route deliveries ----------------------------
            stops_list = v.get("stops") or []
            if stops_list:
                hit = False
                for st in stops_list:
                    if not st.get("delivered") and \
                            progress + 1e-9 >= float(st.get("threshold") or 1.0):
                        try:
                            await _deliver_stop(v, st)
                        except Exception:
                            logger.exception("[tower] stop delivery failed for %s",
                                             v.get("code"))
                        st["delivered"] = True
                        st["delivered_at"] = now_iso()
                        hit = True
                        stats["delivered"] += 1
                if hit:
                    update["stops"] = stops_list

            await db.vehicles.update_one({"id": v["id"]}, {"$set": update})
            stats["moved"] += 1

            # ---- Arrival ------------------------------------------------------
            if progress >= 1.0 and update.get("status") not in ("breakdown", "stopped"):
                if v.get("ref_type") == "transfer":
                    pass  # transfers are completed by the transfer delivery flow
                elif v.get("ref_type") == "route":
                    await _complete_route({**v, **update})
                else:
                    await _complete_delivery({**v, **update})
                    stats["delivered"] += 1
        except Exception:
            logger.exception("[tower] tick failed for vehicle %s", v.get("code"))

    try:
        await purge_old()
    except Exception:
        pass
    return stats


# ---------------------------------------------------------------------------
# Self-healing tick — keeps the simulation alive on request-driven deploys
# ---------------------------------------------------------------------------
_tick_guard = asyncio.Lock()


async def maybe_tick() -> bool:
    """If the last heartbeat is stale (scheduler not running in this
    deployment), fire a tick in the background. Cheap to call per request."""
    cutoff = (datetime.now(timezone.utc)
              - timedelta(minutes=TICK_MINUTES + 1)).isoformat()
    meta = await db.sim_meta.find_one({"id": "tower_tick"}, {"_id": 0, "at": 1})
    if meta and (meta.get("at") or "") > cutoff:
        return False
    if _tick_guard.locked():
        return False
    asyncio.create_task(_guarded_tick())
    return True


async def _guarded_tick() -> None:
    async with _tick_guard:
        try:
            await tick()
        except Exception:
            logger.exception("[tower] on-demand tick failed")
