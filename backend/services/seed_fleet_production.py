"""Production fleet seed — Phase B real data.

Goal: every Track A tenant (manufacturer + distributor + wholesaler) MUST
have a real, non-simulator fleet so the unified ``/fleet/*`` workspace is
never empty. The simulator continues to generate its own
``source="simulator"`` rows; this seed only touches manual/seed entities.

Per tenant we seed:

* **4 drivers**  — real Nigerian names, FRSC licence numbers, phones,
  ``employer_org_id`` set. Licence expiries spread across the 6 severity
  buckets so the Compliance Centre has live data.
* **4 vehicles** — Mercedes/MAN/Scania/Iveco trucks with real Nigerian
  state-plate registrations, insurance + roadworthiness + registration
  expiries spread across severity buckets, ``owner_org_id`` set,
  ``source="seed"``.

Idempotent — keyed by ``(employer_org_id, employee_number)`` for drivers
and ``(owner_org_id, registration_number)`` for vehicles. Re-running this
seed never duplicates.

Also performs a one-time **orphan vehicle migration**: any
``source∈{manual,seed}`` vehicle with ``owner_org_id=""`` is reassigned to
the primary Unilever tenant so it surfaces in their Fleet workspace.
"""
from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from core import db, logger, new_id


# ---------------------------------------------------------------------------
# Deterministic name / plate pools
# ---------------------------------------------------------------------------
DRIVER_FIRST_NAMES = [
    "Tunde", "Chinedu", "Musa", "Emeka", "Ifeanyi", "Yusuf", "Segun",
    "Hassan", "Damilola", "Olumide", "Kelechi", "Sani", "Gbenga", "Uche",
    "Femi", "Idris", "Adewale", "Obinna", "Kayode", "Babatunde", "Okechukwu",
    "Aliyu", "Chukwuma", "Olamide", "Akin", "Bashir", "Chibuzor", "Daniel",
    "Ebuka", "Fola", "Garba", "Henry", "Ikenna", "Joseph", "Lateef",
    "Mohammed", "Nnamdi", "Oluwasegun", "Peter", "Rasheed", "Samuel",
    "Taiwo", "Umar", "Victor", "Wale", "Yakubu",
]
DRIVER_LAST_NAMES = [
    "Okonkwo", "Adeyemi", "Bakare", "Eze", "Abubakar", "Adesina",
    "Nwosu", "Garba", "Olawale", "Obi", "Mohammed", "Ojo", "Kalu",
    "Bello", "Ajayi", "Ogunlade", "Okafor", "Adekunle", "Hassan",
    "Omotola", "Nwachukwu", "Anyanwu", "Lawal", "Ibrahim", "Salami",
    "Akinwale", "Owolabi", "Akpan", "Etim", "Effiong", "Odu",
    "Nwankwo", "Iwobi", "Ojukwu", "Ugwu", "Anyaegbu", "Onyema",
]
STATE_CODES = ["LAG", "ABJ", "KAN", "PHC", "IBD", "ENU", "OWE", "BEN",
               "WAR", "KAD", "SOK", "OND", "OYO", "ANB", "ABA"]
VEHICLE_MAKES = [
    ("Mercedes-Benz", "Actros 2645"),
    ("MAN", "TGS 33.480"),
    ("Scania", "G410"),
    ("Iveco", "Stralis 460"),
    ("Volvo", "FH 460"),
    ("DAF", "XF 480"),
    ("Howo", "T7H"),
    ("Sinotruk", "HOWO A7"),
]


def _seeded_random(seed: str) -> random.Random:
    """Deterministic RNG keyed on tenant_id so a re-run produces identical
    drivers + vehicles. We do not want flapping IDs between boots."""
    h = hashlib.sha256(seed.encode()).digest()
    return random.Random(int.from_bytes(h[:8], "big"))


def _spread_severity(idx: int, total: int) -> str:
    """Distribute fleet items across severity buckets so the Compliance
    Centre always has live rows. Even spread:
        25 % ok  | 20 % info | 20 % warning | 15 % high | 10 % critical | 10 % expired
    """
    p = idx / max(total - 1, 1)
    if p < 0.25:
        return "ok"
    if p < 0.45:
        return "info"
    if p < 0.65:
        return "warning"
    if p < 0.80:
        return "high"
    if p < 0.90:
        return "critical"
    return "expired"


def _expiry_iso_for_severity(severity: str, rng: random.Random) -> str:
    """Return a YYYY-MM-DD string within the bucket's calendar-day window."""
    today = datetime.now(timezone.utc).date()
    if severity == "expired":
        offset = -rng.randint(5, 120)
    elif severity == "critical":
        offset = rng.randint(1, 7)
    elif severity == "high":
        offset = rng.randint(8, 14)
    elif severity == "warning":
        offset = rng.randint(15, 30)
    elif severity == "info":
        offset = rng.randint(31, 90)
    else:  # ok
        offset = rng.randint(180, 540)
    return (today + timedelta(days=offset)).isoformat()


