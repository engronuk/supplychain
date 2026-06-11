"""Wholesaler Workspace · Phase 2 — Distributor Orders, Fulfillment, Shipments.

Distributor users submit orders against a wholesaler's inventory. The
wholesaler approves / modifies / rejects, allocates inventory, picks,
packs, dispatches a shipment, and finally marks delivery.

Collections introduced:
  * wholesaler_orders                 — distributor → wholesaler orders
  * wholesaler_fulfillment_orders     — internal pick/pack workflow
  * wholesaler_shipments              — outbound shipment ledger

All transitions are rule-based (no AI). Fulfillment recommendations and
risk signals derive from inventory snapshots only.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, new_id, now_iso
from routes._wholesaler_shared import (
    get_wholesaler_org,
    require_wholesaler_access,
    tenant_id_for,
)

router = APIRouter()


# ===========================================================================
# MODELS
# ===========================================================================


class OrderLineIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class WholesalerOrderCreate(BaseModel):
    distributor_id: str
    items: List[OrderLineIn]
    priority: Literal["normal", "high", "urgent"] = "normal"
    requested_delivery_date: Optional[str] = None
    note: Optional[str] = None


class RejectPayload(BaseModel):
    reason: str = Field(min_length=2)


class ModifyLinePayload(BaseModel):
    product_id: str
    approved_quantity: int = Field(ge=0)


class ModifyPayload(BaseModel):
    items: List[ModifyLinePayload]
    note: Optional[str] = None
    backorder_remainder: bool = False


class CompletePickPayload(BaseModel):
    items: List[dict] = Field(default_factory=list)   # [{product_id, picked_quantity}]
    note: Optional[str] = None


class ShortagePayload(BaseModel):
    note: str = Field(min_length=2)
    items: Optional[List[dict]] = None                # [{product_id, missing_quantity}]


class DelayPayload(BaseModel):
    reason: str = Field(min_length=2)
    eta_minutes: Optional[int] = None


# ===========================================================================
# HELPERS
# ===========================================================================


async def _enrich_distributor(distributor_id: str) -> dict:
    org = await db.organizations.find_one(
        {"id": distributor_id, "organization_type": "distributor"},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "region": 1, "city": 1, "address": 1},
    )
    if org:
        return {
            "id": distributor_id,
            "name": org.get("organization_name", ""),
            "code": org.get("organization_code", ""),
            "region": org.get("region", ""),
            "city": org.get("city", ""),
            "address": org.get("address", ""),
        }
    legacy = await db.distributors.find_one(
        {"id": distributor_id},
        {"_id": 0, "id": 1, "name": 1, "region": 1, "city": 1},
    )
    legacy = legacy or {}
    return {
        "id": distributor_id,
        "name": legacy.get("name", ""),
        "code": "",
        "region": legacy.get("region", ""),
        "city": legacy.get("city", ""),
        "address": "",
    }


async def _enrich_products(product_ids: List[str]) -> dict:
    if not product_ids:
        return {}
    rows = await db.products.find(
        {"id": {"$in": list(set(product_ids))}},
        {"_id": 0, "id": 1, "name": 1, "sku": 1, "unit_price": 1},
    ).to_list(2000)
    return {r["id"]: r for r in rows}


def _line_totals(items: List[dict], price_lookup: dict) -> dict:
    total_units = 0
    total_amount = 0.0
    out = []
    for it in items:
        pid = it["product_id"]
        qty = int(it.get("quantity") or 0)
        unit_price = float(it.get("unit_price")
                           or price_lookup.get(pid, {}).get("unit_price")
                           or 0)
        line_total = round(unit_price * qty, 2)
        total_units += qty
        total_amount += line_total
        out.append({
            **it,
            "quantity": qty,
            "unit_price": unit_price,
            "line_total": line_total,
        })
    return {"items": out, "total_units": total_units,
            "total_amount": round(total_amount, 2)}


async def _inventory_for(wholesaler_id: str, product_ids: List[str]) -> dict:
    if not product_ids:
        return {}
    rows = await db.inventory.find(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id,
         "product_id": {"$in": list(set(product_ids))}},
        {"_id": 0, "product_id": 1, "quantity": 1, "reserved": 1,
         "in_transit": 1, "reorder_level": 1, "expiry_date": 1,
         "velocity": 1},
    ).to_list(500)
    return {r["product_id"]: r for r in rows}


def _availability_signal(requested: int, available: int) -> str:
    if available <= 0:
        return "unavailable"
    if available >= requested:
        return "full"
    return "partial"


def _fulfillment_recommendation(items: List[dict], inv_map: dict) -> dict:
    """Pure rule-based recommendation — no AI."""
    full_count = 0
    partial_count = 0
    unavailable_count = 0
    safety_warnings: List[str] = []
    expiry_warnings: List[str] = []
    demand_warnings: List[str] = []

    soon = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    for it in items:
        pid = it["product_id"]
        requested = int(it.get("quantity") or 0)
        inv = inv_map.get(pid) or {}
        on_hand = int(inv.get("quantity") or 0)
        reserved = int(inv.get("reserved") or 0)
        available = max(0, on_hand - reserved)
        signal = _availability_signal(requested, available)
        if signal == "full":
            full_count += 1
        elif signal == "partial":
            partial_count += 1
        else:
            unavailable_count += 1

        reorder = int(inv.get("reorder_level") or 0)
        if reorder and (available - requested) < reorder:
            safety_warnings.append(it.get("product_name") or pid)
        exp = inv.get("expiry_date")
        if exp and exp <= soon:
            expiry_warnings.append(it.get("product_name") or pid)
        velocity = float(inv.get("velocity") or 0)
        if velocity and velocity * 7 > available:  # >1 week consumption pressure
            demand_warnings.append(it.get("product_name") or pid)

    total_lines = len(items)
    if total_lines == 0:
        verdict = "no_items"
        message = "Order has no items."
    elif full_count == total_lines:
        verdict = "approve_full"
        message = "Inventory can fulfil 100% of the requested quantity."
    elif unavailable_count == total_lines:
        verdict = "reject_or_backorder"
        message = "None of the requested items are in stock. Reject or backorder."
    else:
        verdict = "partial"
        message = (
            f"Partial fulfilment recommended — {full_count} line(s) full, "
            f"{partial_count} partial, {unavailable_count} unavailable."
        )

    risks: List[dict] = []
    if safety_warnings:
        risks.append({
            "type": "safety_stock",
            "title": "Safety stock at risk",
            "body": f"Approving this order pushes {len(safety_warnings)} SKU(s) below reorder level: "
                    f"{', '.join(safety_warnings[:3])}.",
        })
    if expiry_warnings:
        risks.append({
            "type": "expiry",
            "title": "Product nearing expiry",
            "body": f"{len(expiry_warnings)} SKU(s) expire within 30 days: "
                    f"{', '.join(expiry_warnings[:3])}. Prioritise dispatch.",
        })
    if demand_warnings:
        risks.append({
            "type": "demand",
            "title": "High demand expected",
            "body": f"Velocity on {len(demand_warnings)} SKU(s) suggests further stockout pressure. "
                    f"Consider expediting replenishment.",
        })

    return {
        "verdict": verdict,
        "message": message,
        "lines_full": full_count,
        "lines_partial": partial_count,
        "lines_unavailable": unavailable_count,
        "risks": risks,
    }


async def _next_seq(collection_name: str, prefix: str) -> str:
    """Generate WO-YYYY-#### / FUL-YYYY-#### / WSHIP-YYYY-####."""
    year = datetime.now(timezone.utc).year
    n = await db[collection_name].count_documents({}) + 1
    return f"{prefix}-{year}-{n:04d}"


