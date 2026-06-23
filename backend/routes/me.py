"""``/api/me/*`` — self-service endpoints for the logged-in user.

Currently exposes the multi-tenant membership list used by the tenant
switcher dropdown on the web + mobile dashboards.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from services.auth import get_current_user as require_auth
from services.business_groups import memberships_for_user, find_membership

router = APIRouter()


@router.get("/me/tenants", response_model=Dict[str, Any])
async def my_tenants(user: Dict[str, Any] = Depends(require_auth)):
    """Return every ``(manufacturer, entity)`` the caller may act as.

    Response::

        {
          "active":   { manufacturer_id, manufacturer_name, entity_id, ... },
          "tenants": [{ manufacturer_id, manufacturer_name, entity_id,
                       entity_name, entity_city, entity_role, is_default }, …],
          "multi_tenant": bool
        }

    Frontend renders a selector only when ``multi_tenant`` is true.
    """
    return await memberships_for_user(user)


@router.post("/me/active-tenant", response_model=Dict[str, Any])
async def switch_active_tenant(
    body: Dict[str, Any], user: Dict[str, Any] = Depends(require_auth),
):
    """Validate a tenant switch and echo back the resolved membership.

    The body should be ``{"entity_id": "<distributor_or_wholesaler_id>"}``.
    The frontend persists the chosen ``entity_id`` in local storage and
    sends it as the ``X-Active-Tenant-Id`` header on every subsequent
    request — this endpoint is a server-side validator + canonical-shape
    echo so the client never has to trust its own cache.
    """
    entity_id = (body or {}).get("entity_id")
    if not entity_id:
        raise HTTPException(400, {"code": "MISSING_ENTITY_ID"})
    memberships = await memberships_for_user(user)
    match = find_membership(memberships, entity_id)
    if not match:
        raise HTTPException(403, {"code": "NOT_A_MEMBER",
                                  "entity_id": entity_id,
                                  "available": [t["entity_id"]
                                                for t in memberships["tenants"]]})
    return {"active": match, "multi_tenant": memberships["multi_tenant"]}
