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


# ============================================================================
# Impersonation (super_admin can act as any user)
# ============================================================================
@router.post("/auth/impersonate/{user_id}")
async def impersonate(user_id: str, request: Request, response: Response):
    """Super-admin can mint a fresh access token for any active user.

    Returns the impersonated user's access token + the user object. The
    caller is responsible for stashing the super-admin's own token client
    side so it can "exit impersonation" later.
    """
    admin = await require_role("super_admin")(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("status") != "active":
        raise HTTPException(400, "Target user is not active")
    if target["id"] == admin["id"]:
        raise HTTPException(400, "You cannot impersonate yourself")

    # Stamp the token so we can detect impersonation server-side if needed.
    access = create_access_token({**target, "impersonated_by": admin["id"]})
    refresh = create_refresh_token(target["id"])
    _set_auth_cookies(response, access, refresh)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": public_user(target),
        "impersonated_by": {"id": admin["id"], "email": admin["email"], "name": admin.get("name", "")},
    }


@router.get("/auth/demo-accounts")
async def list_demo_accounts():
    """Public read-only endpoint — returns the demo email roster so the
    landing/login page can offer one-tap demo sign-in. No passwords leak;
    the user still has to type the shared demo password.

    Retailers are capped to the **top 5 most-active per tenant** so the demo
    wizard isn't drowning in 84 storefronts; "activity" is the sum of
    purchase-orders + daily-sales rows attributed to the retailer in the
    last 90 days.
    """
    rows = await db.users.find(
        {"is_demo": True, "status": "active"},
        {"_id": 0, "email": 1, "role": 1, "name": 1, "entity_id": 1, "manufacturer_id": 1},
    ).to_list(500)

    # ----- Compute top-5 retailers per tenant by activity volume ---------
    retailer_users = [r for r in rows if r["role"] == "retailer" and r.get("entity_id")]
    retailer_ids = list({r["entity_id"] for r in retailer_users})
    activity: Dict[str, int] = {rid: 0 for rid in retailer_ids}
    if retailer_ids:
        # purchase_orders authored by these retailers
        async for d in db.purchase_orders.aggregate([
            {"$match": {"retailer_id": {"$in": retailer_ids}}},
            {"$group": {"_id": "$retailer_id", "n": {"$sum": 1}}},
        ]):
            activity[d["_id"]] = activity.get(d["_id"], 0) + int(d.get("n") or 0)
        # daily_sales rows
        async for d in db.daily_sales.aggregate([
            {"$match": {"retailer_id": {"$in": retailer_ids}}},
            {"$group": {"_id": "$retailer_id", "n": {"$sum": 1}}},
        ]):
            activity[d["_id"]] = activity.get(d["_id"], 0) + int(d.get("n") or 0)

    by_tenant: Dict[str, list] = {}
    for r in retailer_users:
        by_tenant.setdefault(r.get("manufacturer_id", ""), []).append(r)
    keep_retailer_ids: set[str] = set()
    for ru_list in by_tenant.values():
        ru_list.sort(key=lambda u: activity.get(u["entity_id"], 0), reverse=True)
        for u in ru_list[:5]:
            keep_retailer_ids.add(u["entity_id"])

    rows = [
        r for r in rows
        if r["role"] != "retailer" or r.get("entity_id") in keep_retailer_ids
    ]

    # Hydrate entity name for each so the UI can show "Lagos Distributor · Region"
    out = []
    for r in rows:
        entity_name = ""
        if r["role"] == "manufacturer":
            m = await db.manufacturers.find_one({"id": r["entity_id"]}, {"_id": 0, "name": 1})
            entity_name = (m or {}).get("name", "")
            if not entity_name:
                # New tenants live in `organizations` only.
                o = await db.organizations.find_one(
                    {"id": r["entity_id"]}, {"_id": 0, "organization_name": 1},
                )
                entity_name = (o or {}).get("organization_name", "")
        elif r["role"] == "distributor":
            d = await db.distributors.find_one({"id": r["entity_id"]},
                                                 {"_id": 0, "name": 1, "region": 1})
            entity_name = f"{(d or {}).get('name','')} · {(d or {}).get('region','')}".strip(" ·")
            if not entity_name:
                o = await db.organizations.find_one(
                    {"id": r["entity_id"]}, {"_id": 0, "organization_name": 1, "region": 1},
                )
                if o:
                    entity_name = f"{o.get('organization_name','')} · {o.get('region','')}".strip(" ·")
        elif r["role"] == "retailer":
            x = await db.retailers.find_one({"id": r["entity_id"]},
                                              {"_id": 0, "name": 1, "city": 1})
            entity_name = f"{(x or {}).get('name','')} · {(x or {}).get('city','')}".strip(" ·")
            if not entity_name:
                o = await db.organizations.find_one(
                    {"id": r["entity_id"]}, {"_id": 0, "organization_name": 1, "city": 1},
                )
                if o:
                    entity_name = f"{o.get('organization_name','')} · {o.get('city','')}".strip(" ·")
        elif r["role"] in ("warehouse", "wholesaler"):
            # These tiers live only in the unified `organizations` collection.
            o = await db.organizations.find_one(
                {"id": r["entity_id"]},
                {"_id": 0, "organization_name": 1, "region": 1, "city": 1},
            )
            if o:
                loc = o.get("city") or o.get("region") or ""
                entity_name = f"{o.get('organization_name','')} · {loc}".strip(" ·")
        out.append({**r, "entity_name": entity_name})
    # Stable order: super_admin first, then walk down the supply chain.
    role_order = {
        "super_admin": 0, "manufacturer": 1, "warehouse": 2,
        "distributor": 3, "wholesaler": 4, "retailer": 5,
    }
    # Group demo accounts by tenant so users see Unilever first, then Flour
    # Mills, etc. — keyed by manufacturer_id, with empty-string (super_admin)
    # sorted first.
    out.sort(key=lambda x: (
        x.get("manufacturer_id", ""),
        role_order.get(x.get("role"), 9),
        x.get("email", ""),
    ))
    return out



