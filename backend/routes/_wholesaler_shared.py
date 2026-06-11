"""Shared helpers for the Wholesaler workspace (Phase 1 + Phase 2).

Imported by `routes/wholesaler.py` (dashboard/inventory/procurement/network)
and `routes/wholesaler_orders.py` (orders/fulfillment/shipments). Keeps the
authorization guard + tenant-walk + entity lookup in one place so we don't
copy-paste across routers.
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from core import db
from services.auth import get_current_user


async def walk_to_manufacturer(org: dict) -> str:
    """Return the manufacturer id at the top of the org tree (or '')."""
    pid = org.get("parent_organization_id")
    seen: set[str] = set()
    if org.get("organization_type") == "manufacturer":
        return org.get("id", "")
    while pid and pid not in seen:
        seen.add(pid)
        p = await db.organizations.find_one(
            {"id": pid}, {"_id": 0, "id": 1, "organization_type": 1,
                          "parent_organization_id": 1},
        )
        if not p:
            break
        if p.get("organization_type") == "manufacturer":
            return p["id"]
        pid = p.get("parent_organization_id")
    return ""


async def get_wholesaler_org(wid: str) -> dict:
    org = await db.organizations.find_one(
        {"id": wid, "organization_type": "wholesaler"}, {"_id": 0}
    )
    if not org:
        raise HTTPException(404, "Wholesaler not found")
    return org


async def require_wholesaler_access(wholesaler_id: str, request: Request) -> dict:
    """401 unauth · 403 retailer · 200 self · 403 cross-tenant · 200 super_admin
    · 200 same-tenant manufacturer/warehouse · 200 distributor in same tenant
    (read-only — they need to be able to POST a new order to a wholesaler)."""
    user = await get_current_user(request)
    role = user.get("role")
    if role == "super_admin":
        return user
    org = await get_wholesaler_org(wholesaler_id)
    if role == "wholesaler":
        if user.get("entity_id") != wholesaler_id:
            raise HTTPException(403, "Not authorised for this wholesaler")
        return user
    if role in ("manufacturer", "warehouse", "distributor"):
        target_tenant = await walk_to_manufacturer(org)
        user_org = await db.organizations.find_one(
            {"id": user.get("entity_id")}, {"_id": 0},
        ) or {}
        user_tenant = await walk_to_manufacturer(user_org)
        if not target_tenant or target_tenant != user_tenant:
            raise HTTPException(403, "Wholesaler outside your tenant")
        return user
    raise HTTPException(403, "Role not permitted")


async def require_wholesaler_owner(wholesaler_id: str, request: Request) -> dict:
    """Stricter guard for private analytics / intelligence surfaces.

    Only the wholesaler itself (or super_admin) may read these endpoints.
    Same-tenant distributors / manufacturers / warehouses are explicitly
    blocked because the data exposes commercial KPIs, churn risk, and
    purchase-order intelligence that belong to the wholesaler alone.
    """
    user = await get_current_user(request)
    role = user.get("role")
    if role == "super_admin":
        return user
    if role == "wholesaler":
        if user.get("entity_id") != wholesaler_id:
            raise HTTPException(403, "Not authorised for this wholesaler")
        return user
    raise HTTPException(403, "Wholesaler scope required")


async def tenant_id_for(wholesaler: dict) -> str:
    """Walk to manufacturer + fall back to legacy mirror."""
    mfr = await walk_to_manufacturer(wholesaler)
    return mfr or wholesaler.get("manufacturer_id") or ""
