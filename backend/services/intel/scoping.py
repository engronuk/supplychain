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

    - manufacturer  → everything within its tenant
    - distributor   → items scoped to itself OR to its retailers (NOT
                      manufacturer-scoped items — those are the central team's view)
    - retailer      → items scoped to itself only
    """
    base = {"tenant_id": tenant_id}
    if role == "manufacturer":
        return base
    if role == "distributor":
        retailer_ids = [r["id"] async for r in db.retailers.find(
            {"distributor_id": entity_id}, {"_id": 0, "id": 1},
        )]
        base["$or"] = [
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


async def role_entity_context(role: str, entity_id: str) -> Dict:
    """Resolve which retailers / region(s) belong to this role+entity.

    Used by narrator + analyzers to scope their inputs.
    """
    if role == "manufacturer":
        dists = await db.distributors.find(
            {"manufacturer_id": entity_id}, {"_id": 0, "id": 1, "region": 1},
        ).to_list(5000)
        dist_ids = [d["id"] for d in dists]
        retailers = await db.retailers.find(
            {"distributor_id": {"$in": dist_ids}}, {"_id": 0, "id": 1, "region": 1},
        ).to_list(20000)
        return {
            "scope": "manufacturer",
            "regions": sorted({(d.get("region") or "—") for d in dists}),
            "distributor_ids": dist_ids,
            "retailer_ids": [r["id"] for r in retailers],
        }
    if role == "distributor":
        d = await db.distributors.find_one(
            {"id": entity_id}, {"_id": 0, "id": 1, "name": 1, "region": 1, "city": 1},
        ) or {}
        retailers = await db.retailers.find(
            {"distributor_id": entity_id}, {"_id": 0, "id": 1, "region": 1},
        ).to_list(20000)
        return {
            "scope": "distributor",
            "distributor_id": entity_id,
            "distributor_name": d.get("name", ""),
            "regions": [d.get("region") or "—"],
            "primary_region": d.get("region") or "—",
            "city": d.get("city") or "",
            "distributor_ids": [entity_id],
            "retailer_ids": [r["id"] for r in retailers],
        }
    if role == "retailer":
        r = await db.retailers.find_one(
            {"id": entity_id},
            {"_id": 0, "id": 1, "name": 1, "region": 1, "city": 1, "distributor_id": 1},
        ) or {}
        return {
            "scope": "retailer",
            "retailer_id": entity_id,
            "retailer_name": r.get("name", ""),
            "regions": [r.get("region") or "—"],
            "primary_region": r.get("region") or "—",
            "city": r.get("city") or "",
            "distributor_id": r.get("distributor_id", ""),
            "distributor_ids": [r.get("distributor_id", "")] if r.get("distributor_id") else [],
            "retailer_ids": [entity_id],
        }
    return {"scope": role, "regions": [], "distributor_ids": [], "retailer_ids": []}
