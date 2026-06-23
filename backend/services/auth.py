"""JWT + bcrypt helpers + FastAPI auth dependency.

Per the integration playbook:
- bcrypt for password hashing
- PyJWT (HS256) for tokens — 30 min access + 30 day refresh
- Token from Authorization: Bearer header (preferred) OR access_token cookie
- get_current_user attaches {id, email, role, entity_type, entity_id,
  manufacturer_id, name, status} to the request
- require_role() factory for endpoint-level RBAC
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import bcrypt
import jwt
from fastapi import HTTPException, Request

from core import db, logger

JWT_ALGORITHM = "HS256"
ACCESS_TTL_MIN = 30
REFRESH_TTL_DAYS = 30
INVITATION_TTL_HOURS = 24 * 7
RESET_TTL_MIN = 60

LOCKOUT_THRESHOLD = 5
LOCKOUT_WINDOW_MIN = 15


def _jwt_secret() -> str:
    s = os.environ.get("JWT_SECRET", "")
    if not s:
        raise RuntimeError("JWT_SECRET env var must be set")
    return s


# ---------------- password hashing ----------------
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------------- JWT ----------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user["role"],
        "entity_id": user.get("entity_id", ""),
        "manufacturer_id": user.get("manufacturer_id", ""),
        "type": "access",
        "iat": int(_now().timestamp()),
        "exp": _now() + timedelta(minutes=ACCESS_TTL_MIN),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "refresh",
        "iat": int(_now().timestamp()),
        "exp": _now() + timedelta(days=REFRESH_TTL_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


# ---------------- helpers ----------------
def random_token(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


def public_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """Strip secrets before returning to the client."""
    if not user:
        return user
    out = dict(user)
    out.pop("_id", None)
    out.pop("password_hash", None)
    out.pop("reset_token", None)
    out.pop("reset_expires_at", None)
    out.pop("invitation_token", None)
    out.pop("invitation_expires_at", None)
    out.pop("failed_attempts", None)
    out.pop("lockout_until", None)
    return out


# ---------------- auth dependency ----------------
async def get_current_user(request: Request) -> Dict[str, Any]:
    """Decode Bearer token (or access_token cookie) → fresh user document.

    If the request carries ``X-Active-Tenant-Id``, **and** the caller is a
    multi-tenant distributor/wholesaler whose ``business_group_id`` lists
    that entity_id as a member, the returned user dict is **rewritten** to
    point at the chosen tenant — i.e. ``entity_id``,
    ``manufacturer_id`` and (where relevant) ``distributor_id`` reflect
    the picked tenant. Endpoints that read these fields therefore scope
    automatically without any per-route plumbing.

    Security: the override is rejected with **403** if ``X-Active-Tenant-Id``
    is not in the caller's membership list. There is never a path where a
    user can scope to a tenant they do not belong to just by spoofing the
    header.
    """
    token: Optional[str] = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(401, "Not authenticated")

    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(401, "Invalid token type")

    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    if user.get("status") == "locked":
        raise HTTPException(403, "Account locked. Contact your administrator.")

    # Multi-tenant scope override (X-Active-Tenant-Id) -------------------
    active_entity_id = request.headers.get("X-Active-Tenant-Id")
    if active_entity_id and user.get("role") in ("distributor", "wholesaler"):
        if active_entity_id != user.get("entity_id"):
            # Lazy import — avoids circular dependency on routes/me.py
            from services.business_groups import memberships_for_user, find_membership
            memberships = await memberships_for_user(user)
            match = find_membership(memberships, active_entity_id)
            if not match:
                raise HTTPException(403, {
                    "code": "NOT_A_MEMBER",
                    "entity_id": active_entity_id,
                    "msg": "X-Active-Tenant-Id is not in your business group's memberships.",
                })
            user = {
                **user,
                "entity_id": match["entity_id"],
                "manufacturer_id": match.get("manufacturer_id"),
                "distributor_id": (match["entity_id"]
                                   if match.get("entity_role") == "distributor"
                                   else user.get("distributor_id")),
                "_active_tenant": match,
            }

    return user


def require_role(*roles: str):
    """Endpoint dependency factory — enforces one of the allowed roles."""
    role_set = set(roles)

    async def _enforce(request: Request) -> Dict[str, Any]:
        user = await get_current_user(request)
        if user["role"] not in role_set:
            raise HTTPException(403, f"Requires role {sorted(role_set)}, got '{user['role']}'")
        return user

    return _enforce


# ---------------- brute-force ----------------
async def register_login_failure(email: str) -> None:
    """Increment failure counter; if threshold exceeded, set lockout window."""
    user = await db.users.find_one({"email": email.lower()})
    if not user:
        return
    attempts = int(user.get("failed_attempts", 0)) + 1
    update: Dict[str, Any] = {"failed_attempts": attempts}
    if attempts >= LOCKOUT_THRESHOLD:
        update["lockout_until"] = (_now() + timedelta(minutes=LOCKOUT_WINDOW_MIN)).isoformat()
        update["failed_attempts"] = 0  # reset counter after lockout starts
        logger.warning("Account temporarily locked: %s", email)
    await db.users.update_one({"id": user["id"]}, {"$set": update})


async def is_locked_out(user: Dict[str, Any]) -> bool:
    until = user.get("lockout_until")
    if not until:
        return False
    try:
        until_dt = datetime.fromisoformat(until)
        if until_dt > _now():
            return True
        # expired — clear it
        await db.users.update_one(
            {"id": user["id"]},
            {"$unset": {"lockout_until": "", "failed_attempts": ""}},
        )
        return False
    except Exception:
        return False


async def clear_login_failures(user_id: str) -> None:
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"last_login_at": _now().isoformat()},
         "$unset": {"failed_attempts": "", "lockout_until": ""}},
    )


# ---------------- entity-scope helpers ----------------
async def resolve_user_tenant(user: Dict[str, Any]) -> str:
    """Find the manufacturer_id (= tenant_id) for any user role.

    Falls back to walking the unified `organizations` hierarchy via
    `parent_organization_id` so the newer warehouse / wholesaler tiers
    (which don't exist in the legacy `manufacturers`/`distributors`/
    `retailers` collections) still resolve to the right tenant.
    """
    role = user.get("role")
    eid = user.get("entity_id", "")
    if role == "super_admin":
        return user.get("manufacturer_id", "")
    if role == "manufacturer":
        return eid
    if role == "distributor":
        d = await db.distributors.find_one({"id": eid}, {"_id": 0, "manufacturer_id": 1})
        if d and d.get("manufacturer_id"):
            return d["manufacturer_id"]
        # Fallback for distributors that only exist in the unified org tree.
        return await _walk_to_manufacturer(eid)
    if role == "retailer":
        r = await db.retailers.find_one({"id": eid}, {"_id": 0, "distributor_id": 1})
        if r and r.get("distributor_id"):
            d = await db.distributors.find_one({"id": r["distributor_id"]},
                                                {"_id": 0, "manufacturer_id": 1})
            if d and d.get("manufacturer_id"):
                return d["manufacturer_id"]
        return await _walk_to_manufacturer(eid)
    if role in ("warehouse", "wholesaler", "logistics_provider"):
        return await _walk_to_manufacturer(eid)
    return ""


async def _walk_to_manufacturer(org_id: str, max_hops: int = 8) -> str:
    """Walk `organizations.parent_organization_id` upwards until we hit a
    `manufacturer` org. Returns its id, or "" if unreachable."""
    cur_id = org_id
    for _ in range(max_hops):
        if not cur_id:
            return ""
        doc = await db.organizations.find_one(
            {"id": cur_id}, {"_id": 0, "organization_type": 1, "parent_organization_id": 1},
        )
        if not doc:
            return ""
        if doc.get("organization_type") == "manufacturer":
            return cur_id
        cur_id = doc.get("parent_organization_id") or ""
    return ""


VALID_ROLES: List[str] = ["super_admin", "manufacturer", "distributor", "retailer", "wholesaler", "driver"]
