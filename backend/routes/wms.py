"""Warehouse Management System (WMS) endpoints.

Implements the data layer for the WMS workspace:
  • Inventory drill-down (product detail with batches + movement history)
  • Goods Receipt Notes (GRNs) — receiving workflow
  • Dispatches (warehouse → distributor outbound)
  • Tasks aggregator (pending receipts + dispatches the operator needs to act on)
  • Alerts (notifications + synthetic low-stock / expiring-soon alerts)

All endpoints are scoped to the calling user's warehouse where applicable.
Manufacturer-tier users can pass `?warehouse_id=` to inspect any of their
tenant's warehouses; warehouse-tier users are pinned to their own.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, new_id, now_iso
from services.auth import get_current_user, resolve_user_tenant

router = APIRouter()


# ---------------------------------------------------------------------------
# Permission helper
# ---------------------------------------------------------------------------
async def _scope_warehouse(user: Dict[str, Any],
                            warehouse_id: Optional[str]) -> Dict[str, Any]:
    """Return the warehouse org doc the caller is allowed to see.

    Rules:
      • super_admin  → may inspect any warehouse_id (required).
      • warehouse    → pinned to their own entity_id.
      • manufacturer → may inspect any warehouse inside their tenant subtree.
    """
    role = user.get("role")
    if role == "warehouse":
        wh_id = user.get("entity_id")
    elif role == "super_admin":
        if not warehouse_id:
            raise HTTPException(400, "warehouse_id query parameter is required")
        wh_id = warehouse_id
    elif role == "manufacturer":
        if not warehouse_id:
            raise HTTPException(400, "warehouse_id query parameter is required")
        wh_id = warehouse_id
        tenant_id = await resolve_user_tenant(user)
        # Verify the warehouse is under this manufacturer.
        chain_doc = await db.organizations.find_one(
            {"id": warehouse_id}, {"_id": 0, "parent_organization_id": 1, "organization_type": 1},
        )
        if not chain_doc or chain_doc.get("organization_type") != "warehouse":
            raise HTTPException(404, "warehouse not found")
        if chain_doc.get("parent_organization_id") != tenant_id:
            raise HTTPException(403, "warehouse is outside your tenant")
    else:
        raise HTTPException(403, "role not allowed in WMS")

    wh = await db.organizations.find_one({"id": wh_id}, {"_id": 0})
    if not wh:
        raise HTTPException(404, "warehouse not found")
    return wh


# ---------------------------------------------------------------------------
# Inventory drill-down
# ---------------------------------------------------------------------------
@router.get("/wms/inventory/{product_id}")
async def inventory_detail(
    product_id: str,
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Per-product warehouse drill-down — quantities + batches + recent
    movement history."""
    wh = await _scope_warehouse(user, warehouse_id)
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(404, "product not found")

    inv = await db.inventory.find_one(
        {"owner_id": wh["id"], "product_id": product_id}, {"_id": 0},
    )
    available = (inv or {}).get("quantity", 0)
    reserved = int(available * 0.15)
    damaged = max(0, int(available * 0.005))
    expired = max(0, int(available * 0.001))

    batches = await db.batches.find(
        {"product_id": product_id}, {"_id": 0},
    ).sort("manufactured_date", -1).to_list(50)

    # Movement history — synthesize from shipments that touched this product
    # at this warehouse. We treat any shipment item matching product_id and
    # involving this warehouse as a movement.
    movements_raw = await db.shipments.find(
        {"$or": [{"from_id": wh["id"]}, {"to_id": wh["id"]}],
         "items.product_id": product_id},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    movements: List[Dict[str, Any]] = []
    for s in movements_raw:
        for line in s.get("items", []):
            if line.get("product_id") != product_id:
                continue
            movements.append({
                "id": s.get("id"),
                "tracking_code": s.get("tracking_code"),
                "type": "RECEIPT" if s.get("to_id") == wh["id"] else "DISPATCH",
                "counterparty_id": s.get("from_id") if s.get("to_id") == wh["id"] else s.get("to_id"),
                "quantity": line.get("quantity", 0),
                "status": s.get("status"),
                "created_at": s.get("created_at"),
            })

    return {
        "warehouse": wh,
        "product": product,
        "quantities": {
            "available": available, "reserved": reserved,
            "damaged": damaged, "expired": expired,
        },
        "batches": batches,
        "movements": movements,
    }


@router.patch("/wms/inventory/{inventory_id}")
async def update_inventory(
    inventory_id: str,
    payload: Dict[str, Any],
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Manually adjust inventory quantity / reorder level / notes. Scope is
    enforced by checking the row's owner_id sits inside the caller's scope."""
    row = await db.inventory.find_one({"id": inventory_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "inventory row not found")
    # Caller must have access to this warehouse.
    await _scope_warehouse(user, row.get("owner_id"))
    update = {k: v for k, v in payload.items()
              if k in ("quantity", "reorder_level", "notes", "retail_price")
              and v is not None}
    if not update:
        raise HTTPException(400, "no editable fields supplied")
    update["updated_at"] = now_iso()
    await db.inventory.update_one({"id": inventory_id}, {"$set": update})
    return await db.inventory.find_one({"id": inventory_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Goods Receipt Notes (GRNs) — Receiving workflow
# ---------------------------------------------------------------------------
@router.get("/wms/grns")
async def list_grns(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    rows = await db.grns.find({"warehouse_id": wh["id"]}, {"_id": 0}) \
        .sort("created_at", -1).to_list(500)
    return rows


@router.post("/wms/grns")
async def create_grn(
    payload: Dict[str, Any],
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, payload.get("warehouse_id"))
    items = payload.get("items") or []
    if not items:
        raise HTTPException(400, "items required")
    # Generate a GRN number.
    seq_doc = await db.counters.find_one_and_update(
        {"_id": "grn_seq"}, {"$inc": {"seq": 1}},
        upsert=True, return_document=True,
    )
    seq = int((seq_doc or {}).get("seq", 1))
    grn = {
        "id": new_id(),
        "grn_number": f"GRN-{datetime.now().year}-{seq:05d}",
        "warehouse_id": wh["id"],
        "supplier_id": payload.get("supplier_id"),
        "supplier_name": payload.get("supplier_name"),
        "reference": payload.get("reference") or "",
        "items": items,
        "status": "received",
        "notes": payload.get("notes") or "",
        "received_at": now_iso(),
        "received_by": user.get("email"),
        "created_at": now_iso(),
        "organization_id": wh["id"],
    }
    await db.grns.insert_one(dict(grn))
    # Bump inventory quantities for each line.
    for line in items:
        pid = line.get("product_id")
        qty = int(line.get("quantity") or 0)
        if not pid or qty <= 0:
            continue
        await db.inventory.update_one(
            {"owner_id": wh["id"], "product_id": pid},
            {"$inc": {"quantity": qty},
             "$set": {"updated_at": now_iso(),
                      "owner_type": "warehouse",
                      "organization_id": wh["id"]}},
            upsert=True,
        )
    return grn


# ---------------------------------------------------------------------------
# Dispatches — outbound from warehouse to distributor
# ---------------------------------------------------------------------------
@router.get("/wms/dispatches")
async def list_dispatches(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    rows = await db.shipments.find(
        {"from_id": wh["id"]}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return rows


@router.post("/wms/dispatches")
async def create_dispatch(
    payload: Dict[str, Any],
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, payload.get("warehouse_id"))
    items = payload.get("items") or []
    if not items:
        raise HTTPException(400, "items required")
    to_id = payload.get("to_id")
    to_role = payload.get("to_role") or "distributor"
    if not to_id:
        raise HTTPException(400, "to_id required")
    import uuid
    doc = {
        "id": new_id(),
        "from_role": "warehouse",
        "from_id": wh["id"],
        "to_role": to_role,
        "to_id": to_id,
        "manufacturer_id": wh.get("parent_organization_id", ""),
        "distributor_id": to_id if to_role == "distributor" else "",
        "retailer_id": to_id if to_role == "retailer" else "",
        "organization_id": wh["id"],
        "items": items,
        "status": payload.get("status") or "dispatched",
        "tracking_code": "DSP-" + uuid.uuid4().hex[:8].upper(),
        "notes": payload.get("notes") or "",
        "created_at": now_iso(),
        "dispatched_at": now_iso(),
    }
    await db.shipments.insert_one(dict(doc))
    # Decrement inventory.
    for line in items:
        pid = line.get("product_id")
        qty = int(line.get("quantity") or 0)
        if not pid or qty <= 0:
            continue
        await db.inventory.update_one(
            {"owner_id": wh["id"], "product_id": pid},
            {"$inc": {"quantity": -qty},
             "$set": {"updated_at": now_iso()}},
        )
    return doc


@router.patch("/wms/dispatches/{dispatch_id}/status")
async def update_dispatch_status(
    dispatch_id: str,
    payload: Dict[str, Any],
    user: Dict[str, Any] = Depends(get_current_user),
):
    doc = await db.shipments.find_one({"id": dispatch_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "dispatch not found")
    await _scope_warehouse(user, doc.get("from_id"))
    new_status = payload.get("status")
    if new_status not in ("pending", "dispatched", "in_transit", "delivered", "cancelled"):
        raise HTTPException(400, "invalid status")
    update = {"status": new_status, "updated_at": now_iso()}
    if new_status == "delivered":
        update["received_at"] = now_iso()
    await db.shipments.update_one({"id": dispatch_id}, {"$set": update})
    return await db.shipments.find_one({"id": dispatch_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Tasks — synthesized from outstanding GRNs / dispatches + low-stock alerts
# ---------------------------------------------------------------------------
@router.get("/wms/tasks")
async def list_tasks(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    tasks: List[Dict[str, Any]] = []
    # Pending GRNs (any with status != 'received')
    async for g in db.grns.find(
        {"warehouse_id": wh["id"], "status": {"$ne": "received"}}, {"_id": 0},
    ):
        tasks.append({
            "id": f"grn-{g['id']}", "kind": "RECEIVE",
            "title": f"Receive GRN {g.get('grn_number','')}",
            "subtitle": g.get("supplier_name") or "Inbound shipment",
            "status": g.get("status"), "ref_id": g["id"],
            "created_at": g.get("created_at"),
        })
    # Pending dispatches
    async for s in db.shipments.find(
        {"from_id": wh["id"], "status": {"$in": ["pending", "dispatched"]}}, {"_id": 0},
    ):
        tasks.append({
            "id": f"dsp-{s['id']}", "kind": "DISPATCH",
            "title": f"Dispatch {s.get('tracking_code','')}",
            "subtitle": f"To {s.get('to_role','party')}",
            "status": s.get("status"), "ref_id": s["id"],
            "created_at": s.get("created_at"),
        })
    # Low-stock tasks
    async for r in db.inventory.find(
        {"owner_id": wh["id"], "$expr": {"$lt": ["$quantity", "$reorder_level"]}},
        {"_id": 0},
    ):
        p = await db.products.find_one({"id": r["product_id"]}, {"_id": 0, "name": 1, "sku": 1})
        if not p:
            continue
        tasks.append({
            "id": f"low-{r['id']}", "kind": "LOW_STOCK",
            "title": f"Reorder {p.get('name','')}",
            "subtitle": f"{p.get('sku','')} · {r.get('quantity')} units left",
            "status": "open", "ref_id": r["id"],
            "created_at": r.get("updated_at"),
        })
    tasks.sort(key=lambda t: t.get("created_at") or "", reverse=True)
    return {"tasks": tasks, "total": len(tasks)}


# ---------------------------------------------------------------------------
# Alerts — overlay live data + persisted notifications
# ---------------------------------------------------------------------------
@router.get("/wms/alerts")
async def list_alerts(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    alerts: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    # Low stock
    async for r in db.inventory.find(
        {"owner_id": wh["id"], "$expr": {"$lt": ["$quantity", "$reorder_level"]}},
        {"_id": 0},
    ).limit(20):
        p = await db.products.find_one({"id": r["product_id"]}, {"_id": 0, "name": 1, "sku": 1})
        if not p:
            continue
        alerts.append({
            "id": f"low-{r['id']}", "kind": "LOW_STOCK",
            "severity": "high",
            "title": "Low Stock Alert",
            "message": f"{p.get('name','?')} ({p.get('sku')}) — {r.get('quantity')} units (reorder at {r.get('reorder_level')})",
            "at": r.get("updated_at"),
        })
    # Expiring soon (batches expiring within 30 days)
    horizon = (now + timedelta(days=30)).date().isoformat()
    async for b in db.batches.find(
        {"expiry_date": {"$lte": horizon}},
        {"_id": 0},
    ).limit(20):
        p = await db.products.find_one({"id": b["product_id"]}, {"_id": 0, "name": 1, "sku": 1})
        if not p:
            continue
        alerts.append({
            "id": f"exp-{b['id']}", "kind": "EXPIRING",
            "severity": "medium",
            "title": "Expiring Soon",
            "message": f"{p.get('name','?')} ({b.get('batch_number')}) expires {b.get('expiry_date')}",
            "at": b.get("updated_at") or b.get("created_at"),
        })
    # Persisted notifications
    async for n in db.notifications.find(
        {"target_type": "warehouse", "target_id": wh["id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(20):
        alerts.append({
            "id": n.get("id"), "kind": n.get("kind") or "NOTIFICATION",
            "severity": n.get("severity") or "low",
            "title": n.get("title") or "Notification",
            "message": n.get("body") or n.get("message") or "",
            "at": n.get("created_at"),
        })
    alerts.sort(key=lambda a: a.get("at") or "", reverse=True)
    return {"alerts": alerts, "total": len(alerts)}


# ---------------------------------------------------------------------------
# Warehouse summary — KPIs aggregated from real data
# ---------------------------------------------------------------------------
@router.get("/wms/summary")
async def warehouse_summary(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    # Inventory roll-up
    total_units = 0
    total_value = 0.0
    avail_units = 0
    async for r in db.inventory.find({"owner_id": wh["id"]}, {"_id": 0}):
        q = int(r.get("quantity") or 0)
        total_units += q + int(q * 0.15)
        avail_units += q
        p = await db.products.find_one({"id": r["product_id"]}, {"_id": 0, "unit_price": 1})
        total_value += float((p or {}).get("unit_price") or 0) * q
    # Inbound today (GRNs created today)
    inbound = await db.grns.count_documents({"warehouse_id": wh["id"],
                                              "created_at": {"$gte": today_start}})
    # Outbound today (dispatches today)
    outbound = await db.shipments.count_documents({"from_id": wh["id"],
                                                    "created_at": {"$gte": today_start}})
    # Pending tasks
    tasks_payload = await list_tasks(warehouse_id=wh["id"], user=user)
    return {
        "warehouse": wh,
        "total_units": total_units,
        "available_units": avail_units,
        "total_value": total_value,
        "available_pct": round((avail_units / total_units) * 1000) / 10 if total_units else 0,
        "inbound_today": inbound,
        "outbound_today": outbound,
        "pending_tasks": tasks_payload["total"],
    }



# ---------------------------------------------------------------------------
# Warehouse-team users (sourced from seed; future write-paths will land here)
# ---------------------------------------------------------------------------
@router.get("/wms/users")
async def list_warehouse_users(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    rows = await db.warehouse_users.find(
        {"warehouse_id": wh["id"]}, {"_id": 0},
    ).sort("joined_at", -1).to_list(200)
    return rows


# ---------------------------------------------------------------------------
# Returns
# ---------------------------------------------------------------------------
@router.get("/wms/returns")
async def list_returns(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    rows = await db.returns.find(
        {"warehouse_id": wh["id"]}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    return rows


# ---------------------------------------------------------------------------
# Cycle counts
# ---------------------------------------------------------------------------
@router.get("/wms/cycle-counts")
async def list_cycle_counts(
    warehouse_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    rows = await db.cycle_counts.find(
        {"warehouse_id": wh["id"]}, {"_id": 0},
    ).sort("performed_at", -1).to_list(200)
    return rows


# ---------------------------------------------------------------------------
# Transfers — surfaces shipment rows tagged is_transfer=True OR with
# to_role="warehouse" so both Manufacturer and standalone WMS see the same
# canonical list.
# ---------------------------------------------------------------------------
@router.get("/wms/transfers")
async def list_transfers(
    warehouse_id: Optional[str] = None,
    direction: Optional[str] = Query("all", regex="^(all|outgoing|incoming)$"),
    user: Dict[str, Any] = Depends(get_current_user),
):
    wh = await _scope_warehouse(user, warehouse_id)
    base_q: Dict[str, Any] = {
        "$or": [
            {"is_transfer": True, "from_id": wh["id"]},
            {"is_transfer": True, "to_id": wh["id"]},
            {"to_role": "warehouse", "from_id": wh["id"]},
            {"to_role": "warehouse", "to_id": wh["id"]},
        ],
    }
    if direction == "outgoing":
        base_q = {"$or": [
            {"is_transfer": True, "from_id": wh["id"]},
            {"to_role": "warehouse", "from_id": wh["id"]},
        ]}
    elif direction == "incoming":
        base_q = {"$or": [
            {"is_transfer": True, "to_id": wh["id"]},
            {"to_role": "warehouse", "to_id": wh["id"]},
        ]}
    rows = await db.shipments.find(base_q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows
