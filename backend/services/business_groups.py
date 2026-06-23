"""Business-group identity model.

The codebase has historically created one ``distributors`` (or
``wholesalers``) row per ``(real-world business, upstream manufacturer)``
pair. So a single business — "Apex Distributors (Apapa)" — that serves
both Unilever and Flour Mills Nigeria appears as TWO rows in
``db.distributors``.

To let a real human operator log in once and *pick* which manufacturer
they want to see, we introduce a third coordinate: ``business_group_id``.

* ``business_group_id`` is a **deterministic UUID-5** derived from
  ``(role, name, city, state)``. Two rows that describe the same
  real-world business under different manufacturers always produce the
  same id. Adding a new manufacturer for the same business later creates
  a new ``distributors`` row that automatically belongs to the same group
  — **no recoding required**.

* Every relevant row carries a ``business_group_id``:
    * ``distributors``
    * ``wholesalers``
    * ``users`` (so login can resolve memberships in O(1))

* ``GET /api/me/tenants`` (see ``routes/me.py``) returns the manufacturer
  list scoped to the caller's ``business_group_id``.

Migration is idempotent — only writes the field if missing or stale.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from core import db, logger


_BUSINESS_NAMESPACE = uuid.UUID("4d6f1e4a-7b3a-4b5e-9b1e-6c7a8d9e0f10")


def _slug(value: Optional[str]) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"\s+", " ", str(value)).strip().casefold()
    cleaned = re.sub(r"[^\w\s()-]", "", cleaned)
    return cleaned


def business_group_id_for(role: str, name: Optional[str],
                          city: Optional[str], state: Optional[str]) -> str:
    """Deterministic UUID for ``(role, name, city, state)``.

    Same real-world business → same id, regardless of which manufacturer
    onboarded it. ``role`` is included so a distributor and a wholesaler
    that share an address never collide.
    """
    key = "|".join([
        role or "",
        _slug(name),
        _slug(city),
        _slug(state),
    ])
    return str(uuid.uuid5(_BUSINESS_NAMESPACE, key))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def backfill_business_groups() -> Dict[str, Any]:
    """One-shot (idempotent) backfill of ``business_group_id`` across
    distributors, wholesalers and users. Returns counts."""
    counters = {"distributors": 0, "wholesalers": 0, "users": 0}

    # ---- distributors ---------------------------------------------------
    async for d in db.distributors.find({}, {"_id": 0}):
        bg = business_group_id_for("distributor", d.get("name"),
                                   d.get("city"), d.get("state"))
        if d.get("business_group_id") == bg:
            continue
        await db.distributors.update_one(
            {"id": d["id"]},
            {"$set": {"business_group_id": bg, "updated_at": _now_iso()}},
        )
        counters["distributors"] += 1

    # ---- wholesalers ----------------------------------------------------
    async for w in db.wholesalers.find({}, {"_id": 0}):
        bg = business_group_id_for("wholesaler", w.get("name"),
                                   w.get("city"), w.get("state"))
        if w.get("business_group_id") == bg:
            continue
        await db.wholesalers.update_one(
            {"id": w["id"]},
            {"$set": {"business_group_id": bg, "updated_at": _now_iso()}},
        )
        counters["wholesalers"] += 1

    # ---- users (distributor + wholesaler logins) -----------------------
    # We resolve each user's business_group_id from THEIR own entity row.
    async for u in db.users.find(
        {"role": {"$in": ["distributor", "wholesaler"]}, "entity_id": {"$ne": None}},
        {"_id": 0, "id": 1, "role": 1, "entity_id": 1, "business_group_id": 1},
    ):
        coll = "distributors" if u["role"] == "distributor" else "wholesalers"
        entity = await db[coll].find_one(
            {"id": u["entity_id"]},
            {"_id": 0, "business_group_id": 1},
        )
        if not entity:
            continue
        bg = entity.get("business_group_id")
        if not bg:
            continue
        if u.get("business_group_id") == bg:
            continue
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {"business_group_id": bg, "updated_at": _now_iso()}},
        )
        counters["users"] += 1

    if any(counters.values()):
        logger.info("Business-group backfill: %s", counters)
    return counters


async def memberships_for_user(user: Dict[str, Any]) -> Dict[str, Any]:
    """Return every ``(manufacturer, entity)`` the caller can act as.

    For a distributor or wholesaler with ``business_group_id`` set, this
    returns one row per ``distributors``/``wholesalers`` record sharing
    the same group. Other roles get a single-element list scoped to
    their own ``entity_id``.
    """
    role = user.get("role")
    bg = user.get("business_group_id")

    # Non-multi-tenant roles → emit a single entry derived from the user record
    if role not in ("distributor", "wholesaler"):
        manufacturer_id = user.get("manufacturer_id")
        manufacturer_name = ""
        if manufacturer_id:
            m = await db.manufacturers.find_one(
                {"id": manufacturer_id}, {"_id": 0, "name": 1})
            manufacturer_name = (m or {}).get("name") or ""
        return {
            "active": {
                "manufacturer_id": manufacturer_id,
                "manufacturer_name": manufacturer_name,
                "entity_id": user.get("entity_id"),
                "entity_role": role,
            },
            "tenants": [{
                "manufacturer_id": manufacturer_id,
                "manufacturer_name": manufacturer_name,
                "entity_id": user.get("entity_id"),
                "entity_name": user.get("name") or "",
                "entity_role": role,
                "is_default": True,
            }] if manufacturer_id else [],
            "multi_tenant": False,
        }

    coll = "distributors" if role == "distributor" else "wholesalers"
    tenants = []
    if bg:
        # Treat missing/None ``is_active`` as active — many legacy rows
        # never had the field populated.
        async for entity in db[coll].find(
            {"business_group_id": bg, "is_active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "manufacturer_id": 1, "city": 1},
        ).sort("name", 1):
            mfr_id = entity.get("manufacturer_id")
            mfr = await db.manufacturers.find_one(
                {"id": mfr_id}, {"_id": 0, "name": 1}) if mfr_id else None
            tenants.append({
                "manufacturer_id": mfr_id,
                "manufacturer_name": (mfr or {}).get("name") or "",
                "entity_id": entity["id"],
                "entity_name": entity.get("name") or "",
                "entity_city": entity.get("city") or "",
                "entity_role": role,
                "is_default": entity["id"] == user.get("entity_id"),
            })

    # Fall back to the row the user is explicitly linked to
    if not tenants and user.get("entity_id"):
        entity = await db[coll].find_one(
            {"id": user["entity_id"]},
            {"_id": 0, "id": 1, "name": 1, "manufacturer_id": 1, "city": 1},
        )
        if entity:
            mfr_id = entity.get("manufacturer_id")
            mfr = await db.manufacturers.find_one(
                {"id": mfr_id}, {"_id": 0, "name": 1}) if mfr_id else None
            tenants.append({
                "manufacturer_id": mfr_id,
                "manufacturer_name": (mfr or {}).get("name") or "",
                "entity_id": entity["id"],
                "entity_name": entity.get("name") or "",
                "entity_city": entity.get("city") or "",
                "entity_role": role,
                "is_default": True,
            })

    default = next((t for t in tenants if t["is_default"]), tenants[0] if tenants else None)
    return {
        "active": {
            "manufacturer_id": (default or {}).get("manufacturer_id"),
            "manufacturer_name": (default or {}).get("manufacturer_name"),
            "entity_id": (default or {}).get("entity_id"),
            "entity_role": role,
        },
        "tenants": tenants,
        "multi_tenant": len(tenants) > 1,
    }


def find_membership(memberships: Dict[str, Any], entity_id: str) -> Optional[Dict[str, Any]]:
    """Lookup helper — returns the tenant row matching ``entity_id`` or None."""
    for t in memberships.get("tenants", []):
        if t.get("entity_id") == entity_id:
            return t
    return None
