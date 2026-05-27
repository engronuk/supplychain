"""Idempotent demo-user seed.

Runs on every backend boot. Safe: only inserts users that do not already
exist (matched by email). Existing users are never overwritten.

Produces the 1:1 demo accounts requested for the 500-retailer POC plus a
super-admin that can impersonate any role:

    admin@tradekonekt.io                — super_admin
    unilever@tradekonekt.io             — manufacturer admin (Unilever)
    lagos.distributor@tradekonekt.io    — distributor admin (primary)
    abuja.distributor@tradekonekt.io    — distributor admin
    ph.distributor@tradekonekt.io       — distributor admin
    retailer1@tradekonekt.io ... 5      — retailer admins (under primary dist)

All accounts share the demo password from `DEMO_PASSWORD` env var.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

from core import db, logger, new_id
from services.auth import hash_password


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _pick_manufacturer() -> Optional[dict]:
    return await db.manufacturers.find_one({}, {"_id": 0})


async def _pick_distributors(manufacturer_id: str) -> List[dict]:
    """Pick three distinct distributors, ideally from 3 different regions."""
    dists = await db.distributors.find(
        {"manufacturer_id": manufacturer_id}, {"_id": 0}
    ).to_list(1000)
    if not dists:
        return []
    by_region: Dict[str, dict] = {}
    for d in dists:
        region = (d.get("region") or "").strip() or "—"
        if region not in by_region:
            by_region[region] = d
    chosen = list(by_region.values())[:3]
    # If we don't have 3 unique regions, fall back to first three distributors
    if len(chosen) < 3:
        seen = {d["id"] for d in chosen}
        for d in dists:
            if d["id"] not in seen:
                chosen.append(d)
                seen.add(d["id"])
                if len(chosen) == 3:
                    break
    return chosen[:3]


async def _pick_retailers(distributor_id: str, limit: int = 5) -> List[dict]:
    return await db.retailers.find(
        {"distributor_id": distributor_id}, {"_id": 0}
    ).to_list(limit)


def _build_user(
    *,
    email: str,
    name: str,
    role: str,
    entity_id: str,
    manufacturer_id: str,
    password_hash: str,
    is_demo: bool = True,
) -> dict:
    return {
        "id": new_id(),
        "email": email.lower(),
        "name": name,
        "role": role,
        "entity_type": role if role != "super_admin" else "system",
        "entity_id": entity_id,
        "manufacturer_id": manufacturer_id,
        "password_hash": password_hash,
        "status": "active",
        "is_demo": is_demo,
        "created_at": _now_iso(),
    }


async def seed_demo_users() -> dict:
    """Insert demo accounts if missing. Idempotent."""
    password = os.environ.get("DEMO_PASSWORD")
    if not password:
        return {"created": 0, "skipped": True, "reason": "DEMO_PASSWORD env not set"}

    mfg = await _pick_manufacturer()
    if not mfg:
        return {"created": 0, "skipped": True, "reason": "No manufacturer in DB yet"}

    dists = await _pick_distributors(mfg["id"])
    primary_dist = dists[0] if dists else None
    retailers = await _pick_retailers(primary_dist["id"], 5) if primary_dist else []

    pwd_hash = hash_password(password)

    accounts: List[dict] = []
    # 1. Super-admin
    accounts.append(_build_user(
        email="admin@tradekonekt.io",
        name="TradeKonekt Admin",
        role="super_admin",
        entity_id="",
        manufacturer_id="",
        password_hash=pwd_hash,
    ))
    # 2. Manufacturer admin (Unilever)
    accounts.append(_build_user(
        email="unilever@tradekonekt.io",
        name=f"{mfg['name']} Admin",
        role="manufacturer",
        entity_id=mfg["id"],
        manufacturer_id=mfg["id"],
        password_hash=pwd_hash,
    ))
    # 3. Distributor admins — 1:1, named after region
    region_email_map = {
        "Lagos": "lagos.distributor@tradekonekt.io",
        "Abuja": "abuja.distributor@tradekonekt.io",
        "FCT": "abuja.distributor@tradekonekt.io",
        "Port Harcourt": "ph.distributor@tradekonekt.io",
        "Rivers": "ph.distributor@tradekonekt.io",
    }
    fallback_emails = [
        "lagos.distributor@tradekonekt.io",
        "abuja.distributor@tradekonekt.io",
        "ph.distributor@tradekonekt.io",
    ]
    used_emails = set()
    for idx, d in enumerate(dists):
        region = (d.get("region") or "").strip()
        email = region_email_map.get(region)
        if not email or email in used_emails:
            # Use next fallback that hasn't been used
            for fb in fallback_emails:
                if fb not in used_emails:
                    email = fb
                    break
        used_emails.add(email)
        accounts.append(_build_user(
            email=email,
            name=f"{d['name']} Admin",
            role="distributor",
            entity_id=d["id"],
            manufacturer_id=mfg["id"],
            password_hash=pwd_hash,
        ))
    # 4. Retailer admins — retailer1..5 under primary distributor
    for idx, r in enumerate(retailers, start=1):
        accounts.append(_build_user(
            email=f"retailer{idx}@tradekonekt.io",
            name=f"{r['name']} Owner",
            role="retailer",
            entity_id=r["id"],
            manufacturer_id=mfg["id"],
            password_hash=pwd_hash,
        ))

    created = 0
    existing = 0
    for user in accounts:
        already = await db.users.find_one({"email": user["email"]}, {"_id": 0, "id": 1})
        if already:
            existing += 1
            continue
        await db.users.insert_one(user)
        created += 1

    if created:
        logger.info(
            "seed_demo_users: created=%s existing=%s (password=%s)",
            created, existing, "<DEMO_PASSWORD env>",
        )
    return {
        "created": created,
        "existing": existing,
        "total_accounts": len(accounts),
    }
