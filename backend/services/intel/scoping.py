"""Tenant scoping for intel features.

The platform is currently single-manufacturer (Unilever) but every intel
record carries a `tenant_id = manufacturer_id` so when additional FMCG
manufacturers onboard, their data is isolated without code changes.
"""
from __future__ import annotations

from typing import Dict, Optional

from core import db


async def resolve_tenant(role: str, entity_id: str) -> Optional[str]:
    """Map (role, entity_id) → tenant_id (= manufacturer_id).

    - manufacturer: itself.
    - distributor: its manufacturer_id.
    - retailer: distributor → manufacturer_id.
    Returns None if it can't be resolved (caller should 404).
    """
    if role == "manufacturer":
        m = await db.manufacturers.find_one({"id": entity_id}, {"_id": 0, "id": 1})
        return m["id"] if m else None
    if role == "distributor":
        d = await db.distributors.find_one({"id": entity_id}, {"_id": 0, "manufacturer_id": 1})
        return (d or {}).get("manufacturer_id") or None
    if role == "retailer":
        r = await db.retailers.find_one({"id": entity_id}, {"_id": 0, "distributor_id": 1})
        if not r:
            return None
        d = await db.distributors.find_one({"id": r["distributor_id"]}, {"_id": 0, "manufacturer_id": 1})
        return (d or {}).get("manufacturer_id") or None
    return None


async def tenant_filter(tenant_id: str, role: str, entity_id: str) -> Dict:
    """Build the Mongo filter for intel reads, scoped to the requesting role.

    - manufacturer sees everything within its tenant.
    - distributor sees only items scoped to it OR to its retailers.
    - retailer sees only items scoped to itself.
    """
    base = {"tenant_id": tenant_id}
    if role == "manufacturer":
        return base
    if role == "distributor":
        retailer_ids = [r["id"] async for r in db.retailers.find(
            {"distributor_id": entity_id}, {"_id": 0, "id": 1},
        )]
        base["$or"] = [
            {"scope_role": "manufacturer"},  # network-wide insights visible to dists
            {"scope_role": "distributor", "scope_id": entity_id},
            {"scope_role": "retailer", "scope_id": {"$in": retailer_ids}},
        ]
        return base
    if role == "retailer":
        base["$or"] = [
            {"scope_role": "retailer", "scope_id": entity_id},
        ]
        return base
    return base