# ---------------------------------------------------------------------------
# Demo Portal (3-step wizard) — tenants endpoint
# ---------------------------------------------------------------------------
# Cosmetic metadata for each tenant. Kept here (not on the org document) so
# we can iterate on the wording without DB migrations.
TENANT_META: Dict[str, Dict[str, str]] = {
    "Flour Mills Nigeria": {
        "type_label": "FMCG Manufacturer",
        "tagline": (
            "One of Nigeria's leading food manufacturers with a strong "
            "distribution network across the country."
        ),
        "accent": "moss",
        "initials": "FMN",
        "short_name": "FMN",
    },
    "Unilever": {
        "type_label": "Consumer Goods Manufacturer",
        "tagline": (
            "World-class consumer goods company with trusted brands and "
            "nationwide distribution."
        ),
        "accent": "indigo",
        "initials": "U",
        "short_name": "Unilever",
    },
}


@router.get("/auth/demo-tenants")
async def list_demo_tenants():
    """Returns one card per manufacturer tenant for the demo wizard.

    Includes live counts per supply-chain tier (warehouse / distributor /
    wholesaler / retailer) plus a flag for how many demo users exist per
    role. Tier counts are computed by walking the unified `organizations`
    tree under each manufacturer's id.
    """
    mfrs = await db.organizations.find(
        {"organization_type": "manufacturer", "status": "active"}, {"_id": 0},
    ).to_list(50)
    # Count demo users grouped by (manufacturer_id, role) in one pass.
    demo_users = await db.users.find(
        {"is_demo": True, "status": "active"},
        {"_id": 0, "manufacturer_id": 1, "role": 1},
    ).to_list(5000)
    user_counts: Dict[tuple, int] = {}
    super_admin_count = 0
    for u in demo_users:
        if u.get("role") == "super_admin":
            super_admin_count += 1
            continue
        key = (u.get("manufacturer_id", ""), u.get("role", ""))
        user_counts[key] = user_counts.get(key, 0) + 1

    out: List[Dict[str, Any]] = []
    for mfr in mfrs:
        mfr_id = mfr["id"]
        # Walk descendants once to bucket types.
        seen = {mfr_id}
        frontier = [mfr_id]
        tier_counts: Dict[str, int] = {"warehouse": 0, "distributor": 0,
                                        "wholesaler": 0, "retailer": 0,
                                        "logistics_provider": 0}
        while frontier:
            children = await db.organizations.find(
                {"parent_organization_id": {"$in": frontier},
                 "status": "active"},
                {"_id": 0, "id": 1, "organization_type": 1},
            ).to_list(50000)
            next_frontier = []
            for c in children:
                if c["id"] in seen:
                    continue
                seen.add(c["id"])
                next_frontier.append(c["id"])
                t = c.get("organization_type")
                if t in tier_counts:
                    tier_counts[t] += 1
            frontier = next_frontier
        meta = TENANT_META.get(mfr["organization_name"], {})
        out.append({
            "id": mfr_id,
            "code": mfr.get("organization_code"),
            "name": mfr["organization_name"],
            "type_label": meta.get("type_label", "Manufacturer"),
            "tagline": meta.get("tagline", ""),
            "accent": meta.get("accent", "indigo"),
            "initials": meta.get("initials") or "".join(
                w[:1] for w in mfr["organization_name"].split()
            )[:3].upper(),
            "short_name": meta.get("short_name", mfr["organization_name"]),
            "region": mfr.get("region"),
            "city": mfr.get("city"),
            "tier_counts": tier_counts,
            "users_by_role": {
                "super_admin":   super_admin_count,
                "manufacturer":  user_counts.get((mfr_id, "manufacturer"), 0),
                "warehouse":     user_counts.get((mfr_id, "warehouse"), 0),
                "distributor":   user_counts.get((mfr_id, "distributor"), 0),
                "wholesaler":    user_counts.get((mfr_id, "wholesaler"), 0),
                "retailer":      user_counts.get((mfr_id, "retailer"), 0),
            },
        })
    # Newest tenants first, so Flour Mills surfaces ahead of Unilever today.
    out.sort(key=lambda x: (x["name"] != "Flour Mills Nigeria", x["name"]))
    return out
