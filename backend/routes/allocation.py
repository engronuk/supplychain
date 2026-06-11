"""Manufacturer-Controlled Order Allocation Center.

Architecture: every Distributor purchase order must be allocated by the
Manufacturer to one or more Warehouses before it can be fulfilled. Warehouses
execute fulfillment, but they never accept orders directly. See the
"Supply Chain Order Allocation Architecture" PRD entry for the full rules.

Status machine (on `distributor_orders`):
    pending               — distributor just submitted
    awaiting_allocation   — manufacturer accepted into the queue
    allocated             — fully covered by warehouse allocations
    partially_allocated   — some quantity allocated, remainder back-ordered
    fulfillment_in_progress — at least one fulfillment order is in flight
    completed             — every fulfillment delivered
    back_ordered          — no allocation possible right now
    rejected              — manufacturer declined

Side collections:
    order_allocations   — per-warehouse allocation decisions (audit trail)
    fulfillment_orders  — operational instruction the warehouse executes
    back_orders         — outstanding demand awaiting future stock
    inventory.reserved  — incremented on allocation, decremented on dispatch
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import db, logger, new_id, now_iso
from services.auth import get_current_user
from services.helpers import push_notification

router = APIRouter()


# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------
POOL_STATUSES = {
    "new":                   ["pending"],
    "awaiting_allocation":   ["awaiting_allocation"],
    "allocated":             ["allocated", "partially_allocated"],
    "fulfillment_in_progress": ["fulfillment_in_progress"],
    "completed":             ["completed"],
    "back_ordered":          ["back_ordered"],
    "rejected":              ["rejected"],
}


async def _scope_manufacturer(user: Dict[str, Any], manufacturer_id: Optional[str]) -> str:
    """Resolve & enforce manufacturer scope. Defaults to the caller's tenant.

    Only manufacturer and warehouse roles (and super_admin) are allowed to
    read allocation-center data. Downstream roles (distributor, wholesaler,
    retailer) carry the parent `manufacturer_id` on their user record for
    catalog scoping, but they must NOT be able to read upstream KPIs or
    allocations.
    """
    role = user.get("role")
    if role == "super_admin":
        if not manufacturer_id:
            raise HTTPException(400, "manufacturer_id is required for super_admin callers")
        return manufacturer_id
    if role not in {"manufacturer", "warehouse"}:
        raise HTTPException(403, "Manufacturer scope required")
    mfr = user.get("manufacturer_id") or user.get("organization_id")
    if not mfr:
        raise HTTPException(403, "Manufacturer scope required")
    if manufacturer_id and manufacturer_id != mfr:
        raise HTTPException(403, "Cross-tenant access denied")
    return mfr


async def _denorm(order: Dict[str, Any]) -> Dict[str, Any]:
    """Attach distributor + product names and totals for table rendering."""
    dist = await db.distributors.find_one({"id": order["distributor_id"]}, {"_id": 0}) or {}
    order["distributor_name"] = dist.get("name", "Unknown")
    order["distributor_city"] = dist.get("city", "")
    order["distributor_region"] = dist.get("region") or dist.get("state") or ""

    total_units = 0
    total_value = 0.0
    prod_ids = [it["product_id"] for it in order.get("items", [])]
    prods = {p["id"]: p for p in await db.products.find(
        {"id": {"$in": prod_ids}}, {"_id": 0},
    ).to_list(None)}
    for it in order.get("items", []):
        p = prods.get(it["product_id"], {})
        qty = int(it.get("quantity", 0))
        it["product_name"] = p.get("name", "Unknown")
        it["sku"] = p.get("sku", "")
        it["unit_price"] = p.get("unit_price", 0) or 0
        total_units += qty
        total_value += (it["unit_price"] or 0) * qty
    order["total_units"] = total_units
    order["total_value"] = round(total_value, 2)
    return order


async def _list_warehouses(manufacturer_id: str) -> List[Dict[str, Any]]:
    """Return warehouses owned by this manufacturer (parent_organization_id)."""
    rows = await db.organizations.find(
        {"organization_type": "warehouse", "parent_organization_id": manufacturer_id},
        {"_id": 0},
    ).to_list(50)
    return rows


async def _inventory_for(warehouse_id: str, product_ids: List[str]) -> Dict[str, Dict[str, int]]:
    inv = await db.inventory.find(
        {"owner_type": "warehouse", "owner_id": warehouse_id, "product_id": {"$in": product_ids}},
        {"_id": 0, "product_id": 1, "quantity": 1, "reserved": 1},
    ).to_list(500)
    return {
        r["product_id"]: {
            "available": max(0, (r.get("quantity") or 0) - (r.get("reserved") or 0)),
            "quantity":  r.get("quantity") or 0,
            "reserved":  r.get("reserved") or 0,
        } for r in inv
    }


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class AllocationLine(BaseModel):
    warehouse_id: str
    product_id: str
    quantity: int = Field(..., gt=0)


class ManualAllocatePayload(BaseModel):
    lines: List[AllocationLine]
    notes: Optional[str] = None


class AutoAllocatePayload(BaseModel):
    notes: Optional[str] = None


class RejectPayload(BaseModel):
    reason: str


class BackorderPayload(BaseModel):
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# 1) Pool — list orders for the manufacturer, optionally bucketed
# ---------------------------------------------------------------------------
@router.get("/allocation/pool")
async def allocation_pool(
    manufacturer_id: Optional[str] = None,
    bucket: Optional[str] = Query(None),
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    q: Dict[str, Any] = {"manufacturer_id": mfr}
    if bucket:
        statuses = POOL_STATUSES.get(bucket)
        if not statuses:
            raise HTTPException(400, f"unknown bucket: {bucket}")
        q["status"] = {"$in": statuses}
    rows = await db.distributor_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [await _denorm(r) for r in rows]


# ---------------------------------------------------------------------------
# 2) Dashboard counts
# ---------------------------------------------------------------------------
@router.get("/allocation/summary")
async def allocation_summary(
    manufacturer_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    today_iso = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    out: Dict[str, int] = {}
    for bucket, statuses in POOL_STATUSES.items():
        out[bucket] = await db.distributor_orders.count_documents(
            {"manufacturer_id": mfr, "status": {"$in": statuses}}
        )
    out["new_today"] = await db.distributor_orders.count_documents(
        {"manufacturer_id": mfr, "status": "pending", "created_at": {"$gte": today_iso}}
    )
    return out


# ---------------------------------------------------------------------------
# 2.5) Allocation performance KPIs — Fill Rate, Allocation Time, Back-Order
# Rate, Service Level, and Warehouse Performance leaderboard.
# Pure programmatic computation against `distributor_orders`,
# `order_allocations` and `fulfillment_orders`. No AI.
# ---------------------------------------------------------------------------
def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


@router.get("/allocation/kpis")
async def allocation_kpis(
    days: int = Query(30, ge=1, le=365),
    manufacturer_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Return performance KPIs for the manufacturer's allocation pipeline.

    All numbers are rule-based — derived from order, allocation and
    fulfillment timestamps. No AI involvement.
    """
    mfr = await _scope_manufacturer(user, manufacturer_id)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    since_iso = since.isoformat()

    orders = await db.distributor_orders.find(
        {"manufacturer_id": mfr, "created_at": {"$gte": since_iso}},
        {"_id": 0},
    ).to_list(5000)
    order_ids = [o["id"] for o in orders]

    # --- Fill Rate ---------------------------------------------------------
    # requested_units = total qty across all decided orders in window
    # allocated_units = sum of allocation.lines[].quantity for those orders
    decided_statuses = {
        "allocated", "partially_allocated", "fulfillment_in_progress",
        "completed", "back_ordered",
    }
    decided_orders = [o for o in orders if o.get("status") in decided_statuses]
    requested_units = sum(
        int(it.get("quantity") or 0)
        for o in decided_orders for it in (o.get("items") or [])
    )
    allocations: List[Dict[str, Any]] = []
    if order_ids:
        allocations = await db.order_allocations.find(
            {"manufacturer_id": mfr, "order_id": {"$in": order_ids}},
            {"_id": 0},
        ).to_list(10000)
    allocated_units = sum(
        int(ln.get("quantity") or 0)
        for a in allocations for ln in (a.get("lines") or [])
    )
    fill_rate_pct = (
        round(min(100.0, allocated_units / requested_units * 100), 1)
        if requested_units else 0.0
    )

    # --- Allocation Time ---------------------------------------------------
    # Avg hours between order.created_at and the earliest allocation
    # decided_at for that order.
    earliest_by_order: Dict[str, datetime] = {}
    for a in allocations:
        oid = a.get("order_id")
        ts = _parse_iso(a.get("decided_at"))
        if not oid or not ts:
            continue
        if oid not in earliest_by_order or ts < earliest_by_order[oid]:
            earliest_by_order[oid] = ts
    alloc_times_h: List[float] = []
    for o in orders:
        oid = o["id"]
        c = _parse_iso(o.get("created_at"))
        d = earliest_by_order.get(oid)
        if c and d and d >= c:
            alloc_times_h.append((d - c).total_seconds() / 3600.0)
    avg_allocation_hours = (
        round(sum(alloc_times_h) / len(alloc_times_h), 1)
        if alloc_times_h else None
    )

    # --- Back-Order Rate ---------------------------------------------------
    # Out of all orders that reached a decision, what fraction landed in
    # back_ordered or partially_allocated.
    decided_total = len(decided_orders)
    back_orders = sum(
        1 for o in decided_orders
        if o.get("status") in ("back_ordered", "partially_allocated")
    )
    back_order_rate_pct = (
        round(back_orders / decided_total * 100, 1) if decided_total else 0.0
    )

    # --- Service Level -----------------------------------------------------
    # % of completed orders delivered within 7 days of submission. Falls
    # back to 0 when no completed orders exist in the window.
    completed = [o for o in orders if o.get("status") == "completed"]
    on_time = 0
    for o in completed:
        c = _parse_iso(o.get("created_at"))
        d = _parse_iso(o.get("delivered_at")) or _parse_iso(o.get("dispatched_at"))
        if c and d and (d - c).total_seconds() <= 7 * 86400:
            on_time += 1
    service_level_pct = (
        round(on_time / len(completed) * 100, 1) if completed else 0.0
    )

    # --- Warehouse Performance leaderboard ---------------------------------
    # Per warehouse: fulfillments handled, delivered count, on-time-dispatch %
    fos = await db.fulfillment_orders.find(
        {"manufacturer_id": mfr, "created_at": {"$gte": since_iso}},
        {"_id": 0},
    ).to_list(5000)
    by_wh: Dict[str, Dict[str, Any]] = {}
    for f in fos:
        wid = f.get("warehouse_id") or "unknown"
        bucket = by_wh.setdefault(wid, {
            "warehouse_id": wid,
            "warehouse_name": f.get("warehouse_name") or "Unknown",
            "fulfillments": 0,
            "delivered": 0,
            "in_progress": 0,
            "on_time_count": 0,
            "measured": 0,
        })
        bucket["fulfillments"] += 1
        st = f.get("status")
        if st == "delivered":
            bucket["delivered"] += 1
        elif st in ("pending_picking", "picking", "picked", "loaded"):
            bucket["in_progress"] += 1
        c = _parse_iso(f.get("created_at"))
        u = _parse_iso(f.get("updated_at"))
        if st == "delivered" and c and u:
            bucket["measured"] += 1
            # SLA target: dispatched within 48h of fulfillment creation.
            if (u - c).total_seconds() <= 48 * 3600:
                bucket["on_time_count"] += 1
    warehouses: List[Dict[str, Any]] = []
    for w in by_wh.values():
        on_time_pct = (
            round(w["on_time_count"] / w["measured"] * 100, 1)
            if w["measured"] else None
        )
        warehouses.append({
            "warehouse_id": w["warehouse_id"],
            "warehouse_name": w["warehouse_name"],
            "fulfillments": w["fulfillments"],
            "delivered": w["delivered"],
            "in_progress": w["in_progress"],
            "on_time_pct": on_time_pct,
        })
    warehouses.sort(key=lambda x: (x["delivered"], x["fulfillments"]),
                    reverse=True)

    return {
        "window_days": days,
        "as_of": now_iso(),
        "kpis": {
            "fill_rate_pct": fill_rate_pct,
            "requested_units": requested_units,
            "allocated_units": allocated_units,
            "avg_allocation_hours": avg_allocation_hours,
            "back_order_rate_pct": back_order_rate_pct,
            "back_orders": back_orders,
            "decided_orders": decided_total,
            "service_level_pct": service_level_pct,
            "completed_orders": len(completed),
            "on_time_orders": on_time,
        },
        "warehouses": warehouses[:8],
    }


