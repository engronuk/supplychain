"""Distributor workspace: retailer intelligence, product intel, executive analytics."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException

from core import db
from services.ai_insights import generate_ai_insights

router = APIRouter()


# ============================================================================
# Phase 1 & 2 — Retailer Intelligence
# ============================================================================
@router.get("/distributor/{distributor_id}/retailers")
async def distributor_retailers_intel(distributor_id: str):
    """Enriched retailer list for the distributor workspace."""
    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0}
    ).sort("name", 1).to_list(20000)
    if not retailers:
        return []

    retailer_ids = [r["id"] for r in retailers]

    pipeline = [
        {"$match": {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}}},
        {"$group": {
            "_id": "$owner_id",
            "total_qty": {"$sum": "$quantity"},
            "skus": {"$sum": 1},
            "low": {"$sum": {"$cond": [{"$and": [
                {"$gt": ["$quantity", 0]},
                {"$lte": ["$quantity", "$reorder_level"]},
            ]}, 1, 0]}},
            "out": {"$sum": {"$cond": [{"$eq": ["$quantity", 0]}, 1, 0]}},
            "healthy": {"$sum": {"$cond": [{"$gt": ["$quantity", "$reorder_level"]}, 1, 0]}},
        }},
    ]
    inv_rollup = {row["_id"]: row async for row in db.inventory.aggregate(pipeline)}

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}

    last_order: Dict[str, str] = {}
    revenue: Dict[str, float] = {}
    async for s in db.shipments.find(
        {"to_role": "retailer", "to_id": {"$in": retailer_ids}},
        {"_id": 0, "to_id": 1, "items": 1, "created_at": 1, "status": 1, "received_at": 1},
    ):
        rid = s["to_id"]
        when = s.get("received_at") or s.get("created_at") or ""
        if when and when > last_order.get(rid, ""):
            last_order[rid] = when
        if s.get("status") == "received":
            for it in s.get("items", []):
                p = products.get(it.get("product_id"))
                if not p:
                    continue
                revenue[rid] = revenue.get(rid, 0) + float(p["unit_price"]) * int(it.get("quantity", 0))

    now = datetime.now(timezone.utc)
    out: List[dict] = []
    for r in retailers:
        rid = r["id"]
        roll = inv_rollup.get(rid) or {}
        total_skus = roll.get("skus", 0)
        healthy = roll.get("healthy", 0)
        low = roll.get("low", 0)
        out_qty = roll.get("out", 0)
        stock_health_pct = round((healthy / total_skus) * 100) if total_skus else 0
        status = "critical" if stock_health_pct < 40 else "warning" if stock_health_pct < 75 else "healthy"

        last = last_order.get(rid)
        active = False
        if last:
            try:
                dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                active = (now - dt).days <= 60
            except Exception:
                active = True
        retailer_status = "active" if active else "inactive"

        out.append({
            "id": rid, "name": r["name"], "region": r.get("region", ""),
            "city": r.get("city", ""), "address": r.get("address", ""),
            "store_code": r.get("store_code", ""), "phone": r.get("phone", ""),
            "email": r.get("contact_email", ""),
            "contact_name": r.get("name", "").split(" ")[0] + " Manager",
            "latitude": r.get("latitude"), "longitude": r.get("longitude"),
            "status": retailer_status, "health": status,
            "stock_health_pct": stock_health_pct,
            "revenue": round(revenue.get(rid, 0), 2),
            "inventory_units": roll.get("total_qty", 0),
            "low_stock_skus": low, "out_of_stock_skus": out_qty,
            "last_order_date": last,
        })
    return out


@router.get("/distributor/{distributor_id}/retailer/{retailer_id}")
async def distributor_retailer_detail(distributor_id: str, retailer_id: str):
    """Detailed retailer workspace: overview, deliveries, requests, analytics, txn."""
    r = await db.retailers.find_one(
        {"id": retailer_id, "distributor_id": distributor_id}, {"_id": 0}
    )
    if not r:
        raise HTTPException(404, "Retailer not found under this distributor")
    d = await db.distributors.find_one({"id": distributor_id}, {"_id": 0}) or {}

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}

    def line_total(line: dict) -> float:
        p = products.get(line.get("product_id"))
        if not p:
            return 0.0
        return float(p["unit_price"]) * int(line.get("quantity", 0))

    inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}
    ).to_list(2000)
    in_stock = sum(1 for i in inv if int(i.get("quantity", 0)) > int(i.get("reorder_level", 0)))
    low_stock = sum(1 for i in inv if 0 < int(i.get("quantity", 0)) <= int(i.get("reorder_level", 0)))
    out_of_stock = sum(1 for i in inv if int(i.get("quantity", 0)) == 0)
    total_skus = max(1, in_stock + low_stock + out_of_stock)
    stock_health_pct = round(100 * in_stock / total_skus)
    inventory_units = sum(int(i.get("quantity", 0)) for i in inv)

    shipments = await db.shipments.find(
        {"to_role": "retailer", "to_id": retailer_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    deliveries: List[dict] = []
    total_delivery_value = 0.0
    total_delivery_cost = 0.0
    last_delivery: Optional[str] = None
    for s in shipments:
        total = round(sum(line_total(line) for line in s.get("items", [])), 2)
        cost = round(total * 0.04, 2)
        units = sum(int(it.get("quantity", 0)) for it in s.get("items", []))
        delivery = {
            "id": s["id"], "tracking_code": s.get("tracking_code", ""),
            "status": s.get("status", ""),
            "created_at": s.get("created_at"),
            "dispatched_at": s.get("dispatched_at"),
            "received_at": s.get("received_at"),
            "value": total, "cost": cost, "units": units,
            "items_count": len(s.get("items", [])),
        }
        deliveries.append(delivery)
        if s.get("status") == "received":
            total_delivery_value += total
            total_delivery_cost += cost
            if not last_delivery or (s.get("received_at") or "") > (last_delivery or ""):
                last_delivery = s.get("received_at")

    reqs = await db.requests.find(
        {"retailer_id": retailer_id, "distributor_id": distributor_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    stock_requests: List[dict] = []
    pending_requests = 0
    last_order_date: Optional[str] = None
    for q in reqs:
        if q.get("status") == "pending":
            pending_requests += 1
        items_full = []
        for it in q.get("items", []):
            p = products.get(it.get("product_id")) or {}
            items_full.append({
                "product_id": it.get("product_id"),
                "product_name": p.get("name", "—"),
                "category": p.get("category", ""),
                "quantity": int(it.get("quantity", 0)),
                "unit_price": float(p.get("unit_price", 0)),
                "line_total": round(line_total(it), 2),
            })
        order_value = round(sum(li["line_total"] for li in items_full), 2)
        when = q.get("created_at")
        if when and (last_order_date is None or when > last_order_date):
            last_order_date = when
        stock_requests.append({
            "id": q["id"], "status": q.get("status", "pending"),
            "priority": q.get("priority", "normal"),
            "created_at": when, "items": items_full,
            "order_value": order_value,
        })

    active_orders = sum(1 for s in shipments if s.get("status") in ("pending", "in_transit"))
    total_revenue = sum(d["value"] for d in deliveries if d["status"] == "received")

    today = datetime.now(timezone.utc).date()
    trend_start = (today - timedelta(days=29)).isoformat()
    daily = await db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": trend_start}},
        {"_id": 0, "date": 1, "revenue": 1, "quantity_sold": 1, "product_id": 1},
    ).to_list(2000)
    by_day: Dict[str, dict] = {}
    for s in daily:
        agg = by_day.setdefault(s["date"], {"revenue": 0.0, "units": 0})
        agg["revenue"] += float(s.get("revenue", 0))
        agg["units"] += int(s.get("quantity_sold", 0))
    trend = []
    for i in range(30):
        day = (today - timedelta(days=29 - i)).isoformat()
        agg = by_day.get(day, {"revenue": 0.0, "units": 0})
        trend.append({"date": day, "revenue": round(agg["revenue"], 2), "units": agg["units"]})

    revenue_7d = round(sum(t["revenue"] for t in trend[-7:]), 2)
    revenue_prev_7d = round(sum(t["revenue"] for t in trend[-14:-7]), 2)
    revenue_30d = round(sum(t["revenue"] for t in trend), 2)
    revenue_prev_30d_query = await db.daily_sales.find({
        "retailer_id": retailer_id,
        "date": {"$gte": (today - timedelta(days=59)).isoformat(),
                 "$lt": trend_start},
    }, {"_id": 0, "revenue": 1}).to_list(5000)
    revenue_prev_30d = round(sum(float(s.get("revenue", 0)) for s in revenue_prev_30d_query), 2)
    wow_pct = round(((revenue_7d - revenue_prev_7d) / revenue_prev_7d) * 100, 1) if revenue_prev_7d else 0.0
    mom_pct = round(((revenue_30d - revenue_prev_30d) / revenue_prev_30d) * 100, 1) if revenue_prev_30d else 0.0

    cat_revenue: Dict[str, float] = {}
    product_revenue: Dict[str, float] = {}
    for s in daily:
        p = products.get(s.get("product_id"))
        if not p:
            continue
        rev = float(s.get("revenue", 0))
        cat_revenue[p["category"]] = cat_revenue.get(p["category"], 0) + rev
        product_revenue[p["name"]] = product_revenue.get(p["name"], 0) + rev
    category_breakdown = sorted(
        [{"category": k, "revenue": round(v, 2)} for k, v in cat_revenue.items()],
        key=lambda x: x["revenue"], reverse=True,
    )
    top_products = sorted(
        [{"product": k, "revenue": round(v, 2)} for k, v in product_revenue.items()],
        key=lambda x: x["revenue"], reverse=True,
    )[:5]

    margin_trend = [{"date": t["date"], "margin": round(t["revenue"] * 0.20, 2)} for t in trend]

    transactions = []
    for s in shipments[:50]:
        total = round(sum(line_total(line) for line in s.get("items", [])), 2)
        if s.get("status") not in ("received", "in_transit", "pending"):
            continue
        transactions.append({
            "invoice_number": s.get("tracking_code", ""),
            "order_value": total,
            "payment_status": "paid" if s.get("status") == "received" else "pending",
            "payment_method": "bank_transfer",
            "created_at": s.get("created_at"),
            "status": s.get("status"),
            "items_count": len(s.get("items", [])),
        })

    insights = _retailer_insights(
        wow_pct=wow_pct, mom_pct=mom_pct, low_stock=low_stock, out_of_stock=out_of_stock,
        pending_requests=pending_requests, active_orders=active_orders,
        top_products=top_products, stock_health_pct=stock_health_pct,
        last_delivery=last_delivery, retailer_name=r.get("name", ""),
    )

    return {
        "retailer": {
            "id": r["id"], "name": r["name"], "region": r.get("region", ""),
            "city": r.get("city", ""), "address": r.get("address", ""),
            "store_code": r.get("store_code", ""), "phone": r.get("phone", ""),
            "email": r.get("contact_email", ""),
            "latitude": r.get("latitude"), "longitude": r.get("longitude"),
            "contact_name": (r.get("name", "").split(" ")[0] + " Manager"),
        },
        "distributor": {"id": d.get("id", ""), "name": d.get("name", "")},
        "overview": {
            "stock_health_pct": stock_health_pct,
            "inventory_units": inventory_units,
            "active_orders": active_orders,
            "pending_requests": pending_requests,
            "last_delivery_date": last_delivery,
            "last_order_date": last_order_date,
            "total_revenue": round(total_revenue, 2),
            "in_stock": in_stock, "low_stock": low_stock, "out_of_stock": out_of_stock,
        },
        "deliveries": deliveries,
        "delivery_summary": {
            "total_value": round(total_delivery_value, 2),
            "total_cost": round(total_delivery_cost, 2),
            "margin": round(total_delivery_value - total_delivery_cost, 2),
            "delivered": sum(1 for d in deliveries if d["status"] == "received"),
            "in_transit": sum(1 for d in deliveries if d["status"] == "in_transit"),
            "pending": sum(1 for d in deliveries if d["status"] == "pending"),
        },
        "stock_requests": stock_requests,
        "analytics": {
            "trend": trend, "margin_trend": margin_trend,
            "revenue_7d": revenue_7d, "revenue_30d": revenue_30d,
            "wow_pct": wow_pct, "mom_pct": mom_pct,
            "category_breakdown": category_breakdown,
            "top_products": top_products,
        },
        "transactions": transactions,
        "ai_insights": insights,
    }


def _retailer_insights(
    *, wow_pct: float, mom_pct: float, low_stock: int, out_of_stock: int,
    pending_requests: int, active_orders: int, top_products: List[dict],
    stock_health_pct: int, last_delivery: Optional[str], retailer_name: str,
) -> List[dict]:
    """Rule-based AI insight generator — deterministic & instant."""
    out: List[dict] = []
    if wow_pct >= 10:
        out.append({"tone": "positive", "icon": "trending-up", "title": f"Revenue up {wow_pct}% W/W",
                    "detail": "Sustain stock levels — momentum is building."})
    elif wow_pct <= -10:
        out.append({"tone": "warning", "icon": "trending-down", "title": f"Revenue down {abs(wow_pct)}% W/W",
                    "detail": "Investigate causes — check pricing or competitor activity."})
    if mom_pct >= 15:
        out.append({"tone": "positive", "icon": "sparkles", "title": f"Strong monthly growth: +{mom_pct}%",
                    "detail": "Consider increasing safety stock to capture demand."})
    if out_of_stock > 0:
        out.append({"tone": "critical", "icon": "alert-octagon", "title": f"{out_of_stock} SKU(s) out of stock",
                    "detail": "Send a restock shipment to avoid lost sales."})
    if low_stock >= 3:
        out.append({"tone": "warning", "icon": "alert-triangle", "title": f"{low_stock} SKU(s) below reorder level",
                    "detail": "Schedule a partial restock within 3–5 days."})
    if pending_requests > 0:
        out.append({"tone": "info", "icon": "clock", "title": f"{pending_requests} pending stock request(s)",
                    "detail": "Approve or reject to keep the retailer moving."})
    if stock_health_pct >= 85 and wow_pct >= 0:
        out.append({"tone": "positive", "icon": "shield-check", "title": "Operations healthy",
                    "detail": "Inventory in great shape; sales tracking up — no action required."})
    if top_products:
        tp = top_products[0]
        out.append({"tone": "info", "icon": "trophy",
                    "title": f"Top seller: {tp['product']}",
                    "detail": f"₦{tp['revenue']:,.0f} in revenue this month."})
    if not out:
        out.append({"tone": "info", "icon": "info",
                    "title": "Stable retailer", "detail": f"{retailer_name} is operating normally."})
    return out[:6]


# ============================================================================
# Phase 3 — Product Intelligence
# ============================================================================
@router.get("/distributor/{distributor_id}/product/{product_id}")
async def distributor_product_detail(distributor_id: str, product_id: str):
    """Full product intelligence — overview, revenue, regional/retailer breakdown."""
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")

    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0}
    ).to_list(20000)
    if not retailers:
        return _empty_product_detail(product)
    retailer_ids = [r["id"] for r in retailers]
    retailer_by_id = {r["id"]: r for r in retailers}
    unit_price = float(product["unit_price"])

    inv_rows = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}, "product_id": product_id},
        {"_id": 0},
    ).to_list(10000)
    last_restock_by_owner: Dict[str, str] = {}
    async for s in db.shipments.find(
        {"to_role": "retailer", "to_id": {"$in": retailer_ids}, "status": "received"},
        {"_id": 0, "to_id": 1, "received_at": 1, "items": 1},
    ):
        for it in s.get("items", []):
            if it.get("product_id") == product_id:
                t = s.get("received_at") or ""
                rid = s["to_id"]
                if t > last_restock_by_owner.get(rid, ""):
                    last_restock_by_owner[rid] = t

    shop_dist: List[dict] = []
    bucket = {"overstocked": 0, "healthy": 0, "understocked": 0, "critical": 0}
    for inv in inv_rows:
        r = retailer_by_id.get(inv["owner_id"])
        if not r:
            continue
        qty = int(inv.get("quantity", 0))
        reorder = int(inv.get("reorder_level", 0))
        if qty == 0:
            tier = "critical"
        elif qty <= reorder:
            tier = "understocked"
        elif reorder > 0 and qty > reorder * 3:
            tier = "overstocked"
        else:
            tier = "healthy"
        bucket[tier] = bucket.get(tier, 0) + 1
        shop_dist.append({
            "retailer_id": r["id"], "retailer_name": r["name"],
            "city": r.get("city", ""), "region": r.get("region", ""),
            "quantity": qty, "reorder_level": reorder, "tier": tier,
            "last_restock": last_restock_by_owner.get(r["id"]),
        })
    shop_dist.sort(key=lambda x: x["quantity"], reverse=True)

    today = datetime.now(timezone.utc).date()
    start_90 = (today - timedelta(days=89)).isoformat()
    daily = await db.daily_sales.find(
        {"product_id": product_id, "retailer_id": {"$in": retailer_ids},
         "date": {"$gte": start_90}}, {"_id": 0},
    ).to_list(60000)

    by_month: Dict[str, float] = {}
    by_region: Dict[str, float] = {}
    by_retailer: Dict[str, dict] = {}
    total_units = 0
    total_revenue = 0.0
    last_30_units = 0
    last_30_start = (today - timedelta(days=29)).isoformat()
    for s in daily:
        rev = float(s.get("revenue", 0))
        units = int(s.get("quantity_sold", 0))
        total_revenue += rev
        total_units += units
        if s["date"] >= last_30_start:
            last_30_units += units
        month_key = s["date"][:7]
        by_month[month_key] = by_month.get(month_key, 0) + rev
        rid = s.get("retailer_id")
        r = retailer_by_id.get(rid)
        if r:
            by_region[r.get("region", "—")] = by_region.get(r.get("region", "—"), 0) + rev
            agg = by_retailer.setdefault(rid, {"name": r["name"], "city": r.get("city", ""),
                                               "region": r.get("region", ""), "revenue": 0.0, "units": 0})
            agg["revenue"] += rev
            agg["units"] += units

    months_sorted = sorted(by_month.keys())[-6:]
    monthly_trend = [{"month": m, "revenue": round(by_month[m], 2)} for m in months_sorted]
    region_breakdown = sorted(
        [{"region": k, "revenue": round(v, 2)} for k, v in by_region.items()],
        key=lambda x: x["revenue"], reverse=True,
    )
    top_retailers = sorted(by_retailer.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    for tr in top_retailers:
        tr["revenue"] = round(tr["revenue"], 2)

    dist_inv = await db.inventory.find_one(
        {"owner_type": "distributor", "owner_id": distributor_id, "product_id": product_id},
        {"_id": 0},
    ) or {}
    dist_qty = int(dist_inv.get("quantity", 0))
    dist_reorder = int(dist_inv.get("reorder_level", 0))
    dist_stock_status = "critical" if dist_qty == 0 else "understocked" if dist_qty <= dist_reorder else "healthy"

    avg_daily_sales = round(last_30_units / 30, 1)
    fast_moving = total_units > 0 and avg_daily_sales >= 5
    slow_moving = total_units > 0 and avg_daily_sales < 1
    most_requested_count = 0
    async for q in db.requests.find(
        {"distributor_id": distributor_id, "items.product_id": product_id},
        {"_id": 0, "items": 1},
    ):
        for it in q.get("items", []):
            if it.get("product_id") == product_id:
                most_requested_count += int(it.get("quantity", 0))

    insights = await generate_ai_insights(
        prompt_id=f"product-{product_id}",
        kind="product",
        context=_build_product_insight_context(
            product=product, bucket=bucket,
            total_revenue=total_revenue, avg_daily_sales=avg_daily_sales,
            top_region=region_breakdown[0]["region"] if region_breakdown else None,
            top_retailer=top_retailers[0]["name"] if top_retailers else None,
            dist_qty=dist_qty, dist_stock_status=dist_stock_status,
            most_requested_count=most_requested_count,
        ),
    )

    return {
        "product": {
            "id": product["id"], "name": product["name"], "sku": product["sku"],
            "barcode": product.get("barcode", ""), "category": product.get("category", ""),
            "unit_price": unit_price,
        },
        "overview": {
            "current_inventory": dist_qty, "reorder_level": dist_reorder,
            "stock_status": dist_stock_status,
            "total_revenue": round(total_revenue, 2),
            "total_units_sold": total_units,
            "avg_daily_sales": avg_daily_sales,
            "shops_stocking": len(shop_dist),
            "shops_critical": bucket["critical"],
            "shops_understocked": bucket["understocked"],
            "shops_healthy": bucket["healthy"],
            "shops_overstocked": bucket["overstocked"],
        },
        "revenue_analytics": {
            "monthly_trend": monthly_trend,
            "region_breakdown": region_breakdown,
            "top_retailers": top_retailers,
        },
        "shop_distribution": shop_dist,
        "stock_intelligence": {
            "buckets": bucket,
            "recommendations": _stock_recommendations(shop_dist, dist_qty, avg_daily_sales),
        },
        "performance": {
            "fast_moving": fast_moving, "slow_moving": slow_moving,
            "most_requested_units": most_requested_count,
            "last_30_units": last_30_units,
        },
        "ai_insights": insights,
    }


def _empty_product_detail(product):
    return {
        "product": {"id": product["id"], "name": product["name"], "sku": product["sku"],
                    "barcode": product.get("barcode", ""), "category": product.get("category", ""),
                    "unit_price": float(product["unit_price"])},
        "overview": {"current_inventory": 0, "reorder_level": 0, "stock_status": "critical",
                     "total_revenue": 0, "total_units_sold": 0, "avg_daily_sales": 0,
                     "shops_stocking": 0, "shops_critical": 0, "shops_understocked": 0,
                     "shops_healthy": 0, "shops_overstocked": 0},
        "revenue_analytics": {"monthly_trend": [], "region_breakdown": [], "top_retailers": []},
        "shop_distribution": [],
        "stock_intelligence": {"buckets": {"overstocked": 0, "healthy": 0, "understocked": 0, "critical": 0},
                               "recommendations": []},
        "performance": {"fast_moving": False, "slow_moving": False, "most_requested_units": 0, "last_30_units": 0},
        "ai_insights": [],
    }


def _stock_recommendations(shop_dist: List[dict], dist_qty: int, avg_daily_sales: float) -> List[dict]:
    out: List[dict] = []
    critical_shops = [s for s in shop_dist if s["tier"] == "critical"][:3]
    under_shops = [s for s in shop_dist if s["tier"] == "understocked"][:3]
    over_shops = [s for s in shop_dist if s["tier"] == "overstocked"][:2]
    for s in critical_shops:
        out.append({"tone": "critical", "title": f"Restock {s['retailer_name']}",
                    "detail": f"Out of stock — last restock {s['last_restock'][:10] if s['last_restock'] else 'unknown'}."})
    for s in under_shops:
        out.append({"tone": "warning", "title": f"Top up {s['retailer_name']}",
                    "detail": f"Only {s['quantity']} units (reorder level {s['reorder_level']})."})
    for s in over_shops:
        out.append({"tone": "info", "title": f"Rebalance from {s['retailer_name']}",
                    "detail": f"Overstocked — could redistribute {s['quantity']} units to under-stocked shops."})
    if dist_qty == 0:
        out.insert(0, {"tone": "critical", "title": "Replenish distributor stock",
                       "detail": "Zero inventory at distributor level — request from manufacturer."})
    elif avg_daily_sales > 0 and dist_qty / max(avg_daily_sales, 1) < 7:
        days = round(dist_qty / max(avg_daily_sales, 1), 1)
        out.insert(0, {"tone": "warning", "title": "Distributor stock running low",
                       "detail": f"{dist_qty} units = ~{days} days of cover at current pace."})
    return out[:6]


def _build_product_insight_context(*, product, bucket, total_revenue, avg_daily_sales,
                                   top_region, top_retailer, dist_qty, dist_stock_status,
                                   most_requested_count) -> str:
    return f"""You are analyzing performance for product **{product['name']}** (SKU {product['sku']}, category {product.get('category', '')}).