async def _adjust_reservation(wholesaler_id: str, product_id: str,
                              delta: int) -> None:
    """+delta reserves stock; -delta releases. Bounded at zero."""
    if delta == 0:
        return
    row = await db.inventory.find_one(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id,
         "product_id": product_id}, {"_id": 0, "id": 1, "reserved": 1},
    )
    if not row:
        return
    new_reserved = max(0, int(row.get("reserved") or 0) + delta)
    await db.inventory.update_one(
        {"id": row["id"]},
        {"$set": {"reserved": new_reserved, "updated_at": now_iso()}},
    )


async def _decrement_stock_on_dispatch(wholesaler_id: str,
                                       items: List[dict]) -> None:
    """When a shipment is dispatched, move items out of on-hand and out of
    reserved (both decrease by the same amount)."""
    for it in items:
        pid = it.get("product_id")
        qty = int(it.get("quantity") or 0)
        if not pid or qty <= 0:
            continue
        row = await db.inventory.find_one(
            {"owner_type": "wholesaler", "owner_id": wholesaler_id,
             "product_id": pid}, {"_id": 0, "id": 1, "quantity": 1,
                                   "reserved": 1, "in_transit": 1},
        )
        if not row:
            continue
        new_qty = max(0, int(row.get("quantity") or 0) - qty)
        new_reserved = max(0, int(row.get("reserved") or 0) - qty)
        new_in_transit = int(row.get("in_transit") or 0) + qty
        await db.inventory.update_one(
            {"id": row["id"]},
            {"$set": {"quantity": new_qty, "reserved": new_reserved,
                      "in_transit": new_in_transit,
                      "updated_at": now_iso(),
                      "last_movement_at": now_iso()}},
        )
        await db.wholesaler_inventory_movements.insert_one({
            "id": new_id(),
            "wholesaler_id": wholesaler_id,
            "product_id": pid,
            "kind": "dispatch",
            "delta": -qty,
            "note": "Dispatched to distributor",
            "actor": "fulfillment",
            "created_at": now_iso(),
        })


async def _settle_in_transit_on_delivery(wholesaler_id: str,
                                         items: List[dict]) -> None:
    for it in items:
        pid = it.get("product_id")
        qty = int(it.get("quantity") or 0)
        if not pid or qty <= 0:
            continue
        row = await db.inventory.find_one(
            {"owner_type": "wholesaler", "owner_id": wholesaler_id,
             "product_id": pid}, {"_id": 0, "id": 1, "in_transit": 1},
        )
        if not row:
            continue
        new_in_transit = max(0, int(row.get("in_transit") or 0) - qty)
        await db.inventory.update_one(
            {"id": row["id"]},
            {"$set": {"in_transit": new_in_transit, "updated_at": now_iso()}},
        )


def _history_event(status: str, actor: str, note: Optional[str] = None) -> dict:
    return {"status": status, "at": now_iso(),
            "by": actor, "note": note or ""}


# ===========================================================================
# ORDERS — dashboard, list, detail, transitions
# ===========================================================================


