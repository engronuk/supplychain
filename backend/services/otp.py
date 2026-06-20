"""OTP-based proof-of-delivery — generation, verification, audit.

- 4-digit numeric code.
- bcrypt at rest (cost 10).
- Clear-text only in the receiver's in-app notification (per locked decision).
- 7-day expiry (OTP_TTL_DAYS env var; default 7).
- 5-attempt lock-out per shipment, 10-minute cooldown.
- Every event mirrored to db.shipment_otp_audit.
"""
from __future__ import annotations

import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException

from core import db, now_iso
from services.auth import hash_password, verify_password

OTP_TTL_DAYS = int(os.environ.get("OTP_TTL_DAYS", "7"))
OTP_MAX_ATTEMPTS = int(os.environ.get("OTP_MAX_ATTEMPTS", "5"))
OTP_LOCK_MIN = int(os.environ.get("OTP_LOCK_MIN", "10"))
OTP_LENGTH = 4


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expiry_iso() -> str:
    return (_now() + timedelta(days=OTP_TTL_DAYS)).isoformat()


def _generate_code() -> str:
    """4-digit zero-padded code from a CSPRNG (secrets)."""
    return str(secrets.randbelow(10 ** OTP_LENGTH)).zfill(OTP_LENGTH)


async def _write_audit(shipment_id: str, owner_org_id: str, event: str,
                       by_user_id: Optional[str], by_role: Optional[str]) -> None:
    await db.shipment_otp_audit.insert_one({
        "id": str(uuid.uuid4()),
        "shipment_id": shipment_id,
        "owner_org_id": owner_org_id,
        "event": event,
        "by_user_id": by_user_id,
        "by_role": by_role,
        "attempt_value_hint": None,           # never store attempted values
        "created_at": now_iso(),
    })


async def _notify_receiver(shp: Dict[str, Any], code: str, expires_at: str) -> int:
    """Write one notification per active user of the receiver org with the
    clear-text code. Returns the number of notifications created."""
    to_id = shp.get("to_id") or ""
    to_role = shp.get("to_role") or ""
    if not to_id:
        return 0

    # find active users for the receiver org
    cursor = db.users.find(
        {"entity_id": to_id, "role": {"$in": [to_role, "distributor", "wholesaler", "retailer", "manufacturer"]},
         "status": {"$ne": "locked"}},
        {"_id": 0, "id": 1, "role": 1, "entity_id": 1},
    )
    items_summary = ""
    items = shp.get("items") or []
    if items:
        units = sum(int(it.get("quantity") or 0) for it in items)
        items_summary = f"{units} units · {len(items)} SKUs"

    payload = {
        "shipment_id": shp["id"],
        "tracking_code": shp.get("tracking_code"),
        "delivery_code": code,
        "expires_at": expires_at,
        "items_summary": items_summary,
    }

    count = 0
    async for u in cursor:
        await db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "target_type": to_role,
            "target_id": to_id,
            "target_user_id": u["id"],
            "title": f"Delivery code for {shp.get('tracking_code') or 'shipment'}",
            "message": f"Your delivery code is {code}. Give this to the driver on arrival.",
            "type": "delivery_code",
            "severity": "info",
            "payload": payload,
            "read": False,
            "created_at": now_iso(),
        })
        count += 1

    # belt-and-braces: also a notification on the org row itself (no user)
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "target_type": to_role,
        "target_id": to_id,
        "title": f"Delivery code for {shp.get('tracking_code') or 'shipment'}",
        "message": f"Delivery code: {code}",
        "type": "delivery_code",
        "severity": "info",
        "payload": payload,
        "read": False,
        "created_at": now_iso(),
    })
    return count


