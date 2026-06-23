"""Active-shipments demo seed — makes Fleet Status feel alive.

For every distributor that already has a seeded production fleet (4
drivers + 4 vehicles per `seed_fleet_production.py`), this seeder
inserts 3 demo shipments so their Logistics Command Center →
Fleet Status panel always shows live activity:

* 1 × ``status=created``          (in the Dispatch unassigned queue)
* 1 × ``status=assigned``         (driver + vehicle assigned, not loaded)
* 1 × ``status=in_transit``       (actively moving — shows in Active stream)

Each shipment is destination-routed to one of that distributor's
downstream retailers (or a wholesaler org under it) so the
``from_role=distributor / to_role=retailer`` leg is realistic.

Idempotent — keyed on ``(owner_org_id, source="fleet_demo_v1")``. If the
distributor already has the expected 3 demo shipments, the seeder is a
no-op. Re-running never duplicates rows or corrupts driver/vehicle
assignments.

Run on every boot via the production path in ``server.py`` (after the
fleet production seed).
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from core import db, logger, new_id

DEMO_TAG = "fleet_demo_v1"
DEMO_PER_DISTRIBUTOR = 3   # created + assigned + in_transit
TARGET_STATUSES = ("created", "assigned", "in_transit")


def _seeded_random(seed: str) -> random.Random:
    h = hashlib.sha256(seed.encode()).digest()
    return random.Random(int.from_bytes(h[:8], "big"))


def _delivery_code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


async def _pick_destinations(distributor_id: str, rng: random.Random) -> List[Dict[str, Any]]:
    """Return up to 3 downstream destinations for this distributor.
    Prefers retailers, falls back to wholesaler orgs."""
    out: List[Dict[str, Any]] = []
    async for r in db.retailers.find(
        {"distributor_id": distributor_id},
        {"_id": 0, "id": 1, "name": 1, "city": 1},
    ).limit(8):
        out.append({"to_role": "retailer", "to_id": r["id"],
                    "to_name": r.get("name"), "to_city": r.get("city")})
    if len(out) < 3:
        async for o in db.organizations.find(
            {"organization_type": "wholesaler",
             "parent_organization_id": distributor_id},
            {"_id": 0, "id": 1, "name": 1},
        ).limit(8 - len(out)):
            out.append({"to_role": "wholesaler", "to_id": o["id"],
                        "to_name": o.get("name"), "to_city": ""})
    if not out:
        # Final fallback — any retailer in the same manufacturer's network.
        async for r in db.retailers.find({}, {"_id": 0, "id": 1, "name": 1, "city": 1}).limit(3):
            out.append({"to_role": "retailer", "to_id": r["id"],
                        "to_name": r.get("name"), "to_city": r.get("city")})
    rng.shuffle(out)
    return out[:3]


async def _pick_products(manufacturer_id: str, rng: random.Random) -> List[Dict[str, Any]]:
    rows = await db.products.find(
        {"manufacturer_id": manufacturer_id},
        {"_id": 0, "id": 1, "name": 1, "price": 1, "case_size": 1},
    ).limit(20).to_list(20)
    if not rows:
        return []
    rng.shuffle(rows)
    return rows[:3]


async def _build_shipment(
    distributor: Dict[str, Any], manufacturer_id: str, dest: Dict[str, Any],
    status: str, driver: Optional[Dict[str, Any]], vehicle: Optional[Dict[str, Any]],
    products: List[Dict[str, Any]], rng: random.Random,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    created_at = now - timedelta(hours=rng.randint(1, 18))
    items: List[Dict[str, Any]] = []
    total_units = 0
    total_value = 0.0
    for p in products[: rng.randint(1, len(products) or 1)]:
        qty = rng.choice([10, 20, 40, 80])
        unit_price = float(p.get("price") or 1500.0)
        gross = qty * unit_price
        items.append({
            "product_id": p["id"],
            "product_name": p.get("name"),
            "quantity_units": qty,
            "unit_price": unit_price,
            "gross_value": gross,
            "discount_value": 0.0,
            "net_value": gross,
        })
        total_units += qty
        total_value += gross

    delivery_code = f"{rng.randint(1000, 9999)}"
    eta = (now + timedelta(hours=rng.randint(4, 18))).isoformat()
    shp_id = new_id()
    status_history = [{
        "from_status": None, "to_status": "created",
        "at": created_at.isoformat(),
        "by_user_id": None, "by_role": "system",
        "notes": "seed: fleet_demo_v1",
    }]
    arrived_at = None
    delivered_at = None
    loaded_at = None
    if status in ("assigned", "in_transit"):
        status_history.append({
            "from_status": "created", "to_status": "assigned",
            "at": (created_at + timedelta(minutes=10)).isoformat(),
            "driver_id": driver["id"] if driver else None,
            "vehicle_id": vehicle["id"] if vehicle else None,
            "by_role": "system", "notes": "seed: auto-assigned",
        })
    if status == "in_transit":
        loaded_at = (created_at + timedelta(minutes=25)).isoformat()
        status_history.append({
            "from_status": "assigned", "to_status": "loaded",
            "at": loaded_at,
            "by_role": "driver", "notes": "seed: loaded",
        })
        status_history.append({
            "from_status": "loaded", "to_status": "in_transit",
            "at": (created_at + timedelta(minutes=30)).isoformat(),
            "by_role": "driver", "notes": "seed: in transit",
        })

    return {
        "id": shp_id,
        "owner_org_id": distributor["id"],
        "manufacturer_id": manufacturer_id,
        "from_role": "distributor",
        "from_id": distributor["id"],
        "from_name": distributor.get("name") or "Distributor",
        "to_role": dest["to_role"],
        "to_id": dest["to_id"],
        "to_name": dest.get("to_name") or dest["to_role"].title(),
        "to_city": dest.get("to_city") or "",
        "status": status,
        "driver_id": driver["id"] if driver else None,
        "vehicle_id": vehicle["id"] if vehicle else None,
        "items": items,
        "total_units": total_units,
        "total_value": round(total_value, 2),
        "delivery_code_hash": _delivery_code_hash(delivery_code),
        "delivery_code_attempts": 0,
        "eta": eta,
        "created_at": created_at.isoformat(),
        "updated_at": now.isoformat(),
        "loaded_at": loaded_at,
        "arrived_at": arrived_at,
        "delivered_at": delivered_at,
        "status_history": status_history,
        "source": DEMO_TAG,
        "schema_version": 2,
    }


async def _seed_distributor(distributor: Dict[str, Any]) -> Dict[str, int]:
    counter = {"created": 0, "assigned": 0, "in_transit": 0, "skipped": 0}
    rng = _seeded_random(f"shp::{DEMO_TAG}::{distributor['id']}")

    manufacturer_id = distributor.get("manufacturer_id")
    if not manufacturer_id:
        counter["skipped"] += 1
        return counter

    destinations = await _pick_destinations(distributor["id"], rng)
    products = await _pick_products(manufacturer_id, rng)
    if not destinations or not products:
        counter["skipped"] += 1
        return counter

    # Pick this distributor's seeded drivers + vehicles
    drivers = await db.drivers.find(
        {"employer_org_id": distributor["id"], "is_active": True,
         "source": {"$in": ["seed", "manual", None]}},
        {"_id": 0, "id": 1, "full_name": 1, "status": 1,
         "assigned_shipment_id": 1, "assigned_vehicle_id": 1},
    ).limit(8).to_list(8)
    vehicles = await db.vehicles.find(
        {"owner_org_id": distributor["id"], "is_active": True,
         "source": {"$in": ["seed", "manual"]}},
        {"_id": 0, "id": 1, "vehicle_code": 1, "status": 1,
         "current_shipment_id": 1, "current_driver_id": 1},
    ).limit(8).to_list(8)

    if len(drivers) < 2 or len(vehicles) < 2:
        counter["skipped"] += 1
        return counter

    # Existing demo shipments? Skip if we already have the target set
    existing_by_status: Dict[str, int] = {}
    async for r in db.shipments.aggregate([
        {"$match": {"owner_org_id": distributor["id"], "source": DEMO_TAG}},
        {"$group": {"_id": "$status", "n": {"$sum": 1}}},
    ]):
        existing_by_status[r["_id"]] = r["n"]

    used_drivers: set = set()
    used_vehicles: set = set()

    # Re-use driver/vehicle pairs for assigned/in_transit. Each pair must
    # not be busy on a non-demo shipment to keep the simulator guard happy.
    def _pick_pair() -> Optional[tuple]:
        free_drv = [d for d in drivers if d["id"] not in used_drivers and
                    d.get("status") in (None, "available", "offline")]
        free_veh = [v for v in vehicles if v["id"] not in used_vehicles and
                    v.get("status") in (None, "available", "offline", "maintenance")]
        if not free_drv or not free_veh:
            return None
        d = rng.choice(free_drv)
        v = rng.choice(free_veh)
        used_drivers.add(d["id"])
        used_vehicles.add(v["id"])
        return d, v

    for i, status in enumerate(TARGET_STATUSES):
        if existing_by_status.get(status, 0) >= 1:
            continue
        dest = destinations[i % len(destinations)]
        driver: Optional[Dict[str, Any]] = None
        vehicle: Optional[Dict[str, Any]] = None
        if status in ("assigned", "in_transit"):
            pair = _pick_pair()
            if not pair:
                # Out of free drivers/vehicles — fall back to created status
                status = "created"
            else:
                driver, vehicle = pair

        doc = await _build_shipment(distributor, manufacturer_id, dest, status,
                                    driver, vehicle, products, rng)
        await db.shipments.insert_one(doc)
        counter[status] += 1

        # Flip driver + vehicle to busy state so downstream views agree.
        if driver and vehicle:
            new_drv_status = "on_trip" if status == "in_transit" else "assigned"
            new_veh_status = "in_transit" if status == "in_transit" else "loading"
            await db.drivers.update_one(
                {"id": driver["id"]},
                {"$set": {
                    "status": new_drv_status,
                    "assigned_shipment_id": doc["id"],
                    "assigned_vehicle_id": vehicle["id"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )
            await db.vehicles.update_one(
                {"id": vehicle["id"]},
                {"$set": {
                    "status": new_veh_status,
                    "current_shipment_id": doc["id"],
                    "current_driver_id": driver["id"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }},
            )

    return counter


async def seed_active_shipments() -> Dict[str, Any]:
    """Idempotent active-shipments demo seed. Returns per-distributor counters."""
    summary: Dict[str, Any] = {
        "distributors": [],
        "totals": {"created": 0, "assigned": 0, "in_transit": 0},
    }
    async for d in db.distributors.find({}, {"_id": 0, "id": 1, "name": 1, "manufacturer_id": 1}):
        r = await _seed_distributor(d)
        summary["distributors"].append({"id": d["id"], "name": d.get("name"), **r})
        for k in ("created", "assigned", "in_transit"):
            summary["totals"][k] += r.get(k, 0)

    total_new = sum(summary["totals"].values())
    if total_new:
        logger.info("Active-shipments demo seed: %s", summary["totals"])
    return summary
