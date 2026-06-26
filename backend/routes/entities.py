"""Entity directory endpoints (manufacturers, distributors, retailers, products)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request

from core import db
from models import Distributor, Manufacturer, Product, Retailer
from services.auth import get_current_user, resolve_user_tenant

router = APIRouter()


async def _maybe_user(request: Request) -> Optional[dict]:
    """Best-effort user resolution — returns None if no/invalid token so the
    endpoint still works as an unauthenticated read for legacy callers.
    """
    try:
        return await get_current_user(request)
    except Exception:
        return None


@router.get("/")
async def root():
    return {"message": "TradeKonekt API", "status": "ok"}


@router.get("/manufacturers", response_model=List[Manufacturer])
async def list_manufacturers():
    return await db.manufacturers.find({}, {"_id": 0}).to_list(100)


@router.get("/distributors", response_model=List[Distributor])
async def list_distributors(manufacturer_id: Optional[str] = None):
    q = {"manufacturer_id": manufacturer_id} if manufacturer_id else {}
    return await db.distributors.find(q, {"_id": 0}).sort("name", 1).to_list(2000)


@router.get("/retailers", response_model=List[Retailer])
async def list_retailers(distributor_id: Optional[str] = None):
    q = {"distributor_id": distributor_id} if distributor_id else {}
    return await db.retailers.find(q, {"_id": 0}).sort("name", 1).to_list(20000)


@router.get("/products", response_model=List[Product])
async def list_products(request: Request, manufacturer_id: Optional[str] = None):
    """Default-scoped by the authenticated user's tenant so multi-tenant
    isolation holds. Super-admin (and unauthenticated legacy callers) see
    everything ecosystem; non-admin authenticated users only see products
    owned by their tenant unless they explicitly pass `manufacturer_id`.

    Retailer-private products (``source == "retailer_private"``) are
    EXCLUDED by default so they never leak into manufacturer catalogues
    or wholesaler ordering screens. A retailer caller transparently
    sees both ecosystem products AND their own private SKUs by also
    matching ``owner_id == retailer.entity_id``.
    """
    user = await _maybe_user(request)
    base_filter: Dict[str, Any]
    if manufacturer_id:
        base_filter = {"manufacturer_id": manufacturer_id}
    elif user and user.get("role") != "super_admin":
        tenant_id = await resolve_user_tenant(user)
        base_filter = {"manufacturer_id": tenant_id} if tenant_id else {}
    else:
        base_filter = {}

    # Strip retailer-private SKUs from every consumer except the owning
    # retailer (and super_admin who already has the wildcard scope).
    if user and user.get("role") == "retailer":
        rid = user.get("entity_id")
        # Owning retailer sees ecosystem + their own private products.
        q = {
            "$or": [
                {**base_filter, "source": {"$ne": "retailer_private"}},
                {"source": "retailer_private",
                 "owner_type": "retailer", "owner_id": rid},
            ]
        }
    elif user and user.get("role") == "super_admin":
        q = base_filter
    else:
        # All non-retailer + unauthenticated callers: ecosystem only.
        q = {**base_filter, "source": {"$ne": "retailer_private"}}
    return await db.products.find(q, {"_id": 0}).sort("name", 1).to_list(2000)