@router.get("/wholesaler/{wholesaler_id}/orders/dashboard")
async def orders_dashboard(wholesaler_id: str,
                           _user: dict = Depends(require_wholesaler_access)):
    """KPI cards + funnel counts for the Distributor Orders module."""
    cursor = db.wholesaler_orders.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0, "status": 1, "created_at": 1},
    )
    new_orders = 0
    pending_approval = 0
    approved = 0
    in_fulfillment = 0
    shipped = 0
    delivered = 0
    backordered = 0
    funnel = defaultdict(int)
    today = datetime.now(timezone.utc).date().isoformat()
    async for o in cursor:
        st = o.get("status", "submitted")
        funnel[st] += 1
        if st == "submitted":
            pending_approval += 1
            if (o.get("created_at") or "")[:10] == today:
                new_orders += 1
        elif st == "approved":
            approved += 1
        elif st in ("allocated", "picking", "picked", "packing", "packed",
                    "ready_for_dispatch"):
            in_fulfillment += 1
        elif st == "shipped":
            shipped += 1
        elif st == "delivered":
            delivered += 1
        elif st == "backordered":
            backordered += 1

    return {
        "wholesaler_id": wholesaler_id,
        "kpis": {
            "new_orders": new_orders,
            "pending_approval": pending_approval,
            "approved": approved,
            "in_fulfillment": in_fulfillment,
            "shipped": shipped,
            "delivered": delivered,
            "backordered": backordered,
        },
        "funnel": {
            "submitted": funnel.get("submitted", 0),
            "approved": funnel.get("approved", 0),
            "allocated": funnel.get("allocated", 0),
            "picking": funnel.get("picking", 0) + funnel.get("picked", 0),
            "packing": funnel.get("packing", 0) + funnel.get("packed", 0),
            "shipped": funnel.get("shipped", 0),
            "delivered": funnel.get("delivered", 0),
        },
        "as_of": now_iso(),
    }


@router.get("/wholesaler/{wholesaler_id}/orders")
async def list_orders(wholesaler_id: str,
                      status: Optional[str] = None,
                      distributor_id: Optional[str] = None,
                      region: Optional[str] = None,
                      date_from: Optional[str] = None,
                      date_to: Optional[str] = None,
                      _user: dict = Depends(require_wholesaler_access)):
    q: dict = {"wholesaler_id": wholesaler_id}
    if status:
        q["status"] = status
    if distributor_id:
        q["distributor_id"] = distributor_id
    if region:
        q["distributor.region"] = region
    if date_from or date_to:
        rng: dict = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["created_at"] = rng
    rows = await db.wholesaler_orders.find(q, {"_id": 0}).sort(
        "created_at", -1
    ).to_list(500)
    return rows


