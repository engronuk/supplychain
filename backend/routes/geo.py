"""Geographic supply-chain network endpoints (Leaflet map view)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from core import db
from routes.hierarchy import (
    _health_from_low_stock,
    _low_stock_by_owner,
    _shipment_activity_by_distributor,
)

router = APIRouter()


@router.get("/geo/network/{mfg_id}")
async def geo_network(mfg_id: str):
    """Geographic supply-chain network for the map view.

    Manufacturer position = soft default (Lagos). Distributor position = median of
    its retailers' GPS coords. Retailers carry their real lat/lon from the seed CSV.
    """
    mfg = await db.manufacturers.find_one({"id": mfg_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")

    retailers = await db.retailers.find(
        {}, {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1,
             "address": 1, "store_code": 1, "phone": 1, "latitude": 1,
             "longitude": 1, "distributor_id": 1},
    ).to_list(20000)
    retailers = [r for r in retailers if r.get("latitude") is not None and r.get("longitude") is not None]

    low_retail = await _low_stock_by_owner("retailer")
    pending_per_retailer: Dict[str, int] = {}
    async for s in db.shipments.find(
        {"status": {"$in": ["pending", "in_transit"]}, "to_role": "retailer"},
        {"_id": 0, "to_id": 1},
    ):
        rid = s.get("to_id", "")
        if rid:
            pending_per_retailer[rid] = pending_per_retailer.get(rid, 0) + 1

    retailer_out: List[dict] = []
    by_dist: Dict[str, List[dict]] = {}
    for r in retailers:
        low, total = low_retail.get(r["id"], (0, 0))
        status = _health_from_low_stock(low, total)
        item = {
            "id": r["id"], "name": r["name"], "city": r.get("city", ""),
            "region": r.get("region", ""), "address": r.get("address", ""),
            "store_code": r.get("store_code", ""), "phone": r.get("phone", ""),
            "lat": float(r["latitude"]), "lon": float(r["longitude"]),
            "distributor_id": r.get("distributor_id", ""),
            "status": status, "low_stock_skus": low,
            "active_shipments": pending_per_retailer.get(r["id"], 0),
        }
        retailer_out.append(item)
        by_dist.setdefault(item["distributor_id"], []).append(item)

    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id},
        {"_id": 0, "id": 1, "name": 1, "city": 1, "region": 1},
    ).to_list(5000)
    low_dist = await _low_stock_by_owner("distributor")
    ship_activity = await _shipment_activity_by_distributor()

    distributor_out: List[dict] = []
    for d in distributors:
        kids = by_dist.get(d["id"], [])
        if kids:
            lats = sorted(k["lat"] for k in kids)
            lons = sorted(k["lon"] for k in kids)
            mid = len(lats) // 2
            d_lat = lats[mid] if len(lats) % 2 else (lats[mid - 1] + lats[mid]) / 2
            d_lon = lons[mid] if len(lons) % 2 else (lons[mid - 1] + lons[mid]) / 2
        else:
            d_lat, d_lon = 6.5244, 3.3792  # Lagos fallback
        low, total = low_dist.get(d["id"], (0, 0))
        low_kids = sum(1 for k in kids if k["status"] != "healthy")
        distributor_out.append({
            "id": d["id"], "name": d["name"],
            "city": d.get("city", ""), "region": d.get("region", ""),
            "lat": float(d_lat), "lon": float(d_lon),
            "status": _health_from_low_stock(low, total),
            "retailer_count": len(kids),
            "low_stock_retailers": low_kids,
            "shipment_activity": ship_activity.get(d["id"], 0),
        })

    region_map: Dict[str, dict] = {}
    for d in distributor_out:
        r = d["region"] or "—"
        rm = region_map.setdefault(r, {
            "name": r, "lat_sum": 0.0, "lon_sum": 0.0, "n": 0,
            "distributors": 0, "retailers": 0, "low": 0,
        })
        rm["lat_sum"] += d["lat"]
        rm["lon_sum"] += d["lon"]
        rm["n"] += 1
        rm["distributors"] += 1
        rm["retailers"] += d["retailer_count"]
        rm["low"] += d["low_stock_retailers"]
    region_out: List[dict] = []
    for r in region_map.values():
        n = max(1, r["n"])
        region_out.append({
            "name": r["name"],
            "lat": r["lat_sum"] / n,
            "lon": r["lon_sum"] / n,
            "distributors": r["distributors"],
            "retailers": r["retailers"],
            "status": (
                "critical" if r["low"] > r["retailers"] * 0.3
                else "warning" if r["low"] > 0 else "healthy"
            ),
        })

    return {
        "manufacturer": {"id": mfg["id"], "name": mfg["name"], "lat": 6.5244, "lon": 3.3792},
        "regions": region_out,
        "distributors": distributor_out,
        "retailers": retailer_out,
    }


@router.get("/geo/retailer/{retailer_id}")
async def geo_retailer_detail(retailer_id: str):
    """Detailed retailer card for the map: inventory, 7-day sales, ETA, AI summary."""
    r = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Retailer not found")
    d = await db.distributors.find_one({"id": r.get("distributor_id", "")}, {"_id": 0}) or {}

    inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}
    ).to_list(2000)
    in_stock = sum(1 for i in inv if int(i.get("quantity", 0)) > int(i.get("reorder_level", 0)))
    low_stock = sum(1 for i in inv if 0 < int(i.get("quantity", 0)) <= int(i.get("reorder_level", 0)))
    out_of_stock = sum(1 for i in inv if int(i.get("quantity", 0)) == 0)
    total = max(1, in_stock + low_stock + out_of_stock)
    health_pct = round(100 * in_stock / total)

    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=6)).isoformat()
    sales = await db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": start}}, {"_id": 0}
    ).to_list(5000)
    by_day: Dict[str, float] = {}
    for s in sales:
        by_day[s["date"]] = by_day.get(s["date"], 0) + float(s.get("revenue", 0))
    trend = []
    for i in range(7):
        day = (today - timedelta(days=6 - i)).isoformat()
        trend.append({"date": day, "revenue": round(by_day.get(day, 0), 2)})
    revenue_7d = round(sum(t["revenue"] for t in trend), 2)

    prev_start = (today - timedelta(days=13)).isoformat()
    prev_end = (today - timedelta(days=7)).isoformat()
    prev_sales = await db.daily_sales.find(
        {"retailer_id": retailer_id, "date": {"$gte": prev_start, "$lte": prev_end}},
        {"_id": 0, "revenue": 1},
    ).to_list(5000)
    revenue_prev_7d = round(sum(float(s.get("revenue", 0)) for s in prev_sales), 2)
    delta_pct = round(((revenue_7d - revenue_prev_7d) / revenue_prev_7d) * 100, 1) if revenue_prev_7d else 0.0

    pending = await db.requests.count_documents({"retailer_id": retailer_id, "status": "pending"})

    last_ship = await db.shipments.find(
        {"to_role": "retailer", "to_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(1)
    last_ship_doc = last_ship[0] if last_ship else None
    last_shipment = None
    if last_ship_doc:
        eta = None
        if last_ship_doc.get("status") == "in_transit":
            try:
                dispatched = last_ship_doc.get("dispatched_at") or last_ship_doc.get("created_at")
                dt = datetime.fromisoformat(dispatched.replace("Z", "+00:00")) if isinstance(dispatched, str) else None
                if dt:
                    eta = (dt + timedelta(days=3)).date().isoformat()
            except Exception:
                eta = None
        last_shipment = {
            "tracking_code": last_ship_doc.get("tracking_code", ""),
            "status": last_ship_doc.get("status", "pending"),
            "eta": eta,
        }

    insight_parts: List[str] = []
    if delta_pct >= 5:
        insight_parts.append(f"Sales are up {delta_pct}% week-over-week.")
    elif delta_pct <= -5:
        insight_parts.append(f"Sales are down {abs(delta_pct)}% week-over-week.")
    if low_stock + out_of_stock > 0:
        insight_parts.append(f"{low_stock + out_of_stock} SKU(s) need restocking soon.")
    if pending > 0:
        insight_parts.append(f"{pending} pending request(s) awaiting distributor approval.")
    if not insight_parts:
        insight_parts.append("Inventory healthy and sales steady — no action required.")
    ai_insight = " ".join(insight_parts)

    return {
        "retailer": {
            "id": r["id"], "name": r["name"], "city": r.get("city", ""),
            "region": r.get("region", ""), "address": r.get("address", ""),
            "store_code": r.get("store_code", ""), "phone": r.get("phone", ""),
            "lat": r.get("latitude"), "lon": r.get("longitude"),
            "status": _health_from_low_stock(low_stock, total),
        },
        "distributor": {"id": d.get("id", ""), "name": d.get("name", "")},
        "inventory": {
            "in_stock": in_stock, "low_stock": low_stock,
            "out_of_stock": out_of_stock, "health_pct": health_pct,
        },
        "sales": {"revenue_7d": revenue_7d, "delta_pct": delta_pct, "trend": trend},
        "pending_requests": pending,
        "last_shipment": last_shipment,
        "ai_insight": ai_insight,
    }
