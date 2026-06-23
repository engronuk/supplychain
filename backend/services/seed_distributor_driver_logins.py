"""Pre-claim one driver login per distributor for mobile-app smoke testing.

After ``seed_fleet_production.py`` plants 4 drivers per distributor, this
helper picks ONE of them per tenant and turns it into a real user account
that can authenticate against `/api/auth/login` with `DEMO_PASSWORD`. The
result: 12 distributor driver logins (one per distributor) the mobile QA
team can use in parallel — no more single-threading on Adaeze.

Email pattern: ``driver-{distributor_id_short}@tradekonekt.io``
  → e.g. Apex Distributors → ``driver-f9dfaf08@tradekonekt.io``

Idempotent:
* If the user row already exists with a valid password and is linked to a
  driver → no-op.
* If the user row is missing → insert.
* If the user row exists but the password hash drifted or the driver
  link is stale → repair.

Returns a list of ``{distributor, email, driver_id, action}`` rows for
logging + audit. The full credential list is exposed via
``/api/_admin/distributor-driver-logins`` (super-admin-only) so QA can
fetch the latest list without grepping logs.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core import db, logger, new_id
from services.auth import hash_password, verify_password


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _driver_email(distributor_id: str) -> str:
    return f"driver-{distributor_id[:8]}@tradekonekt.io"


async def _pick_driver_for_distributor(distributor_id: str) -> Optional[Dict[str, Any]]:
    """Pick the first seeded driver for this distributor (deterministic —
    sort by employee_number so re-runs always pick the same row)."""
    cursor = db.drivers.find(
        {"employer_org_id": distributor_id, "is_active": True,
         "source": {"$in": ["seed", "manual"]}},
        {"_id": 0},
    ).sort("employee_number", 1).limit(1)
    async for d in cursor:
        return d
    return None


async def _claim_one(distributor: Dict[str, Any], password: str,
                    pwd_hash: str) -> Dict[str, Any]:
    drv = await _pick_driver_for_distributor(distributor["id"])
    if not drv:
        return {"distributor": distributor.get("name"),
                "skipped": True, "reason": "no seeded driver"}

    email = _driver_email(distributor["id"])
    now = _now_iso()
    manufacturer_id = distributor.get("manufacturer_id")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if not existing:
        user_id = new_id()
        await db.users.insert_one({
            "id": user_id,
            "email": email,
            "name": drv.get("full_name") or "Driver",
            "role": "driver",
            "entity_id": drv["id"],
            "entity_type": "driver",
            "manufacturer_id": manufacturer_id,
            "distributor_id": distributor["id"],
            "password_hash": pwd_hash,
            "status": "active",
            "must_change_password": False,
            "is_demo": True,
            "created_at": now,
            "updated_at": now,
        })
        await db.drivers.update_one(
            {"id": drv["id"]},
            {"$set": {"user_id": user_id, "claimed_at": now,
                      "updated_at": now}},
        )
        return {"distributor": distributor.get("name"),
                "distributor_id": distributor["id"],
                "email": email, "driver_id": drv["id"],
                "driver_code": drv.get("employee_number"),
                "action": "created"}

    # Repair stale rows so login keeps working across boots
    needs_repair = bool(
        existing.get("must_change_password")
        or not existing.get("password_hash")
        or not verify_password(password, existing.get("password_hash") or "")
        or existing.get("status") != "active"
        or existing.get("role") != "driver"
        or existing.get("entity_id") != drv["id"]
    )
    if needs_repair:
        await db.users.update_one(
            {"id": existing["id"]},
            {"$set": {
                "password_hash": pwd_hash,
                "status": "active",
                "role": "driver",
                "entity_id": drv["id"],
                "entity_type": "driver",
                "manufacturer_id": manufacturer_id,
                "distributor_id": distributor["id"],
                "must_change_password": False,
                "updated_at": now,
            }},
        )
        if drv.get("user_id") != existing["id"]:
            await db.drivers.update_one(
                {"id": drv["id"]},
                {"$set": {"user_id": existing["id"], "claimed_at": now,
                          "updated_at": now}},
            )
        return {"distributor": distributor.get("name"),
                "distributor_id": distributor["id"],
                "email": email, "driver_id": drv["id"],
                "driver_code": drv.get("employee_number"),
                "action": "repaired"}

    # Already healthy — but ensure driver row carries the user_id link.
    if drv.get("user_id") != existing["id"]:
        await db.drivers.update_one(
            {"id": drv["id"]},
            {"$set": {"user_id": existing["id"], "updated_at": now}},
        )
    return {"distributor": distributor.get("name"),
            "distributor_id": distributor["id"],
            "email": email, "driver_id": drv["id"],
            "driver_code": drv.get("employee_number"),
            "action": "exists"}


async def seed_distributor_driver_logins() -> Dict[str, Any]:
    """Idempotently mint one driver login per distributor.

    Reads ``DEMO_PASSWORD`` from env. Returns a summary with one row per
    distributor including the email QA can use to log in.
    """
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        return {"skipped": True, "reason": "DEMO_PASSWORD env not set",
                "rows": []}

    pwd_hash = hash_password(password)
    rows: List[Dict[str, Any]] = []
    created = repaired = 0
    async for d in db.distributors.find(
        {}, {"_id": 0, "id": 1, "name": 1, "manufacturer_id": 1},
    ):
        row = await _claim_one(d, password, pwd_hash)
        rows.append(row)
        if row.get("action") == "created":
            created += 1
        elif row.get("action") == "repaired":
            repaired += 1

    if created or repaired:
        logger.info("Distributor driver logins seed: created=%s repaired=%s",
                    created, repaired)

    return {"rows": rows, "created": created, "repaired": repaired,
            "total": len(rows)}
