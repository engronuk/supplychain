"""Auth endpoints — login, refresh, me, password reset, invitation flow.

Per the integration playbook + multi-tenant FMCG context:
- No public registration. Users are created by super-admins or via invitation.
- 5-failed-login lockout (15 min window).
- Bearer-token first (cookies as fallback).
- Console-logged password-reset links (no email provider in POC).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, new_id
from services.auth import (
    ACCESS_TTL_MIN, INVITATION_TTL_HOURS, REFRESH_TTL_DAYS, RESET_TTL_MIN,
    VALID_ROLES, clear_login_failures, create_access_token,
    create_refresh_token, decode_token, get_current_user, hash_password,
    is_locked_out, public_user, random_token, register_login_failure,
    require_role, resolve_user_tenant, verify_password,
)

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(
        "access_token", access, httponly=True, samesite="lax",
        max_age=ACCESS_TTL_MIN * 60, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh, httponly=True, samesite="lax",
        max_age=REFRESH_TTL_DAYS * 24 * 3600, path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


# ============================================================================
# Login / Refresh / Logout / Me
# ============================================================================
class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


@router.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(401, "Invalid email or password")
    if await is_locked_out(user):
        raise HTTPException(429, "Account temporarily locked due to repeated failures. Try again shortly.")
    if user.get("status") == "pending":
        raise HTTPException(403, "Account not activated. Use your invitation link.")
    if user.get("status") == "locked":
        raise HTTPException(403, "Account locked. Contact your administrator.")
    if not verify_password(payload.password, user.get("password_hash", "")):
        await register_login_failure(email)
        raise HTTPException(401, "Invalid email or password")

    await clear_login_failures(user["id"])
    access = create_access_token(user)
    refresh = create_refresh_token(user["id"])
    _set_auth_cookies(response, access, refresh)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": public_user(user),
    }


@router.post("/auth/refresh")
async def refresh(request: Request, response: Response):
    # Prefer body, then cookie
    body: Dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    token = body.get("refresh_token") or request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "No refresh token provided")
    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "User not found")
    access = create_access_token(user)
    response.set_cookie(
        "access_token", access, httponly=True, samesite="lax",
        max_age=ACCESS_TTL_MIN * 60, path="/",
    )
    return {"access_token": access, "token_type": "bearer", "user": public_user(user)}


@router.post("/auth/logout")
async def logout(response: Response, request: Request):
    _clear_auth_cookies(response)
    return {"ok": True}


@router.get("/auth/me")
async def me(request: Request):
    user = await get_current_user(request)
    tenant_id = await resolve_user_tenant(user)
    out = public_user(user)
    out["tenant_id"] = tenant_id
    return out


# ============================================================================
# Forgot / Reset password
# ============================================================================
class ForgotIn(BaseModel):
    email: EmailStr


@router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotIn):
    # Always return ok=True to avoid email enumeration.
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user:
        token = random_token(32)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "reset_token": token,
                "reset_expires_at": (datetime.now(timezone.utc)
                                     + timedelta(minutes=RESET_TTL_MIN)).isoformat(),
            }},
        )
        # Email provider not wired up in POC — log to backend stdout so admin can copy.
        logger.info("Password reset link for %s — token=%s", email, token)
    return {"ok": True, "message": "If the account exists, a reset link has been sent."}


class ResetIn(BaseModel):
    token: str
    password: str = Field(..., min_length=6)


@router.post("/auth/reset-password")
async def reset_password(payload: ResetIn, response: Response):
    user = await db.users.find_one({"reset_token": payload.token})
    if not user:
        raise HTTPException(400, "Invalid or expired reset token")
    expires = user.get("reset_expires_at", "")
    try:
        if datetime.fromisoformat(expires) < datetime.now(timezone.utc):
            raise HTTPException(400, "Reset token expired")
    except (ValueError, TypeError):
        raise HTTPException(400, "Invalid reset token")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.password), "status": "active"},
         "$unset": {"reset_token": "", "reset_expires_at": "", "failed_attempts": "", "lockout_until": ""}},
    )
    user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    access = create_access_token(user)
    refresh = create_refresh_token(user["id"])
    _set_auth_cookies(response, access, refresh)
    return {
        "ok": True,
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": public_user(user),
    }


# ============================================================================
# Invitations
# ============================================================================
class InviteCreateIn(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=120)
    role: str  # manufacturer | distributor | retailer
    entity_id: str
    manufacturer_id: Optional[str] = None  # required for non-manufacturer roles


@router.post("/auth/invite", dependencies=[])
async def create_invitation(payload: InviteCreateIn, request: Request):
    """Super-admin or manufacturer admin can invite users into their tenant."""
    admin = await require_role("super_admin", "manufacturer")(request)
    role = payload.role.lower()
    if role not in {"manufacturer", "distributor", "retailer"}:
        raise HTTPException(400, "Invalid role for invitation")
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing and existing.get("status") != "pending":
        raise HTTPException(409, "User with this email already exists")

    if role == "manufacturer":
        mfg = await db.manufacturers.find_one({"id": payload.entity_id}, {"_id": 0, "id": 1})
        if not mfg:
            raise HTTPException(404, "Manufacturer entity not found")
        manufacturer_id = payload.entity_id
    elif role == "distributor":
        d = await db.distributors.find_one({"id": payload.entity_id},
                                            {"_id": 0, "id": 1, "manufacturer_id": 1})
        if not d:
            raise HTTPException(404, "Distributor entity not found")
        manufacturer_id = d.get("manufacturer_id") or payload.manufacturer_id or ""
    else:  # retailer
        r = await db.retailers.find_one({"id": payload.entity_id},
                                         {"_id": 0, "id": 1, "distributor_id": 1})
        if not r:
            raise HTTPException(404, "Retailer entity not found")
        d = await db.distributors.find_one({"id": r["distributor_id"]},
                                            {"_id": 0, "manufacturer_id": 1})
        manufacturer_id = (d or {}).get("manufacturer_id") or payload.manufacturer_id or ""

    # Super-admin can invite anywhere; manufacturer admin only into their own tenant.
    if admin["role"] == "manufacturer" and admin.get("entity_id") != manufacturer_id:
        raise HTTPException(403, "Cannot invite users outside your tenant")

    token = random_token(32)
    expires = (datetime.now(timezone.utc) + timedelta(hours=INVITATION_TTL_HOURS)).isoformat()
    user_doc = {
        "id": existing["id"] if existing else new_id(),
        "email": email,
        "name": payload.name.strip(),
        "role": role,
        "entity_type": role,
        "entity_id": payload.entity_id,
        "manufacturer_id": manufacturer_id,
        "status": "pending",
        "invitation_token": token,
        "invitation_expires_at": expires,
        "invited_by": admin["id"],
        "created_at": _now_iso() if not existing else existing.get("created_at", _now_iso()),
    }
    if existing:
        await db.users.update_one({"id": existing["id"]}, {"$set": user_doc})
    else:
        await db.users.insert_one(user_doc)

    logger.info("Invitation issued for %s (%s) — token=%s", email, role, token)
    return {
        "ok": True,
        "invitation_url": f"/invite/{token}",
        "invitation_token": token,  # for testing convenience — production should send via email
        "expires_at": expires,
        "user": public_user(user_doc),
    }


@router.get("/auth/invite/{token}")
async def get_invitation(token: str):
    user = await db.users.find_one({"invitation_token": token}, {"_id": 0})
    if not user or user.get("status") != "pending":
        raise HTTPException(404, "Invalid or expired invitation")
    try:
        if datetime.fromisoformat(user["invitation_expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(410, "Invitation has expired")
    except (ValueError, TypeError, KeyError):
        raise HTTPException(404, "Invitation malformed")
    # Build a friendly preview
    entity_name = ""
    role = user["role"]
    if role == "manufacturer":
        ent = await db.manufacturers.find_one({"id": user["entity_id"]}, {"_id": 0, "name": 1})
        entity_name = (ent or {}).get("name", "")
    elif role == "distributor":
        ent = await db.distributors.find_one({"id": user["entity_id"]}, {"_id": 0, "name": 1, "region": 1})
        entity_name = f"{(ent or {}).get('name','')} · {(ent or {}).get('region','')}".strip(" ·")
    elif role == "retailer":
        ent = await db.retailers.find_one({"id": user["entity_id"]}, {"_id": 0, "name": 1, "city": 1})
        entity_name = f"{(ent or {}).get('name','')} · {(ent or {}).get('city','')}".strip(" ·")
    return {
        "email": user["email"],
        "name": user.get("name", ""),
        "role": role,
        "entity_name": entity_name,
        "expires_at": user["invitation_expires_at"],
    }


class InviteClaimIn(BaseModel):
    token: str
    password: str = Field(..., min_length=6)


@router.post("/auth/invite/{token}/claim")
async def claim_invitation(token: str, payload: InviteClaimIn, response: Response):
    if payload.token != token:
        raise HTTPException(400, "Token mismatch")
    user = await db.users.find_one({"invitation_token": token})
    if not user or user.get("status") != "pending":
        raise HTTPException(404, "Invalid or expired invitation")
    try:
        if datetime.fromisoformat(user["invitation_expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(410, "Invitation has expired")
    except (ValueError, TypeError, KeyError):
        raise HTTPException(404, "Invitation malformed")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password_hash": hash_password(payload.password),
            "status": "active",
            "activated_at": _now_iso(),
        },
         "$unset": {"invitation_token": "", "invitation_expires_at": ""}},
    )
    user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    access = create_access_token(user)
    refresh = create_refresh_token(user["id"])
    _set_auth_cookies(response, access, refresh)
    return {
        "ok": True,
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": public_user(user),
    }


# ============================================================================
# Admin: list / manage users (super_admin + manufacturer)
# ============================================================================
@router.get("/auth/users")
async def list_users(request: Request,
                      role: Optional[str] = None,
                      status: Optional[str] = None,
                      manufacturer_id: Optional[str] = None,
                      limit: int = 200):
    admin = await require_role("super_admin", "manufacturer")(request)
    q: Dict[str, Any] = {}
    if role:
        q["role"] = role
    if status:
        q["status"] = status
    # Manufacturer admin only sees their own tenant
    if admin["role"] == "manufacturer":
        q["manufacturer_id"] = admin.get("entity_id", "")
    elif manufacturer_id:
        q["manufacturer_id"] = manufacturer_id
    rows = await db.users.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [public_user(r) for r in rows]