# ---------------------------------------------------------------------------
# Driver + vehicle builders
# ---------------------------------------------------------------------------
def _build_driver(
    tenant_id: str, tenant_type: str, idx: int, total: int,
    rng: random.Random, state_code: str,
) -> Dict[str, Any]:
    first = rng.choice(DRIVER_FIRST_NAMES)
    last = rng.choice(DRIVER_LAST_NAMES)
    severity = _spread_severity(idx, total)
    licence_expiry = _expiry_iso_for_severity(severity, rng)
    suffix = tenant_id[:6].upper()
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": new_id(),
        "employee_number": f"DRV-{suffix}-{idx+1:03d}",
        "first_name": first,
        "last_name": last,
        "full_name": f"{first} {last}",
        "phone": f"+23480{rng.randint(30000000, 89999999)}",
        "email": None,
        "licence_number": f"FRSC-{state_code}-{rng.randint(10000, 99999)}",
        "licence_class": rng.choice(["C", "D", "E"]),
        "licence_expiry": licence_expiry,
        "employer_org_id": tenant_id,
        "employer_org_type": tenant_type,
        "home_warehouse_id": None,
        "status": rng.choice(["available", "available", "available", "offline"]),
        "assigned_vehicle_id": None,
        "assigned_shipment_id": None,
        "user_id": "",
        "invited_at": now,
        "claimed_at": None,
        "last_login_at": None,
        "deliveries_30d": 0,
        "on_time_pct_30d": None,
        "avg_pod_time_min": None,
        "last_seen_at": None,
        "is_active": True,
        "deactivated_at": None,
        "deactivation_reason": None,
        "created_at": now,
        "updated_at": now,
        "schema_version": 2,
        "active_trip_count": 0,
        "failed_delivery_count": 0,
        "source": "seed",
    }


def _build_vehicle(
    tenant_id: str, tenant_type: str, idx: int, total: int,
    rng: random.Random, state_code: str,
) -> Dict[str, Any]:
    make, model = rng.choice(VEHICLE_MAKES)
    sev_ins = _spread_severity(idx, total)
    sev_rwc = _spread_severity((idx + 2) % total, total)
    sev_reg = _spread_severity((idx + 4) % total, total)
    suffix = tenant_id[:6].upper()
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": new_id(),
        "vehicle_code": f"TK-{suffix}-V{idx+1:03d}",
        "registration_number": f"{state_code}-{suffix}-{idx+1:03d}",
        "vehicle_type": "truck",
        "make": make,
        "model": model,
        "year": rng.choice([2019, 2020, 2021, 2022, 2023]),
        "colour": rng.choice(["White", "Blue", "Red", "Silver"]),
        "capacity_units": rng.choice([800, 1000, 1200, 1500]),
        "capacity_weight_kg": float(rng.choice([12000, 15000, 18000, 22000])),
        "owner_org_id": tenant_id,
        "owner_org_type": tenant_type,
        "home_warehouse_id": None,
        "status": rng.choice(["available", "available", "available", "maintenance"]),
        "current_driver_id": None,
        "current_shipment_id": None,
        "current_route_id": None,
        "odometer_km": rng.randint(20000, 250000),
        "fuel_pct": float(rng.randint(40, 100)),
        "last_lat": None,
        "last_lng": None,
        "last_position_at": None,
        "last_service_at": (date.today() - timedelta(days=rng.randint(5, 90))).isoformat(),
        "next_service_due_km": rng.randint(50000, 300000),
        "insurance_expiry": _expiry_iso_for_severity(sev_ins, rng),
        "roadworthiness_expiry": _expiry_iso_for_severity(sev_rwc, rng),
        "registration_expiry": _expiry_iso_for_severity(sev_reg, rng),
        "is_active": True,
        "decommissioned_at": None,
        "source": "seed",
        "created_at": now,
        "updated_at": now,
        "schema_version": 2,
        "assigned_driver_id": None,
        "trips_30d": 0,
        "utilization_pct": 0.0,
        "idle_pct": 100.0,
        "distance_km_30d": 0.0,
        "on_time_delivery_pct": None,
    }


