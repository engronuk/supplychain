"""Retailer Customers CRM — offline-first (Phase D).

Five endpoints under ``/api/retailer/{rid}/customers``:

* ``GET    /``               — paginated list with ``updated_since`` cursor.
* ``GET    /{customer_id}``  — single customer (404 if not owned).
* ``POST   /``               — idempotent create / upsert by phone.
* ``PATCH  /{customer_id}``  — partial update with optional If-Match ETag.
* ``DELETE /{customer_id}``  — soft-delete (sets ``deleted_at``).

Storage
-------
Collection ``retailer_customers``. Schema:
``id`` · ``retailer_id`` · ``name`` · ``phone`` · ``normalized_phone`` ·
``email`` · ``address`` · ``credit_balance`` · ``total_spent`` ·
``lifetime_orders`` · ``first_purchase_at`` · ``last_purchase_at`` ·
``notes`` · ``tags`` · ``created_at`` · ``updated_at`` · ``deleted_at``.

The ``(retailer_id, normalized_phone)`` index is unique-sparse so two
customers with the same phone under the same retailer collapse into one
(upsert-by-phone), but phone is optional and missing values do not
collide with each other.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response

from core import db, new_id
from models import RetailerCustomerCreate, RetailerCustomerUpdate
from services.auth import get_current_user
from services.idempotency import IdempotencyContext, idempotent

router = APIRouter()

_PHONE_NOISE = re.compile(r"[\s\-()\.]+")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Strip whitespace / dashes / parens / dots, keep leading ``+`` and
    digits. Returns ``None`` if the input is empty or normalises to <4
    digits (treat as junk)."""
    if not raw:
        return None
    cleaned = _PHONE_NOISE.sub("", raw).strip()
    if not cleaned:
        return None
    # Allow leading '+' but everything else must be digits.
    body = cleaned[1:] if cleaned.startswith("+") else cleaned
    if not body.isdigit() or len(body) < 4:
        return None
    return cleaned


def _enforce_retailer_ownership(user: Dict[str, Any], retailer_id: str) -> None:
    role = user.get("role")
    if role == "super_admin":
        return
    if role == "retailer" and user.get("entity_id") == retailer_id:
        return
    raise HTTPException(403, "Forbidden — not your retailer")


def _public(row: Dict[str, Any]) -> Dict[str, Any]:
    """Project an internal customer row to the API shape (drops _id,
    normalises field order)."""
    out = {k: v for k, v in row.items() if k != "_id"}
    return out


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------
@router.get("/retailer/{retailer_id}/customers")
async def list_customers(
    retailer_id: str,
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    updated_since: Optional[str] = Query(None),
    include_deleted: bool = Query(False),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_retailer_ownership(user, retailer_id)
    filter_: Dict[str, Any] = {"retailer_id": retailer_id}
    if not include_deleted:
        filter_["deleted_at"] = None
    if updated_since:
        filter_["updated_at"] = {"$gt": updated_since}
    if q:
        ql = q.strip()
        filter_["$or"] = [
            {"name": {"$regex": re.escape(ql), "$options": "i"}},
            {"phone": {"$regex": re.escape(ql), "$options": "i"}},
            {"email": {"$regex": re.escape(ql), "$options": "i"}},
        ]
    total = await db.retailer_customers.count_documents(filter_)
    sort_dir = 1 if updated_since else -1
    sort_key = "updated_at" if updated_since else "created_at"
    cursor = (
        db.retailer_customers
        .find(filter_, {"_id": 0})
        .sort(sort_key, sort_dir)
        .skip(offset)
        .limit(limit)
    )
    rows = await cursor.to_list(limit)
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "rows": [_public(r) for r in rows],
        # Cursor for the next pull — clients pass this back as
        # ``updated_since`` to get only newer rows.
        "next_cursor": rows[-1]["updated_at"] if rows and updated_since else None,
    }


