"""Retailer OS endpoints — mobile-first dashboard, insights, reorder, sales, activity."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from core import db, now_iso
from models import QuickReorderPayload, RequestLine, StockRequest
from services.helpers import push_notification
from services.retailer import retailer_inventory_enriched

router = APIRouter()


@router.get("/retailer/{retailer_id}/dashboard")
async def retailer_dashboard(retailer_id: str):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    inv = await retailer_inventory_enriched(retailer_id)

    total_units = sum(int(i["quantity"]) for i in inv)
    low = [i for i in inv if i["urgency"] in ("warning", "critical")]
    critical = [i for i in inv if i["urgency"] == "critical"]
    pending = await db.shipments.count_documents(
        {"retailer_id": retailer_id, "status": {"$in": ["pending", "in_transit"]}}
    )
    shipments = await db.shipments.find(
        {"retailer_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(8)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(2000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(2000)}
    for s in shipments:
        s["distributor"] = distributors.get(s.get("distributor_id", ""), {})
        for it in s.get("items", []):
            it["product"] = products.get(it["product_id"], {})

    today = datetime.now(timezone.utc).date().isoformat()
    sales_today = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": today}},
        {"$group": {"_id": None, "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
    ]).to_list(1)
    sales_today = sales_today[0] if sales_today else {"units": 0, "revenue": 0}

    seven_ago = (datetime.now(timezone.utc).date() - timedelta(days=7)).isoformat()
    top = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": seven_ago}}},
        {"$group": {"_id": "$product_id", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
        {"$sort": {"units": -1}},
        {"$limit": 5},
    ]).to_list(5)
    for t in top:
        t["product"] = products.get(t["_id"], {})

    fast = sorted(inv, key=lambda x: -float(x.get("velocity", 0)))[:5]
    near = sorted(
        [i for i in inv if i["urgency"] != "healthy"],
        key=lambda x: x["days_remaining"],
    )[:6]

    return {
        "retailer": retailer,
        "kpis": {
            "inventory_units": total_units,
            "low_stock_count": len(low),
            "critical_count": len(critical),
            "pending_deliveries": pending,
            "sales_today_units": int(sales_today.get("units", 0)),
            "sales_today_revenue": round(float(sales_today.get("revenue", 0)), 2),
            "skus_tracked": len(inv),
        },
        "recent_shipments": shipments,
        "top_selling": top,
        "fast_moving": fast,
        "near_stockout": near,
    }


@router.get("/retailer/{retailer_id}/insights")
async def retailer_insights_endpoint(retailer_id: str):
    inv = await retailer_inventory_enriched(retailer_id)
    insights: List[Dict[str, Any]] = []

    for i in inv:
        name = (i.get("product") or {}).get("name", "Item")
        if i["urgency"] == "critical" and i["days_remaining"] < 999:
            insights.append({
                "id": f"stockout-{i['product_id']}", "type": "stockout_risk", "tone": "critical",
                "title": "Stockout risk",
                "message": f"{name} may run out in {i['days_remaining']:.0f} day{'s' if i['days_remaining'] != 1 else ''} based on current sales velocity.",
                "action": "Restock now", "product_id": i["product_id"],
            })
        elif i["urgency"] == "warning":
            insights.append({
                "id": f"warning-{i['product_id']}", "type": "low_stock", "tone": "warning",
                "title": "Low stock warning",
                "message": f"{name} is running low — about {i['days_remaining']:.0f} days of cover left.",
                "action": "Add to reorder", "product_id": i["product_id"],
            })

    fast = [i for i in inv if float(i.get("velocity", 0)) >= 3]
    fast = sorted(fast, key=lambda x: -float(x.get("velocity", 0)))[:2]
    for i in fast:
        name = (i.get("product") or {}).get("name", "Item")
        insights.append({
            "id": f"fast-{i['product_id']}", "type": "fast_seller", "tone": "info",
            "title": "Top performer",
            "message": f"{name} is selling fast — about {i['velocity']:.1f} units/day. Keep stock high.",
            "action": "View", "product_id": i["product_id"],
        })

    slow = [i for i in inv if float(i.get("velocity", 0)) <= 0.3 and i["quantity"] > i["reorder_level"] * 3]
    for i in slow[:2]:
        name = (i.get("product") or {}).get("name", "Item")
        insights.append({
            "id": f"slow-{i['product_id']}", "type": "overstock", "tone": "info",
            "title": "Overstock detected",
            "message": f"{name} has {i['quantity']} units but is moving slowly. Consider a promotion.",
            "action": "Plan promo", "product_id": i["product_id"],
        })

    tone_order = {"critical": 0, "warning": 1, "info": 2}
    insights.sort(key=lambda x: tone_order.get(x["tone"], 9))
    return insights[:8]


@router.get("/retailer/{retailer_id}/reorder-suggestions")
async def reorder_suggestions(retailer_id: str):
    inv = await retailer_inventory_enriched(retailer_id)
    out = []
    target_days_cover = 14
    for i in inv:
        if i["urgency"] == "healthy":
            continue
        velocity = float(i.get("velocity", 0))
        target = max(int(round(velocity * target_days_cover)), int(i["reorder_level"]))
        recommended = max(target - int(i["quantity"]), 0)
        if recommended > 0:
            recommended = int((recommended + 4) // 5 * 5)
        if recommended <= 0:
            continue
        out.append({
            "product_id": i["product_id"], "product": i.get("product"),
            "current_quantity": int(i["quantity"]), "velocity": velocity,
            "days_remaining": i["days_remaining"], "urgency": i["urgency"],
            "recommended_quantity": recommended,
        })
    order = {"critical": 0, "warning": 1, "healthy": 2}
    out.sort(key=lambda x: (order[x["urgency"]], x["days_remaining"]))
    return out


@router.post("/retailer/{retailer_id}/quick-reorder")
async def quick_reorder(retailer_id: str, payload: QuickReorderPayload):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    items: List[Dict[str, Any]] = []
    if payload.shipment_id:
        sh = await db.shipments.find_one({"id": payload.shipment_id, "retailer_id": retailer_id})
        if not sh:
            raise HTTPException(404, "Shipment not found")
        items = [{"product_id": it["product_id"], "quantity": int(it["quantity"])} for it in sh.get("items", [])]
    elif payload.items:
        items = [{"product_id": it["product_id"], "quantity": int(it["quantity"])}
                 for it in payload.items if int(it.get("quantity", 0)) > 0]
    if not items:
        raise HTTPException(400, "No items to reorder")

    req = StockRequest(
        retailer_id=retailer_id,
        distributor_id=retailer["distributor_id"],
        items=[RequestLine(**it) for it in items],
        note=payload.note or "Quick reorder",
    )
    await db.requests.insert_one(req.model_dump())
    await push_notification(
        "distributor", retailer["distributor_id"],
        "New Stock Request",
        f"{retailer['name']} submitted a quick reorder ({len(items)} item(s)).",
        "request",
    )
    return {"ok": True, "request_id": req.id, "items_count": len(items)}


@router.get("/retailer/{retailer_id}/sales-trend")
async def sales_trend(retailer_id: str, days: int = 7):
    days = max(1, min(30, days))
    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=days - 1)).isoformat()
    rows = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": start}}},
        {"$group": {"_id": "$date", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
        {"$sort": {"_id": 1}},
    ]).to_list(60)
    by_date = {r["_id"]: r for r in rows}
    series = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        r = by_date.get(d, {"units": 0, "revenue": 0})
        series.append({"date": d[5:], "units": int(r["units"]), "revenue": round(float(r["revenue"]), 2)})

    total_units = sum(s["units"] for s in series)
    total_revenue = sum(s["revenue"] for s in series)
    inv = await db.inventory.find({"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}).to_list(2000)
    avg_inv = max(sum(int(i["quantity"]) for i in inv) / max(len(inv), 1), 1)
    turnover = round(total_units / avg_inv, 2)

    reorders = await db.requests.count_documents({
        "retailer_id": retailer_id,
        "created_at": {"$gte": (today - timedelta(days=days - 1)).isoformat()},
    })

    healthy = sum(1 for i in inv if int(i["quantity"]) > int(i.get("reorder_level", 10)))
    health_ratio = healthy / max(len(inv), 1)
    score = max(0, min(100, int(round(40 * health_ratio + 30 * min(turnover, 2) / 2 + 30))))

    return {
        "series": series,
        "totals": {"units": total_units, "revenue": round(total_revenue, 2)},
        "inventory_turnover": turnover,
        "reorder_count": reorders,
        "stock_efficiency_score": score,
    }


@router.get("/retailer/{retailer_id}/activity")
async def retailer_activity(retailer_id: str, limit: int = 30):
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    notifs = await db.notifications.find(
        {"target_type": "retailer", "target_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    shipments = await db.shipments.find(
        {"retailer_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(2000)}

    items = []
    for n in notifs:
        items.append({
            "kind": n.get("type", "system"),
            "title": n.get("title", ""),
            "message": n.get("message", ""),
            "ts": n.get("created_at", ""),
            "read": bool(n.get("read", False)),
        })
    for s in shipments:
        d_name = distributors.get(s.get("distributor_id", ""), {}).get("name", "Distributor")
        if s["status"] == "received":
            msg = f"Shipment {s['tracking_code']} from {d_name} was delivered."
            ts = s.get("received_at") or s.get("created_at")
        elif s["status"] == "in_transit":
            msg = f"Shipment {s['tracking_code']} from {d_name} is on the way."
            ts = s.get("dispatched_at") or s.get("created_at")
        else:
            msg = f"Shipment {s['tracking_code']} from {d_name} is being prepared."
            ts = s.get("created_at")
        items.append({
            "kind": "shipment",
            "title": f"Shipment · {s['status'].replace('_', ' ').title()}",
            "message": msg,
            "ts": ts or now_iso(),
            "tracking_code": s.get("tracking_code"),
            "status": s["status"],
        })

    items.sort(key=lambda x: x["ts"], reverse=True)
    return items[:limit]
