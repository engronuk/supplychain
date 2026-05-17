"""Cross-cutting helpers used by multiple routers."""
from __future__ import annotations

from typing import Dict, Tuple

from core import db, now_iso
from models import InventoryItem, Notification


async def push_notification(
    target_type: str, target_id: str, title: str, message: str, ntype: str = "system"
) -> None:
    n = Notification(
        target_type=target_type, target_id=target_id,
        title=title, message=message, type=ntype,
    )
    await db.notifications.insert_one(n.model_dump())


def denorm_ids(from_role: str, from_id: str, to_role: str, to_id: str) -> Dict[str, str]:
    """Map generic from/to to legacy denormalized fields."""
    out = {"manufacturer_id": "", "distributor_id": "", "retailer_id": ""}
    out[f"{from_role}_id"] = from_id
    out[f"{to_role}_id"] = to_id
    return out


async def adjust_inventory(
    owner_type: str, owner_id: str, product_id: str, delta: int
) -> Tuple[int, int]:
    """Increase or decrease quantity for an inventory row, creating it if absent."""
    existing = await db.inventory.find_one(
        {"owner_type": owner_type, "owner_id": owner_id, "product_id": product_id}
    )
    if existing:
        new_qty = max(0, int(existing.get("quantity", 0)) + delta)
        await db.inventory.update_one(
            {"id": existing["id"]},
            {"$set": {"quantity": new_qty, "updated_at": now_iso()}},
        )
        return new_qty, int(existing.get("reorder_level", 10))
    item = InventoryItem(
        owner_type=owner_type, owner_id=owner_id, product_id=product_id,
        quantity=max(0, delta),
    )
    await db.inventory.insert_one(item.model_dump())
    return item.quantity, item.reorder_level


async def entity_name(role: str, eid: str) -> str:
    coll = {"manufacturer": "manufacturers", "distributor": "distributors",
            "retailer": "retailers"}.get(role)
    if not coll:
        return eid
    doc = await db[coll].find_one({"id": eid}, {"_id": 0, "name": 1})
    return (doc or {}).get("name", eid)
