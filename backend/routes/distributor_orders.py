"""Distributor → Manufacturer order fulfillment workflow.

Distributors place purchase orders on the manufacturer. The manufacturer
approves / rejects them, then dispatches an approved order which converts
into a Shipment (re-using the existing shipments lifecycle, so the existing
'distributor marks delivered → manufacturer gets notified' path keeps working
unchanged).

Status machine:
    pending → approved → dispatched → delivered     (happy path)
    pending → rejected                              (decline path)

Collections:
    distributor_orders
        id, manufacturer_id, distributor_id,
        items: [{product_id, quantity}],
        note (optional),
        status, created_at,
        approved_at, approved_by_user_id,
        rejected_at, rejection_reason,
        dispatched_at, shipment_id,
        delivered_at
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from models import Shipment
from services.helpers import denorm_ids, push_notification

router = APIRouter()


# ----------------------------------------------------------------------------
# Pydantic schemas
# ----------------------------------------------------------------------------
class OrderItem(BaseModel):
    product_id: str
    quantity: int = Field(..., gt=0)


class OrderCreate(BaseModel):
    manufacturer_id: str
    items: List[OrderItem]
    note: Optional[str] = None


class RejectPayload(BaseModel):
    reason: Optional[str] = None


# ----------------------------------------------------------------------------
# Distributor endpoints
# ----------------------------------------------------------------------------
@router.post("/distributor/{distributor_id}/orders")
async def create_distributor_order(distributor_id: str, payload: OrderCreate):
    distributor = await db.distributors.find_one({"id": distributor_id}, {"_id": 0})
    if not distributor:
        raise HTTPException(404, "Distributor not found")
    manufacturer = await db.manufacturers.find_one(
        {"id": payload.manufacturer_id}, {"_id": 0},
    )
    if not manufacturer:
        raise HTTPException(404, "Manufacturer not found")

    order = {
        "id": str(uuid.uuid4()),
        "manufacturer_id": payload.manufacturer_id,
        "distributor_id": distributor_id,
        "items": [item.model_dump() for item in payload.items],
        "note": payload.note,
        "status": "pending",
        "created_at": now_iso(),
        "approved_at": None,
        "rejected_at": None,
        "dispatched_at": None,
        "delivered_at": None,
        "shipment_id": None,
        "rejection_reason": None,
    }
    await db.distributor_orders.insert_one(order)
    order.pop("_id", None)

    await push_notification(
        "manufacturer", payload.manufacturer_id,
        "New Order Received",
        f"{distributor['name']} has placed a new purchase order ({len(payload.items)} SKUs).",
        "order",
    )
    return order


@router.get("/distributor/{distributor_id}/orders")
async def list_distributor_orders(distributor_id: str):
    """Distributor-side view of their own outbound orders."""
    return await _list_orders({"distributor_id": distributor_id})


# ----------------------------------------------------------------------------
# Manufacturer endpoints
# ----------------------------------------------------------------------------
@router.get("/manufacturer/{manufacturer_id}/distributor-orders")
async def list_manufacturer_orders(manufacturer_id: str):
    """Inbound queue for the manufacturer — every order distributors placed."""
    return await _list_orders({"manufacturer_id": manufacturer_id})


async def _list_orders(query: dict) -> List[dict]:
    orders = await db.distributor_orders.find(query, {"_id": 0}) \
        .sort("created_at", -1).to_list(2000)
    # Denormalise distributor + product names so the table can render in 1 round-trip.
    dist_ids = {o["distributor_id"] for o in orders}
    distributors = {d["id"]: d for d in await db.distributors.find(
        {"id": {"$in": list(dist_ids)}}, {"_id": 0},
    ).to_list(None)}
    prod_ids = {it["product_id"] for o in orders for it in o.get("items", [])}
    products = {p["id"]: p for p in await db.products.find(
        {"id": {"$in": list(prod_ids)}}, {"_id": 0},
    ).to_list(None)}

    for o in orders:
        d = distributors.get(o["distributor_id"], {})
        o["distributor_name"] = d.get("name", "Unknown")
        o["distributor_city"] = d.get("city", "")
        total_units = 0
        total_value = 0.0
        for it in o.get("items", []):
            p = products.get(it["product_id"], {})
            qty = int(it.get("quantity", 0))
            total_units += qty
            total_value += float(p.get("unit_price", 0) or 0) * qty
            it["product_name"] = p.get("name", "Unknown")
            it["sku"] = p.get("sku", "")
            it["unit_price"] = p.get("unit_price", 0)
        o["total_units"] = total_units
        o["total_value"] = round(total_value, 2)

        # Keep the delivered flag in sync with the underlying shipment so the
        # manufacturer sees real-time status without polling another table.
        if o["status"] == "dispatched" and o.get("shipment_id"):
            sh = await db.shipments.find_one(
                {"id": o["shipment_id"]}, {"_id": 0, "status": 1, "received_at": 1},
            )
            if sh and sh.get("status") == "received":
                o["status"] = "delivered"
                o["delivered_at"] = sh.get("received_at") or now_iso()
                await db.distributor_orders.update_one(
                    {"id": o["id"]},
                    {"$set": {"status": "delivered", "delivered_at": o["delivered_at"]}},
                )
    return orders


async def _load_order(manufacturer_id: str, order_id: str) -> dict:
    order = await db.distributor_orders.find_one(
        {"id": order_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Order not found")
    return order


@router.post("/manufacturer/{manufacturer_id}/distributor-orders/{order_id}/approve")
async def approve_order(manufacturer_id: str, order_id: str):
    order = await _load_order(manufacturer_id, order_id)
    if order["status"] != "pending":
        raise HTTPException(400, f"Cannot approve an order in '{order['status']}' state")
    update = {"status": "approved", "approved_at": now_iso()}
    await db.distributor_orders.update_one({"id": order_id}, {"$set": update})
    await push_notification(
        "distributor", order["distributor_id"],
        "Order Approved",
        "Your order has been approved and is queued for dispatch.",
        "order",
    )
    order.update(update)
    _invalidate_caches(manufacturer_id)
    return order


@router.post("/manufacturer/{manufacturer_id}/distributor-orders/{order_id}/reject")
async def reject_order(manufacturer_id: str, order_id: str, payload: RejectPayload):
    order = await _load_order(manufacturer_id, order_id)
    if order["status"] != "pending":
        raise HTTPException(400, f"Cannot reject an order in '{order['status']}' state")
    update = {
        "status": "rejected",
        "rejected_at": now_iso(),
        "rejection_reason": payload.reason,
    }
    await db.distributor_orders.update_one({"id": order_id}, {"$set": update})
    await push_notification(
        "distributor", order["distributor_id"],
        "Order Rejected",
        f"Your order was rejected{': ' + payload.reason if payload.reason else '.'}",
        "order",
    )
    order.update(update)
    _invalidate_caches(manufacturer_id)
    return order


@router.post("/manufacturer/{manufacturer_id}/distributor-orders/{order_id}/dispatch")
async def dispatch_order(manufacturer_id: str, order_id: str):
    """Convert an approved order into a Shipment.

    Re-uses the existing shipments lifecycle so the distributor's
    'Mark delivered' path automatically updates the order to delivered
    (see _list_orders above).
    """
    order = await _load_order(manufacturer_id, order_id)
    if order["status"] not in ("approved", "pending"):
        raise HTTPException(400, f"Cannot dispatch an order in '{order['status']}' state")

    denorm = denorm_ids(
        "manufacturer", manufacturer_id, "distributor", order["distributor_id"],
    )
    sh = Shipment(
        from_role="manufacturer", from_id=manufacturer_id,
        to_role="distributor", to_id=order["distributor_id"],
        items=order["items"],
        notes=order.get("note"),
        request_id=order["id"],
        **denorm,
    )
    sh_doc = sh.model_dump()
    # Dispatch immediately on creation.
    sh_doc["status"] = "in_transit"
    sh_doc["dispatched_at"] = now_iso()
    await db.shipments.insert_one(sh_doc)

    update = {
        "status": "dispatched",
        "dispatched_at": sh_doc["dispatched_at"],
        "shipment_id": sh_doc["id"],
    }
    await db.distributor_orders.update_one({"id": order_id}, {"$set": update})
    await push_notification(
        "distributor", order["distributor_id"],
        "Shipment Dispatched",
        f"Your order has been dispatched (tracking {sh_doc['tracking_code']}).",
        "shipment",
    )
    order.update(update)
    order["shipment"] = {
        "id": sh_doc["id"],
        "tracking_code": sh_doc["tracking_code"],
        "status": sh_doc["status"],
    }
    _invalidate_caches(manufacturer_id)
    return order


def _invalidate_caches(manufacturer_id: str):
    try:
        from services.snapshots import db as _db
        import asyncio
        async def _drop():
            await _db.dashboard_snapshots.delete_many({"manufacturer_id": manufacturer_id})
        loop = asyncio.get_event_loop()
        loop.create_task(_drop())
    except Exception:
        pass
