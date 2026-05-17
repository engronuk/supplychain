"""Shipment list / create / status-update endpoints."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException

from core import clean, db, now_iso
from models import Shipment, ShipmentCreate, ShipmentStatusUpdate
from services.helpers import adjust_inventory, denorm_ids, entity_name, push_notification

router = APIRouter()


@router.get("/shipments")
async def list_shipments(
    distributor_id: Optional[str] = None,
    retailer_id: Optional[str] = None,
    manufacturer_id: Optional[str] = None,
    party_role: Optional[str] = None,
    party_id: Optional[str] = None,
):
    q: Dict[str, Any] = {}
    if distributor_id:
        q["distributor_id"] = distributor_id
    if retailer_id:
        q["retailer_id"] = retailer_id
    if manufacturer_id:
        q["manufacturer_id"] = manufacturer_id
    if party_role and party_id:
        q["$or"] = [
            {"from_role": party_role, "from_id": party_id},
            {"to_role": party_role, "to_id": party_id},
        ]
    docs = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    manufacturers = {m["id"]: m for m in await db.manufacturers.find({}, {"_id": 0}).to_list(100)}
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    party_map = {"manufacturer": manufacturers, "distributor": distributors, "retailer": retailers}
    for s in docs:
        s["from_party"] = party_map.get(s.get("from_role", ""), {}).get(s.get("from_id", ""), {})
        s["to_party"] = party_map.get(s.get("to_role", ""), {}).get(s.get("to_id", ""), {})
        s["distributor"] = distributors.get(s.get("distributor_id", ""), {})
        s["retailer"] = retailers.get(s.get("retailer_id", ""), {})
        for it in s.get("items", []):
            it["product"] = products.get(it["product_id"], {})
    return docs


@router.post("/shipments", response_model=Shipment)
async def create_shipment(payload: ShipmentCreate):
    denorm = denorm_ids(payload.from_role, payload.from_id, payload.to_role, payload.to_id)
    sh = Shipment(
        from_role=payload.from_role, from_id=payload.from_id,
        to_role=payload.to_role, to_id=payload.to_id,
        items=payload.items, notes=payload.notes,
        **denorm,
    )
    await db.shipments.insert_one(sh.model_dump())
    sender_name = await entity_name(payload.from_role, payload.from_id)
    await push_notification(
        payload.to_role, payload.to_id,
        "New Shipment Created",
        f"Shipment {sh.tracking_code} from {sender_name} is pending dispatch.",
        "shipment",
    )
    return sh


@router.patch("/shipments/{shipment_id}/status")
async def update_shipment_status(shipment_id: str, payload: ShipmentStatusUpdate):
    sh = await db.shipments.find_one({"id": shipment_id})
    if not sh:
        raise HTTPException(404, "Shipment not found")
    current = sh["status"]
    target = payload.status
    valid = {"pending": ["in_transit"], "in_transit": ["received"]}
    if target not in valid.get(current, []):
        raise HTTPException(400, f"Cannot transition from {current} to {target}")

    update: Dict[str, Any] = {"status": target}
    from_role = sh.get("from_role", "distributor")
    from_id = sh.get("from_id", sh.get("distributor_id", ""))
    to_role = sh.get("to_role", "retailer")
    to_id = sh.get("to_id", sh.get("retailer_id", ""))

    if target == "in_transit":
        update["dispatched_at"] = now_iso()
        for it in sh.get("items", []):
            await adjust_inventory(from_role, from_id, it["product_id"], -int(it["quantity"]))
        await push_notification(
            to_role, to_id,
            "Shipment In Transit",
            f"Shipment {sh['tracking_code']} has been dispatched.",
            "shipment",
        )
    elif target == "received":
        update["received_at"] = now_iso()
        for it in sh.get("items", []):
            await adjust_inventory(to_role, to_id, it["product_id"], int(it["quantity"]))
        await push_notification(
            from_role, from_id,
            "Shipment Received",
            f"Receipt confirmed for shipment {sh['tracking_code']}.",
            "shipment",
        )
        if sh.get("request_id"):
            await db.requests.update_one(
                {"id": sh["request_id"]},
                {"$set": {"status": "fulfilled", "resolved_at": now_iso()}},
            )

    await db.shipments.update_one({"id": shipment_id}, {"$set": update})
    return clean(await db.shipments.find_one({"id": shipment_id}, {"_id": 0}))
