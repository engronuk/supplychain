"""Warehouse Fulfillment Queue.

Warehouses execute fulfillment orders that the Manufacturer's Allocation
Center created. They cannot change allocated quantities; only the
Manufacturer can re-allocate.

Lifecycle:
    pending_picking → picking → picked → loaded → dispatched → delivered → closed

Inventory effects:
    On allocation        : inventory.reserved += qty   (handled by allocation.py)
    On dispatched        : inventory.reserved -= qty AND inventory.quantity -= qty
    On delivered         : update distributor_orders status if all FOs delivered
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import db, logger, new_id, now_iso
from services.auth import get_current_user

router = APIRouter()


LIFECYCLE = ["pending_picking", "picking", "picked", "loaded", "dispatched", "delivered", "closed"]


async def _scope_warehouse(user: Dict[str, Any], warehouse_id: Optional[str]) -> Dict[str, Any]:
    if not warehouse_id:
        # Pick the first warehouse owned by the caller's tenant.
        mfr = user.get("manufacturer_id") or user.get("organization_id")
        if not mfr:
            raise HTTPException(400, "warehouse_id is required")
        wh = await db.organizations.find_one(
            {"organization_type": "warehouse", "parent_organization_id": mfr}, {"_id": 0},
        )
    else:
        wh = await db.organizations.find_one({"id": warehouse_id}, {"_id": 0})
    if not wh:
        raise HTTPException(404, "Warehouse not found")
    return wh


@router.get("/fulfillment")
async def list_fulfillment(
    warehouse_id: Optional[str] = None,
    bucket: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    q: Dict[str, Any] = {"warehouse_id": wh["id"]}
    if bucket:
        if bucket not in LIFECYCLE:
            raise HTTPException(400, f"unknown bucket {bucket}")
        q["status"] = bucket
    rows = await db.fulfillment_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Denorm distributor name + order ref.
    dist_ids = list({r["distributor_id"] for r in rows})
    dists = {d["id"]: d for d in await db.distributors.find(
        {"id": {"$in": dist_ids}}, {"_id": 0},
    ).to_list(None)}
    for r in rows:
        d = dists.get(r["distributor_id"], {})
        r["distributor_name"] = d.get("name", "Unknown")
        r["distributor_city"] = d.get("city", "")
    return rows


@router.get("/fulfillment/summary")
async def fulfillment_summary(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    out: Dict[str, int] = {}
    for stage in LIFECYCLE:
        out[stage] = await db.fulfillment_orders.count_documents(
            {"warehouse_id": wh["id"], "status": stage},
        )
    out["open"] = await db.fulfillment_orders.count_documents(
        {"warehouse_id": wh["id"], "status": {"$nin": ["delivered", "closed"]}},
    )
    return out


class AdvancePayload(BaseModel):
    to: str = Field(..., description="Target lifecycle stage")


@router.post("/fulfillment/{fo_id}/advance")
async def advance(
    fo_id: str,
    payload: AdvancePayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    if payload.to not in LIFECYCLE:
        raise HTTPException(400, f"Unknown target stage: {payload.to}")
    fo = await db.fulfillment_orders.find_one({"id": fo_id}, {"_id": 0})
    if not fo:
        raise HTTPException(404, "Fulfillment order not found")

    cur_idx = LIFECYCLE.index(fo.get("status", "pending_picking"))
    new_idx = LIFECYCLE.index(payload.to)
    if new_idx < cur_idx:
        raise HTTPException(400, f"Cannot move backwards (current: {fo['status']}, requested: {payload.to})")
    if new_idx > cur_idx + 1 and payload.to not in ("delivered", "closed"):
        # Allow skipping to delivered/closed (e.g. on confirmation),
        # but disallow arbitrary jumps elsewhere.
        raise HTTPException(400, "Cannot skip stages")

    update = {"status": payload.to, "updated_at": now_iso()}
    update[f"{payload.to}_at"] = now_iso()

    # Inventory side effects when leaving the warehouse.
    if payload.to == "dispatched":
        for line in fo.get("items", []):
            qty = int(line.get("allocated_quantity") or 0)
            if qty <= 0:
                continue
            await db.inventory.update_one(
                {"owner_type": "warehouse", "owner_id": fo["warehouse_id"], "product_id": line["product_id"]},
                {"$inc": {"reserved": -qty, "quantity": -qty}, "$set": {"last_movement_at": now_iso(), "updated_at": now_iso()}},
            )

    await db.fulfillment_orders.update_one({"id": fo_id}, {"$set": update})

    # Cascade to parent order: if every FO is delivered, mark order completed.
    if payload.to == "delivered":
        sibling_fos = await db.fulfillment_orders.find(
            {"order_id": fo["order_id"]}, {"_id": 0, "status": 1},
        ).to_list(200)
        if sibling_fos and all(f["status"] in ("delivered", "closed") for f in sibling_fos):
            await db.distributor_orders.update_one(
                {"id": fo["order_id"]},
                {"$set": {"status": "completed", "delivered_at": now_iso(), "updated_at": now_iso()}},
            )
        else:
            await db.distributor_orders.update_one(
                {"id": fo["order_id"]},
                {"$set": {"status": "fulfillment_in_progress", "updated_at": now_iso()}},
            )
    elif payload.to in ("picking", "picked", "loaded", "dispatched"):
        await db.distributor_orders.update_one(
            {"id": fo["order_id"]},
            {"$set": {"status": "fulfillment_in_progress", "updated_at": now_iso()}},
        )

    fo.update(update)
    return fo
