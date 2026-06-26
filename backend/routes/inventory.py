"""Inventory endpoint."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db
from services.auth import (
    get_current_user, require_retailer_ownership_async,
)

router = APIRouter()


@router.get("/inventory")
async def get_inventory(
    owner_type: Optional[str] = None,
    owner_id: Optional[str] = None,
    updated_since: Optional[str] = Query(None),
    limit: int = Query(5000, ge=1, le=20000),
    user: Dict[str, Any] = Depends(get_current_user),
):
    # Caller-scoped defaults: a retailer/distributor/wholesaler caller
    # who omits owner_type/owner_id gets their OWN inventory rather than
    # a 422. This is both more ergonomic for mobile callers and closes
    # the cross-tenant enumeration that was reachable via the explicit
    # ``owner_type=retailer&owner_id=<anyone>`` form.
    role = (user or {}).get("role")
    eid = (user or {}).get("entity_id")
    if not owner_type or not owner_id:
        if role in ("retailer", "distributor", "wholesaler") and eid:
            owner_type = owner_type or role
            owner_id = owner_id or eid
        elif role == "super_admin":
            # Admin must be explicit — refuse a wildcard scan.
            raise HTTPException(
                400,
                "owner_type and owner_id required (admin must be explicit)",
            )
        else:
            raise HTTPException(
                400, "owner_type and owner_id required for this caller",
            )
    # Authorization: anyone reading a RETAILER's inventory must own it
    # (or be an upstream manufacturer/distributor in the same tree).
    # Non-retailer scopes fall back to the existing role-based access
    # baked into the JWT dependency (no further widening here).
    if owner_type == "retailer":
        await require_retailer_ownership_async(user, owner_id)
    elif role == "retailer" and not (
        owner_type == "retailer" and owner_id == eid
    ):
        # A retailer is NOT allowed to read non-retailer inventory.
        raise HTTPException(403, "Forbidden — not your inventory scope")

    q = {"owner_type": owner_type, "owner_id": owner_id}
    if updated_since:
        q["updated_at"] = {"$gt": updated_since}
    sort_dir = 1 if updated_since else None
    cursor = db.inventory.find(q, {"_id": 0})
    if sort_dir is not None:
        cursor = cursor.sort("updated_at", sort_dir)
    items = await cursor.to_list(limit)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    for it in items:
        it["product"] = products.get(it["product_id"], {})
    if not updated_since:
        items.sort(key=lambda x: (x.get("product", {}).get("name") or "").lower())
    payload = {"rows": items}
    if updated_since:
        payload["next_cursor"] = (
            items[-1].get("updated_at") if items else None
        )
        return payload
    # Legacy shape: bare list. Existing in-market clients depend on this.
    return items
