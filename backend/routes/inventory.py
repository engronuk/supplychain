"""Inventory endpoint."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from core import db

router = APIRouter()


@router.get("/inventory")
async def get_inventory(
    owner_type: str, owner_id: str,
    updated_since: Optional[str] = Query(None),
    limit: int = Query(5000, ge=1, le=20000),
):
    q = {"owner_type": owner_type, "owner_id": owner_id}
    if updated_since:
        q["updated_at"] = {"$gt": updated_since}
    sort_dir = 1 if updated_since else None
    cursor = db.inventory.find(q, {"_id": 0})
    if sort_dir is not None:
        cursor = cursor.sort("updated_at", sort_dir)
    items = await cursor.to_list(limit)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    for it in items:
        it["product"] = products.get(it["product_id"], {})
    if not updated_since:
        items.sort(key=lambda x: (x.get("product", {}).get("name") or "").lower())
    payload = {"rows": items}
    if updated_since:
        payload["next_cursor"] = (
            items[-1].get("updated_at") if items else None
        )
        return payload
    # Legacy shape: bare list. Existing in-market clients depend on this.
    return items
