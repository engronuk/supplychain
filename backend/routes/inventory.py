"""Inventory endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from core import db

router = APIRouter()


@router.get("/inventory")
async def get_inventory(owner_type: str, owner_id: str):
    items = await db.inventory.find(
        {"owner_type": owner_type, "owner_id": owner_id}, {"_id": 0}
    ).to_list(5000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    for it in items:
        it["product"] = products.get(it["product_id"], {})
    items.sort(key=lambda x: (x.get("product", {}).get("name") or "").lower())
    return items
