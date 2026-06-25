"""Retailer Procurement workspace endpoints.

Implements the four sub-modules + AI assistant:
  - Cart  (server-persisted, one cart per retailer)
  - Purchase Orders  (full lifecycle w/ 8 statuses + PO numbers)
  - Order History    (read-only view, same store, filtered)
  - Supplier Quotes  (multi-distributor RFQs with side-by-side responses)
  - AI Reorder Recommendations  (deterministic v1)

Statuses for Purchase Orders:
    draft → submitted → approved → processing → shipped → delivered
                     ↘ rejected
                     ↘ cancelled (at any time before shipped)

PO numbers are zero-padded sequences `PO-YYYY-NNNNN` allocated atomically
via a `counters` collection so two parallel writers can't collide.
Quote numbers follow the same idea (`QT-YYYY-NNNN`).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from core import db, logger, new_id, now_iso
from models import (
    Cart, CartItem, CartItemUpdate, CartItemUpsert,
    POAction, POLine, PurchaseOrder, PurchaseOrderCreate, StatusEvent,
    QuoteCreate, QuoteRespondPayload, QuoteResponse, Shipment, ShipmentLine,
    SupplierQuote,
)
from services.helpers import denorm_ids, push_notification

router = APIRouter()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
async def _next_counter(key: str) -> int:
    """Atomic sequence allocator backed by `counters` collection."""
    doc = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,  # type: ignore[arg-type]
    )
    # Some Mongo drivers return the pre-update doc on upsert; defend:
    if not doc:
        d = await db.counters.find_one({"_id": key})
        return int(d["seq"]) if d else 1
    return int(doc.get("seq", 1))


async def _next_po_number() -> str:
    year = datetime.now(timezone.utc).year
    seq = await _next_counter(f"po_seq_{year}")
    return f"PO-{year}-{seq:05d}"


async def _next_quote_number() -> str:
    year = datetime.now(timezone.utc).year
    seq = await _next_counter(f"qt_seq_{year}")
    return f"QT-{year}-{seq:04d}"


def _line_total(qty: int, unit_cost: float) -> float:
    return round(qty * unit_cost, 2)


async def _denorm_po(po: dict, distributors: dict, retailers: dict, products: dict, wholesalers: dict) -> dict:
    stype = po.get("supplier_type") or "wholesaler"
    if stype == "wholesaler":
        po["supplier"] = wholesalers.get(po["distributor_id"], {})
        po["distributor"] = po["supplier"]  # legacy field kept for old UI
    else:
        po["supplier"] = distributors.get(po["distributor_id"], {})
        po["distributor"] = po["supplier"]
    po["supplier_type"] = stype
    po["retailer"] = retailers.get(po["retailer_id"], {})
    for it in po.get("items", []):
        it["product"] = products.get(it["product_id"], {})
    return po


async def _load_lookups() -> tuple[dict, dict, dict, dict]:
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    wholesalers = {
        w["id"]: {**w, "name": w.get("name") or w.get("organization_name", "")}
        for w in await db.organizations.find(
            {"organization_type": "wholesaler"}, {"_id": 0},
        ).to_list(20000)
    }
    return distributors, retailers, products, wholesalers


async def _push_status_event(po_id: str, status: str, by: Optional[str] = None,
                             note: Optional[str] = None, extra: Optional[dict] = None):
    ev = StatusEvent(status=status, by=by, note=note).model_dump()  # type: ignore[arg-type]
    update: Dict[str, Any] = {
        "$set": {"status": status, "updated_at": now_iso(), **(extra or {})},
        "$push": {"status_history": ev},
    }
    await db.purchase_orders.update_one({"id": po_id}, update)


def _is_terminal(status: str) -> bool:
    return status in ("delivered", "cancelled", "rejected")


# ---------------------------------------------------------------------------
# Retailer-side supplier discovery
# ---------------------------------------------------------------------------
@router.get("/procurement/retailer/{retailer_id}/suppliers")
async def list_retailer_suppliers(retailer_id: str):
    """Suppliers a retailer can buy from:

    - Primary: the **wholesaler** they're parented under (the retailer's
      organization `parent_organization_id`). Wholesalers serve retailers.
    - Fallback: the legacy **distributor** linked on the `retailers` doc
      (kept open so large retailers like Shoprite can be served directly
      by a distributor).
    """
    retailer_doc = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer_doc:
        raise HTTPException(404, "Retailer not found")
    out: List[dict] = []

    # Primary — wholesaler parent (organization hierarchy).
    org = await db.organizations.find_one(
        {"id": retailer_id, "organization_type": "retailer"}, {"_id": 0},
    )
    if org and org.get("parent_organization_id"):
        wh = await db.organizations.find_one(
            {"id": org["parent_organization_id"], "organization_type": "wholesaler"},
            {"_id": 0},
        )
        if wh:
            out.append({
                "id": wh["id"], "supplier_type": "wholesaler",
                "name": wh.get("organization_name") or wh.get("name", ""),
                "code": wh.get("organization_code", ""),
                "region": wh.get("region", ""),
                "city": wh.get("city", ""),
                "is_primary": True,
            })

    # Fallback — direct distributor (legacy link).
    dist_id = retailer_doc.get("distributor_id")
    if dist_id:
        dist = await db.distributors.find_one({"id": dist_id}, {"_id": 0})
        if dist:
            out.append({
                "id": dist["id"], "supplier_type": "distributor",
                "name": dist.get("name", ""),
                "code": dist.get("code", ""),
                "region": dist.get("region", ""),
                "city": dist.get("city", ""),
                "is_primary": False,
                "note": "Direct distributor (key-account / large-format)",
            })
    return out



# ---------------------------------------------------------------------------
# Cart
# ---------------------------------------------------------------------------
@router.get("/procurement/cart/{retailer_id}")
async def get_cart(retailer_id: str):
    doc = await db.procurement_carts.find_one({"retailer_id": retailer_id}, {"_id": 0})
    if not doc:
        doc = Cart(retailer_id=retailer_id).model_dump()
        await db.procurement_carts.insert_one(doc.copy())
    return await _enrich_cart(doc)


async def _enrich_cart(cart: dict) -> dict:
    distributors, _, products, wholesalers = await _load_lookups()
    enriched_items = []
    subtotal = 0.0
    by_supplier: Dict[str, dict] = {}
    for it in cart.get("items", []):
        product = products.get(it["product_id"], {})
        stype = it.get("supplier_type") or "wholesaler"
        if stype == "wholesaler":
            supplier = wholesalers.get(it["distributor_id"], {})
        else:
            supplier = distributors.get(it["distributor_id"], {})
        line_total = _line_total(int(it["quantity"]), float(it["unit_cost"]))
        subtotal += line_total
        row = {**it, "supplier_type": stype, "product": product,
               "distributor": supplier, "supplier": supplier, "line_total": line_total}
        enriched_items.append(row)
        sid = it["distributor_id"]
        key = f"{stype}:{sid}"
        bucket = by_supplier.setdefault(key, {
            "supplier_type": stype, "supplier_id": sid, "supplier": supplier,
            "distributor_id": sid, "distributor": supplier,  # legacy
            "items": [], "subtotal": 0.0,
        })
        bucket["items"].append(row)
        bucket["subtotal"] = round(bucket["subtotal"] + line_total, 2)
    cart["items"] = enriched_items
    cart["subtotal"] = round(subtotal, 2)
    cart["item_count"] = sum(int(it["quantity"]) for it in enriched_items)
    cart["unique_skus"] = len(enriched_items)
    cart["by_supplier"] = list(by_supplier.values())
    return cart


@router.post("/procurement/cart/{retailer_id}/items")
async def add_or_replace_cart_item(retailer_id: str, payload: CartItemUpsert):
    cart_doc = await db.procurement_carts.find_one({"retailer_id": retailer_id})
    if not cart_doc:
        cart_doc = Cart(retailer_id=retailer_id).model_dump()
        await db.procurement_carts.insert_one(cart_doc.copy())
    items = [CartItem(**it) for it in cart_doc.get("items", [])]
    found = False
    for it in items:
        if (it.product_id == payload.product_id
                and it.distributor_id == payload.distributor_id
                and (it.supplier_type or "wholesaler") == (payload.supplier_type or "wholesaler")):
            it.quantity = payload.quantity
            it.unit_cost = payload.unit_cost
            found = True
            break
    if not found:
        items.append(CartItem(**payload.model_dump()))
    await db.procurement_carts.update_one(
        {"retailer_id": retailer_id},
        {"$set": {"items": [i.model_dump() for i in items], "updated_at": now_iso()}},
    )
    doc = await db.procurement_carts.find_one({"retailer_id": retailer_id}, {"_id": 0})
    return await _enrich_cart(doc)


@router.patch("/procurement/cart/{retailer_id}/items/{product_id}")
async def update_cart_item(retailer_id: str, product_id: str, payload: CartItemUpdate,
                           distributor_id: Optional[str] = Query(None)):
    cart_doc = await db.procurement_carts.find_one({"retailer_id": retailer_id})
    if not cart_doc:
        raise HTTPException(404, "Cart not found")
    updated = False
    for it in cart_doc.get("items", []):
        if it["product_id"] == product_id and (
            distributor_id is None or it["distributor_id"] == distributor_id
        ):
            it["quantity"] = payload.quantity
            updated = True
    if not updated:
        raise HTTPException(404, "Item not in cart")
    await db.procurement_carts.update_one(
        {"retailer_id": retailer_id},
        {"$set": {"items": cart_doc["items"], "updated_at": now_iso()}},
    )
    doc = await db.procurement_carts.find_one({"retailer_id": retailer_id}, {"_id": 0})
    return await _enrich_cart(doc)


@router.delete("/procurement/cart/{retailer_id}/items/{product_id}")
async def delete_cart_item(retailer_id: str, product_id: str,
                           distributor_id: Optional[str] = Query(None)):
    cart_doc = await db.procurement_carts.find_one({"retailer_id": retailer_id})
    if not cart_doc:
        raise HTTPException(404, "Cart not found")
    new_items = [
        it for it in cart_doc.get("items", [])
        if not (it["product_id"] == product_id
                and (distributor_id is None or it["distributor_id"] == distributor_id))
    ]
    await db.procurement_carts.update_one(
        {"retailer_id": retailer_id},
        {"$set": {"items": new_items, "updated_at": now_iso()}},
    )
    doc = await db.procurement_carts.find_one({"retailer_id": retailer_id}, {"_id": 0})
    return await _enrich_cart(doc)


@router.delete("/procurement/cart/{retailer_id}")
async def clear_cart(retailer_id: str):
    await db.procurement_carts.update_one(
        {"retailer_id": retailer_id},
        {"$set": {"items": [], "updated_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/procurement/cart/{retailer_id}/submit")
async def submit_cart(retailer_id: str, payload: Optional[POAction] = None):
    """Splits the cart by supplier (type + id) and creates one PO per supplier."""
    cart_doc = await db.procurement_carts.find_one({"retailer_id": retailer_id})
    if not cart_doc or not cart_doc.get("items"):
        raise HTTPException(400, "Cart is empty")
    by_supplier: Dict[str, List[dict]] = {}
    for it in cart_doc["items"]:
        stype = it.get("supplier_type") or "wholesaler"
        key = f"{stype}:{it['distributor_id']}"
        by_supplier.setdefault(key, []).append(it)
    note = (payload.reason if payload else None)
    created_pos: List[dict] = []
    for key, items in by_supplier.items():
        stype, supplier_id = key.split(":", 1)
        po_lines = [
            POLine(
                product_id=it["product_id"],
                quantity=int(it["quantity"]),
                unit_cost=float(it["unit_cost"]),
                line_total=_line_total(int(it["quantity"]), float(it["unit_cost"])),
            )
            for it in items
        ]
        total = round(sum(line.line_total for line in po_lines), 2)
        po = PurchaseOrder(
            po_number=await _next_po_number(),
            retailer_id=retailer_id,
            distributor_id=supplier_id,
            supplier_type=stype,
            items=po_lines,
            total_amount=total,
            status="submitted",
            note=note,
            submitted_at=now_iso(),
            status_history=[
                StatusEvent(status="draft", note="Created from cart"),
                StatusEvent(status="submitted", note=f"Sent to {stype}"),
            ],
        )
        await db.purchase_orders.insert_one(po.model_dump())
        created_pos.append(po.model_dump())
        await push_notification(
            stype, supplier_id,
            "New Purchase Order",
            f"New PO {po.po_number} received from a retailer (₦{total:,.0f}).",
            "order",
        )
    # Empty the cart
    await db.procurement_carts.update_one(
        {"retailer_id": retailer_id},
        {"$set": {"items": [], "updated_at": now_iso()}},
    )
    return {"ok": True, "purchase_orders": created_pos, "count": len(created_pos)}


# ---------------------------------------------------------------------------
# Purchase Orders
# ---------------------------------------------------------------------------
@router.get("/procurement/purchase-orders")
async def list_purchase_orders(
    retailer_id: Optional[str] = None,
    distributor_id: Optional[str] = None,
    status: Optional[str] = None,
    statuses: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    product_id: Optional[str] = None,
    q: Optional[str] = None,
    updated_since: Optional[str] = None,
    limit: int = 500,
):
    query: Dict[str, Any] = {}
    if retailer_id:
        query["retailer_id"] = retailer_id
    if distributor_id:
        query["distributor_id"] = distributor_id
    if status:
        query["status"] = status
    if statuses:
        query["status"] = {"$in": [s.strip() for s in statuses.split(",") if s.strip()]}
    if date_from:
        query.setdefault("created_at", {})["$gte"] = date_from
    if date_to:
        query.setdefault("created_at", {})["$lte"] = date_to
    if product_id:
        query["items.product_id"] = product_id
    # Offline-sync cursor: rows where updated_at > since, sorted ASC.
    if updated_since:
        query["$or"] = [
            {"updated_at": {"$gt": updated_since}},
            {"updated_at": {"$exists": False},
             "created_at": {"$gt": updated_since}},
        ]
        sort_key, sort_dir = "updated_at", 1
    else:
        sort_key, sort_dir = "created_at", -1
    docs = await db.purchase_orders.find(query, {"_id": 0}).sort(sort_key, sort_dir).to_list(limit)
    distributors, retailers, products, wholesalers = await _load_lookups()
    enriched = []
    for d in docs:
        if q:
            # Filter by free-text on PO number / supplier / product names
            supplier_map = wholesalers if (d.get("supplier_type") or "wholesaler") == "wholesaler" else distributors
            hay = " ".join([
                d.get("po_number", ""),
                (supplier_map.get(d["distributor_id"], {}) or {}).get("name", ""),
                retailers.get(d["retailer_id"], {}).get("name", ""),
                " ".join(products.get(it["product_id"], {}).get("name", "")
                         for it in d.get("items", [])),
            ]).lower()
            if q.lower() not in hay:
                continue
        enriched.append(await _denorm_po(d, distributors, retailers, products, wholesalers))
    return enriched


@router.get("/procurement/purchase-orders/{po_id}")
async def get_purchase_order(po_id: str):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "Purchase order not found")
    distributors, retailers, products, wholesalers = await _load_lookups()
    enriched = await _denorm_po(po, distributors, retailers, products, wholesalers)
    # Attach the linked shipment + live vehicle so the lifecycle timeline can
    # show TK-XXX · X% en route · ETA without an extra round-trip.
    enriched["shipment"] = None
    enriched["vehicle"] = None
    ship = await db.shipments.find_one(
        {"$or": [
            {"purchase_order_id": po_id},
            {"id": po.get("mirror_shipment_id")},
        ]},
        {"_id": 0},
    )
    if ship:
        enriched["shipment"] = {
            "id": ship.get("id"),
            "status": ship.get("status"),
            "from_role": ship.get("from_role"),
            "to_role": ship.get("to_role"),
            "tracking_code": ship.get("tracking_code"),
            "dispatched_at": ship.get("dispatched_at"),
            "delivered_at": ship.get("delivered_at"),
        }
        v = await db.vehicles.find_one(
            {"ref_id": ship["id"]},
            {"_id": 0, "id": 1, "code": 1, "plate": 1, "driver_name": 1,
             "driver_phone": 1, "status": 1, "route_progress": 1,
             "eta_minutes": 1, "lat": 1, "lng": 1, "speed_kmh": 1,
             "dest_name": 1, "origin_name": 1, "route_km": 1, "units": 1,
             "updated_at": 1},
        )
        if v:
            # Convert ETA minutes → readable absolute time guess.
            from datetime import datetime, timezone, timedelta
            eta_iso = None
            if v.get("status") == "in_transit" and v.get("eta_minutes"):
                remain = max(0, int(v["eta_minutes"]) * (1 - float(v.get("route_progress") or 0)))
                eta_iso = (datetime.now(timezone.utc) + timedelta(minutes=remain)).isoformat()
            v["eta_iso"] = eta_iso
            enriched["vehicle"] = v
    return enriched


@router.post("/procurement/purchase-orders", response_model=PurchaseOrder)
async def create_purchase_order(payload: PurchaseOrderCreate, submit: bool = False):
    """Create a draft PO directly (without going through the cart)."""
    po_lines = [
        POLine(
            product_id=it.product_id, quantity=it.quantity,
            unit_cost=it.unit_cost,
            line_total=_line_total(it.quantity, it.unit_cost),
        )
        for it in payload.items
    ]
    if not po_lines:
        raise HTTPException(400, "At least one line required")
    total = round(sum(line.line_total for line in po_lines), 2)
    status = "submitted" if submit else "draft"
    # Per-item supplier_type may vary; take the first as the PO's supplier.
    supplier_type = next((it.supplier_type for it in payload.items if it.supplier_type), "wholesaler")
    po = PurchaseOrder(
        po_number=await _next_po_number(),
        retailer_id=payload.retailer_id,
        distributor_id=payload.distributor_id,
        supplier_type=supplier_type,
        items=po_lines,
        total_amount=total,
        status=status,
        note=payload.note,
        submitted_at=now_iso() if submit else None,
        status_history=[StatusEvent(status="draft")] + (
            [StatusEvent(status="submitted")] if submit else []
        ),
    )
    await db.purchase_orders.insert_one(po.model_dump())
    if submit:
        await push_notification(
            supplier_type, payload.distributor_id,
            "New Purchase Order",
            f"New PO {po.po_number} (₦{total:,.0f}).", "order",
        )
    return po


@router.post("/procurement/purchase-orders/{po_id}/submit")
async def submit_po(po_id: str):
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] != "draft":
        raise HTTPException(400, f"Only drafts can be submitted (current: {po['status']})")
    stype = po.get("supplier_type") or "wholesaler"
    await _push_status_event(po_id, "submitted", note=f"Sent to {stype}",
                             extra={"submitted_at": now_iso()})
    await push_notification(
        stype, po["distributor_id"],
        "New Purchase Order",
        f"PO {po['po_number']} submitted for review.", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/approve")
async def approve_po(po_id: str):
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] != "submitted":
        raise HTTPException(400, f"Only submitted POs can be approved (current: {po['status']})")
    await _push_status_event(po_id, "approved", extra={"approved_at": now_iso()})
    await push_notification(
        "retailer", po["retailer_id"], "PO Approved",
        f"Your PO {po['po_number']} has been approved.", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/reject")
async def reject_po(po_id: str, payload: POAction):
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] not in ("submitted", "approved"):
        raise HTTPException(400, "PO cannot be rejected in current state")
    await _push_status_event(po_id, "rejected", note=payload.reason,
                             extra={"reject_reason": payload.reason})
    await push_notification(
        "retailer", po["retailer_id"], "PO Rejected",
        f"Your PO {po['po_number']} was rejected. Reason: {payload.reason or '—'}", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/process")
async def process_po(po_id: str):
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] != "approved":
        raise HTTPException(400, "PO must be approved before processing")
    await _push_status_event(po_id, "processing", extra={"processed_at": now_iso()})
    await push_notification(
        "retailer", po["retailer_id"], "PO Processing",
        f"PO {po['po_number']} is being prepared for shipment.", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/ship")
async def ship_po(po_id: str):
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] not in ("approved", "processing"):
        raise HTTPException(400, "PO must be approved/processing before shipping")
    stype = po.get("supplier_type") or "wholesaler"
    denorm = denorm_ids(stype, po["distributor_id"], "retailer", po["retailer_id"])
    sh = Shipment(
        from_role=stype, from_id=po["distributor_id"],
        to_role="retailer", to_id=po["retailer_id"],
        items=[ShipmentLine(product_id=it["product_id"], quantity=it["quantity"])
               for it in po["items"]],
        request_id=po["id"],
        notes=f"Auto-created from PO {po['po_number']}",
        **denorm,
    )
    await db.shipments.insert_one(sh.model_dump())
    await _push_status_event(
        po_id, "shipped", note=f"Shipment {sh.tracking_code} created",
        extra={"shipped_at": now_iso(), "shipment_id": sh.id},
    )
    await push_notification(
        "retailer", po["retailer_id"], "PO Shipped",
        f"PO {po['po_number']} dispatched. Tracking {sh.tracking_code}.", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/deliver")
async def deliver_po(po_id: str):
    """Retailer confirms receipt of the shipment — closes the loop."""
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] != "shipped":
        raise HTTPException(400, "PO must be shipped before delivery")
    await _push_status_event(po_id, "delivered", extra={"delivered_at": now_iso()})
    await push_notification(
        "distributor", po["distributor_id"], "Delivery Confirmed",
        f"Retailer confirmed delivery of PO {po['po_number']}.", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/cancel")
async def cancel_po(po_id: str, payload: POAction):
    po = await db.purchase_orders.find_one({"id": po_id})
    if not po:
        raise HTTPException(404, "PO not found")
    if po["status"] in ("shipped", "delivered", "cancelled", "rejected"):
        raise HTTPException(400, "PO cannot be cancelled in current state")
    await _push_status_event(po_id, "cancelled", note=payload.reason,
                             extra={"cancelled_at": now_iso(), "cancel_reason": payload.reason})
    await push_notification(
        "distributor", po["distributor_id"], "PO Cancelled",
        f"PO {po['po_number']} cancelled. Reason: {payload.reason or '—'}", "order",
    )
    return await get_purchase_order(po_id)


@router.post("/procurement/purchase-orders/{po_id}/duplicate")
async def duplicate_po(po_id: str):
    po = await db.purchase_orders.find_one({"id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(404, "PO not found")
    dup = PurchaseOrder(
        po_number=await _next_po_number(),
        retailer_id=po["retailer_id"],
        distributor_id=po["distributor_id"],
        items=[POLine(**{k: v for k, v in it.items() if k in ("product_id", "quantity", "unit_cost", "line_total")})
               for it in po["items"]],
        total_amount=po["total_amount"],
        status="draft",
        note=f"Duplicated from {po['po_number']}",
        duplicate_of=po["id"],
        status_history=[StatusEvent(status="draft", note=f"Duplicated from {po['po_number']}")],
    )
    await db.purchase_orders.insert_one(dup.model_dump())
    return dup


# ---------------------------------------------------------------------------
# Supplier Quotes
# ---------------------------------------------------------------------------
@router.get("/procurement/quotes")
async def list_quotes(
    retailer_id: Optional[str] = None,
    distributor_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
):
    query: Dict[str, Any] = {}
    if retailer_id:
        query["retailer_id"] = retailer_id
    if distributor_id:
        # Distributor sees quotes where they're invited
        query["distributor_ids"] = distributor_id
    if status:
        query["status"] = status
    docs = await db.supplier_quotes.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    distributors, retailers, products, _ws = await _load_lookups()
    out = []
    for d in docs:
        d["product"] = products.get(d["product_id"], {})
        d["retailer"] = retailers.get(d["retailer_id"], {})
        d["distributors"] = [distributors.get(did, {"id": did, "name": "—"})
                             for did in d.get("distributor_ids", [])]
        # Enrich responses
        for r in d.get("responses", []):
            r["distributor"] = distributors.get(r["distributor_id"], {})
        # Add "best_offer" hint
        if d.get("responses"):
            d["best_offer"] = min(d["responses"], key=lambda r: r["unit_price"])
        out.append(d)
    return out


@router.get("/procurement/quotes/{quote_id}")
async def get_quote(quote_id: str):
    q = await db.supplier_quotes.find_one({"id": quote_id}, {"_id": 0})
    if not q:
        raise HTTPException(404, "Quote not found")
    distributors, retailers, products, _ws = await _load_lookups()
    q["product"] = products.get(q["product_id"], {})
    q["retailer"] = retailers.get(q["retailer_id"], {})
    q["distributors"] = [distributors.get(did, {"id": did, "name": "—"})
                         for did in q.get("distributor_ids", [])]
    for r in q.get("responses", []):
        r["distributor"] = distributors.get(r["distributor_id"], {})
    if q.get("responses"):
        q["best_offer"] = min(q["responses"], key=lambda r: r["unit_price"])
    return q


@router.post("/procurement/quotes", response_model=SupplierQuote)
async def create_quote(payload: QuoteCreate):
    if not payload.distributor_ids:
        raise HTTPException(400, "At least one distributor required")
    q = SupplierQuote(
        quote_number=await _next_quote_number(),
        retailer_id=payload.retailer_id,
        product_id=payload.product_id,
        quantity=payload.quantity,
        distributor_ids=payload.distributor_ids,
        note=payload.note,
    )
    await db.supplier_quotes.insert_one(q.model_dump())
    # Notify each distributor
    for did in payload.distributor_ids:
        await push_notification(
            "distributor", did, "New Quote Request",
            f"Retailer requested a quote for {payload.quantity} units ({q.quote_number}).",
            "order",
        )
    return q


@router.post("/procurement/quotes/{quote_id}/respond")
async def respond_to_quote(quote_id: str, payload: QuoteRespondPayload):
    q = await db.supplier_quotes.find_one({"id": quote_id})
    if not q:
        raise HTTPException(404, "Quote not found")
    if q["status"] == "closed":
        raise HTTPException(400, "Quote is closed")
    if payload.distributor_id not in q.get("distributor_ids", []):
        raise HTTPException(403, "Distributor not invited on this quote")
    # Replace existing response if any
    existing = [r for r in q.get("responses", []) if r["distributor_id"] != payload.distributor_id]
    existing.append(QuoteResponse(**payload.model_dump()).model_dump())
    new_status = "responded" if q["status"] == "open" else q["status"]
    await db.supplier_quotes.update_one(
        {"id": quote_id},
        {"$set": {"responses": existing, "status": new_status}},
    )
    await push_notification(
        "retailer", q["retailer_id"], "Quote Response",
        f"A distributor responded to your quote {q['quote_number']}.", "order",
    )
    return await get_quote(quote_id)


@router.post("/procurement/quotes/{quote_id}/close")
async def close_quote(quote_id: str):
    q = await db.supplier_quotes.find_one({"id": quote_id})
    if not q:
        raise HTTPException(404, "Quote not found")
    await db.supplier_quotes.update_one(
        {"id": quote_id},
        {"$set": {"status": "closed", "closed_at": now_iso()}},
    )
    return await get_quote(quote_id)


# ---------------------------------------------------------------------------
# AI Reorder Recommendations
# ---------------------------------------------------------------------------
@router.get("/procurement/ai-recommendations/{retailer_id}")
async def ai_recommendations(retailer_id: str, top: int = 6):
    """Return reorder recommendations sorted by urgency.

    Each recommendation contains:
        - product_id / product (name, category)
        - current_stock
        - daily_velocity (avg units/day last 30d)
        - days_to_stockout
        - recommended_qty (covers 30 more days of velocity, rounded to nearest 10)
        - expected_lost_revenue (₦) if stockout occurs
        - severity: critical / high / medium / low
        - suggested_supplier {id, name, last_unit_cost}
    """
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    # Last 30d sales velocity per product
    today = datetime.now(timezone.utc).date()
    cutoff = (today - timedelta(days=30)).isoformat()
    velocity: Dict[str, dict] = {}
    async for s in db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": cutoff}},
        {"_id": 0, "product_id": 1, "units": 1, "quantity_sold": 1,
         "revenue": 1, "date": 1},
    ):
        pid = s["product_id"]
        v = velocity.setdefault(pid, {"units": 0, "revenue": 0.0, "days": set()})
        v["units"] += int(s.get("units", s.get("quantity_sold", 0)))
        v["revenue"] += float(s.get("revenue", 0))
        v["days"].add(s["date"])

    inventory_map: Dict[str, int] = {}
    async for inv in db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id},
        {"_id": 0, "product_id": 1, "quantity": 1},
    ):
        inventory_map[inv["product_id"]] = int(inv.get("quantity", 0))

    # last unit cost per supplier×product from historical POs
    last_cost: Dict[str, dict] = {}  # key product_id -> {unit_cost, distributor_id}
    async for po in db.purchase_orders.find(
        {"retailer_id": retailer_id}, {"_id": 0, "distributor_id": 1, "items": 1},
    ).sort("created_at", -1):
        for it in po.get("items", []):
            pid = it["product_id"]
            if pid not in last_cost and it.get("unit_cost", 0) > 0:
                last_cost[pid] = {
                    "unit_cost": float(it["unit_cost"]),
                    "distributor_id": po["distributor_id"],
                }

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}

    primary_supplier = retailer.get("distributor_id")
    recs: List[dict] = []
    for pid, v in velocity.items():
        avg_per_day = v["units"] / 30.0
        if avg_per_day <= 0:
            continue
        avg_revenue_per_day = v["revenue"] / 30.0
        stock = inventory_map.get(pid, 0)
        days_to_stockout = stock / avg_per_day
        if days_to_stockout > 30:
            continue  # plenty of stock, skip
        recommended_qty = max(10, int(round(avg_per_day * 30 / 10) * 10))
        expected_lost_revenue = round(avg_revenue_per_day * 7, 2)  # 7-day shortfall
        severity = (
            "critical" if days_to_stockout < 3 else
            "high" if days_to_stockout < 7 else
            "medium" if days_to_stockout < 14 else
            "low"
        )
        supplier_id = last_cost.get(pid, {}).get("distributor_id") or primary_supplier
        unit_cost = last_cost.get(pid, {}).get("unit_cost") or 0.0
        recs.append({
            "product_id": pid,
            "product": products.get(pid, {}),
            "current_stock": stock,
            "daily_velocity": round(avg_per_day, 2),
            "days_to_stockout": round(days_to_stockout, 1),
            "recommended_qty": recommended_qty,
            "expected_lost_revenue": expected_lost_revenue,
            "severity": severity,
            "suggested_supplier": {
                "id": supplier_id,
                "name": distributors.get(supplier_id, {}).get("name", "—") if supplier_id else "—",
                "last_unit_cost": unit_cost,
            },
            "headline": _ai_headline(
                products.get(pid, {}).get("name", "this SKU"),
                recommended_qty, days_to_stockout, severity,
            ),
            "rationale": _ai_rationale(stock, avg_per_day, days_to_stockout, expected_lost_revenue),
        })
    recs.sort(key=lambda r: r["days_to_stockout"])
    return {
        "as_of": now_iso(),
        "retailer_id": retailer_id,
        "recommendations": recs[:top],
        "total_recommendations": len(recs),
    }


def _ai_headline(name: str, qty: int, days: float, severity: str) -> str:
    if severity == "critical":
        return f"Reorder {qty} units of {name} immediately — projected stockout in {days:.1f} days."
    if severity == "high":
        return f"Reorder {qty} units of {name} this week — only {days:.0f} days of cover left."
    if severity == "medium":
        return f"Plan a reorder of {qty} units of {name} — {days:.0f} days of cover remaining."
    return f"Monitor {name} — current cover {days:.0f} days."


def _ai_rationale(stock: int, velocity: float, days_left: float, lost_rev: float) -> str:
    return (
        f"Current stock: {stock} units · Velocity: ~{velocity:.1f}/day · "
        f"Days of cover: {days_left:.1f}. Potential 7-day lost revenue if not restocked: ₦{lost_rev:,.0f}."
    )
