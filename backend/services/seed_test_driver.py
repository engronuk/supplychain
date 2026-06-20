"""Idempotent test-driver seed for Track A end-to-end validation.

Creates / repairs the canonical Track A test driver:

    email:          adaeze.w0+26275@tradekonekt.io
    driver_code:    DRV-W0-11542
    role:           driver
    password:       <DEMO_PASSWORD> env (shared with the other demo accounts)

Run on every backend boot — safe and idempotent:

* If the User row is missing → insert it with a bcrypt password hash.
* If the User row exists but ``must_change_password`` is still True or the
  password hash is empty/invalid → overwrite it so login works without an
  invitation-claim round-trip.
* If the Driver row is missing → insert it linked to the first manufacturer
  org in the DB.
* If the Driver row exists → leave the operational fields
  (``status``, ``assigned_*``, location, KPIs) untouched.

This unblocks the Track A team from having to re-run the invitation /
claim flow in production. The chosen email + driver_code match the values
already documented in ``DRIVER_MOBILE_DEPLOYMENT.md``.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from core import db, logger, new_id
from services.auth import hash_password, verify_password


TEST_DRIVER_EMAIL = "adaeze.w0+26275@tradekonekt.io"
TEST_DRIVER_CODE = "DRV-W0-11542"
TEST_DRIVER_NAME = ("Adaeze", "Ibe")
TEST_DRIVER_PHONE = "+2348038888888"
TEST_DRIVER_LICENCE = "FRSC-W0-001"
TEST_DRIVER_LICENCE_CLASS = "E"

# Starter vehicle paired with the test driver. Stable values so the seed is
# idempotent across boots — collision-detected by ``(owner_org_id,
# registration_number)`` which is the unique constraint in routes/vehicles.py.
TEST_VEHICLE_REGISTRATION = "LAG-W0-001"
TEST_VEHICLE_CODE = "TK-W0-V001"
TEST_VEHICLE_MAKE = "Mercedes-Benz"
TEST_VEHICLE_MODEL = "Actros 2645"
TEST_VEHICLE_YEAR = 2022
TEST_VEHICLE_COLOUR = "White"
TEST_VEHICLE_CAPACITY_UNITS = 1000
TEST_VEHICLE_CAPACITY_KG = 15000.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _pick_manufacturer_org() -> Optional[dict]:
    """Pick the first manufacturer to employ the test driver."""
    return await db.manufacturers.find_one(
        {}, {"_id": 0, "id": 1, "name": 1},
    )


async def seed_test_driver() -> dict:
    """Insert or repair the canonical Track A test driver. Idempotent."""
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        return {"skipped": True, "reason": "DEMO_PASSWORD env not set"}

    mfr = await _pick_manufacturer_org()
    if not mfr:
        return {"skipped": True, "reason": "No manufacturer in DB yet"}

    now = _now_iso()
    pwd_hash = hash_password(password)

    # ---- 1. Driver row -------------------------------------------------
    drv = await db.drivers.find_one(
        {"$or": [{"email": TEST_DRIVER_EMAIL},
                 {"employee_number": TEST_DRIVER_CODE}]},
        {"_id": 0},
    )
    driver_action = "exists"
    if not drv:
        driver_id = new_id()
        drv_doc = {
            "id": driver_id,
            "employee_number": TEST_DRIVER_CODE,
            "first_name": TEST_DRIVER_NAME[0],
            "last_name": TEST_DRIVER_NAME[1],
            "full_name": " ".join(TEST_DRIVER_NAME),
            "phone": TEST_DRIVER_PHONE,
            "email": TEST_DRIVER_EMAIL,
            "licence_number": TEST_DRIVER_LICENCE,
            "licence_class": TEST_DRIVER_LICENCE_CLASS,
            "licence_expiry": None,
            "employer_org_id": mfr["id"],
            "employer_org_type": "manufacturer",
            "home_warehouse_id": None,
            "status": "available",
            "assigned_vehicle_id": None,
            "assigned_shipment_id": None,
            "user_id": "",                          # backfilled after user insert
            "invited_at": now,
            "claimed_at": now,
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
            "source": "seed",
        }
        await db.drivers.insert_one(drv_doc)
        drv = drv_doc
        driver_action = "created"

    # ---- 2. User row ---------------------------------------------------
    user = await db.users.find_one({"email": TEST_DRIVER_EMAIL}, {"_id": 0})
    user_action = "exists"

    if not user:
        user_id = new_id()
        await db.users.insert_one({
            "id": user_id,
            "email": TEST_DRIVER_EMAIL,
            "name": " ".join(TEST_DRIVER_NAME),
            "role": "driver",
            "entity_id": drv["id"],
            "entity_type": "driver",
            "manufacturer_id": mfr["id"],
            "password_hash": pwd_hash,
            "status": "active",
            "must_change_password": False,
            "is_demo": True,
            "created_at": now,
            "updated_at": now,
        })
        await db.drivers.update_one(
            {"id": drv["id"]},
            {"$set": {"user_id": user_id, "claimed_at": now, "updated_at": now}},
        )
        user_action = "created"
    else:
        # Repair: ensure the user can log in with DEMO_PASSWORD even if
        # the row was left in the invitation state (must_change_password=true)
        # or carries a stale hash from a different password.
        needs_repair = bool(
            user.get("must_change_password")
            or not user.get("password_hash")
            or not verify_password(password, user.get("password_hash") or "")
            or user.get("status") != "active"
            or user.get("role") != "driver"
            or user.get("entity_id") != drv["id"]
        )
        if needs_repair:
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {
                    "password_hash": pwd_hash,
                    "status": "active",
                    "role": "driver",
                    "entity_id": drv["id"],
                    "entity_type": "driver",
                    "manufacturer_id": mfr["id"],
                    "must_change_password": False,
                    "updated_at": now,
                }},
            )
            # Make sure driver.user_id is in sync
            if drv.get("user_id") != user["id"]:
                await db.drivers.update_one(
                    {"id": drv["id"]},
                    {"$set": {"user_id": user["id"], "claimed_at": now,
                              "updated_at": now}},
                )
            user_action = "repaired"

    return {
        "driver_email": TEST_DRIVER_EMAIL,
        "driver_code": TEST_DRIVER_CODE,
        "manufacturer": mfr.get("name"),
        "driver": driver_action,
        "user": user_action,
        "vehicle": await _seed_test_vehicle(mfr["id"], drv),
    }


async def _seed_test_vehicle(owner_org_id: str, drv: dict) -> str:
    """Ensure a starter vehicle exists for the test driver. Idempotent.

    The vehicle is *not* pre-bound to the driver — the canonical 8-state
    lifecycle binds driver + vehicle together on ``POST
    /api/shipments/{id}/assign``. We only need the row to exist with
    ``status="available"`` in the same fleet so the assign endpoint will
    accept it. If it's already there and currently `available` we leave it
    alone; if it's been left in a non-terminal busy state pointing at a
    delivered/cancelled shipment, we free it (defensive cleanup that
    mirrors the v2 cascade migration).
    """
    now = _now_iso()

    veh = await db.vehicles.find_one(
        {"owner_org_id": owner_org_id,
         "registration_number": TEST_VEHICLE_REGISTRATION},
        {"_id": 0},
    )

    if not veh:
        veh_doc = {
            "id": new_id(),
            "vehicle_code": TEST_VEHICLE_CODE,
            "registration_number": TEST_VEHICLE_REGISTRATION,
            "vehicle_type": "truck",
            "make": TEST_VEHICLE_MAKE,
            "model": TEST_VEHICLE_MODEL,
            "year": TEST_VEHICLE_YEAR,
            "colour": TEST_VEHICLE_COLOUR,
            "capacity_units": TEST_VEHICLE_CAPACITY_UNITS,
            "capacity_weight_kg": TEST_VEHICLE_CAPACITY_KG,
            "owner_org_id": owner_org_id,
            "owner_org_type": "manufacturer",
            "home_warehouse_id": None,
            "status": "available",
            "current_driver_id": None,
            "current_shipment_id": None,
            "current_route_id": None,
            "odometer_km": 0,
            "fuel_pct": 100.0,
            "last_lat": None,
            "last_lng": None,
            "last_position_at": None,
            "last_service_at": None,
            "next_service_due_km": None,
            "insurance_expiry": None,
            "roadworthiness_expiry": None,
            "is_active": True,
            "decommissioned_at": None,
            "source": "seed",
            "created_at": now,
            "updated_at": now,
            "schema_version": 2,
        }
        await db.vehicles.insert_one(veh_doc)
        return "created"

    # Already exists — repair only if it's wedged on a terminal shipment.
    needs_repair = False
    if veh.get("current_shipment_id"):
        linked = await db.shipments.find_one(
            {"id": veh["current_shipment_id"]},
            {"_id": 0, "status": 1},
        )
        if not linked or linked.get("status") in ("delivered", "cancelled"):
            needs_repair = True
    if veh.get("status") not in ("available", "maintenance", "in_transit",
                                  "loading", "offline"):
        needs_repair = True
    if not veh.get("is_active"):
        needs_repair = True

    if needs_repair:
        await db.vehicles.update_one(
            {"id": veh["id"]},
            {"$set": {
                "status": "available",
                "current_shipment_id": None,
                "current_driver_id": None,
                "current_route_id": None,
                "is_active": True,
                "updated_at": now,
            }},
        )
        return "repaired"
    return "exists"
