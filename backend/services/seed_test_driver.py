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
    }
