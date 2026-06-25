"""Retailer Inventory Adjustment Ledger — delta-only (Phase E).

Three endpoints under ``/api/retailer/{rid}/inventory/adjust``:

* ``POST   /``        — single atomic delta against ``inventory.quantity``.
* ``POST   /batch``   — many deltas with per-row idempotency; partial OK.
* ``GET    /``        — paginated ledger filtered by product / reason / since.

Hard rule: no absolute-quantity endpoints exist. All mutations go through
``$inc`` against the existing ``inventory`` collection so the operation
is atomic at the storage layer even under concurrent writers. The ledger
itself is kept in a dedicated collection ``retailer_inventory_adjustments``
so the full audit trail survives independently of inventory state.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, new_id
from models import InventoryAdjustBatch, InventoryAdjustCreate
from services.auth import get_current_user
from services.idempotency import (
    IdempotencyContext, check_delta_replay, idempotent, persist_delta_replay,
    _payload_sha256,
)

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _enforce_retailer_ownership(user: Dict[str, Any], retailer_id: str) -> None:
    role = user.get("role")
    if role == "super_admin":
        return
    if role == "retailer" and user.get("entity_id") == retailer_id:
        return
    raise HTTPException(403, "Forbidden — not your retailer")


async def _apply_delta_atomic(
    *, retailer_id: str, product_id: str, delta: int,
    reason: str, source_local_id: Optional[str],
    client_op_id: Optional[str], occurred_at: Optional[str],
    notes: Optional[str],
) -> Dict[str, Any]:
    """Apply a single delta atomically. Returns the persisted ledger row.

    Atomicity: ``find_one_and_update`` with ``$inc`` is a single
    server-side operation. Concurrent callers cannot interleave on the
    same inventory document.
    """
    # ``upsert=True`` lets the first-ever inbound delta materialise an
    # inventory row at the supplied quantity. We init missing fields on
    # the same call via ``$setOnInsert``.
    now = _now_iso()
    new_inv = await db.inventory.find_one_and_update(
        {"owner_type": "retailer", "owner_id": retailer_id,
         "product_id": product_id},
        {
            "$inc": {"quantity": delta},
            "$set": {"updated_at": now},
            "$setOnInsert": {
                "id": new_id(),
                "owner_type": "retailer",
                "owner_id": retailer_id,
                "product_id": product_id,
                "reserved": 0,
                "damaged": 0,
                "created_at": now,
            },
        },
        upsert=True,
        return_document=True,
        projection={"_id": 0},
    )
    resulting_qty = int((new_inv or {}).get("quantity", 0))
    reserved = int((new_inv or {}).get("reserved", 0))
    resulting_available = max(0, resulting_qty - reserved)

    warning = "negative_balance" if resulting_qty < 0 else None
    ledger_row = {
        "id": new_id(),
        "retailer_id": retailer_id,
        "product_id": product_id,
        "delta": int(delta),
        "reason": reason,
        "source_local_id": source_local_id,
        "client_op_id": client_op_id,
        "applied_at": now,
        "occurred_at": (occurred_at or now),
        "notes": (notes or None),
        "resulting_quantity": resulting_qty,
        "resulting_available": resulting_available,
        "warning": warning,
    }
    await db.retailer_inventory_adjustments.insert_one(ledger_row.copy())
    return ledger_row


# ---------------------------------------------------------------------------
# SINGLE DELTA
# ---------------------------------------------------------------------------
@router.post("/retailer/{retailer_id}/inventory/adjust")
async def post_adjustment(
    retailer_id: str, payload: InventoryAdjustCreate,
    user: Dict[str, Any] = Depends(get_current_user),
    ctx: IdempotencyContext = Depends(idempotent("retailer.inventory.adjust")),
):
    _enforce_retailer_ownership(user, retailer_id)
    if ctx.replay is not None:
        return ctx.replay
    if payload.delta == 0:
        raise HTTPException(400, "delta must be non-zero")
    ledger = await _apply_delta_atomic(
        retailer_id=retailer_id,
        product_id=payload.product_id,
        delta=payload.delta,
        reason=payload.reason,
        source_local_id=payload.source_local_id,
        client_op_id=payload.client_op_id,
        occurred_at=payload.occurred_at,
        notes=payload.notes,
    )
    return await ctx.set_response(200, ledger)


# ---------------------------------------------------------------------------
# BATCH (partial-OK)
# ---------------------------------------------------------------------------
@router.post("/retailer/{retailer_id}/inventory/adjust/batch")
async def post_adjustment_batch(
    retailer_id: str, payload: InventoryAdjustBatch,
    user: Dict[str, Any] = Depends(get_current_user),
    ctx: IdempotencyContext = Depends(
        idempotent("retailer.inventory.adjust.batch")),
):
    """Apply many deltas. Each delta carries its own
    ``client_delta_op_id`` and is INDIVIDUALLY idempotent. The batch as
    a whole is NOT atomic — a bad delta does not block others.

    On replay (same ``client_delta_op_id`` + same payload), the original
    response for that delta is returned with ``status="skipped"``.
    """
    _enforce_retailer_ownership(user, retailer_id)
    if ctx.replay is not None:
        return ctx.replay

    DELTA_ENDPOINT = "retailer.inventory.adjust.delta"
    results: List[Dict[str, Any]] = []
    applied = 0
    skipped = 0
    rejected = 0

    for item in payload.adjustments:
        if not item.client_delta_op_id:
            results.append({
                "client_delta_op_id": item.client_delta_op_id or "",
                "status": "rejected",
                "reason": "client_delta_op_id required",
            })
            rejected += 1
            continue
        if item.delta == 0:
            results.append({
                "client_delta_op_id": item.client_delta_op_id,
                "status": "rejected",
                "reason": "delta must be non-zero",
            })
            rejected += 1
            continue

        # Per-delta payload hash for replay detection.
        delta_sha = _payload_sha256((
            f"{item.product_id}|{item.delta}|{item.reason}|"
            f"{item.source_local_id or ''}|{item.occurred_at or ''}"
        ).encode("utf-8"))

        try:
            replay = await check_delta_replay(
                retailer_id=retailer_id, endpoint=DELTA_ENDPOINT,
                delta_op_id=item.client_delta_op_id,
                payload_sha=delta_sha,
            )
        except HTTPException as he:
            # Mismatched payload reuse — record as rejected, keep going.
            results.append({
                "client_delta_op_id": item.client_delta_op_id,
                "status": "rejected",
                "reason": "client_delta_op_id reused with mismatched payload",
                "detail": he.detail,
            })
            rejected += 1
            continue

        if replay:
            body = replay.get("response_body") or {}
            results.append({
                "client_delta_op_id": item.client_delta_op_id,
                "status": "skipped",
                **{k: body.get(k) for k in (
                    "id", "resulting_quantity", "resulting_available",
                    "warning",
                )},
            })
            skipped += 1
            continue

        try:
            ledger = await _apply_delta_atomic(
                retailer_id=retailer_id,
                product_id=item.product_id,
                delta=item.delta,
                reason=item.reason,
                source_local_id=item.source_local_id,
                client_op_id=item.client_delta_op_id,
                occurred_at=item.occurred_at,
                notes=item.notes,
            )
        except Exception as e:
            results.append({
                "client_delta_op_id": item.client_delta_op_id,
                "status": "rejected",
                "reason": str(e),
            })
            rejected += 1
            continue

        await persist_delta_replay(
            retailer_id=retailer_id, endpoint=DELTA_ENDPOINT,
            delta_op_id=item.client_delta_op_id, payload_sha=delta_sha,
            response_body=ledger,
        )
        results.append({
            "client_delta_op_id": item.client_delta_op_id,
            "status": "applied",
            "id": ledger["id"],
            "resulting_quantity": ledger["resulting_quantity"],
            "resulting_available": ledger["resulting_available"],
            "warning": ledger["warning"],
        })
        applied += 1

    body = {
        "ok": True,
        "applied": applied,
        "skipped": skipped,
        "rejected": rejected,
        "results": results,
    }
    return await ctx.set_response(200, body)


# ---------------------------------------------------------------------------
# LEDGER (read)
# ---------------------------------------------------------------------------
@router.get("/retailer/{retailer_id}/inventory/adjust")
async def list_adjustments(
    retailer_id: str,
    product_id: Optional[str] = Query(None),
    reason: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    updated_since: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_retailer_ownership(user, retailer_id)
    q: Dict[str, Any] = {"retailer_id": retailer_id}
    if product_id:
        q["product_id"] = product_id
    if reason:
        q["reason"] = reason
    # `since` and `updated_since` are synonyms (the ledger has no
    # mutable rows — applied_at IS the updated timestamp).
    cursor_since = updated_since or since
    if cursor_since:
        q["applied_at"] = {"$gt": cursor_since}

    total = await db.retailer_inventory_adjustments.count_documents(q)
    sort_dir = 1 if cursor_since else -1
    rows = await (
        db.retailer_inventory_adjustments
        .find(q, {"_id": 0})
        .sort("applied_at", sort_dir)
        .skip(offset).limit(limit).to_list(limit)
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "rows": rows,
        "next_cursor": rows[-1]["applied_at"] if rows and cursor_since else None,
    }