Key data (last 90 days):
- Revenue: ₦{total_revenue:,.0f}
- Avg daily units sold: {avg_daily_sales}
- Distributor inventory: {dist_qty} units (status: {dist_stock_status})
- Shop distribution: {bucket['healthy']} healthy, {bucket['understocked']} understocked, {bucket['critical']} critical, {bucket['overstocked']} overstocked
- Top region: {top_region or 'n/a'}
- Top retailer: {top_retailer or 'n/a'}
- Pending retailer requests for this SKU: {most_requested_count} units
"""


# ============================================================================
# Phase 4 — Executive Analytics
# ============================================================================
@router.get("/distributor/{distributor_id}/analytics/executive")
async def distributor_executive_analytics(distributor_id: str):
    """Cross-network executive analytics."""
    retailers = await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0}
    ).to_list(20000)
    if not retailers:
        return _empty_executive_analytics()
    retailer_ids = [r["id"] for r in retailers]
    retailer_by_id = {r["id"]: r for r in retailers}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}

    today = datetime.now(timezone.utc).date()
    start_60 = (today - timedelta(days=59)).isoformat()

    daily = await db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start_60}},
        {"_id": 0},
    ).to_list(80000)

    by_date: Dict[str, dict] = {}
    by_category: Dict[str, dict] = {}
    by_region: Dict[str, dict] = {}
    by_product: Dict[str, dict] = {}
    by_retailer: Dict[str, dict] = {}

    for s in daily:
        rev = float(s.get("revenue", 0))
        units = int(s.get("quantity_sold", 0))
        date = s["date"]
        p = products.get(s.get("product_id"))
        r = retailer_by_id.get(s.get("retailer_id"))

        d = by_date.setdefault(date, {"revenue": 0.0, "units": 0})
        d["revenue"] += rev
        d["units"] += units

        if p:
            cat = by_category.setdefault(p["category"], {"revenue": 0.0, "units": 0})
            cat["revenue"] += rev
            cat["units"] += units
            pa = by_product.setdefault(p["id"], {"name": p["name"], "category": p["category"],
                                                  "revenue": 0.0, "units": 0})
            pa["revenue"] += rev
            pa["units"] += units
        if r:
            reg = by_region.setdefault(r.get("region", "—"), {"revenue": 0.0, "units": 0,
                                                               "retailers": set(), "low_health_count": 0})
            reg["revenue"] += rev
            reg["units"] += units
            reg["retailers"].add(r["id"])
            ra = by_retailer.setdefault(r["id"], {"name": r["name"], "city": r.get("city", ""),
                                                   "region": r.get("region", ""),
                                                   "revenue": 0.0, "units": 0})
            ra["revenue"] += rev
            ra["units"] += units

    trend: List[dict] = []
    for i in range(30):
        day = (today - timedelta(days=29 - i)).isoformat()
        agg = by_date.get(day, {"revenue": 0.0, "units": 0})
        trend.append({"date": day, "revenue": round(agg["revenue"], 2),
                      "units": agg["units"], "margin": round(agg["revenue"] * 0.20, 2)})

    revenue_30d = round(sum(t["revenue"] for t in trend), 2)
    revenue_prev_30d = round(sum(
        float(by_date.get((today - timedelta(days=d)).isoformat(), {"revenue": 0})["revenue"])
        for d in range(30, 60)
    ), 2)
    revenue_7d = round(sum(t["revenue"] for t in trend[-7:]), 2)
    revenue_prev_7d = round(sum(t["revenue"] for t in trend[-14:-7]), 2)
    wow_pct = round(((revenue_7d - revenue_prev_7d) / revenue_prev_7d) * 100, 1) if revenue_prev_7d else 0.0
    mom_pct = round(((revenue_30d - revenue_prev_30d) / revenue_prev_30d) * 100, 1) if revenue_prev_30d else 0.0
    margin_30d = round(revenue_30d * 0.20, 2)

    category_perf = sorted(
        [{"category": k, "revenue": round(v["revenue"], 2), "units": v["units"]}
         for k, v in by_category.items()],
        key=lambda x: x["revenue"], reverse=True,
    )

    inv_pipeline = [
        {"$match": {"owner_type": "retailer", "owner_id": {"$in": retailer_ids}}},
        {"$group": {
            "_id": "$owner_id",
            "low": {"$sum": {"$cond": [{"$or": [
                {"$eq": ["$quantity", 0]},
                {"$lte": ["$quantity", "$reorder_level"]},
            ]}, 1, 0]}},
            "total": {"$sum": 1},
        }},
    ]
    low_stock_map: Dict[str, float] = {}
    async for row in db.inventory.aggregate(inv_pipeline):
        if row["total"]:
            low_stock_map[row["_id"]] = row["low"] / row["total"]

    region_intel: List[dict] = []
    for name, v in by_region.items():
        rid_set = v["retailers"]
        low_count = sum(1 for rid in rid_set if low_stock_map.get(rid, 0) > 0.35)
        region_intel.append({
            "region": name, "revenue": round(v["revenue"], 2), "units": v["units"],
            "retailers": len(rid_set), "low_stock_retailers": low_count,
        })
    region_intel.sort(key=lambda x: x["revenue"], reverse=True)
    high_demand_region = region_intel[0]["region"] if region_intel else None
    low_stock_region = max(region_intel, key=lambda x: x["low_stock_retailers"])["region"] if region_intel else None

    best_products = sorted(by_product.values(), key=lambda x: x["revenue"], reverse=True)[:10]
    underperforming = sorted(
        [p for p in by_product.values() if p["units"] > 0],
        key=lambda x: x["revenue"],
    )[:5]
    for p in best_products + underperforming:
        p["revenue"] = round(p["revenue"], 2)

    last15_start = (today - timedelta(days=14)).isoformat()
    prev15_start = (today - timedelta(days=29)).isoformat()
    last15: Dict[str, float] = {}
    prev15: Dict[str, float] = {}
    for s in daily:
        rid = s.get("retailer_id")
        rev = float(s.get("revenue", 0))
        d = s["date"]
        if d >= last15_start:
            last15[rid] = last15.get(rid, 0) + rev
        elif d >= prev15_start:
            prev15[rid] = prev15.get(rid, 0) + rev

    growth_list: List[dict] = []
    for rid, r in by_retailer.items():
        cur = last15.get(rid, 0)
        prev = prev15.get(rid, 0)
        delta = round(((cur - prev) / prev) * 100, 1) if prev else (100 if cur else 0)
        growth_list.append({**r, "growth_pct": delta, "last15": round(cur, 2)})

    best_retailers = sorted(growth_list, key=lambda x: x["revenue"], reverse=True)[:5]
    fastest_growing = sorted([r for r in growth_list if r["last15"] > 0],
                             key=lambda x: x["growth_pct"], reverse=True)[:5]
    declining = sorted([r for r in growth_list if r["last15"] > 0],
                      key=lambda x: x["growth_pct"])[:5]

    low_health = sorted([
        {"id": rid, "name": retailer_by_id[rid]["name"],
         "region": retailer_by_id[rid].get("region", ""),
         "low_pct": round(pct * 100, 1)}
        for rid, pct in low_stock_map.items()
        if pct > 0.35 and rid in retailer_by_id
    ], key=lambda x: x["low_pct"], reverse=True)[:5]

    margin_trend = [{"date": t["date"], "margin": t["margin"]} for t in trend]

    insights = await generate_ai_insights(
        prompt_id=f"exec-{distributor_id}",
        kind="executive",
        context=_build_executive_insight_context(
            revenue_30d=revenue_30d, wow_pct=wow_pct, mom_pct=mom_pct,
            margin_30d=margin_30d,
            top_category=category_perf[0]["category"] if category_perf else None,
            high_demand_region=high_demand_region,
            low_stock_region=low_stock_region,
            top_product=best_products[0]["name"] if best_products else None,
            declining_count=len(declining), low_health_count=len(low_health),
        ),
    )

    return {
        "kpis": {
            "revenue_30d": revenue_30d, "revenue_7d": revenue_7d,
            "margin_30d": margin_30d,
            "wow_pct": wow_pct, "mom_pct": mom_pct,
            "active_retailers": len([r for r in growth_list if r["last15"] > 0]),
            "total_retailers": len(retailers),
        },
        "trend": trend, "margin_trend": margin_trend,
        "category_performance": category_perf,
        "region_intelligence": region_intel,
        "best_products": best_products,
        "underperforming_products": underperforming,
        "best_retailers": best_retailers,
        "fastest_growing": fastest_growing,
        "declining": declining,
        "low_health_retailers": low_health,
        "ai_insights": insights,
    }


def _empty_executive_analytics():
    return {
        "kpis": {"revenue_30d": 0, "revenue_7d": 0, "margin_30d": 0,
                 "wow_pct": 0, "mom_pct": 0,
                 "active_retailers": 0, "total_retailers": 0},
        "trend": [], "margin_trend": [], "category_performance": [],
        "region_intelligence": [], "best_products": [], "underperforming_products": [],
        "best_retailers": [], "fastest_growing": [], "declining": [],
        "low_health_retailers": [], "ai_insights": [],
    }


def _build_executive_insight_context(*, revenue_30d, wow_pct, mom_pct, margin_30d,
                                     top_category, high_demand_region, low_stock_region,
                                     top_product, declining_count, low_health_count) -> str:
    return f"""You are advising a Unilever distributor's executive on their last 30-day performance.

KPIs:
- 30-day revenue: ₦{revenue_30d:,.0f}
- 30-day gross margin (est. 20%): ₦{margin_30d:,.0f}
- Week-on-week growth: {wow_pct}%
- Month-on-month growth: {mom_pct}%

Highlights:
- Top category by revenue: {top_category or 'n/a'}
- Highest demand region: {high_demand_region or 'n/a'}
- Region with most low-stock retailers: {low_stock_region or 'n/a'}
- Top product: {top_product or 'n/a'}
- Retailers showing decline: {declining_count}
- Retailers with low stock health (>35% SKUs low): {low_health_count}
"""
