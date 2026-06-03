"""Manufacturer workspace: product + distributor drill-down endpoints.

Aggregates across the entire downstream network (every distributor + every
retailer linked to this manufacturer), unlike the distributor-scoped routes
in routes/distributor.py which only see one distributor's slice.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db, now_iso

router = APIRouter()


# ============================================================================
# PRODUCT CATALOG — enriched list for the Manufacturer Inventory page
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/products")
async def manufacturer_products(manufacturer_id: str):
    """Enriched product catalog for the manufacturer's Inventory module.

    Returns every product + units in network, revenue (90d), distributor count
    and status. Replaces the bare "product list" with the directory the
    Inventory page can render.
    """
    products = await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0}
    ).sort("name", 1).to_list(5000)
    if not products:
        return []

    product_ids = [p["id"] for p in products]
    # Distributor count carrying each product (via distributor-level inventory)
    distributors_in_network = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0, "id": 1},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors_in_network]
    retailers_in_network = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0, "id": 1},
    ).to_list(50000)
    retailer_ids = [r["id"] for r in retailers_in_network]

    # Inventory rollup across distributors + retailers
    inv_rollup: Dict[str, dict] = {pid: {"dist_units": 0, "retail_units": 0,
                                          "dist_count": 0, "retail_count": 0} for pid in product_ids}
    async for inv in db.inventory.find(
        {"product_id": {"$in": product_ids}, "$or": [
            {"owner_type": "distributor", "owner_id": {"$in": dist_ids}},
            {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}},
        ]}, {"_id": 0, "product_id": 1, "owner_type": 1, "quantity": 1},
    ):
        pid = inv["product_id"]
        if pid not in inv_rollup:
            continue
        if inv["owner_type"] == "distributor":
            inv_rollup[pid]["dist_units"] += int(inv.get("quantity", 0))
            if inv.get("quantity", 0) > 0:
                inv_rollup[pid]["dist_count"] += 1
        else:
            inv_rollup[pid]["retail_units"] += int(inv.get("quantity", 0))
            if inv.get("quantity", 0) > 0:
                inv_rollup[pid]["retail_count"] += 1

    # Revenue (90d) by product
    start_90 = (datetime.now(timezone.utc).date() - timedelta(days=89)).isoformat()
    # 30-day sparkline (units sold per day across the whole network)
    today = datetime.now(timezone.utc).date()
    start_30 = (today - timedelta(days=29)).isoformat()
    spark_by_product: Dict[str, Dict[str, int]] = {pid: {} for pid in product_ids}

    rev_by_product: Dict[str, dict] = {pid: {"revenue": 0.0, "units": 0} for pid in product_ids}
    async for s in db.daily_sales.find(
        {"product_id": {"$in": product_ids}, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_90}},
        {"_id": 0, "product_id": 1, "revenue": 1, "quantity_sold": 1, "date": 1},
    ):
        pid = s["product_id"]
        if pid in rev_by_product:
            rev_by_product[pid]["revenue"] += float(s.get("revenue", 0))
            rev_by_product[pid]["units"] += int(s.get("quantity_sold", 0))
            if s["date"] >= start_30:
                spark_by_product[pid][s["date"]] = (
                    spark_by_product[pid].get(s["date"], 0) + int(s.get("quantity_sold", 0))
                )

    out: List[dict] = []
    # 30 chronological day buckets for the sparkline
    day_keys = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    for p in products:
        roll = inv_rollup.get(p["id"], {})
        rev = rev_by_product.get(p["id"], {})
        units_in_network = roll.get("dist_units", 0) + roll.get("retail_units", 0)
        status = "active" if (units_in_network > 0 or roll.get("dist_count", 0) > 0) else "inactive"
        daily = spark_by_product.get(p["id"], {})
        spark = [daily.get(d, 0) for d in day_keys]
        # Trend = sum(last 7d) vs sum(prior 7d), as % delta. None when no signal.
        recent_7 = sum(spark[-7:])
        prior_7 = sum(spark[-14:-7])
        trend_pct = None if prior_7 == 0 and recent_7 == 0 else (
            round((recent_7 - prior_7) / max(prior_7, 1) * 100, 1) if prior_7 > 0 else 100.0
        )
        out.append({
            "id": p["id"], "sku": p.get("sku", ""), "name": p["name"],
            "category": p.get("category", ""), "unit_price": float(p.get("unit_price", 0)),
            "barcode": p.get("barcode", ""),
            "units_in_network": units_in_network,
            "distributor_count": roll.get("dist_count", 0),
            "retailer_count": roll.get("retail_count", 0),
            "revenue_90d": round(rev.get("revenue", 0.0), 2),
            "units_sold_90d": rev.get("units", 0),
            "status": status,
            "sparkline_30d": spark,
            "trend_pct_7d": trend_pct,
        })
    return out


# ============================================================================
# PRODUCT DRILL-DOWN — full intelligence across the whole network
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/product/{product_id}")
async def manufacturer_product_detail(manufacturer_id: str, product_id: str):
    product = await db.products.find_one(
        {"id": product_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not product:
        raise HTTPException(404, "Product not found in this manufacturer's catalog")

    distributors = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)
    dist_by_id = {d["id"]: d for d in distributors}
    dist_ids = list(dist_by_id.keys())

    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0},
    ).to_list(50000)
    retailer_by_id = {r["id"]: r for r in retailers}
    retailer_ids = list(retailer_by_id.keys())

    unit_price = float(product.get("unit_price", 0))

    # Inventory across all distributors + retailers
    dist_inv_rows = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": {"$in": dist_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(10000)
    retail_inv_rows = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(50000)

    dist_qty = sum(int(i.get("quantity", 0)) for i in dist_inv_rows)
    retail_qty = sum(int(i.get("quantity", 0)) for i in retail_inv_rows)

    # Reserved = total quantity attached to pending/in_transit shipments out
    reserved_qty = 0
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id,
         "status": {"$in": ["pending", "in_transit"]}}, {"_id": 0, "items": 1},
    ):
        for it in s.get("items", []):
            if it.get("product_id") == product_id:
                reserved_qty += int(it.get("quantity", 0))

    # Last restock at manufacturer level (last received inbound). For now we
    # use the latest "in_transit" or "received" shipment date as proxy.
    last_restock_at = ""
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "status": "received",
         "items.product_id": product_id},
        {"_id": 0, "received_at": 1},
    ).sort("received_at", -1).limit(1):
        last_restock_at = s.get("received_at", "") or ""

    # Distributor-level rollup
    dist_rollup: Dict[str, dict] = {}
    for inv in dist_inv_rows:
        did = inv["owner_id"]
        d = dist_by_id.get(did)
        if not d:
            continue
        dist_rollup[did] = {
            "distributor_id": did, "distributor_name": d.get("name", ""),
            "region": d.get("region", ""), "city": d.get("city", ""),
            "quantity": int(inv.get("quantity", 0)),
            "reorder_level": int(inv.get("reorder_level", 0)),
            "retailers_count": 0, "retailers_stocked": 0,
            "revenue_90d": 0.0, "units_sold_90d": 0,
        }
    # Add distributors that don't hold the SKU yet (so the user can see them)
    for did, d in dist_by_id.items():
        if did not in dist_rollup:
            dist_rollup[did] = {
                "distributor_id": did, "distributor_name": d.get("name", ""),
                "region": d.get("region", ""), "city": d.get("city", ""),
                "quantity": 0, "reorder_level": 0,
                "retailers_count": 0, "retailers_stocked": 0,
                "revenue_90d": 0.0, "units_sold_90d": 0,
            }

    # Count retailers and stocked retailers under each distributor
    for r in retailers:
        did = r.get("distributor_id")
        if did in dist_rollup:
            dist_rollup[did]["retailers_count"] += 1
    stocked_per_dist: Dict[str, int] = {}
    for inv in retail_inv_rows:
        rid = inv["owner_id"]
        r = retailer_by_id.get(rid)
        if not r:
            continue
        did = r.get("distributor_id")
        if inv.get("quantity", 0) > 0 and did in dist_rollup:
            stocked_per_dist[did] = stocked_per_dist.get(did, 0) + 1
    for did, n in stocked_per_dist.items():
        dist_rollup[did]["retailers_stocked"] = n

    # 90-day revenue / units by distributor + monthly trend
    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=89)).isoformat()
    last_30_start = (today - timedelta(days=29)).isoformat()

    monthly: Dict[str, float] = {}
    by_region: Dict[str, float] = {}
    total_revenue = 0.0
    total_units = 0
    last_30_units = 0

    async for s in db.daily_sales.find(
        {"product_id": product_id, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_90}},
        {"_id": 0, "retailer_id": 1, "revenue": 1, "quantity_sold": 1, "date": 1},
    ):
        rev = float(s.get("revenue", 0))
        units = int(s.get("quantity_sold", 0))
        total_revenue += rev
        total_units += units
        if s["date"] >= last_30_start:
            last_30_units += units
        monthly[s["date"][:7]] = monthly.get(s["date"][:7], 0) + rev
        r = retailer_by_id.get(s["retailer_id"])
        if r:
            by_region[r.get("region", "—")] = by_region.get(r.get("region", "—"), 0) + rev
            did = r.get("distributor_id")
            if did in dist_rollup:
                dist_rollup[did]["revenue_90d"] += rev
                dist_rollup[did]["units_sold_90d"] += units

    monthly_trend = [{"month": m, "revenue": round(monthly[m], 2)}
                     for m in sorted(monthly.keys())[-6:]]
    region_breakdown = sorted(
        [{"region": k, "revenue": round(v, 2)} for k, v in by_region.items()],
        key=lambda x: x["revenue"], reverse=True,
    )
    distributor_breakdown = sorted(
        [{**d, "revenue_90d": round(d["revenue_90d"], 2)} for d in dist_rollup.values()],
        key=lambda x: x["revenue_90d"], reverse=True,
    )

    avg_daily_sales = round(last_30_units / 30, 1)
    inventory_turnover = round(total_units / max(retail_qty + dist_qty, 1) * (365 / 90), 2)

    # Recent outbound orders for this product
    recent_orders: List[dict] = []
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id,
         "items.product_id": product_id},
        {"_id": 0},
    ).sort("created_at", -1).limit(8):
        line_qty = next(
            (int(it.get("quantity", 0)) for it in s.get("items", []) if it.get("product_id") == product_id),
            0,
        )
        d = dist_by_id.get(s.get("to_id", ""), {})
        recent_orders.append({
            "id": s["id"], "tracking_code": s.get("tracking_code", ""),
            "to_distributor": d.get("name", s.get("to_id", "")),
            "region": d.get("region", ""), "quantity": line_qty,
            "status": s.get("status", ""), "created_at": s.get("created_at", ""),
        })

    return {
        "product": {
            "id": product["id"], "name": product["name"], "sku": product["sku"],
            "barcode": product.get("barcode", ""), "category": product.get("category", ""),
            "unit_price": unit_price,
        },
        "inventory": {
            "distributor_units": dist_qty, "retailer_units": retail_qty,
            "available": max(0, dist_qty - reserved_qty),
            "reserved": reserved_qty, "last_restock_at": last_restock_at,
        },
        "distribution": {
            "distributors_carrying": sum(1 for d in distributor_breakdown if d["quantity"] > 0),
            "distributors_total": len(distributor_breakdown),
            "retailers_stocking": sum(stocked_per_dist.values()),
            "retailers_total": len(retailers),
            "by_distributor": distributor_breakdown,
            "by_region": region_breakdown,
        },
        "analytics": {
            "total_revenue_90d": round(total_revenue, 2),
            "total_units_90d": total_units,
            "avg_daily_sales": avg_daily_sales,
            "last_30_units": last_30_units,
            "inventory_turnover": inventory_turnover,
            "monthly_trend": monthly_trend,
        },
        "recent_orders": recent_orders,
    }


# ============================================================================
# DISTRIBUTOR DRILL-DOWN — full intelligence for one distributor
# ============================================================================
@router.get("/manufacturer/{manufacturer_id}/distributor/{distributor_id}")
async def manufacturer_distributor_detail(manufacturer_id: str, distributor_id: str):
    distributor = await db.distributors.find_one(
        {"id": distributor_id, "manufacturer_id": manufacturer_id}, {"_id": 0},
    )
    if not distributor:
        raise HTTPException(404, "Distributor not found in your network")

    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0},
    ).to_list(20000)
    retailer_ids = [r["id"] for r in retailers]

    products = {p["id"]: p for p in await db.products.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0},
    ).to_list(5000)}

    # Inventory at this distributor — by product
    inv_rows = await db.inventory.find(
        {"owner_type": "distributor", "owner_id": distributor_id}, {"_id": 0},
    ).to_list(5000)
    product_portfolio: List[dict] = []
    total_stock_units = 0
    for inv in inv_rows:
        p = products.get(inv["product_id"])
        if not p:
            continue
        qty = int(inv.get("quantity", 0))
        total_stock_units += qty
        product_portfolio.append({
            "product_id": p["id"], "product_name": p["name"], "sku": p.get("sku", ""),
            "category": p.get("category", ""), "unit_price": float(p.get("unit_price", 0)),
            "quantity": qty, "reorder_level": int(inv.get("reorder_level", 0)),
            "velocity": float(inv.get("velocity", 0)),
        })
    product_portfolio.sort(key=lambda x: x["quantity"], reverse=True)

    # Shipments: outbound from manufacturer to this distributor
    total_orders = 0
    total_units_distributed = 0
    revenue_generated_orders = 0.0  # estimated from shipment items × unit_price
    last_order_at = ""
    monthly_orders: Dict[str, int] = {}
    monthly_units: Dict[str, int] = {}
    product_orders: Dict[str, dict] = {}

    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "to_id": distributor_id},
        {"_id": 0},
    ).sort("created_at", -1):
        total_orders += 1
        created = s.get("created_at", "") or ""
        if created > last_order_at:
            last_order_at = created
        month_key = created[:7] if created else "unknown"
        monthly_orders[month_key] = monthly_orders.get(month_key, 0) + 1
        for it in s.get("items", []):
            pid = it.get("product_id")
            qty = int(it.get("quantity", 0))
            total_units_distributed += qty
            p = products.get(pid, {})
            unit_price = float(p.get("unit_price", 0))
            revenue_generated_orders += qty * unit_price
            monthly_units[month_key] = monthly_units.get(month_key, 0) + qty
            agg = product_orders.setdefault(pid, {
                "product_id": pid, "product_name": p.get("name", "Unknown"),
                "sku": p.get("sku", ""), "units": 0, "revenue": 0.0,
            })
            agg["units"] += qty
            agg["revenue"] += qty * unit_price

    top_products = sorted(product_orders.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    for tp in top_products:
        tp["revenue"] = round(tp["revenue"], 2)

    # Monthly trend (last 6 months)
    months_sorted = sorted(set(list(monthly_orders.keys()) + list(monthly_units.keys())))[-6:]
    monthly_trend = [
        {"month": m, "orders": monthly_orders.get(m, 0), "units": monthly_units.get(m, 0)}
        for m in months_sorted if m != "unknown"
    ]

    # Growth rate — last 30 days vs previous 30 days (by units distributed)
    today = datetime.now(timezone.utc).date()
    start_30 = (today - timedelta(days=29)).isoformat()
    start_60 = (today - timedelta(days=59)).isoformat()
    prev_units = 0
    curr_units = 0
    async for s in db.shipments.find(
        {"from_role": "manufacturer", "from_id": manufacturer_id, "to_id": distributor_id,
         "created_at": {"$gte": start_60}}, {"_id": 0, "created_at": 1, "items": 1},
    ):
        units = sum(int(it.get("quantity", 0)) for it in s.get("items", []))
        if s["created_at"] >= start_30:
            curr_units += units
        else:
            prev_units += units
    growth_rate = None if prev_units == 0 else round((curr_units - prev_units) / prev_units * 100, 1)

    # Outstanding balance: pending requests value
    outstanding_units = 0
    outstanding_value = 0.0
    async for q in db.requests.find(
        {"distributor_id": distributor_id, "status": "pending"},
        {"_id": 0, "items": 1},
    ):
        for it in q.get("items", []):
            qty = int(it.get("quantity", 0))
            outstanding_units += qty
            p = products.get(it.get("product_id"), {})
            outstanding_value += qty * float(p.get("unit_price", 0))

    # Retailer downstream revenue (last 90d via daily_sales)
    start_90 = (today - timedelta(days=89)).isoformat()
    downstream_revenue = 0.0
    downstream_units = 0
    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_90}},
        {"_id": 0, "revenue": 1, "quantity_sold": 1},
    ):
        downstream_revenue += float(s.get("revenue", 0))
        downstream_units += int(s.get("quantity_sold", 0))

    avg_order_freq_days = None
    if total_orders > 1 and last_order_at:
        # use first vs last shipment date as crude span
        first = await db.shipments.find_one(
            {"from_role": "manufacturer", "from_id": manufacturer_id, "to_id": distributor_id},
            {"_id": 0, "created_at": 1}, sort=[("created_at", 1)],
        )
        if first:
            try:
                span_days = (datetime.fromisoformat(last_order_at.replace("Z", "+00:00"))
                             - datetime.fromisoformat(first["created_at"].replace("Z", "+00:00"))).days
                if span_days > 0:
                    avg_order_freq_days = round(span_days / max(total_orders - 1, 1), 1)
            except Exception:
                pass

    return {
        "distributor": {
            "id": distributor["id"], "name": distributor["name"],
            "region": distributor.get("region", ""), "city": distributor.get("city", ""),
            "contact_email": distributor.get("contact_email", ""),
            "contact_phone": distributor.get("phone", ""),
            "address": distributor.get("address", ""),
            "status": distributor.get("status", "active"),
            "created_at": distributor.get("created_at", ""),
        },
        "business_metrics": {
            "total_orders": total_orders,
            "total_units_distributed": total_units_distributed,
            "revenue_generated": round(revenue_generated_orders, 2),
            "outstanding_units": outstanding_units,
            "outstanding_value": round(outstanding_value, 2),
            "last_order_at": last_order_at,
            "avg_order_freq_days": avg_order_freq_days,
            "growth_rate_pct": growth_rate,
            "retailers_count": len(retailers),
            "downstream_revenue_90d": round(downstream_revenue, 2),
            "downstream_units_90d": downstream_units,
        },
        "product_portfolio": product_portfolio,
        "total_stock_units": total_stock_units,
        "performance": {
            "monthly_trend": monthly_trend,
            "top_products": top_products,
        },
        "retailers_summary": {
            "count": len(retailers),
            "regions": sorted({r.get("region", "—") for r in retailers}),
            "cities": sorted({r.get("city", "—") for r in retailers if r.get("city")}),
        },
    }


# ============================================================================
# MUTATIONS — Edit Product / Edit Distributor / Adjust Inventory
# ============================================================================
@router.patch("/products/{product_id}")
async def update_product(product_id: str, payload: dict):
    """Allowed fields: name, sku, category, unit_price, barcode."""
    allowed = {"name", "sku", "category", "unit_price", "barcode"}
    update = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if "unit_price" in update:
        try:
            update["unit_price"] = float(update["unit_price"])
        except (TypeError, ValueError):
            raise HTTPException(400, "unit_price must be a number")
    if not update:
        raise HTTPException(400, "No valid fields to update")
    update["updated_at"] = now_iso()
    res = await db.products.update_one({"id": product_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Product not found")
    fresh = await db.products.find_one({"id": product_id}, {"_id": 0})
    return fresh


@router.patch("/distributors/{distributor_id}")
async def update_distributor(distributor_id: str, payload: dict):
    """Allowed fields: name, region, city, contact_email, phone, address, status."""
    allowed = {"name", "region", "city", "contact_email", "phone", "address", "status"}
    update = {k: v for k, v in payload.items() if k in allowed and v is not None}
    if not update:
        raise HTTPException(400, "No valid fields to update")
    update["updated_at"] = now_iso()
    res = await db.distributors.update_one({"id": distributor_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Distributor not found")
    fresh = await db.distributors.find_one({"id": distributor_id}, {"_id": 0})
    return fresh


@router.post("/inventory/adjust")
async def adjust_inventory(payload: dict):
    """Manual inventory adjustment (manufacturer / super-admin tool).

    Body: { owner_type, owner_id, product_id, quantity_delta?, set_quantity?,
            reorder_level?, reason? }

    Either provide quantity_delta (positive or negative) OR set_quantity
    (absolute). reason is logged for audit.
    """
    owner_type = payload.get("owner_type")
    owner_id = payload.get("owner_id")
    product_id = payload.get("product_id")
    if not (owner_type and owner_id and product_id):
        raise HTTPException(400, "owner_type, owner_id and product_id are required")
    if owner_type not in {"manufacturer", "distributor", "retailer"}:
        raise HTTPException(400, "Invalid owner_type")

    inv = await db.inventory.find_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id},
        {"_id": 0},
    )
    if not inv:
        # Create row if missing
        inv = {
            "id": __import__("uuid").uuid4().hex,
            "owner_type": owner_type, "owner_id": owner_id, "product_id": product_id,
            "quantity": 0, "reorder_level": 10, "velocity": 0.0,
            "updated_at": now_iso(),
        }
        await db.inventory.insert_one(inv.copy())

    new_qty = int(inv.get("quantity", 0))
    if "set_quantity" in payload and payload["set_quantity"] is not None:
        try:
            new_qty = max(0, int(payload["set_quantity"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "set_quantity must be an integer")
    elif "quantity_delta" in payload and payload["quantity_delta"] is not None:
        try:
            new_qty = max(0, new_qty + int(payload["quantity_delta"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "quantity_delta must be an integer")

    update: Dict = {"quantity": new_qty, "updated_at": now_iso()}
    if "reorder_level" in payload and payload["reorder_level"] is not None:
        try:
            update["reorder_level"] = max(0, int(payload["reorder_level"]))
        except (TypeError, ValueError):
            raise HTTPException(400, "reorder_level must be an integer")
    await db.inventory.update_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id},
        {"$set": update},
    )
    # Audit log
    await db.inventory_audit.insert_one({
        "id": __import__("uuid").uuid4().hex,
        "owner_type": owner_type, "owner_id": owner_id, "product_id": product_id,
        "prev_quantity": int(inv.get("quantity", 0)),
        "new_quantity": new_qty,
        "delta": new_qty - int(inv.get("quantity", 0)),
        "reorder_level": update.get("reorder_level"),
        "reason": (payload.get("reason") or "")[:300],
        "actor": (payload.get("actor") or "")[:120],
        "created_at": now_iso(),
    })
    fresh = await db.inventory.find_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id},
        {"_id": 0},
    )
    return fresh
