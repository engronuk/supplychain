"""Notification list / read endpoints — tenant-scoped (Track A7 retrofit)."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db
from services.auth import get_current_user

router = APIRouter()


def _enforce_target(user: Dict[str, Any], target_type: str, target_id: str) -> None:
    role = user.get("role")
    if role == "super_admin":
        return
    # callers may only read their own org's notifications, OR (for drivers)
    # notifications addressed to them personally as the target_user.
    if role == "driver":
        # drivers do not have org-level notification visibility today
        raise HTTPException(403, "Drivers cannot list org notifications")
    if (user.get("entity_id") or "") != target_id:
        raise HTTPException(403, "Forbidden — not your tenant")


@router.get("/notifications")
async def list_notifications(
    target_type: str = Query(...),
    target_id: str = Query(...),
    limit: int = Query(200, ge=1, le=500),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_target(user, target_type, target_id)
    # for non-super-admin callers, narrow to either their org-wide notifications
    # or the ones explicitly addressed to their user id
    q: Dict[str, Any] = {"target_type": target_type, "target_id": target_id}
    if user.get("role") != "super_admin":
        q = {
            "target_type": target_type,
            "target_id": target_id,
            "$or": [
                {"target_user_id": {"$exists": False}},
                {"target_user_id": None},
                {"target_user_id": user.get("id")},
            ],
        }
    return await db.notifications.find(q, {"_id": 0}).sort(
        "created_at", -1).limit(limit).to_list(limit)


@router.get("/notifications/me")
async def list_my_notifications(
    limit: int = Query(50, ge=1, le=200),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Personal + tenant inbox shortcut for the dispatcher UI.

    Returns notifications that target the caller's user_id OR their tenant
    (e.g. fleet_compliance fanouts addressed to ``target_type=manufacturer``,
    ``target_id=<tenant>``). Sorted desc by created_at.
    """
    uid = user.get("id")
    tenant = user.get("entity_id") or user.get("manufacturer_id")
    q: Dict[str, Any] = {
        "$or": [
            {"user_id": uid},
            {"target_user_id": uid},
            {"target_type": user.get("entity_type") or user.get("role"),
             "target_id": tenant},
        ],
    }
    rows = await db.notifications.find(q, {"_id": 0}).sort(
        "created_at", -1).limit(limit).to_list(limit)
    return rows




@router.patch("/notifications/{notif_id}/read")
async def mark_notification_read(
    notif_id: str,
    user: Dict[str, Any] = Depends(get_current_user),
):
    notif = await db.notifications.find_one({"id": notif_id}, {"_id": 0})
    if not notif:
        raise HTTPException(404, "Notification not found")
    _enforce_target(user, notif.get("target_type") or "", notif.get("target_id") or "")
    await db.notifications.update_one({"id": notif_id}, {"$set": {"read": True}})
    return {"ok": True}


@router.patch("/notifications/read-all")
async def mark_all_read(
    target_type: str = Query(...),
    target_id: str = Query(...),
    user: Dict[str, Any] = Depends(get_current_user),
):
    _enforce_target(user, target_type, target_id)
    await db.notifications.update_many(
        {"target_type": target_type, "target_id": target_id, "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}
