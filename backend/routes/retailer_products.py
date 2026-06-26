"""Retailer-private product CRUD.

Lets a retailer onboard products from manufacturers that are NOT in the
TradeKonekt ecosystem (local brands, private-label SKUs, off-platform
distributors). These products:

* Live in the same ``products`` collection so the existing sales /
  inventory / pricing endpoints work natively.
* Are tagged with ``source="retailer_private"``, ``owner_type="retailer"``
  and ``owner_id=<rid>``. The global `GET /api/products` (used by
  manufacturer catalogues and wholesaler ordering screens) excludes
  them; only the owning retailer (and super_admin) see them.
* Do NOT roll up into wholesaler/manufacturer demand analytics —
  upstream forecasting only counts ``source="ecosystem"`` sales.

Endpoints (under ``/api/retailer/{rid}/products``):

* ``GET    /``                — list retailer's private products
* ``POST   /``                — idempotent create
* ``PATCH  /{product_id}``    — partial update
* ``DELETE /{product_id}``    — soft delete (``deleted_at``)

Authentication: JWT + retailer ownership check on every route.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from core import db, new_id
from models import RetailerPrivateProductCreate, RetailerPrivateProductUpdate
from services.auth import get_current_user, require_retailer_ownership_async
from services.idempotency import IdempotencyContext, idempotent

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in row.items() if k != "_id"}
    out.setdefault("is_private", True)
    return out


def _generate_sku(name: str) -> str:
    """SKU derived from name slug + 6-char unique suffix."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").upper()[:24] or "PRIV"
    return f"PRIV-{slug}-{new_id()[:6].upper()}"


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------
@router.get("/retailer/{retailer_id}/products")
async def list_retailer_private_products(
    retailer_id: str,
    q: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    include_deleted: bool = Query(False),
    updated_since: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(get_current_user),
):
    await require_retailer_ownership_async(user, retailer_id)
    filter_: Dict[str, Any] = {
        "source": "retailer_private",
        "owner_type": "retailer",
        "owner_id": retailer_id,
    }
    if not include_deleted:
        filter_["deleted_at"] = None
    if updated_since:
        filter_["updated_at"] = {"$gt": updated_since}
    if q:
        ql = re.escape(q.strip())
        filter_["$or"] = [
            {"name": {"$regex": ql, "$options": "i"}},
            {"sku": {"$regex": ql, "$options": "i"}},
            {"barcode": {"$regex": ql, "$options": "i"}},
            {"external_manufacturer": {"$regex": ql, "$options": "i"}},
        ]
    total = await db.products.count_documents(filter_)
    sort_dir = 1 if updated_since else -1
    sort_key = "updated_at" if updated_since else "created_at"
    rows = await (
        db.products.find(filter_, {"_id": 0})
        .sort(sort_key, sort_dir)
        .skip(offset).limit(limit).to_list(limit)
    )
    return {
        "total": total, "limit": limit, "offset": offset,
        "rows": [_public(r) for r in rows],
        "next_cursor": rows[-1].get("updated_at") if rows and updated_since else None,
    }


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------
@router.post("/retailer/{retailer_id}/products")
async def create_retailer_private_product(
    retailer_id: str, payload: RetailerPrivateProductCreate,
    user: Dict[str, Any] = Depends(get_current_user),
    ctx: IdempotencyContext = Depends(idempotent("retailer.products.create")),
):
    await require_retailer_ownership_async(user, retailer_id)
    if ctx.replay is not None:
        return ctx.replay

    name = payload.name.strip()
    sku = (payload.sku or "").strip() or _generate_sku(name)
    now = _now_iso()
    row = {
        "id": new_id(),
        "sku": sku,
        "name": name,
        "category": payload.category.strip(),
        "unit_price": float(payload.unit_price),
        "barcode": (payload.barcode or "").strip() or "",
        "manufacturer_id": "",
        "organization_id": "",
        # ---- retailer-private discriminator ----
        "source": "retailer_private",
        "owner_type": "retailer",
        "owner_id": retailer_id,
        "external_manufacturer": (payload.external_manufacturer or "").strip() or None,
        "is_private": True,
        "notes": (payload.notes or "").strip() or None,
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    }
    await db.products.insert_one(row.copy())

    # Auto-create an inventory row at quantity 0 so the retailer can
    # immediately use the standard /inventory/adjust endpoints to top up.
    await db.inventory.update_one(
        {"owner_type": "retailer", "owner_id": retailer_id,
         "product_id": row["id"]},
        {"$setOnInsert": {
            "id": new_id(),
            "owner_type": "retailer", "owner_id": retailer_id,
            "product_id": row["id"], "quantity": 0,
            "reserved": 0, "damaged": 0,
            "retail_price": row["unit_price"],
            "created_at": now, "updated_at": now,
        }},
        upsert=True,
    )
    return await ctx.set_response(200, _public(row))


# ---------------------------------------------------------------------------
# UPDATE
# ---------------------------------------------------------------------------
@router.patch("/retailer/{retailer_id}/products/{product_id}")
async def update_retailer_private_product(
    retailer_id: str, product_id: str, payload: RetailerPrivateProductUpdate,
    user: Dict[str, Any] = Depends(get_current_user),
):
    await require_retailer_ownership_async(user, retailer_id)
    row = await db.products.find_one({
        "id": product_id, "source": "retailer_private",
        "owner_type": "retailer", "owner_id": retailer_id,
    }, {"_id": 0})
    if not row:
        raise HTTPException(404, "Retailer-private product not found")

    updates: Dict[str, Any] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.category is not None:
        updates["category"] = payload.category.strip()
    if payload.unit_price is not None:
        updates["unit_price"] = float(payload.unit_price)
    if payload.barcode is not None:
        updates["barcode"] = payload.barcode.strip()
    if payload.external_manufacturer is not None:
        updates["external_manufacturer"] = (
            payload.external_manufacturer.strip() or None
        )
    if payload.notes is not None:
        updates["notes"] = payload.notes.strip() or None
    if not updates:
        return _public(row)
    updates["updated_at"] = _now_iso()
    await db.products.update_one(
        {"id": product_id, "owner_id": retailer_id}, {"$set": updates},
    )
    fresh = await db.products.find_one({"id": product_id}, {"_id": 0})
    return _public(fresh or {})


# ---------------------------------------------------------------------------
# SOFT DELETE
# ---------------------------------------------------------------------------
@router.delete("/retailer/{retailer_id}/products/{product_id}",
               status_code=204)
async def delete_retailer_private_product(
    retailer_id: str, product_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    await require_retailer_ownership_async(user, retailer_id)
    res = await db.products.update_one(
        {"id": product_id, "source": "retailer_private",
         "owner_type": "retailer", "owner_id": retailer_id,
         "deleted_at": None},
        {"$set": {"deleted_at": _now_iso(), "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        existing = await db.products.find_one(
            {"id": product_id, "owner_id": retailer_id}, {"_id": 0},
        )
        if not existing:
            raise HTTPException(404, "Retailer-private product not found")
    return Response(status_code=204)