async def generate(shipment_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")

    cur = (shp.get("status") or "").lower()
    if cur in {"delivered", "cancelled"}:
        raise HTTPException(410, "Shipment is in a terminal state")
    if cur not in {"assigned", "loaded", "in_transit", "arrived"}:
        raise HTTPException(409, {
            "code": "INVALID_STATE_FOR_OTP",
            "current_status": cur,
            "allowed_status": ["assigned", "loaded", "in_transit", "arrived"],
        })

    code = _generate_code()
    code_hash = hash_password(code)
    expires_at = _expiry_iso()
    now = now_iso()

    history_entry = {
        "generated_at": now,
        "generated_by_user_id": user.get("id"),
        "expires_at": expires_at,
    }

    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {
            "delivery_code": code_hash,
            "delivery_code_generated_at": now,
            "delivery_code_expires_at": expires_at,
            "delivery_code_attempts": 0,
            "delivery_code_locked_until": None,
            "updated_at": now,
        }, "$push": {"delivery_code_history": history_entry}},
    )

    notified = await _notify_receiver(shp, code, expires_at)
    await _write_audit(shipment_id, shp.get("owner_org_id") or "",
                       "generated", user.get("id"), user.get("role"))

    return {
        "shipment_id": shipment_id,
        "tracking_code": shp.get("tracking_code"),
        "delivery_code_generated_at": now,
        "delivery_code_expires_at": expires_at,
        "notified_user_count": notified,
    }


async def verify(shipment_id: str, code: str, user: Dict[str, Any]) -> Dict[str, Any]:
    if not code or not code.isdigit() or len(code) != OTP_LENGTH:
        raise HTTPException(400, {"code": "MALFORMED_CODE",
                                  "expected_length": OTP_LENGTH})

    shp = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shp:
        raise HTTPException(404, "Shipment not found")

    cur = (shp.get("status") or "").lower()
    if cur == "delivered":
        raise HTTPException(409, "Shipment already delivered")
    if cur == "cancelled":
        raise HTTPException(410, "Shipment cancelled")

    locked_until = shp.get("delivery_code_locked_until")
    if locked_until:
        try:
            lu = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
            if lu > _now():
                raise HTTPException(423, {
                    "code": "LOCKED",
                    "unlock_at": locked_until,
                })
        except ValueError:
            pass

    expires_at = shp.get("delivery_code_expires_at")
    if expires_at:
        try:
            ex = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if ex < _now():
                raise HTTPException(410, "Delivery code expired")
        except ValueError:
            pass

    stored_hash = shp.get("delivery_code")
    if not stored_hash:
        raise HTTPException(409, "No delivery code generated yet")

    if not verify_password(code, stored_hash):
        attempts = int(shp.get("delivery_code_attempts") or 0) + 1
        update: Dict[str, Any] = {
            "delivery_code_attempts": attempts,
            "updated_at": now_iso(),
        }
        locked = False
        if attempts >= OTP_MAX_ATTEMPTS:
            update["delivery_code_locked_until"] = (
                _now() + timedelta(minutes=OTP_LOCK_MIN)
            ).isoformat()
            locked = True
        await db.shipments.update_one({"id": shipment_id}, {"$set": update})
        await _write_audit(
            shipment_id, shp.get("owner_org_id") or "",
            "locked" if locked else "failed_attempt",
            user.get("id"), user.get("role"),
        )
        raise HTTPException(401, {
            "code": "INVALID_CODE",
            "attempts_remaining": max(0, OTP_MAX_ATTEMPTS - attempts),
            "locked": locked,
        })

    # ✅ verified
    now = now_iso()
    await db.shipments.update_one(
        {"id": shipment_id},
        {"$set": {
            "delivery_code_verified_at": now,
            "delivered_by": user.get("driver_id") or user.get("entity_id"),
            "delivery_code_attempts": 0,
            "delivery_code_locked_until": None,
            "updated_at": now,
        }},
    )
    await _write_audit(shipment_id, shp.get("owner_org_id") or "",
                       "verified", user.get("id"), user.get("role"))
    return {"shipment_id": shipment_id, "verified_at": now}
