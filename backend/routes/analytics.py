"""Per-role analytics dashboard."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from core import db

router = APIRouter()


@router.get("/analytics")
async def analytics(role: str, entity_id: str):
    if role not in ("manufacturer", "distributor", "retailer"):
        raise HTTPException(400, "Invalid role")

    if role == "manufacturer":
        q = {"manufacturer_id": entity_id}
    elif role == "distributor":
        q = {"distributor_id": entity_id}
    else:
        q = {"retailer_id": entity_id}

    shipments = await db.shipments.find(q, {"_id": 0}).to_list(5000)
    if role in ("distributor", "retailer"):
        rq = {"distributor_id": entity_id} if role == "distributor" else {"retailer_id": entity_id}
        requests_docs = await db.requests.find(rq, {"_id": 0}).to_list(5000)
    else:
        requests_docs = []

    kpis = {
        "total_shipments": len(shipments),
        "pending": sum(1 for s in shipments if s["status"] == "pending"),
        "in_transit": sum(1 for s in shipments if s["status"] == "in_transit"),
        "received": sum(1 for s in shipments if s["status"] == "received"),
        "open_requests": sum(1 for r in requests_docs if r["status"] == "pending"),
    }

    status_breakdown = [
        {"name": "Pending", "value": kpis["pending"]},
        {"name": "In Transit", "value": kpis["in_transit"]},
        {"name": "Received", "value": kpis["received"]},
    ]

    today = datetime.now(timezone.utc).date()
    buckets = {(today - timedelta(days=i)).isoformat(): 0 for i in range(13, -1, -1)}
    for s in shipments:
        try:
            d = datetime.fromisoformat(s["created_at"]).date().isoformat()
            if d in buckets:
                buckets[d] += 1
        except Exception:
            pass
    timeline = [{"date": k[5:], "shipments": v} for k, v in buckets.items()]

    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    product_volume: Dict[str, int] = {}
    for s in shipments:
        for it in s.get("items", []):
            product_volume[it["product_id"]] = product_volume.get(it["product_id"], 0) + int(it["quantity"])
    top_products = sorted(
        [{"name": (products.get(pid, {}).get("name", pid) or pid)[:30], "units": v}
         for pid, v in product_volume.items()],
        key=lambda x: -x["units"],
    )[:6]

    inv = await db.inventory.find({"owner_type": role, "owner_id": entity_id}, {"_id": 0}).to_list(5000)
    inventory_total = sum(int(i.get("quantity", 0)) for i in inv)
    low_stock = sum(1 for i in inv if int(i.get("quantity", 0)) <= int(i.get("reorder_level", 10)))

    extra: Dict[str, Any] = {}
    if role == "manufacturer":
        extra["distributors_count"] = await db.distributors.count_documents({"manufacturer_id": entity_id})
        extra["retailers_count"] = await db.retailers.count_documents({})
    elif role == "distributor":
        extra["retailers_count"] = await db.retailers.count_documents({"distributor_id": entity_id})

    return {
        "kpis": {**kpis, "inventory_total": inventory_total, "low_stock": low_stock, **extra},
        "status_breakdown": status_breakdown,
        "timeline": timeline,
        "top_products": top_products,
    }
