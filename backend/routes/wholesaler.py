"""Wholesaler Workspace — Phase 1 routes.

Endpoints power the Wholesaler Dashboard, Inventory, Procurement, and
Distributor Network views. The wholesaler persona buys in bulk from
the Manufacturer (or the parent Warehouse) and supplies regional
distributors.

Topology:
    Manufacturer → Warehouse → Distributor → Wholesaler → Retailer (legacy)

We use a *soft-link* model for the Distributor Network: distributors
in the same region as the wholesaler are surfaced as the wholesaler's
"customer base" (no schema migration required).
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from core import db, new_id, now_iso
from routes._wholesaler_shared import (
    get_wholesaler_org as _get_wholesaler,
    require_wholesaler_access as _require_wholesaler_access,
    tenant_id_for as _tenant_id,
    walk_to_manufacturer as _walk_to_manufacturer,
)
from services.auth import get_current_user

router = APIRouter()

# ---- helpers ---------------------------------------------------------------


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _to_dt(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _delta_pct(cur: float, prev: float) -> float:
    if not prev:
        return 0.0 if not cur else 100.0
    return round(((cur - prev) / prev) * 100, 1)


def _spark(series: List[float], length: int = 12) -> List[float]:
    if not series:
        return [0] * length
    step = max(1, len(series) // length)
    out: List[float] = []
    for i in range(0, len(series), step):
        out.append(round(sum(series[i:i + step]), 2))
        if len(out) >= length:
            break
    while len(out) < length:
        out.append(0)
    return out[:length]


async def _get_wholesaler_local(wid: str) -> dict:
    """Local wrapper around the shared helper to avoid F811."""
    return await _get_wholesaler(wid)


# ---- ENTITY ENDPOINT (used by frontend SessionContext.fetchEntity) ---------


@router.get("/wholesaler/{wholesaler_id}")
async def get_wholesaler(wholesaler_id: str,
                         _user: dict = Depends(_require_wholesaler_access)):
    org = await _get_wholesaler(wholesaler_id)
    return {
        "id": org["id"],
        "name": org.get("organization_name", ""),
        "code": org.get("organization_code", ""),
        "region": org.get("region", ""),
        "city": org.get("city", ""),
        "manager_name": org.get("manager_name", ""),
        "contact_email": org.get("contact_email", ""),
    }


# ---- DASHBOARD OVERVIEW ----------------------------------------------------


@router.get("/wholesaler/{wholesaler_id}/overview")
async def wholesaler_overview(wholesaler_id: str,
                              _user: dict = Depends(_require_wholesaler_access)):
    wh = await _get_wholesaler(wholesaler_id)
    tenant_id = await _tenant_id(wh)
    region = wh.get("region") or ""

    # ---- Reference catalogues ---------------------------------------------
    products = await db.products.find(
        {"manufacturer_id": tenant_id} if tenant_id else {}, {"_id": 0},
    ).to_list(2000)
    product_by_id = {p["id"]: p for p in products}

    # ---- Distributors in the same region (soft-link "customer base") ------
    distributors_in_region = await db.organizations.find(
        {
            "organization_type": "distributor",
            "region": region,
            **({"parent_organization_id": {"$ne": None}} if region else {}),
        },
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "region": 1, "city": 1},
    ).to_list(500) if region else []
    # Filter by tenant via a SINGLE bulk lookup against the legacy mirror.
    customers: List[dict] = []
    if distributors_in_region:
        ids = [d["id"] for d in distributors_in_region]
        legacy_mfr: dict = {}
        async for ld in db.distributors.find(
            {"id": {"$in": ids}}, {"_id": 0, "id": 1, "manufacturer_id": 1},
        ):
            legacy_mfr[ld["id"]] = ld.get("manufacturer_id", "")
        for d in distributors_in_region:
            mfr = legacy_mfr.get(d["id"])
            # If we have a legacy mirror, enforce tenant; otherwise accept
            # the small-tenant pattern (no manufacturer mirror).
            if mfr and tenant_id and mfr != tenant_id:
                continue
            customers.append(d)

    # ---- Inventory --------------------------------------------------------
    inventory = await db.inventory.find(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id}, {"_id": 0},
    ).to_list(2000)

    total_units = 0
    total_value = 0.0
    in_stock = 0
    low_stock = 0
    excess = 0
    expiring = 0
    expiring_value = 0.0
    cutoff_expiring = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    for r in inventory:
        qty = int(r.get("quantity") or 0)
        reorder = int(r.get("reorder_level") or 0)
        max_stock = int(r.get("max_stock") or (reorder * 6 if reorder else 0))
        total_units += qty
        p = product_by_id.get(r.get("product_id")) or {}
        total_value += float(p.get("unit_price") or 0) * qty
        if qty > 0:
            in_stock += 1
        if reorder and qty <= reorder:
            low_stock += 1
        if max_stock and qty > max_stock:
            excess += 1
        # Expiry: optional `expiry_date` field on the inventory row.
        if r.get("expiry_date") and r["expiry_date"] <= cutoff_expiring:
            expiring += 1
            expiring_value += float(p.get("unit_price") or 0) * qty

    inv_health = round((in_stock / max(len(inventory), 1)) * 100, 1) if inventory else 0

    # ---- Purchase Orders (this wholesaler buying from upstream) -----------
    pos = await db.wholesaler_purchase_orders.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0}
    ).to_list(500)
    pending_pos = sum(1 for p in pos if p.get("status") in ("draft", "submitted", "approved"))
    incoming_shipments = sum(1 for p in pos if p.get("status") in ("allocated", "shipped"))

    # ---- Outgoing shipments (placeholder Phase 2 — count zero for now) ----
    outgoing_shipments = 0

    # ---- Inventory turnover (last 90d throughput / avg inventory) ----------
    ninety_ago = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    received_recent = sum(
        sum(int(it.get("quantity") or 0) for it in (p.get("items") or []))
        for p in pos
        if p.get("status") in ("delivered",) and (p.get("delivered_at") or "") >= ninety_ago
    )
    turnover = round(received_recent / max(total_units, 1), 2) if total_units else 0.0

    # ---- Stockout risks (top 5 by criticality) ----------------------------
    risks = []
    for r in inventory:
        qty = int(r.get("quantity") or 0)
        reorder = int(r.get("reorder_level") or 0)
        if reorder and qty <= reorder * 1.5:
            p = product_by_id.get(r.get("product_id")) or {}
            severity = "out" if qty == 0 else ("critical" if qty <= reorder else "low")
            # naive days-of-cover from a synthetic velocity field.
            velocity = float(r.get("velocity") or 0) or 1
            risks.append({
                "product_id": r.get("product_id"),
                "product_name": p.get("name", "Unknown"),
                "sku": p.get("sku", ""),
                "on_hand": qty,
                "reorder_level": reorder,
                "days_left": round(qty / velocity, 1) if velocity else None,
                "severity": severity,
            })
    sev_rank = {"out": 0, "critical": 1, "low": 2}
    risks.sort(key=lambda r: (sev_rank.get(r["severity"], 9),
                              r["days_left"] if r["days_left"] is not None else 999))

    # ---- AI Insights (rule-based; mirrors logistics module's tone) --------
    insights = []
    if low_stock or excess:
        insights.append({
            "type": "inventory",
            "title": "Inventory rebalance",
            "body": f"{low_stock} SKU(s) below reorder, {excess} SKU(s) in excess. "
                    f"Trigger replenishment on critical SKUs and review pricing on excess.",
            "tone": "warning",
        })
    else:
        insights.append({
            "type": "inventory",
            "title": "Inventory healthy",
            "body": f"{inv_health}% of SKUs in stock. No urgent restocks required.",
            "tone": "positive",
        })

    if pending_pos:
        insights.append({
            "type": "procurement",
            "title": "Replenishment in motion",
            "body": f"{pending_pos} purchase order(s) in the pipeline — confirm allocation "
                    f"to keep distributors served.",
            "tone": "neutral",
        })
    else:
        insights.append({
            "type": "procurement",
            "title": "Procurement pipeline empty",
            "body": "No active POs. Review demand from your distributor network and "
                    "place a replenishment order.",
            "tone": "warning",
        })

    if expiring:
        insights.append({
            "type": "expiry",
            "title": "Expiring inventory",
            "body": f"{expiring} SKU(s) ({total_value and round(expiring_value, 0)} ₦) "
                    f"expire within 30 days. Plan distributor promotions or returns.",
            "tone": "alert",
        })

    if customers:
        insights.append({
            "type": "network",
            "title": f"Serving {len(customers)} distributor(s)",
            "body": f"You are the regional hub for {len(customers)} distributor(s) in "
                    f"{region or 'your zone'}. Track their replenishment cadence.",
            "tone": "positive",
        })

    return {
        "wholesaler": {
            "id": wh["id"],
            "name": wh.get("organization_name", ""),
            "code": wh.get("organization_code", ""),
            "region": region,
            "city": wh.get("city", ""),
        },
        "kpis": {
            "inventory_value":   {"value": round(total_value, 2)},
            "inventory_units":   {"value": total_units},
            "pending_pos":       {"value": pending_pos},
            "incoming_shipments": {"value": incoming_shipments},
            "outgoing_shipments": {"value": outgoing_shipments},
            "active_distributors": {"value": len(customers)},
            "inventory_turnover": {"value": turnover},
            "stockout_risks":    {"value": len(risks)},
        },
        "inventory_health": {
            "in_stock": in_stock,
            "low_stock": low_stock,
            "excess_stock": excess,
            "expiring": expiring,
            "total_skus": len(inventory),
            "health_score": inv_health,
        },
        "ai_insights": insights[:4],
        "stockout_risks": risks[:6],
        "as_of": now_iso(),
    }


# ---- INVENTORY -------------------------------------------------------------


class InventoryAdjustPayload(BaseModel):
    delta: int                          # +/- quantity to apply
    reason: Literal["receive", "damage", "cycle_count", "manual"] = "manual"
    note: Optional[str] = None
    actor: Optional[str] = None


class InventoryReceivePayload(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)
    source: Optional[str] = "manual"
    note: Optional[str] = None
    actor: Optional[str] = None


class CycleCountPayload(BaseModel):
    counted_quantity: int = Field(ge=0)
    note: Optional[str] = None
    actor: Optional[str] = None


@router.get("/wholesaler/{wholesaler_id}/inventory")
async def list_inventory(wholesaler_id: str,
                         _user: dict = Depends(_require_wholesaler_access)):
    wh = await _get_wholesaler(wholesaler_id)
    tenant_id = await _tenant_id(wh)
    rows = await db.inventory.find(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id}, {"_id": 0},
    ).to_list(2000)
    products = await db.products.find(
        {"manufacturer_id": tenant_id} if tenant_id else {}, {"_id": 0},
    ).to_list(2000)
    pmap = {p["id"]: p for p in products}

    out = []
    for r in rows:
        p = pmap.get(r.get("product_id")) or {}
        qty = int(r.get("quantity") or 0)
        reserved = int(r.get("reserved") or 0)
        damaged = int(r.get("damaged") or 0)
        in_transit = int(r.get("in_transit") or 0)
        reorder = int(r.get("reorder_level") or 0)
        max_stock = int(r.get("max_stock") or (reorder * 6 if reorder else 0))
        if qty == 0:
            health = "out"
        elif reorder and qty <= reorder:
            health = "low"
        elif max_stock and qty > max_stock:
            health = "excess"
        else:
            health = "healthy"
        out.append({
            "id": r.get("id"),
            "product_id": r.get("product_id"),
            "product_name": p.get("name", "Unknown"),
            "sku": p.get("sku", ""),
            "category": p.get("category", "—"),
            "unit_price": float(p.get("unit_price") or 0),
            "available": qty,
            "reserved": reserved,
            "damaged": damaged,
            "in_transit": in_transit,
            "reorder_level": reorder,
            "max_stock": max_stock,
            "value": round(float(p.get("unit_price") or 0) * qty, 2),
            "health": health,
            "expiry_date": r.get("expiry_date"),
            "updated_at": r.get("updated_at") or r.get("last_movement_at"),
        })
    out.sort(key=lambda x: (x["health"] != "out", x["health"] != "low",
                            -x["value"]))
    return {
        "wholesaler_id": wholesaler_id,
        "rows": out,
        "summary": {
            "total_skus": len(out),
            "total_value": round(sum(r["value"] for r in out), 2),
            "total_units": sum(r["available"] for r in out),
            "low_stock": sum(1 for r in out if r["health"] == "low"),
            "out_of_stock": sum(1 for r in out if r["health"] == "out"),
            "excess": sum(1 for r in out if r["health"] == "excess"),
        },
    }


async def _log_movement(wholesaler_id: str, product_id: str,
                        kind: str, delta: int, note: Optional[str],
                        actor: Optional[str]) -> None:
    await db.wholesaler_inventory_movements.insert_one({
        "id": new_id(),
        "wholesaler_id": wholesaler_id,
        "product_id": product_id,
        "kind": kind,
        "delta": int(delta),
        "note": note or "",
        "actor": actor or "wholesaler",
        "created_at": now_iso(),
    })


@router.post("/wholesaler/{wholesaler_id}/inventory/{product_id}/adjust")
async def adjust_inventory(wholesaler_id: str, product_id: str,
                           payload: InventoryAdjustPayload,
                           _user: dict = Depends(_require_wholesaler_access)):
    await _get_wholesaler(wholesaler_id)
    existing = await db.inventory.find_one(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id, "product_id": product_id},
        {"_id": 0},
    )
    if not existing:
        # Bootstrap a fresh inventory row
        row = {
            "id": new_id(),
            "owner_type": "wholesaler",
            "owner_id": wholesaler_id,
            "organization_id": wholesaler_id,
            "product_id": product_id,
            "quantity": max(0, payload.delta),
            "reorder_level": 20,
            "max_stock": 0,
            "updated_at": now_iso(),
            "created_at": now_iso(),
        }
        await db.inventory.insert_one(row)
    else:
        new_qty = max(0, int(existing.get("quantity") or 0) + payload.delta)
        await db.inventory.update_one(
            {"id": existing["id"]},
            {"$set": {"quantity": new_qty, "updated_at": now_iso(),
                      "last_movement_at": now_iso()}},
        )
    await _log_movement(wholesaler_id, product_id, payload.reason,
                        payload.delta, payload.note, payload.actor)
    return {"ok": True}


@router.post("/wholesaler/{wholesaler_id}/inventory/receive")
async def receive_inventory(wholesaler_id: str, payload: InventoryReceivePayload,
                            user: dict = Depends(_require_wholesaler_access)):
    """Manual goods-receipt: increment available stock and log a movement."""
    return await adjust_inventory(
        wholesaler_id, payload.product_id,
        InventoryAdjustPayload(delta=payload.quantity, reason="receive",
                               note=payload.note or payload.source,
                               actor=payload.actor),
        _user=user,
    )


@router.post("/wholesaler/{wholesaler_id}/inventory/{product_id}/cycle-count")
async def cycle_count(wholesaler_id: str, product_id: str,
                      payload: CycleCountPayload,
                      _user: dict = Depends(_require_wholesaler_access)):
    await _get_wholesaler(wholesaler_id)
    row = await db.inventory.find_one(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id,
         "product_id": product_id}, {"_id": 0},
    )
    if not row:
        raise HTTPException(404, "Inventory row not found")
    current = int(row.get("quantity") or 0)
    variance = payload.counted_quantity - current
    await db.inventory.update_one(
        {"id": row["id"]},
        {"$set": {"quantity": payload.counted_quantity, "updated_at": now_iso(),
                  "last_movement_at": now_iso(),
                  "last_cycle_count_at": now_iso()}},
    )
    await _log_movement(wholesaler_id, product_id, "cycle_count",
                        variance, payload.note or f"Counted {payload.counted_quantity}",
                        payload.actor)
    return {"ok": True, "variance": variance, "new_quantity": payload.counted_quantity}


@router.get("/wholesaler/{wholesaler_id}/inventory/movements")
async def list_movements(wholesaler_id: str, limit: int = 50,
                         _user: dict = Depends(_require_wholesaler_access)):
    await _get_wholesaler(wholesaler_id)
    rows = await db.wholesaler_inventory_movements.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    product_ids = list({r["product_id"] for r in rows if r.get("product_id")})
    pmap = {p["id"]: p for p in await db.products.find(
        {"id": {"$in": product_ids}}, {"_id": 0, "id": 1, "name": 1, "sku": 1},
    ).to_list(len(product_ids))}
    for r in rows:
        p = pmap.get(r.get("product_id")) or {}
        r["product_name"] = p.get("name", "Unknown")
        r["sku"] = p.get("sku", "")
    return rows


# ---- PROCUREMENT (PO LIFECYCLE) --------------------------------------------


PO_TRANSITIONS = {
    "draft":      ["submitted", "cancelled"],
    "submitted":  ["approved", "rejected", "cancelled"],
    "approved":   ["allocated", "cancelled"],
    "allocated":  ["shipped"],
    "shipped":    ["delivered"],
    "delivered":  [],
    "rejected":   [],
    "cancelled":  [],
}


class POLineIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)
    unit_cost: float = Field(ge=0)


class POCreatePayload(BaseModel):
    supplier_id: str                                # manufacturer / warehouse / distributor
    supplier_type: Literal["manufacturer", "warehouse", "distributor"]
    items: List[POLineIn]
    note: Optional[str] = None
    expected_delivery: Optional[str] = None


class POTransitionPayload(BaseModel):
    action: Literal["submit", "approve", "reject", "allocate", "ship",
                    "deliver", "cancel"]
    note: Optional[str] = None
    actor: Optional[str] = None


_ACTION_TO_STATUS = {
    "submit": "submitted",
    "approve": "approved",
    "reject": "rejected",
    "allocate": "allocated",
    "ship": "shipped",
    "deliver": "delivered",
    "cancel": "cancelled",
}


@router.get("/wholesaler/{wholesaler_id}/procurement/orders")
async def list_purchase_orders(wholesaler_id: str,
                               _user: dict = Depends(_require_wholesaler_access)):
    await _get_wholesaler(wholesaler_id)
    pos = await db.wholesaler_purchase_orders.find(
        {"wholesaler_id": wholesaler_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    # Enrich with supplier + product names
    supplier_ids = list({p["supplier_id"] for p in pos if p.get("supplier_id")})
    product_ids = list({i["product_id"] for p in pos for i in (p.get("items") or [])})
    supp_map = {o["id"]: o for o in await db.organizations.find(
        {"id": {"$in": supplier_ids}}, {"_id": 0,
                                         "id": 1, "organization_name": 1,
                                         "organization_code": 1, "organization_type": 1},
    ).to_list(len(supplier_ids))}
    prod_map = {p["id"]: p for p in await db.products.find(
        {"id": {"$in": product_ids}}, {"_id": 0, "id": 1, "name": 1, "sku": 1},
    ).to_list(len(product_ids))}
    for p in pos:
        supp = supp_map.get(p.get("supplier_id")) or {}
        p["supplier_name"] = supp.get("organization_name", "Unknown")
        p["supplier_code"] = supp.get("organization_code", "")
        units = 0
        for it in (p.get("items") or []):
            pr = prod_map.get(it.get("product_id")) or {}
            it["product_name"] = pr.get("name", "Unknown")
            it["sku"] = pr.get("sku", "")
            units += int(it.get("quantity") or 0)
        p["total_units"] = units
    return pos


@router.post("/wholesaler/{wholesaler_id}/procurement/orders")
async def create_purchase_order(wholesaler_id: str, payload: POCreatePayload,
                                _user: dict = Depends(_require_wholesaler_access)):
    wh = await _get_wholesaler(wholesaler_id)
    # Validate supplier exists
    sup = await db.organizations.find_one(
        {"id": payload.supplier_id, "organization_type": payload.supplier_type},
        {"_id": 0},
    )
    if not sup:
        raise HTTPException(404, "Supplier not found")

    # Tenant-validate product_ids — every line must belong to the
    # wholesaler's parent manufacturer's catalog.
    tenant_id = await _tenant_id(wh)
    if tenant_id:
        product_ids = [it.product_id for it in payload.items]
        valid = await db.products.count_documents(
            {"id": {"$in": product_ids}, "manufacturer_id": tenant_id}
        )
        if valid != len(set(product_ids)):
            raise HTTPException(400, "One or more products are not in your tenant catalog")

    items_out = []
    total = 0.0
    for it in payload.items:
        line_total = round(it.unit_cost * it.quantity, 2)
        items_out.append({
            "product_id": it.product_id,
            "quantity": it.quantity,
            "unit_cost": it.unit_cost,
            "line_total": line_total,
        })
        total += line_total

    seq = await db.wholesaler_purchase_orders.count_documents({})
    po_number = f"WPO-{datetime.now(timezone.utc).year}-{seq + 1:04d}"

    doc = {
        "id": new_id(),
        "po_number": po_number,
        "wholesaler_id": wholesaler_id,
        "tenant_id": tenant_id,
        "supplier_id": payload.supplier_id,
        "supplier_type": payload.supplier_type,
        "supplier_name": sup.get("organization_name", ""),
        "items": items_out,
        "total_units": sum(it["quantity"] for it in items_out),
        "total_amount": round(total, 2),
        "status": "draft",
        "note": payload.note or "",
        "expected_delivery": payload.expected_delivery,
        "status_history": [{"status": "draft", "at": now_iso(),
                            "by": "wholesaler", "note": "PO drafted"}],
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.wholesaler_purchase_orders.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/wholesaler/{wholesaler_id}/procurement/orders/{po_id}/transition")
async def transition_po(wholesaler_id: str, po_id: str,
                        payload: POTransitionPayload,
                        _user: dict = Depends(_require_wholesaler_access)):
    await _get_wholesaler(wholesaler_id)
    po = await db.wholesaler_purchase_orders.find_one(
        {"id": po_id, "wholesaler_id": wholesaler_id}, {"_id": 0}
    )
    if not po:
        raise HTTPException(404, "Purchase order not found")
    target = _ACTION_TO_STATUS[payload.action]
    cur = po.get("status", "draft")
    if target not in PO_TRANSITIONS.get(cur, []):
        raise HTTPException(400, f"Cannot transition {cur} → {target}")

    updates: dict = {
        "status": target,
        "updated_at": now_iso(),
    }
    timestamp_field = {
        "submitted": "submitted_at",
        "approved": "approved_at",
        "allocated": "allocated_at",
        "shipped": "shipped_at",
        "delivered": "delivered_at",
        "cancelled": "cancelled_at",
        "rejected": "rejected_at",
    }.get(target)
    if timestamp_field:
        updates[timestamp_field] = now_iso()

    # Delivered → credit inventory (one row per line item)
    if target == "delivered":
        for it in (po.get("items") or []):
            existing = await db.inventory.find_one(
                {"owner_type": "wholesaler", "owner_id": wholesaler_id,
                 "product_id": it["product_id"]}, {"_id": 0},
            )
            if existing:
                await db.inventory.update_one(
                    {"id": existing["id"]},
                    {"$inc": {"quantity": int(it.get("quantity") or 0)},
                     "$set": {"updated_at": now_iso(),
                              "last_movement_at": now_iso()}},
                )
            else:
                await db.inventory.insert_one({
                    "id": new_id(),
                    "owner_type": "wholesaler",
                    "owner_id": wholesaler_id,
                    "organization_id": wholesaler_id,
                    "product_id": it["product_id"],
                    "quantity": int(it.get("quantity") or 0),
                    "reorder_level": 20,
                    "max_stock": 0,
                    "updated_at": now_iso(),
                    "created_at": now_iso(),
                })
            await _log_movement(wholesaler_id, it["product_id"], "receive",
                                int(it.get("quantity") or 0),
                                f"Received from PO {po['po_number']}", payload.actor)

    event = {"status": target, "at": now_iso(),
             "by": payload.actor or "wholesaler", "note": payload.note}
    await db.wholesaler_purchase_orders.update_one(
        {"id": po_id},
        {"$set": updates, "$push": {"status_history": event}},
    )
    return {"ok": True, "status": target}


@router.get("/wholesaler/{wholesaler_id}/procurement/suppliers")
async def list_suppliers(wholesaler_id: str,
                         _user: dict = Depends(_require_wholesaler_access)):
    """Return suppliers a wholesaler can buy from.

    Per the foundational supply-chain spec — Distributors **serve**
    Wholesalers — distributors are the primary upstream. The manufacturer
    and the regional warehouses are retained as legacy/secondary so
    factory-direct procurement is still possible when a distributor is
    not in the region or for key-account flows.
    """
    wh = await _get_wholesaler(wholesaler_id)
    tenant_id = await _tenant_id(wh)

    out: List[dict] = []
    if tenant_id:
        # Primary — distributors in the wholesaler's tenant.
        # If the wholesaler has a parent distributor (org hierarchy)
        # surface it first; otherwise list every distributor in tenant.
        parent_id = wh.get("parent_organization_id")
        parent_dist = None
        if parent_id:
            parent_dist = await db.organizations.find_one(
                {"id": parent_id, "organization_type": "distributor"}, {"_id": 0},
            )
            if parent_dist:
                out.append({
                    "id": parent_dist["id"], "type": "distributor",
                    "name": parent_dist.get("organization_name"),
                    "code": parent_dist.get("organization_code"),
                    "region": parent_dist.get("region") or "",
                    "is_primary": True,
                })
        async for d_doc in db.organizations.find(
            {"organization_type": "distributor",
             "$or": [
                 {"parent_organization_id": tenant_id},
                 {"manufacturer_id": tenant_id},
             ]},
            {"_id": 0},
        ):
            if parent_dist and d_doc["id"] == parent_dist["id"]:
                continue
            out.append({
                "id": d_doc["id"], "type": "distributor",
                "name": d_doc.get("organization_name"),
                "code": d_doc.get("organization_code"),
                "region": d_doc.get("region") or "",
                "is_primary": False,
            })

        # Legacy — manufacturer & warehouses (kept for factory-direct
        # / key-account procurement).
        mfr = await db.organizations.find_one(
            {"id": tenant_id, "organization_type": "manufacturer"}, {"_id": 0},
        )
        if mfr:
            out.append({
                "id": mfr["id"], "type": "manufacturer",
                "name": mfr.get("organization_name"),
                "code": mfr.get("organization_code"),
                "region": mfr.get("region") or "",
                "is_primary": False,
                "note": "Legacy / factory-direct",
            })
        async for wh_doc in db.organizations.find(
            {"organization_type": "warehouse",
             "parent_organization_id": tenant_id}, {"_id": 0},
        ):
            out.append({
                "id": wh_doc["id"], "type": "warehouse",
                "name": wh_doc.get("organization_name"),
                "code": wh_doc.get("organization_code"),
                "region": wh_doc.get("region") or "",
                "is_primary": False,
                "note": "Legacy / factory-direct",
            })
    return out


@router.get("/wholesaler/{wholesaler_id}/procurement/catalog")
async def list_catalog(wholesaler_id: str,
                       _user: dict = Depends(_require_wholesaler_access)):
    """Products this wholesaler can order from upstream (tenant scoped)."""
    wh = await _get_wholesaler(wholesaler_id)
    tenant_id = await _tenant_id(wh)
    if not tenant_id:
        return []
    rows = await db.products.find(
        {"manufacturer_id": tenant_id}, {"_id": 0},
    ).sort("name", 1).to_list(2000)
    # Annotate with current wholesaler on-hand for context
    inv_rows = await db.inventory.find(
        {"owner_type": "wholesaler", "owner_id": wholesaler_id}, {"_id": 0},
    ).to_list(2000)
    inv_map = {r["product_id"]: r for r in inv_rows}
    for p in rows:
        inv = inv_map.get(p["id"]) or {}
        p["on_hand"] = int(inv.get("quantity") or 0)
        p["reorder_level"] = int(inv.get("reorder_level") or 0)
    return rows


# ---- DISTRIBUTOR NETWORK ---------------------------------------------------


@router.get("/wholesaler/{wholesaler_id}/distributors")
async def list_distributors_served(wholesaler_id: str,
                                   _user: dict = Depends(_require_wholesaler_access)):
    wh = await _get_wholesaler(wholesaler_id)
    region = wh.get("region") or ""
    tenant_id = await _tenant_id(wh)

    # Pull region distributors; cross-check against legacy `distributors`
    # mirror to filter tenant scope (single bulk lookup, no N+1).
    org_rows = await db.organizations.find(
        {"organization_type": "distributor", "region": region}, {"_id": 0},
    ).to_list(500) if region else []
    org_ids = [d["id"] for d in org_rows]

    legacy_map: dict = {}
    if org_ids:
        async for ld in db.distributors.find(
            {"id": {"$in": org_ids}},
            {"_id": 0, "id": 1, "manufacturer_id": 1, "city": 1, "name": 1},
        ):
            legacy_map[ld["id"]] = ld

    # Tenant-filter org rows up-front
    in_tenant_ids = []
    for d in org_rows:
        legacy = legacy_map.get(d["id"])
        if legacy and tenant_id and legacy.get("manufacturer_id") != tenant_id:
            continue
        in_tenant_ids.append(d["id"])

    if not in_tenant_ids:
        return {
            "wholesaler_id": wholesaler_id, "region": region,
            "distributors": [],
            "totals": {"distributor_count": 0, "total_revenue_90d": 0.0,
                       "active_distributors": 0},
            "insights": [],
        }

    # Bulk inventory aggregate per distributor
    inv_pipeline = [
        {"$match": {"owner_type": "distributor", "owner_id": {"$in": in_tenant_ids}}},
        {"$group": {
            "_id": "$owner_id",
            "skus": {"$sum": 1},
            "in_stock": {"$sum": {"$cond": [{"$gt": ["$quantity", 0]}, 1, 0]}},
        }},
    ]
    inv_map: dict = {}
    async for row in db.inventory.aggregate(inv_pipeline):
        inv_map[row["_id"]] = row

    # Bulk order frequency + revenue aggregate (last 90 days)
    ninety_ago = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    order_count_map: dict = {}
    async for row in db.distributor_orders.aggregate([
        {"$match": {"distributor_id": {"$in": in_tenant_ids},
                    "created_at": {"$gte": ninety_ago}}},
        {"$group": {"_id": "$distributor_id", "n": {"$sum": 1}}},
    ]):
        order_count_map[row["_id"]] = row["n"]

    # Revenue from delivered orders (last 90 days)
    revenue_map: dict = {}
    async for o in db.distributor_orders.find(
        {"distributor_id": {"$in": in_tenant_ids}, "status": "delivered",
         "delivered_at": {"$gte": ninety_ago}}, {"_id": 0},
    ):
        rev = sum(float(it.get("unit_cost") or 0) * int(it.get("quantity") or 0)
                  for it in (o.get("items") or []))
        revenue_map[o["distributor_id"]] = revenue_map.get(o["distributor_id"], 0.0) + rev

    out: List[dict] = []
    for d in org_rows:
        if d["id"] not in legacy_map and tenant_id:
            # Only skip if the tenant filter applies and the distributor
            # isn't in our legacy mirror — likely cross-tenant.
            pass
        if d["id"] not in in_tenant_ids:
            continue
        legacy = legacy_map.get(d["id"]) or {}
        inv = inv_map.get(d["id"]) or {}
        in_stock = int(inv.get("in_stock") or 0)
        sku_count = int(inv.get("skus") or 0)
        inv_health = round(in_stock / sku_count * 100, 1) if sku_count else 0
        out.append({
            "id": d["id"],
            "name": d.get("organization_name") or legacy.get("name") or "",
            "code": d.get("organization_code", ""),
            "region": d.get("region", ""),
            "city": d.get("city") or legacy.get("city") or "",
            "inventory_health": inv_health,
            "inventory_skus": sku_count,
            "purchase_frequency_90d": order_count_map.get(d["id"], 0),
            "revenue_90d": round(revenue_map.get(d["id"], 0.0), 2),
        })

    out.sort(key=lambda x: x["revenue_90d"], reverse=True)
    total_revenue = sum(d["revenue_90d"] for d in out)
    insights = []
    if out:
        top = out[0]
        insights.append({
            "title": f"{top['name']} leads",
            "body": f"Highest 90-day revenue contributor at ₦{top['revenue_90d']:,.0f}.",
            "tone": "positive",
        })
        dormant = [d for d in out if d["purchase_frequency_90d"] == 0]
        if dormant:
            insights.append({
                "title": "Reactivation opportunity",
                "body": f"{len(dormant)} distributor(s) haven't ordered in 90 days. "
                        f"Re-engage to lift fill-rate.",
                "tone": "warning",
            })
        weak = [d for d in out if d["inventory_health"] < 60 and d["inventory_skus"] > 0]
        if weak:
            insights.append({
                "title": "Distributors with low coverage",
                "body": f"{len(weak)} distributor(s) carry under 60% catalogue coverage. "
                        f"Push replenishment.",
                "tone": "neutral",
            })

    return {
        "wholesaler_id": wholesaler_id,
        "region": region,
        "distributors": out,
        "totals": {
            "distributor_count": len(out),
            "total_revenue_90d": round(total_revenue, 2),
            "active_distributors": sum(1 for d in out if d["purchase_frequency_90d"] > 0),
        },
        "insights": insights[:3],
    }



# ============================================================================
# Distributor → incoming wholesaler purchase orders
# ----------------------------------------------------------------------------
# Per the foundational spec ("Distributors serve Wholesalers"), wholesalers
# place POs on distributors. This endpoint surfaces those POs on the
# distributor side so they can be reviewed / actioned.
# ============================================================================
@router.get("/distributor/{distributor_id}/incoming-wholesaler-pos")
async def list_incoming_wholesaler_pos(distributor_id: str,
                                        status: Optional[str] = None,
                                        limit: int = 200):
    """List wholesaler purchase orders where this distributor is the supplier."""
    q: dict = {"supplier_id": distributor_id, "supplier_type": "distributor"}
    if status:
        q["status"] = status
    pos = await db.wholesaler_purchase_orders.find(q, {"_id": 0}).sort(
        "created_at", -1,
    ).to_list(limit)

    wh_ids = list({p["wholesaler_id"] for p in pos if p.get("wholesaler_id")})
    product_ids = list({i["product_id"] for p in pos for i in (p.get("items") or [])})
    wh_map = {o["id"]: o for o in await db.organizations.find(
        {"id": {"$in": wh_ids}, "organization_type": "wholesaler"},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1, "region": 1, "city": 1},
    ).to_list(len(wh_ids))} if wh_ids else {}
    prod_map = {p["id"]: p for p in await db.products.find(
        {"id": {"$in": product_ids}}, {"_id": 0, "id": 1, "name": 1, "sku": 1},
    ).to_list(len(product_ids))} if product_ids else {}

    for p in pos:
        wh = wh_map.get(p.get("wholesaler_id")) or {}
        p["wholesaler_name"] = wh.get("organization_name", "Unknown wholesaler")
        p["wholesaler_code"] = wh.get("organization_code", "")
        p["wholesaler_region"] = wh.get("region", "")
        p["wholesaler_city"] = wh.get("city", "")
        units = 0
        for it in (p.get("items") or []):
            pr = prod_map.get(it.get("product_id")) or {}
            it["product_name"] = pr.get("name", "Unknown")
            it["sku"] = pr.get("sku", "")
            units += int(it.get("quantity") or 0)
        p["total_units"] = units
    return pos