@router.get("/wholesaler/{wholesaler_id}/orders/{order_id}")
async def get_order(wholesaler_id: str, order_id: str,
                    _user: dict = Depends(require_wholesaler_access)):
    order = await db.wholesaler_orders.find_one(
        {"id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    # Live availability check
    items = order.get("items", [])
    inv_map = await _inventory_for(wholesaler_id, [it["product_id"] for it in items])
    availability = []
    for it in items:
        inv = inv_map.get(it["product_id"]) or {}
        on_hand = int(inv.get("quantity") or 0)
        reserved = int(inv.get("reserved") or 0)
        in_transit = int(inv.get("in_transit") or 0)
        available = max(0, on_hand - reserved)
        availability.append({
            "product_id": it["product_id"],
            "product_name": it.get("product_name"),
            "sku": it.get("sku"),
            "requested": int(it.get("quantity") or 0),
            "available": available,
            "reserved": reserved,
            "in_transit": in_transit,
            "on_hand": on_hand,
            "signal": _availability_signal(int(it.get("quantity") or 0), available),
        })
    recommendation = _fulfillment_recommendation(items, inv_map)

    # Optional linked fulfillment + shipment
    fulfillment = await db.wholesaler_fulfillment_orders.find_one(
        {"order_id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    shipment = await db.wholesaler_shipments.find_one(
        {"order_id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )

    return {
        **order,
        "availability": availability,
        "recommendation": recommendation,
        "fulfillment": fulfillment,
        "shipment": shipment,
    }


@router.post("/wholesaler/{wholesaler_id}/orders")
async def create_order(wholesaler_id: str, payload: WholesalerOrderCreate,
                       user: dict = Depends(require_wholesaler_access)):
    """A distributor (or admin) submits an order to the wholesaler.

    Tenant validation: products must belong to the wholesaler's tenant.
    """
    wh = await get_wholesaler_org(wholesaler_id)
    tenant_id = await tenant_id_for(wh)

    if user.get("role") == "distributor" and user.get("entity_id") != payload.distributor_id:
        raise HTTPException(403, "Can only submit orders for your own organization")

    # Validate products
    product_ids = [it.product_id for it in payload.items]
    products = await db.products.find(
        {"id": {"$in": product_ids},
         **({"manufacturer_id": tenant_id} if tenant_id else {})},
        {"_id": 0},
    ).to_list(len(product_ids))
    if len(products) != len(set(product_ids)):
        raise HTTPException(400, "One or more products are not in tenant catalog")
    pmap = {p["id"]: p for p in products}

    distributor = await _enrich_distributor(payload.distributor_id)

    items_in = [{
        "product_id": it.product_id,
        "product_name": pmap[it.product_id].get("name", "Unknown"),
        "sku": pmap[it.product_id].get("sku", ""),
        "quantity": it.quantity,
        "approved_quantity": 0,
        "fulfilled_quantity": 0,
        "unit_price": float(pmap[it.product_id].get("unit_price") or 0),
    } for it in payload.items]
    totals = _line_totals(items_in, pmap)

    order_number = await _next_seq("wholesaler_orders", "WO")
    doc = {
        "id": new_id(),
        "order_number": order_number,
        "wholesaler_id": wholesaler_id,
        "tenant_id": tenant_id,
        "distributor_id": payload.distributor_id,
        "distributor": distributor,
        "items": totals["items"],
        "total_units": totals["total_units"],
        "total_amount": totals["total_amount"],
        "status": "submitted",
        "priority": payload.priority,
        "note": payload.note or "",
        "requested_delivery_date": payload.requested_delivery_date,
        "status_history": [
            _history_event("submitted", user.get("email", "distributor"),
                           f"Submitted by {distributor['name']}"),
        ],
        "created_at": now_iso(),
        "submitted_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.wholesaler_orders.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/wholesaler/{wholesaler_id}/orders/{order_id}/approve")
async def approve_order(wholesaler_id: str, order_id: str,
                        user: dict = Depends(require_wholesaler_access)):
    order = await db.wholesaler_orders.find_one(
        {"id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "submitted":
        raise HTTPException(400, f"Cannot approve order in status {order['status']}")

    # Reserve inventory for the full requested quantity (best-effort,
    # capped by what's currently available).
    inv_map = await _inventory_for(
        wholesaler_id, [it["product_id"] for it in order.get("items", [])]
    )
    items_out = []
    full_fulfilment = True
    for it in order["items"]:
        inv = inv_map.get(it["product_id"]) or {}
        on_hand = int(inv.get("quantity") or 0)
        reserved = int(inv.get("reserved") or 0)
        available = max(0, on_hand - reserved)
        approve_qty = min(int(it["quantity"]), available)
        if approve_qty < int(it["quantity"]):
            full_fulfilment = False
        await _adjust_reservation(wholesaler_id, it["product_id"], approve_qty)
        items_out.append({**it, "approved_quantity": approve_qty})

    new_status = "allocated"            # approval = inventory allocation event
    actor = user.get("email") or "wholesaler"

    await db.wholesaler_orders.update_one(
        {"id": order_id},
        {"$set": {
            "items": items_out,
            "status": new_status,
            "approved_at": now_iso(),
            "allocated_at": now_iso(),
            "updated_at": now_iso(),
            "fully_fulfilled_at_approval": full_fulfilment,
         },
         "$push": {
            "status_history": {"$each": [
                _history_event("approved", actor, "Order approved"),
                _history_event("allocated", "system", "Inventory reserved"),
            ]},
         }},
    )

    # Create the fulfillment order
    items_for_ful = [{
        "product_id": it["product_id"],
        "product_name": it.get("product_name"),
        "sku": it.get("sku"),
        "quantity": int(it.get("approved_quantity", 0)),
        "picked_quantity": 0,
        "packed_quantity": 0,
        "batch_number": "",
    } for it in items_out if int(it.get("approved_quantity", 0)) > 0]
    ful_num = await _next_seq("wholesaler_fulfillment_orders", "FUL")
    ful_doc = {
        "id": new_id(),
        "fulfillment_number": ful_num,
        "wholesaler_id": wholesaler_id,
        "order_id": order_id,
        "order_number": order["order_number"],
        "distributor_id": order["distributor_id"],
        "distributor": order["distributor"],
        "items": items_for_ful,
        "status": "allocated",
        "priority": order.get("priority", "normal"),
        "assigned_warehouse": wholesaler_id,
        "shortage_reported": False,
        "status_history": [
            _history_event("allocated", actor, "Created from approval"),
        ],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.wholesaler_fulfillment_orders.insert_one(ful_doc)
    return {"ok": True, "status": new_status,
            "fulfillment_id": ful_doc["id"],
            "fulfillment_number": ful_num}


@router.post("/wholesaler/{wholesaler_id}/orders/{order_id}/reject")
async def reject_order(wholesaler_id: str, order_id: str,
                       payload: RejectPayload,
                       user: dict = Depends(require_wholesaler_access)):
    order = await db.wholesaler_orders.find_one(
        {"id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] not in ("submitted",):
        raise HTTPException(400, f"Cannot reject order in status {order['status']}")
    await db.wholesaler_orders.update_one(
        {"id": order_id},
        {"$set": {"status": "rejected", "rejected_at": now_iso(),
                  "reject_reason": payload.reason, "updated_at": now_iso()},
         "$push": {"status_history": _history_event(
             "rejected", user.get("email", "wholesaler"), payload.reason)}},
    )
    return {"ok": True, "status": "rejected"}


@router.post("/wholesaler/{wholesaler_id}/orders/{order_id}/modify")
async def modify_order(wholesaler_id: str, order_id: str,
                       payload: ModifyPayload,
                       user: dict = Depends(require_wholesaler_access)):
    """Modify approved quantities (partial fulfillment). Optionally flag
    remainder as backorder. Creates a fulfillment for the approved qty."""
    order = await db.wholesaler_orders.find_one(
        {"id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "submitted":
        raise HTTPException(400, f"Cannot modify order in status {order['status']}")

    approved_map = {p.product_id: p.approved_quantity for p in payload.items}
    items_out = []
    any_partial = False
    any_full = False
    for it in order["items"]:
        approved = approved_map.get(it["product_id"], 0)
        requested = int(it["quantity"])
        approved = max(0, min(approved, requested))
        if approved < requested:
            any_partial = True
        if approved == requested:
            any_full = True
        await _adjust_reservation(wholesaler_id, it["product_id"], approved)
        items_out.append({**it, "approved_quantity": approved})

    actor = user.get("email") or "wholesaler"
    has_approved = any(int(i.get("approved_quantity", 0)) > 0 for i in items_out)

    if not has_approved and payload.backorder_remainder:
        new_status = "backordered"
    elif not has_approved:
        new_status = "rejected"
    else:
        new_status = "allocated"

    update_fields = {
        "items": items_out,
        "status": new_status,
        "approved_at": now_iso(),
        "updated_at": now_iso(),
        "modify_note": payload.note or "",
        "partial_fulfilment": any_partial and any_full,
        "backorder_remainder": payload.backorder_remainder,
    }
    if new_status == "allocated":
        update_fields["allocated_at"] = now_iso()
    if new_status == "backordered":
        update_fields["backorder_reason"] = payload.note or "Insufficient stock"

    history_events = [_history_event(
        "modified", actor,
        payload.note or "Quantities modified for partial fulfilment")]
    if new_status == "allocated":
        history_events.append(_history_event("allocated", "system",
                                             "Approved quantities reserved"))
    elif new_status == "backordered":
        history_events.append(_history_event(
            "backordered", actor,
            payload.note or "No stock — full order backordered"))
    elif new_status == "rejected":
        history_events.append(_history_event("rejected", actor,
                                             "No quantities approved"))

    await db.wholesaler_orders.update_one(
        {"id": order_id},
        {"$set": update_fields,
         "$push": {"status_history": {"$each": history_events}}},
    )

    if new_status == "allocated":
        items_for_ful = [{
            "product_id": it["product_id"],
            "product_name": it.get("product_name"),
            "sku": it.get("sku"),
            "quantity": int(it.get("approved_quantity", 0)),
            "picked_quantity": 0,
            "packed_quantity": 0,
            "batch_number": "",
        } for it in items_out if int(it.get("approved_quantity", 0)) > 0]
        ful_num = await _next_seq("wholesaler_fulfillment_orders", "FUL")
        ful_doc = {
            "id": new_id(),
            "fulfillment_number": ful_num,
            "wholesaler_id": wholesaler_id,
            "order_id": order_id,
            "order_number": order["order_number"],
            "distributor_id": order["distributor_id"],
            "distributor": order["distributor"],
            "items": items_for_ful,
            "status": "allocated",
            "priority": order.get("priority", "normal"),
            "assigned_warehouse": wholesaler_id,
            "shortage_reported": False,
            "status_history": [
                _history_event("allocated", actor, "Partial fulfilment created"),
            ],
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.wholesaler_fulfillment_orders.insert_one(ful_doc)

    return {"ok": True, "status": new_status}


@router.post("/wholesaler/{wholesaler_id}/orders/{order_id}/cancel")
async def cancel_order(wholesaler_id: str, order_id: str,
                       user: dict = Depends(require_wholesaler_access)):
    order = await db.wholesaler_orders.find_one(
        {"id": order_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] in ("shipped", "delivered", "cancelled", "rejected"):
        raise HTTPException(400, f"Cannot cancel order in status {order['status']}")
    # Release any reservations
    for it in order.get("items", []):
        await _adjust_reservation(
            wholesaler_id, it["product_id"], -int(it.get("approved_quantity", 0))
        )
    await db.wholesaler_orders.update_one(
        {"id": order_id},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso(),
                  "updated_at": now_iso()},
         "$push": {"status_history": _history_event(
             "cancelled", user.get("email", "wholesaler"), "Order cancelled")}},
    )
    return {"ok": True, "status": "cancelled"}


# ===========================================================================
# FULFILLMENT
# ===========================================================================


@router.get("/wholesaler/{wholesaler_id}/fulfillments")
async def list_fulfillments(wholesaler_id: str,
                            status: Optional[str] = None,
                            _user: dict = Depends(require_wholesaler_access)):
    q: dict = {"wholesaler_id": wholesaler_id}
    if status:
        q["status"] = status
    return await db.wholesaler_fulfillment_orders.find(q, {"_id": 0}).sort(
        "created_at", -1
    ).to_list(500)


@router.get("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}")
async def get_fulfillment(wholesaler_id: str, ful_id: str,
                          _user: dict = Depends(require_wholesaler_access)):
    ful = await db.wholesaler_fulfillment_orders.find_one(
        {"id": ful_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ful:
        raise HTTPException(404, "Fulfillment not found")
    return ful


_FUL_TRANSITIONS = {
    "allocated":  "picking",
    "picking":    "picked",
    "picked":     "packing",
    "packing":    "packed",
    "packed":     "ready_for_dispatch",
}

_FUL_ACTION_TO_STATUS = {
    "start-picking":      ("allocated", "picking"),
    "complete-picking":   ("picking",   "picked"),
    "start-packing":      ("picked",    "packing"),
    "complete-packing":   ("packing",   "packed"),
    "ready-dispatch":     ("packed",    "ready_for_dispatch"),
}


async def _transition_fulfillment(wholesaler_id: str, ful_id: str,
                                  action: str, actor: str,
                                  note: Optional[str] = None,
                                  payload_items: Optional[List[dict]] = None
                                  ) -> dict:
    ful = await db.wholesaler_fulfillment_orders.find_one(
        {"id": ful_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ful:
        raise HTTPException(404, "Fulfillment not found")
    expected, target = _FUL_ACTION_TO_STATUS[action]
    if ful["status"] != expected:
        raise HTTPException(400,
                            f"Cannot {action} from status {ful['status']}")

    updates: dict = {"status": target, "updated_at": now_iso()}
    timestamp_field = {
        "picking": "picking_started_at",
        "picked": "picking_completed_at",
        "packing": "packing_started_at",
        "packed": "packing_completed_at",
        "ready_for_dispatch": "ready_at",
    }.get(target)
    if timestamp_field:
        updates[timestamp_field] = now_iso()

    if action == "complete-picking" and payload_items:
        # Merge picked_quantity per line
        picked_map = {it.get("product_id"): int(it.get("picked_quantity") or 0)
                      for it in payload_items}
        new_items = []
        for it in ful["items"]:
            picked = picked_map.get(it["product_id"], it["quantity"])
            new_items.append({**it, "picked_quantity": min(picked, it["quantity"])})
        updates["items"] = new_items
    elif action == "complete-packing":
        # Packed = picked (no further inspection in Phase 2)
        updates["items"] = [
            {**it, "packed_quantity": it.get("picked_quantity", it["quantity"])}
            for it in ful["items"]
        ]

    history = _history_event(target, actor, note)
    await db.wholesaler_fulfillment_orders.update_one(
        {"id": ful_id},
        {"$set": updates, "$push": {"status_history": history}},
    )

    # Mirror status on the parent order at the matching coarser stage
    coarser = {
        "picking": "picking",
        "picked": "picking",
        "packing": "packing",
        "packed": "packing",
        "ready_for_dispatch": "ready_for_dispatch",
    }.get(target)
    if coarser:
        await db.wholesaler_orders.update_one(
            {"id": ful["order_id"]},
            {"$set": {"status": coarser, "updated_at": now_iso()},
             "$push": {"status_history": _history_event(coarser, "system",
                                                        f"Fulfilment {ful['fulfillment_number']}")}},
        )

    return {"ok": True, "status": target}


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/start-picking")
async def start_picking(wholesaler_id: str, ful_id: str,
                        user: dict = Depends(require_wholesaler_access)):
    return await _transition_fulfillment(
        wholesaler_id, ful_id, "start-picking",
        user.get("email") or "wholesaler"
    )


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/complete-picking")
async def complete_picking(wholesaler_id: str, ful_id: str,
                           payload: CompletePickPayload,
                           user: dict = Depends(require_wholesaler_access)):
    return await _transition_fulfillment(
        wholesaler_id, ful_id, "complete-picking",
        user.get("email") or "wholesaler",
        note=payload.note,
        payload_items=payload.items,
    )


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/report-shortage")
async def report_shortage(wholesaler_id: str, ful_id: str,
                          payload: ShortagePayload,
                          user: dict = Depends(require_wholesaler_access)):
    ful = await db.wholesaler_fulfillment_orders.find_one(
        {"id": ful_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ful:
        raise HTTPException(404, "Fulfillment not found")
    await db.wholesaler_fulfillment_orders.update_one(
        {"id": ful_id},
        {"$set": {"shortage_reported": True,
                  "shortage_note": payload.note,
                  "shortage_items": payload.items or [],
                  "updated_at": now_iso()},
         "$push": {"status_history": _history_event(
             ful["status"], user.get("email", "wholesaler"),
             f"SHORTAGE: {payload.note}")}},
    )
    return {"ok": True}


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/start-packing")
async def start_packing(wholesaler_id: str, ful_id: str,
                        user: dict = Depends(require_wholesaler_access)):
    return await _transition_fulfillment(
        wholesaler_id, ful_id, "start-packing",
        user.get("email") or "wholesaler",
    )


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/complete-packing")
async def complete_packing(wholesaler_id: str, ful_id: str,
                           user: dict = Depends(require_wholesaler_access)):
    return await _transition_fulfillment(
        wholesaler_id, ful_id, "complete-packing",
        user.get("email") or "wholesaler",
    )


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/ready-dispatch")
async def ready_dispatch(wholesaler_id: str, ful_id: str,
                         user: dict = Depends(require_wholesaler_access)):
    return await _transition_fulfillment(
        wholesaler_id, ful_id, "ready-dispatch",
        user.get("email") or "wholesaler",
    )


@router.post("/wholesaler/{wholesaler_id}/fulfillments/{ful_id}/dispatch")
async def dispatch_fulfillment(wholesaler_id: str, ful_id: str,
                               user: dict = Depends(require_wholesaler_access)):
    """Final fulfillment action — creates a shipment, decrements on-hand
    stock, marks the parent order as 'shipped'."""
    wh = await get_wholesaler_org(wholesaler_id)
    ful = await db.wholesaler_fulfillment_orders.find_one(
        {"id": ful_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ful:
        raise HTTPException(404, "Fulfillment not found")
    if ful["status"] != "ready_for_dispatch":
        raise HTTPException(400,
                            f"Cannot dispatch from status {ful['status']}")

    actor = user.get("email") or "wholesaler"
    order = await db.wholesaler_orders.find_one(
        {"id": ful["order_id"]}, {"_id": 0},
    )

    # Build the shipment (use packed_quantity, fallback to quantity)
    ship_items = [{
        "product_id": it["product_id"],
        "product_name": it.get("product_name"),
        "sku": it.get("sku"),
        "batch_number": it.get("batch_number") or "",
        "quantity": int(it.get("packed_quantity") or it.get("quantity") or 0),
    } for it in ful["items"]]

    ship_num = await _next_seq("wholesaler_shipments", "WSHIP")
    distributor = ful["distributor"]

    expected = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    ship_doc = {
        "id": new_id(),
        "shipment_number": ship_num,
        "wholesaler_id": wholesaler_id,
        "fulfillment_id": ful_id,
        "order_id": ful["order_id"],
        "order_number": ful["order_number"],
        "distributor_id": ful["distributor_id"],
        "distributor": distributor,
        "items": ship_items,
        "total_units": sum(it["quantity"] for it in ship_items),
        "status": "loaded",                 # dispatch action = goods loaded
        "origin_lat": wh.get("latitude"),
        "origin_lng": wh.get("longitude"),
        "destination_lat": None,
        "destination_lng": None,
        "eta_minutes": 90,
        "shipment_date": now_iso(),
        "expected_delivery_date": expected,
        "status_history": [
            _history_event("created", actor, "Shipment created from fulfillment"),
            _history_event("loaded", actor, "Goods loaded"),
        ],
        "created_at": now_iso(),
        "loaded_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.wholesaler_shipments.insert_one(ship_doc)

    # Decrement physical stock, release reservation, bump in_transit
    await _decrement_stock_on_dispatch(wholesaler_id, ship_items)

    # Fulfillment → dispatched
    await db.wholesaler_fulfillment_orders.update_one(
        {"id": ful_id},
        {"$set": {"status": "dispatched", "dispatched_at": now_iso(),
                  "shipment_id": ship_doc["id"],
                  "shipment_number": ship_num,
                  "updated_at": now_iso()},
         "$push": {"status_history": _history_event(
             "dispatched", actor, f"Shipment {ship_num} created")}},
    )
    # Order → shipped
    if order and order["status"] not in ("shipped", "delivered"):
        await db.wholesaler_orders.update_one(
            {"id": order["id"]},
            {"$set": {"status": "shipped", "shipped_at": now_iso(),
                      "shipment_id": ship_doc["id"],
                      "fulfillment_id": ful_id,
                      "updated_at": now_iso()},
             "$push": {"status_history": _history_event(
                 "shipped", actor, f"Dispatched via {ship_num}")}},
        )

    return {"ok": True, "shipment_id": ship_doc["id"],
            "shipment_number": ship_num}


# ===========================================================================
# SHIPMENTS
# ===========================================================================


@router.get("/wholesaler/{wholesaler_id}/shipments/dashboard")
async def shipments_dashboard(wholesaler_id: str,
                              _user: dict = Depends(require_wholesaler_access)):
    today = datetime.now(timezone.utc).date().isoformat()
    rows = await db.wholesaler_shipments.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0},
    ).to_list(2000)
    active = sum(1 for r in rows if r["status"] in ("created", "loaded", "in_transit"))
    delivered_today = sum(1 for r in rows if r["status"] == "delivered"
                          and (r.get("delivered_at") or "")[:10] == today)
    delayed = sum(1 for r in rows if r["status"] == "delayed")
    pending_dispatch = sum(1 for r in rows if r["status"] in ("created",))
    # Average delivery time (created → delivered) in hours
    times: List[float] = []
    for r in rows:
        if r.get("status") == "delivered" and r.get("created_at") and r.get("delivered_at"):
            try:
                t0 = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
                t1 = datetime.fromisoformat(r["delivered_at"].replace("Z", "+00:00"))
                times.append((t1 - t0).total_seconds() / 3600.0)
            except Exception:
                pass
    avg_hours = round(sum(times) / len(times), 1) if times else None
    return {
        "kpis": {
            "active_shipments": active,
            "delivered_today": delivered_today,
            "delayed_shipments": delayed,
            "pending_dispatch": pending_dispatch,
            "avg_delivery_hours": avg_hours,
        },
        "as_of": now_iso(),
    }


@router.get("/wholesaler/{wholesaler_id}/shipments")
async def list_shipments(wholesaler_id: str,
                         status: Optional[str] = None,
                         distributor_id: Optional[str] = None,
                         region: Optional[str] = None,
                         _user: dict = Depends(require_wholesaler_access)):
    q: dict = {"wholesaler_id": wholesaler_id}
    if status:
        q["status"] = status
    if distributor_id:
        q["distributor_id"] = distributor_id
    if region:
        q["distributor.region"] = region
    return await db.wholesaler_shipments.find(q, {"_id": 0}).sort(
        "created_at", -1
    ).to_list(500)


@router.get("/wholesaler/{wholesaler_id}/shipments/{ship_id}")
async def get_shipment(wholesaler_id: str, ship_id: str,
                       _user: dict = Depends(require_wholesaler_access)):
    ship = await db.wholesaler_shipments.find_one(
        {"id": ship_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ship:
        raise HTTPException(404, "Shipment not found")
    return ship


_SHIP_ACTIONS = {
    "load":          ("created",    "loaded"),
    "start-transit": ("loaded",     "in_transit"),
    "deliver":       ("in_transit", "delivered"),
}


# NOTE: the generic /{action} catch-all is registered AFTER the explicit
# /delay and /cancel routes below so that FastAPI doesn't shadow them.
async def transition_shipment(wholesaler_id: str, ship_id: str, action: str,
                              user: dict = Depends(require_wholesaler_access)):
    ship = await db.wholesaler_shipments.find_one(
        {"id": ship_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ship:
        raise HTTPException(404, "Shipment not found")
    if action not in _SHIP_ACTIONS:
        raise HTTPException(400, "Unsupported action")
    expected, target = _SHIP_ACTIONS[action]
    if ship["status"] != expected:
        raise HTTPException(400, f"Cannot {action} from status {ship['status']}")

    actor = user.get("email") or "wholesaler"
    updates: dict = {"status": target, "updated_at": now_iso()}
    ts_field = {
        "loaded": "loaded_at",
        "in_transit": "in_transit_at",
        "delivered": "delivered_at",
    }.get(target)
    if ts_field:
        updates[ts_field] = now_iso()

    await db.wholesaler_shipments.update_one(
        {"id": ship_id},
        {"$set": updates,
         "$push": {"status_history": _history_event(target, actor, "")}},
    )

    if target == "delivered":
        # Settle in_transit and roll the order to delivered
        await _settle_in_transit_on_delivery(wholesaler_id, ship.get("items", []))
        await db.wholesaler_orders.update_one(
            {"id": ship["order_id"]},
            {"$set": {"status": "delivered", "delivered_at": now_iso(),
                      "updated_at": now_iso()},
             "$push": {"status_history": _history_event(
                 "delivered", actor, f"Shipment {ship['shipment_number']} delivered")}},
        )
        await db.wholesaler_fulfillment_orders.update_one(
            {"id": ship["fulfillment_id"]},
            {"$set": {"status": "delivered", "delivered_at": now_iso(),
                      "updated_at": now_iso()},
             "$push": {"status_history": _history_event(
                 "delivered", actor, f"Shipment {ship['shipment_number']} delivered")}},
        )

    return {"ok": True, "status": target}


@router.post("/wholesaler/{wholesaler_id}/shipments/{ship_id}/delay")
async def delay_shipment(wholesaler_id: str, ship_id: str,
                         payload: DelayPayload,
                         user: dict = Depends(require_wholesaler_access)):
    ship = await db.wholesaler_shipments.find_one(
        {"id": ship_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ship:
        raise HTTPException(404, "Shipment not found")
    if ship["status"] in ("delivered", "cancelled", "failed"):
        raise HTTPException(400, "Shipment already closed")
    updates = {"status": "delayed", "delay_reason": payload.reason,
               "updated_at": now_iso()}
    if payload.eta_minutes is not None:
        updates["eta_minutes"] = int(payload.eta_minutes)
    await db.wholesaler_shipments.update_one(
        {"id": ship_id},
        {"$set": updates,
         "$push": {"status_history": _history_event(
             "delayed", user.get("email", "wholesaler"),
             f"Delay: {payload.reason}")}},
    )
    return {"ok": True, "status": "delayed"}


@router.post("/wholesaler/{wholesaler_id}/shipments/{ship_id}/cancel")
async def cancel_shipment(wholesaler_id: str, ship_id: str,
                          user: dict = Depends(require_wholesaler_access)):
    ship = await db.wholesaler_shipments.find_one(
        {"id": ship_id, "wholesaler_id": wholesaler_id}, {"_id": 0},
    )
    if not ship:
        raise HTTPException(404, "Shipment not found")
    if ship["status"] in ("delivered", "cancelled"):
        raise HTTPException(400, "Cannot cancel a closed shipment")
    # Roll back: release in_transit if any
    if ship["status"] in ("loaded", "in_transit", "delayed"):
        # The stock has already been moved to in_transit when loaded — push
        # it back to on-hand so we don't lose inventory.
        for it in (ship.get("items") or []):
            row = await db.inventory.find_one(
                {"owner_type": "wholesaler", "owner_id": wholesaler_id,
                 "product_id": it["product_id"]},
                {"_id": 0, "id": 1, "quantity": 1, "in_transit": 1},
            )
            if not row:
                continue
            qty = int(it.get("quantity") or 0)
            new_in_transit = max(0, int(row.get("in_transit") or 0) - qty)
            new_qty = int(row.get("quantity") or 0) + qty
            await db.inventory.update_one(
                {"id": row["id"]},
                {"$set": {"quantity": new_qty, "in_transit": new_in_transit,
                          "updated_at": now_iso()}},
            )
    await db.wholesaler_shipments.update_one(
        {"id": ship_id},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso(),
                  "updated_at": now_iso()},
         "$push": {"status_history": _history_event(
             "cancelled", user.get("email", "wholesaler"),
             "Shipment cancelled, stock returned")}},
    )
    return {"ok": True, "status": "cancelled"}



# Register the generic catch-all transition LAST so /delay and /cancel
# (declared above) are matched first by FastAPI's route table.
router.add_api_route(
    "/wholesaler/{wholesaler_id}/shipments/{ship_id}/{action}",
    transition_shipment,
    methods=["POST"],
)
