"""CSV report exports."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from core import db

router = APIRouter()


@router.get("/reports/shipments.csv")
async def export_shipments_csv(role: str, entity_id: str):
    if role == "manufacturer":
        q = {"manufacturer_id": entity_id}
    elif role == "distributor":
        q = {"distributor_id": entity_id}
    else:
        q = {"retailer_id": entity_id}

    shipments = await db.shipments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    manufacturers = {m["id"]: m for m in await db.manufacturers.find({}, {"_id": 0}).to_list(100)}
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(5000)}
    retailers = {r["id"]: r for r in await db.retailers.find({}, {"_id": 0}).to_list(20000)}
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    party_map = {"manufacturer": manufacturers, "distributor": distributors, "retailer": retailers}

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Tracking Code", "Status", "From", "To",
        "Products", "Total Units", "Created", "Dispatched", "Received",
    ])
    for s in shipments:
        prods = "; ".join(
            f"{products.get(it['product_id'], {}).get('name', it['product_id'])} x{it['quantity']}"
            for it in s.get("items", [])
        )
        total = sum(int(it["quantity"]) for it in s.get("items", []))
        frm = party_map.get(s.get("from_role", ""), {}).get(s.get("from_id", ""), {}).get("name", "")
        to_ = party_map.get(s.get("to_role", ""), {}).get(s.get("to_id", ""), {}).get("name", "")
        writer.writerow([
            s.get("tracking_code", ""), s.get("status", ""), frm, to_,
            prods, total,
            s.get("created_at", ""), s.get("dispatched_at") or "", s.get("received_at") or "",
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=shipments_{role}_{entity_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)


@router.get("/reports/inventory.csv")
async def export_inventory_csv(role: str, entity_id: str):
    inv = await db.inventory.find({"owner_type": role, "owner_id": entity_id}, {"_id": 0}).to_list(5000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["SKU", "Product", "Category", "Barcode", "Quantity", "Reorder Level", "Updated"])
    for it in inv:
        p = products.get(it["product_id"], {})
        writer.writerow([
            p.get("sku", ""), p.get("name", ""), p.get("category", ""), p.get("barcode", ""),
            it.get("quantity", 0), it.get("reorder_level", 10), it.get("updated_at", ""),
        ])
    buf.seek(0)
    headers = {"Content-Disposition": f"attachment; filename=inventory_{role}_{entity_id[:8]}.csv"}
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers=headers)
