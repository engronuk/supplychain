"""Notification list / read endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from core import db

router = APIRouter()


@router.get("/notifications")
async def list_notifications(target_type: str, target_id: str):
    return await db.notifications.find(
        {"target_type": target_type, "target_id": target_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(200)


@router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str):
    res = await db.notifications.update_one({"id": notif_id}, {"$set": {"read": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}


@router.patch("/notifications/read-all")
async def mark_all_read(target_type: str, target_id: str):
    await db.notifications.update_many(
        {"target_type": target_type, "target_id": target_id, "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}