# ---------------------------------------------------------------------------
# GET ONE
# ---------------------------------------------------------------------------
@router.get("/retailer/{retailer_id}/customers/{customer_id}")
async def get_customer(
    retailer_id: str, customer_id: str, response: Response,
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_retailer_ownership(user, retailer_id)
    row = await db.retailer_customers.find_one(
        {"id": customer_id, "retailer_id": retailer_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Customer not found")
    response.headers["ETag"] = f'"{row.get("updated_at", "")}"'
    return _public(row)


# ---------------------------------------------------------------------------
# CREATE / UPSERT
# ---------------------------------------------------------------------------
@router.post("/retailer/{retailer_id}/customers")
async def create_customer(
    retailer_id: str, payload: RetailerCustomerCreate,
    user: Dict[str, Any] = Depends(get_current_user),
    ctx: IdempotencyContext = Depends(idempotent("retailer.customers.create")),
):
    _enforce_retailer_ownership(user, retailer_id)
    if ctx.replay is not None:
        return ctx.replay

    # Validate email if provided.
    if payload.email and not _EMAIL_RE.match(payload.email):
        raise HTTPException(400, "Invalid email")

    normalized = _normalize_phone(payload.phone)

    # Phone-based upsert: if a customer with this normalised phone already
    # exists for this retailer, return the existing row instead of
    # creating a duplicate.
    if normalized:
        existing = await db.retailer_customers.find_one({
            "retailer_id": retailer_id,
            "normalized_phone": normalized,
            "deleted_at": None,
        }, {"_id": 0})
        if existing:
            return await ctx.set_response(200, _public(existing))

    now = _now_iso()
    row = {
        "id": new_id(),
        "retailer_id": retailer_id,
        "name": payload.name.strip(),
        "phone": (payload.phone or "").strip() or None,
        "email": (payload.email or "").strip().lower() or None,
        "address": (payload.address or "").strip() or None,
        "credit_balance": 0.0,
        "total_spent": 0.0,
        "lifetime_orders": 0,
        "first_purchase_at": None,
        "last_purchase_at": None,
        "notes": (payload.notes or "").strip() or None,
        "tags": list(payload.tags or []),
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    }
    # IMPORTANT: omit ``normalized_phone`` entirely when there is no
    # phone — Mongo's sparse index still indexes ``null`` values, so a
    # second customer without a phone would collide on the
    # ``(retailer_id, normalized_phone)=null`` slot. Only setting the
    # field when it has a real value keeps the sparse index honest.
    if normalized:
        row["normalized_phone"] = normalized
    try:
        await db.retailer_customers.insert_one(row)
    except Exception as e:
        # Race on the unique index — re-read and return the survivor.
        if "duplicate key" in str(e).lower() and normalized:
            survivor = await db.retailer_customers.find_one({
                "retailer_id": retailer_id, "normalized_phone": normalized,
            }, {"_id": 0})
            if survivor:
                return await ctx.set_response(200, _public(survivor))
        raise
    return await ctx.set_response(200, _public(row))


# ---------------------------------------------------------------------------
# UPDATE
# ---------------------------------------------------------------------------
@router.patch("/retailer/{retailer_id}/customers/{customer_id}")
async def update_customer(
    retailer_id: str, customer_id: str, payload: RetailerCustomerUpdate,
    response: Response,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_retailer_ownership(user, retailer_id)
    row = await db.retailer_customers.find_one(
        {"id": customer_id, "retailer_id": retailer_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Customer not found")

    # ETag check (passed via If-Match header — FastAPI maps header names
    # ``X-Y-Z`` → param ``x_y_z`` so ``if-match`` → ``if_match``).
    if if_match is not None:
        wanted = if_match.strip().strip('"')
        if wanted and wanted != (row.get("updated_at") or ""):
            raise HTTPException(412, "Precondition Failed — stale If-Match")

    updates: Dict[str, Any] = {}
    unsets: Dict[str, str] = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.phone is not None:
        updates["phone"] = payload.phone.strip() or None
        norm = _normalize_phone(payload.phone)
        if norm:
            updates["normalized_phone"] = norm
        else:
            # Clearing phone → drop the indexed field so sparse stays sparse.
            unsets["normalized_phone"] = ""
    if payload.email is not None:
        if payload.email and not _EMAIL_RE.match(payload.email):
            raise HTTPException(400, "Invalid email")
        updates["email"] = payload.email.strip().lower() or None
    if payload.address is not None:
        updates["address"] = payload.address.strip() or None
    if payload.notes is not None:
        updates["notes"] = payload.notes.strip() or None
    if payload.tags is not None:
        updates["tags"] = list(payload.tags)
    if not updates:
        response.headers["ETag"] = f'"{row.get("updated_at", "")}"'
        return _public(row)

    updates["updated_at"] = _now_iso()
    update_op: Dict[str, Any] = {"$set": updates}
    if unsets:
        update_op["$unset"] = unsets
    await db.retailer_customers.update_one(
        {"id": customer_id, "retailer_id": retailer_id}, update_op,
    )
    fresh = await db.retailer_customers.find_one(
        {"id": customer_id, "retailer_id": retailer_id}, {"_id": 0},
    )
    response.headers["ETag"] = f'"{fresh.get("updated_at", "")}"'
    return _public(fresh or {})


# ---------------------------------------------------------------------------
# SOFT DELETE
# ---------------------------------------------------------------------------
@router.delete("/retailer/{retailer_id}/customers/{customer_id}",
               status_code=204)
async def delete_customer(
    retailer_id: str, customer_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_retailer_ownership(user, retailer_id)
    res = await db.retailer_customers.update_one(
        {"id": customer_id, "retailer_id": retailer_id, "deleted_at": None},
        {"$set": {"deleted_at": _now_iso(), "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        # Either doesn't exist or already soft-deleted; both 404 from the
        # caller's perspective (idempotent re-delete should not 200).
        existing = await db.retailer_customers.find_one(
            {"id": customer_id, "retailer_id": retailer_id}, {"_id": 0},
        )
        if not existing:
            raise HTTPException(404, "Customer not found")
        # Already deleted is a no-op — 204 is still the right response.
    return Response(status_code=204)
