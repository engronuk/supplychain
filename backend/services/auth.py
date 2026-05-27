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
    """Decode Bearer token (or access_token cookie) → fresh user document."""
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
    """Find the manufacturer_id (= tenant_id) for any user role."""
    role = user.get("role")
    eid = user.get("entity_id", "")
    if role == "super_admin":
        return user.get("manufacturer_id", "")
    if role == "manufacturer":
        return eid
    if role == "distributor":
        d = await db.distributors.find_one({"id": eid}, {"_id": 0, "manufacturer_id": 1})
        return (d or {}).get("manufacturer_id", "")
    if role == "retailer":
        r = await db.retailers.find_one({"id": eid}, {"_id": 0, "distributor_id": 1})
        if not r:
            return ""
        d = await db.distributors.find_one({"id": r["distributor_id"]},
                                            {"_id": 0, "manufacturer_id": 1})
        return (d or {}).get("manufacturer_id", "")
    return ""


VALID_ROLES: List[str] = ["super_admin", "manufacturer", "distributor", "retailer"]