# ---------------------------------------------------------------------------
# 3) Allocation recommendation — for a given order, score each warehouse
# ---------------------------------------------------------------------------
@router.get("/allocation/orders/{order_id}/recommendation")
async def recommend(
    order_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")

    distributor = await db.distributors.find_one({"id": order["distributor_id"]}, {"_id": 0}) or {}
    region = (distributor.get("region") or distributor.get("state") or "").lower()
    warehouses = await _list_warehouses(mfr)

    product_ids = [it["product_id"] for it in order["items"]]
    per_wh_inv = {}
    for wh in warehouses:
        per_wh_inv[wh["id"]] = await _inventory_for(wh["id"], product_ids)

    rows = []
    for it in order["items"]:
        candidates = []
        for wh in warehouses:
            stock = per_wh_inv[wh["id"]].get(it["product_id"], {"available": 0})
            available = stock["available"]
            # Region scoring: exact match weighs heaviest. Stock-on-hand and
            # a proxy "distance" (alphabetical hash) finalise tie-breaks.
            wh_region = (wh.get("region") or wh.get("state") or wh.get("city") or "").lower()
            region_score = 100 if (region and wh_region and region in wh_region) else 0
            stock_score  = min(60, available / 100)  # cap at 60
            distance     = abs(hash(wh.get("organization_code", "")) % 40)
            score = region_score + stock_score - distance / 4
            candidates.append({
                "warehouse_id": wh["id"],
                "warehouse_name": wh["organization_name"],
                "warehouse_code": wh["organization_code"],
                "region": wh.get("region") or wh.get("state") or wh.get("city") or "",
                "available": available,
                "score": round(score, 1),
                "recommended": False,
            })
        candidates.sort(key=lambda c: c["score"], reverse=True)
        if candidates and candidates[0]["available"] > 0:
            candidates[0]["recommended"] = True
        rows.append({
            "product_id": it["product_id"],
            "product_name": it.get("product_name"),
            "sku": it.get("sku"),
            "requested": it["quantity"],
            "warehouses": candidates,
        })
    return {"order_id": order_id, "distributor_region": region, "rows": rows}


# ---------------------------------------------------------------------------
# 4) Allocation actions
# ---------------------------------------------------------------------------
async def _apply_reservation(warehouse_id: str, product_id: str, delta: int) -> None:
    """Increment (positive) or release (negative) the reservation counter."""
    if delta == 0:
        return
    await db.inventory.update_one(
        {"owner_type": "warehouse", "owner_id": warehouse_id, "product_id": product_id},
        {"$inc": {"reserved": delta},
         "$setOnInsert": {
            "id": new_id(),
            "owner_type": "warehouse",
            "owner_id": warehouse_id,
            "product_id": product_id,
            "quantity": 0,
            "reorder_level": 0,
            "damaged": 0,
            "created_at": now_iso(),
         },
         "$set": {"updated_at": now_iso()}},
        upsert=True,
    )


async def _create_fulfillment_orders(
    order: Dict[str, Any],
    allocations: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Group allocation lines by warehouse → one fulfillment order each."""
    by_wh: Dict[str, List[Dict[str, Any]]] = {}
    for a in allocations:
        by_wh.setdefault(a["warehouse_id"], []).append(a)

    fos: List[Dict[str, Any]] = []
    counter_now = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    idx = 1
    for warehouse_id, lines in by_wh.items():
        wh = await db.organizations.find_one({"id": warehouse_id}, {"_id": 0}) or {}
        fo = {
            "id": new_id(),
            "fulfillment_number": f"FO-{counter_now}-{idx:02d}",
            "order_id": order["id"],
            "manufacturer_id": order["manufacturer_id"],
            "distributor_id": order["distributor_id"],
            "warehouse_id": warehouse_id,
            "warehouse_name": wh.get("organization_name", ""),
            "organization_id": warehouse_id,
            "items": [{
                "product_id": ln["product_id"],
                "product_name": ln.get("product_name"),
                "sku": ln.get("sku"),
                "allocated_quantity": ln["quantity"],
                "picked_quantity": 0,
            } for ln in lines],
            "priority": order.get("priority", "normal"),
            "due_date": order.get("due_date"),
            "status": "pending_picking",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.fulfillment_orders.insert_one(fo)
        fo.pop("_id", None)
        fos.append(fo)
        idx += 1
    return fos


async def _build_allocation_doc(
    order: Dict[str, Any],
    lines: List[Dict[str, Any]],
    mode: str,
    user_id: str,
    notes: Optional[str],
) -> Dict[str, Any]:
    return {
        "id": new_id(),
        "order_id": order["id"],
        "manufacturer_id": order["manufacturer_id"],
        "distributor_id": order["distributor_id"],
        "mode": mode,
        "lines": lines,
        "notes": notes,
        "decided_by": user_id,
        "decided_at": now_iso(),
    }


@router.post("/allocation/orders/{order_id}/auto-allocate")
async def auto_allocate(
    order_id: str,
    payload: AutoAllocatePayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] not in ("pending", "awaiting_allocation", "partially_allocated", "back_ordered"):
        raise HTTPException(400, f"Cannot allocate from '{order['status']}' state")

    # Greedy allocator using the recommendation engine.
    rec = await recommend(order_id, user)  # type: ignore[arg-type]
    await _denorm(order)  # ensure product_name/sku attached for fulfillment docs

    allocations: List[Dict[str, Any]] = []
    outstanding: List[Dict[str, Any]] = []
    for row in rec["rows"]:
        remaining = row["requested"]
        for cand in row["warehouses"]:
            if remaining <= 0:
                break
            give = min(cand["available"], remaining)
            if give <= 0:
                continue
            # Find product details from the order itself for line denormalisation.
            line_meta = next((it for it in order["items"] if it["product_id"] == row["product_id"]), {})
            allocations.append({
                "warehouse_id": cand["warehouse_id"],
                "warehouse_name": cand["warehouse_name"],
                "product_id": row["product_id"],
                "product_name": line_meta.get("product_name"),
                "sku": line_meta.get("sku"),
                "quantity": give,
            })
            remaining -= give
        if remaining > 0:
            line_meta = next((it for it in order["items"] if it["product_id"] == row["product_id"]), {})
            outstanding.append({
                "product_id": row["product_id"],
                "product_name": line_meta.get("product_name"),
                "sku": line_meta.get("sku"),
                "quantity": remaining,
            })

    return await _finalise_allocation(order, allocations, outstanding, "auto", user, payload.notes)


@router.post("/allocation/orders/{order_id}/manual-allocate")
async def manual_allocate(
    order_id: str,
    payload: ManualAllocatePayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] not in ("pending", "awaiting_allocation", "partially_allocated", "back_ordered"):
        raise HTTPException(400, f"Cannot allocate from '{order['status']}' state")
    await _denorm(order)

    requested_by_pid = {it["product_id"]: it["quantity"] for it in order["items"]}
    allocated_by_pid: Dict[str, int] = {pid: 0 for pid in requested_by_pid}
    allocations: List[Dict[str, Any]] = []
    for line in payload.lines:
        if line.product_id not in requested_by_pid:
            raise HTTPException(400, f"Product {line.product_id} not on this order")
        # Reservation check against current available
        inv = await _inventory_for(line.warehouse_id, [line.product_id])
        avail = inv.get(line.product_id, {}).get("available", 0)
        if line.quantity > avail:
            raise HTTPException(400, f"Insufficient available stock at warehouse for product {line.product_id}: requested {line.quantity}, available {avail}")
        wh = await db.organizations.find_one({"id": line.warehouse_id}, {"_id": 0, "organization_name": 1}) or {}
        line_meta = next((it for it in order["items"] if it["product_id"] == line.product_id), {})
        allocations.append({
            "warehouse_id": line.warehouse_id,
            "warehouse_name": wh.get("organization_name", ""),
            "product_id": line.product_id,
            "product_name": line_meta.get("product_name"),
            "sku": line_meta.get("sku"),
            "quantity": line.quantity,
        })
        allocated_by_pid[line.product_id] += line.quantity

    outstanding: List[Dict[str, Any]] = []
    for pid, req in requested_by_pid.items():
        rem = req - allocated_by_pid.get(pid, 0)
        if rem > 0:
            line_meta = next((it for it in order["items"] if it["product_id"] == pid), {})
            outstanding.append({
                "product_id": pid,
                "product_name": line_meta.get("product_name"),
                "sku": line_meta.get("sku"),
                "quantity": rem,
            })

    return await _finalise_allocation(order, allocations, outstanding, "manual", user, payload.notes)


async def _finalise_allocation(
    order: Dict[str, Any],
    allocations: List[Dict[str, Any]],
    outstanding: List[Dict[str, Any]],
    mode: str,
    user: Dict[str, Any],
    notes: Optional[str],
) -> Dict[str, Any]:
    if not allocations and outstanding:
        # Nothing could be allocated — flip to back-order immediately.
        update = {"status": "back_ordered", "updated_at": now_iso()}
        await db.distributor_orders.update_one({"id": order["id"]}, {"$set": update})
        bo = {
            "id": new_id(),
            "order_id": order["id"],
            "manufacturer_id": order["manufacturer_id"],
            "distributor_id": order["distributor_id"],
            "items": outstanding,
            "status": "open",
            "reason": "insufficient_inventory",
            "created_at": now_iso(),
        }
        await db.back_orders.insert_one(bo)
        return {"order_id": order["id"], "status": "back_ordered", "back_order": {**bo, "_id": None}}

    # Reserve inventory for each allocation line
    for a in allocations:
        await _apply_reservation(a["warehouse_id"], a["product_id"], a["quantity"])

    alloc_doc = await _build_allocation_doc(order, allocations, mode, user.get("id", ""), notes)
    await db.order_allocations.insert_one(alloc_doc)

    fos = await _create_fulfillment_orders(order, allocations)

    new_status = "partially_allocated" if outstanding else "allocated"
    update: Dict[str, Any] = {
        "status": new_status,
        "allocated_at": now_iso(),
        "allocation_id": alloc_doc["id"],
        "fulfillment_order_ids": [f["id"] for f in fos],
        "updated_at": now_iso(),
    }
    await db.distributor_orders.update_one({"id": order["id"]}, {"$set": update})

    if outstanding:
        bo = {
            "id": new_id(),
            "order_id": order["id"],
            "manufacturer_id": order["manufacturer_id"],
            "distributor_id": order["distributor_id"],
            "items": outstanding,
            "status": "open",
            "reason": "partial_allocation",
            "created_at": now_iso(),
        }
        await db.back_orders.insert_one(bo)

    # Notifications (best-effort)
    try:
        await push_notification(
            "distributor", order["distributor_id"],
            "Order Allocated" if not outstanding else "Order Partially Allocated",
            f"Your order has been {new_status.replace('_', ' ')}; fulfillment is now in progress.",
            "order",
        )
    except Exception:
        pass

    return {
        "order_id": order["id"],
        "status": new_status,
        "allocation_id": alloc_doc["id"],
        "fulfillment_orders": fos,
        "outstanding": outstanding,
    }


@router.post("/allocation/orders/{order_id}/back-order")
async def force_back_order(
    order_id: str,
    payload: BackorderPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] in ("completed", "rejected"):
        raise HTTPException(400, f"Cannot back-order from '{order['status']}' state")
    bo = {
        "id": new_id(),
        "order_id": order["id"],
        "manufacturer_id": order["manufacturer_id"],
        "distributor_id": order["distributor_id"],
        "items": order["items"],
        "status": "open",
        "reason": payload.reason or "manual_back_order",
        "created_at": now_iso(),
    }
    await db.back_orders.insert_one(bo)
    await db.distributor_orders.update_one(
        {"id": order_id}, {"$set": {"status": "back_ordered", "updated_at": now_iso()}},
    )
    return {"order_id": order_id, "status": "back_ordered", "back_order_id": bo["id"]}


@router.post("/allocation/orders/{order_id}/reject")
async def reject(
    order_id: str,
    payload: RejectPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] in ("completed", "rejected"):
        raise HTTPException(400, f"Cannot reject from '{order['status']}' state")
    await db.distributor_orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "rejected",
            "rejection_reason": payload.reason,
            "rejected_at": now_iso(),
            "updated_at": now_iso(),
        }},
    )
    try:
        await push_notification(
            "distributor", order["distributor_id"],
            "Order Rejected",
            f"Your order was rejected: {payload.reason}",
            "order",
        )
    except Exception:
        pass
    return {"order_id": order_id, "status": "rejected"}


@router.post("/allocation/orders/{order_id}/acknowledge")
async def acknowledge(
    order_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Move a brand-new 'pending' order into the active queue."""
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["status"] != "pending":
        return {"order_id": order_id, "status": order["status"]}
    await db.distributor_orders.update_one(
        {"id": order_id},
        {"$set": {"status": "awaiting_allocation", "updated_at": now_iso()}},
    )
    return {"order_id": order_id, "status": "awaiting_allocation"}


# ---------------------------------------------------------------------------
# 5) Back orders
# ---------------------------------------------------------------------------
@router.get("/allocation/back-orders")
async def list_back_orders(
    manufacturer_id: Optional[str] = None,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, manufacturer_id)
    rows = await db.back_orders.find(
        {"manufacturer_id": mfr, "status": {"$in": ["open", "partial"]}}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    # Denorm distributor name.
    dist_ids = list({r["distributor_id"] for r in rows})
    dists = {d["id"]: d for d in await db.distributors.find(
        {"id": {"$in": dist_ids}}, {"_id": 0},
    ).to_list(None)}
    now = datetime.now(timezone.utc)
    for r in rows:
        d = dists.get(r["distributor_id"], {})
        r["distributor_name"] = d.get("name", "Unknown")
        try:
            r["age_hours"] = round((now - datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))).total_seconds() / 3600, 1)
        except Exception:
            r["age_hours"] = 0
    return rows


# ---------------------------------------------------------------------------
# 6) Audit trail for a single order
# ---------------------------------------------------------------------------
@router.get("/allocation/orders/{order_id}")
async def order_detail(
    order_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    mfr = await _scope_manufacturer(user, None)
    order = await db.distributor_orders.find_one({"id": order_id, "manufacturer_id": mfr}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    await _denorm(order)
    order["allocations"] = await db.order_allocations.find({"order_id": order_id}, {"_id": 0}).sort("decided_at", -1).to_list(50)
    order["fulfillments"] = await db.fulfillment_orders.find({"order_id": order_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    order["back_orders"] = await db.back_orders.find({"order_id": order_id}, {"_id": 0}).to_list(50)
    return order