# ---------------------------------------------------------------------------
# Per-tenant upsert
# ---------------------------------------------------------------------------
async def _seed_tenant(
    tenant_id: str, tenant_type: str, name: str,
    target_drivers: int, target_vehicles: int,
) -> Dict[str, int]:
    counter = {"drivers_created": 0, "drivers_existing": 0,
               "vehicles_created": 0, "vehicles_existing": 0}
    rng = _seeded_random(f"fleet::{tenant_type}::{tenant_id}")
    state_code = rng.choice(STATE_CODES)

    existing_real_drivers = await db.drivers.count_documents({
        "employer_org_id": tenant_id, "is_active": True,
        "source": {"$in": ["seed", "manual", None]},
    })
    drivers_to_add = max(0, target_drivers - existing_real_drivers)

    existing_real_vehicles = await db.vehicles.count_documents({
        "owner_org_id": tenant_id, "is_active": True,
        "source": {"$in": ["seed", "manual"]},
    })
    vehicles_to_add = max(0, target_vehicles - existing_real_vehicles)

    counter["drivers_existing"] = existing_real_drivers
    counter["vehicles_existing"] = existing_real_vehicles

    # ---- Drivers --------------------------------------------------------
    for i in range(drivers_to_add):
        idx = existing_real_drivers + i
        doc = _build_driver(tenant_id, tenant_type, idx, target_drivers,
                            rng, state_code)
        # Honour the unique key (employer_org_id, employee_number) — if a
        # row already exists with that employee_number we leave it alone.
        already = await db.drivers.find_one(
            {"employer_org_id": tenant_id,
             "employee_number": doc["employee_number"]},
            {"_id": 0, "id": 1},
        )
        if already:
            continue
        await db.drivers.insert_one(doc)
        counter["drivers_created"] += 1

    # ---- Vehicles -------------------------------------------------------
    for i in range(vehicles_to_add):
        idx = existing_real_vehicles + i
        doc = _build_vehicle(tenant_id, tenant_type, idx, target_vehicles,
                             rng, state_code)
        already = await db.vehicles.find_one(
            {"owner_org_id": tenant_id,
             "registration_number": doc["registration_number"]},
            {"_id": 0, "id": 1},
        )
        if already:
            continue
        await db.vehicles.insert_one(doc)
        counter["vehicles_created"] += 1

    return counter


# ---------------------------------------------------------------------------
# Orphan migration
# ---------------------------------------------------------------------------
async def _migrate_orphans() -> int:
    """Reassign manual/seed vehicles with empty owner_org_id to the primary
    manufacturer tenant so they surface in some Fleet workspace. Returns
    the number of rows updated."""
    primary = await db.manufacturers.find_one(
        {"name": {"$regex": "Unilever", "$options": "i"}},
        {"_id": 0, "id": 1},
    )
    if not primary:
        primary = await db.manufacturers.find_one({}, {"_id": 0, "id": 1})
    if not primary:
        return 0
    res = await db.vehicles.update_many(
        {"source": {"$in": ["manual", "seed"]},
         "$or": [{"owner_org_id": ""}, {"owner_org_id": None}]},
        {"$set": {"owner_org_id": primary["id"],
                  "owner_org_type": "manufacturer",
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return res.modified_count or 0


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
async def seed_fleet_production() -> Dict[str, Any]:
    """Idempotent production fleet seeder.

    Returns per-tenant counters of created/existing drivers and vehicles.
    Cheap and safe to call on every boot — only inserts rows that are
    missing, never updates existing live records.
    """
    summary: Dict[str, Any] = {
        "manufacturers": [],
        "distributors": [],
        "wholesalers": [],
        "orphans_migrated": 0,
        "totals": {"drivers_created": 0, "vehicles_created": 0},
    }

    # 1. Migrate orphan vehicles before counting existing rows
    summary["orphans_migrated"] = await _migrate_orphans()

    # 2. Manufacturers — 4 drivers + 4 vehicles
    async for m in db.manufacturers.find({}, {"_id": 0, "id": 1, "name": 1}):
        r = await _seed_tenant(m["id"], "manufacturer", m.get("name") or "",
                               target_drivers=4, target_vehicles=4)
        summary["manufacturers"].append({"id": m["id"], "name": m.get("name"), **r})
        summary["totals"]["drivers_created"] += r["drivers_created"]
        summary["totals"]["vehicles_created"] += r["vehicles_created"]

    # 3. Distributors — 4 drivers + 4 vehicles
    async for d in db.distributors.find({}, {"_id": 0, "id": 1, "name": 1}):
        r = await _seed_tenant(d["id"], "distributor", d.get("name") or "",
                               target_drivers=4, target_vehicles=4)
        summary["distributors"].append({"id": d["id"], "name": d.get("name"), **r})
        summary["totals"]["drivers_created"] += r["drivers_created"]
        summary["totals"]["vehicles_created"] += r["vehicles_created"]

    # 4. Wholesalers — 3 drivers + 3 vehicles (smaller fleets, more focused)
    async for w in db.wholesalers.find({}, {"_id": 0, "id": 1, "name": 1}):
        r = await _seed_tenant(w["id"], "wholesaler", w.get("name") or "",
                               target_drivers=3, target_vehicles=3)
        summary["wholesalers"].append({"id": w["id"], "name": w.get("name"), **r})
        summary["totals"]["drivers_created"] += r["drivers_created"]
        summary["totals"]["vehicles_created"] += r["vehicles_created"]

    if summary["totals"]["drivers_created"] or summary["totals"]["vehicles_created"]:
        logger.info("Fleet production seed: %s drivers, %s vehicles created (orphans migrated: %s)",
                    summary["totals"]["drivers_created"],
                    summary["totals"]["vehicles_created"],
                    summary["orphans_migrated"])

    # 5. Compute compliance + KPIs so newly-seeded rows are immediately
    # categorised in the buckets shown by the Compliance Centre.
    try:
        from services.fleet_compliance import (
            job_driver_kpis, job_vehicle_kpis, job_compliance_check,
        )
        await job_driver_kpis()
        await job_vehicle_kpis()
        await job_compliance_check()
    except Exception:
        logger.exception("Compliance recompute after fleet seed failed (continuing)")

    return summary
