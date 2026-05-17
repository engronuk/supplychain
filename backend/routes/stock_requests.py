"""Retailer ↔ Distributor stock-request endpoints."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException

from core import db, now_iso
from models import (
    RequestCreate, RequestDecision, Shipment, ShipmentLine, StockRequest,
)
from services.helpers import denorm_ids, push_notification

router = APIRouter()


@router.get("/requests")
async def list_requests(distributor_id: Optional[str] = None, retailer_id: Optional[str] = None):
    q: Dict[str, Any] = {}
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    docs = await db.requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    for r in docs:
        r["distributor"] = distributors.get(r["distributor_id"], {})
        r["retailer"] = retailers.get(r["retailer_id"], {})
        for it in r.get("items", []):
            it["product"] = products.get(it["product_id"], {})
    return docs


@router.post("/requests", response_model=StockRequest)
async def create_request(payload: RequestCreate):
    req = StockRequest(**payload.model_dump())
    await db.requests.insert_one(req.model_dump())
    await push_notification(
        "distributor", req.distributor_id,
        "New Stock Request",
        f"Retailer submitted a new stock request ({len(req.items)} item(s)).",
        "request",
    )
    return req


@router.patch("/requests/{request_id}")
async def decide_request(request_id: str, payload: RequestDecision):
    req = await db.requests.find_one({"id": request_id})
    if not req:
        raise HTTPException(404, "Request not found")
    if req["status"] != "pending":
        raise HTTPException(400, "Request already resolved")

    if payload.action == "reject":
        await db.requests.update_one(
            {"id": request_id},
            {"$set": {"status": "rejected", "resolved_at": now_iso()}},
        )
        await push_notification(
            "retailer", req["retailer_id"], "Request Rejected",
            "Your stock request was rejected by the distributor.", "request",
        )
        return {"ok": True, "status": "rejected"}

    # approve -> create shipment distributor → retailer
    denorm = denorm_ids("distributor", req["distributor_id"], "retailer", req["retailer_id"])
    sh = Shipment(
        from_role="distributor", from_id=req["distributor_id"],
        to_role="retailer", to_id=req["retailer_id"],
        items=[ShipmentLine(**it) for it in req["items"]],
        request_id=req["id"],
        notes=f"Auto-created from request {req['id'][:8]}",
        **denorm,
    )
    await db.shipments.insert_one(sh.model_dump())
    await db.requests.update_one(
        {"id": request_id},
        {"$set": {"status": "approved", "resolved_at": now_iso()}},
    )
    await push_notification(
        "retailer", req["retailer_id"], "Request Approved",
        f"Your request was approved. Shipment {sh.tracking_code} is now pending dispatch.",
        "request",
    )
    return {"ok": True, "status": "approved", "shipment_id": sh.id, "tracking_code": sh.tracking_code}
