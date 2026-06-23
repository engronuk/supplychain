"""Global federated search — ``GET /api/search``.

Searches across products · shipments · drivers · vehicles · distributors ·
wholesalers · retailers · warehouses, scoped to the caller's tenant. Used
by the global search bar in every workspace (web + mobile).

Response shape:
``{query, total, groups: {<type>: [{...hit, type}], ...}}``

Roles
-----
* ``manufacturer``                — sees their own + downstream chain
* ``distributor`` / ``wholesaler`` — sees own org + own children + own fleet
* ``retailer``                    — sees own products only
* ``super_admin``                 — global cross-tenant view
* ``driver``                      — search disabled (403)
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db
from services.auth import get_current_user as require_auth

router = APIRouter()

ALLOWED_TYPES = {
    "products", "shipments", "drivers", "vehicles",
    "distributors", "wholesalers", "retailers", "warehouses",
}
DEFAULT_TYPES = ALLOWED_TYPES
SEARCH_DENY_ROLES = {"driver"}


def _re(q: str) -> Dict[str, Any]:
    """Build a case-insensitive ``$regex`` matcher on a single field."""
    return {"$regex": re.escape(q), "$options": "i"}


def _tenant_filter_for(role: str, user: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Return a flat dict of `{tenant_field: id}` to AND into every query."""
    if role == "super_admin":
        return {}
    return {
        "manufacturer_id": user.get("manufacturer_id"),
        "entity_id": user.get("entity_id"),
        "distributor_id": user.get("distributor_id"),
    }


async def _search_products(q: str, role: str, user: Dict[str, Any], limit: int):
    cond: Dict[str, Any] = {"$or": [
        {"name": _re(q)}, {"sku": _re(q)}, {"barcode": _re(q)},
    ]}
    if role != "super_admin":
        mfr = user.get("manufacturer_id")
        if mfr:
            cond["manufacturer_id"] = mfr
    rows = []
    async for r in db.products.find(cond, {"_id": 0, "id": 1, "name": 1, "sku": 1,
                                           "price": 1, "case_size": 1,
                                           "manufacturer_id": 1}).limit(limit):
        r["type"] = "product"
        r["title"] = r.get("name") or r.get("sku") or ""
        r["subtitle"] = r.get("sku") or ""
        rows.append(r)
    return rows


async def _search_shipments(q: str, role: str, user: Dict[str, Any], limit: int):
    cond: Dict[str, Any] = {"$or": [
        {"id": _re(q)},
        {"from_name": _re(q)},
        {"to_name": _re(q)},
    ]}
    if role != "super_admin":
        mfr = user.get("manufacturer_id")
        ent = user.get("entity_id")
        scoping = []
        if mfr:
            scoping.append({"manufacturer_id": mfr})
        if ent:
            scoping += [{"owner_org_id": ent}, {"from_id": ent}, {"to_id": ent}]
        if scoping:
            cond = {"$and": [cond, {"$or": scoping}]}
    rows = []
    async for r in db.shipments.find(cond, {
        "_id": 0, "id": 1, "status": 1, "from_role": 1, "from_id": 1,
        "to_role": 1, "to_id": 1, "to_name": 1, "total_units": 1,
        "total_value": 1, "created_at": 1,
    }).sort("created_at", -1).limit(limit):
        r["type"] = "shipment"
        r["title"] = f"Shipment {r['id'][:8]}"
        r["subtitle"] = f"{r.get('status','')} · → {r.get('to_name') or r.get('to_role','')}"
        rows.append(r)
    return rows


async def _search_drivers(q: str, role: str, user: Dict[str, Any], limit: int):
    cond: Dict[str, Any] = {"is_active": True, "$or": [
        {"full_name": _re(q)}, {"first_name": _re(q)}, {"last_name": _re(q)},
        {"employee_number": _re(q)}, {"phone": _re(q)}, {"licence_number": _re(q)},
    ]}
    if role != "super_admin":
        ent = user.get("entity_id")
        if ent:
            cond["employer_org_id"] = ent
    rows = []
    async for r in db.drivers.find(cond, {
        "_id": 0, "id": 1, "full_name": 1, "employee_number": 1,
        "status": 1, "phone": 1, "compliance_severity": 1,
        "employer_org_id": 1,
    }).limit(limit):
        r["type"] = "driver"
        r["title"] = r.get("full_name") or r.get("employee_number") or ""
        r["subtitle"] = f"{r.get('employee_number','')} · {r.get('status','')}"
        rows.append(r)
    return rows


async def _search_vehicles(q: str, role: str, user: Dict[str, Any], limit: int):
    cond: Dict[str, Any] = {"is_active": True, "$or": [
        {"vehicle_code": _re(q)},
        {"registration_number": _re(q)},
        {"make": _re(q)}, {"model": _re(q)},
    ]}
    if role != "super_admin":
        ent = user.get("entity_id")
        if ent:
            cond["owner_org_id"] = ent
        # Exclude simulator-only fleet for non-admins
        cond["source"] = {"$in": ["seed", "manual"]}
    rows = []
    async for r in db.vehicles.find(cond, {
        "_id": 0, "id": 1, "vehicle_code": 1, "registration_number": 1,
        "status": 1, "make": 1, "model": 1, "capacity_units": 1,
        "compliance_severity": 1, "owner_org_id": 1,
    }).limit(limit):
        r["type"] = "vehicle"
        r["title"] = r.get("registration_number") or r.get("vehicle_code") or ""
        r["subtitle"] = f"{r.get('make','')} {r.get('model','')} · {r.get('status','')}"
        rows.append(r)
    return rows


async def _search_org(coll: str, q: str, role: str, user: Dict[str, Any],
                     limit: int, kind: str) -> List[Dict[str, Any]]:
    cond: Dict[str, Any] = {"$or": [
        {"name": _re(q)}, {"city": _re(q)}, {"state": _re(q)},
    ]}
    # Manufacturers see their own network; distributors see their own retailers
    if role != "super_admin":
        mfr = user.get("manufacturer_id")
        ent = user.get("entity_id")
        scopes: List[Dict[str, Any]] = []
        if kind == "retailer" and ent:
            scopes.append({"distributor_id": ent})
        if mfr and kind in ("distributor", "wholesaler", "warehouse", "retailer"):
            scopes.append({"manufacturer_id": mfr})
        if ent and kind == coll.rstrip("s"):
            scopes.append({"id": ent})
        if scopes:
            cond = {"$and": [cond, {"$or": scopes}]}
    rows = []
    async for r in db[coll].find(cond, {
        "_id": 0, "id": 1, "name": 1, "city": 1, "state": 1,
        "manufacturer_id": 1, "distributor_id": 1,
    }).limit(limit):
        r["type"] = kind
        r["title"] = r.get("name") or ""
        r["subtitle"] = f"{r.get('city','')}, {r.get('state','')}".strip(", ")
        rows.append(r)
    return rows


@router.get("/search", response_model=Dict[str, Any])
async def global_search(
    q: str = Query(..., min_length=1, max_length=100),
    types: Optional[str] = Query(None, description="comma-separated subset"),
    limit: int = Query(10, ge=1, le=50),
    user: Dict[str, Any] = Depends(require_auth),
) -> Dict[str, Any]:
    role = user.get("role") or ""
    if role in SEARCH_DENY_ROLES:
        raise HTTPException(403, {"code": "SEARCH_FORBIDDEN_ROLE", "role": role})

    requested = (
        {t.strip() for t in types.split(",") if t.strip()} if types else DEFAULT_TYPES
    )
    invalid = requested - ALLOWED_TYPES
    if invalid:
        raise HTTPException(400, {"code": "INVALID_TYPES",
                                  "invalid": sorted(invalid),
                                  "allowed": sorted(ALLOWED_TYPES)})

    groups: Dict[str, List[Dict[str, Any]]] = {}
    if "products" in requested:
        groups["products"] = await _search_products(q, role, user, limit)
    if "shipments" in requested:
        groups["shipments"] = await _search_shipments(q, role, user, limit)
    if "drivers" in requested:
        groups["drivers"] = await _search_drivers(q, role, user, limit)
    if "vehicles" in requested:
        groups["vehicles"] = await _search_vehicles(q, role, user, limit)
    if "distributors" in requested:
        groups["distributors"] = await _search_org(
            "distributors", q, role, user, limit, "distributor")
    if "wholesalers" in requested:
        groups["wholesalers"] = await _search_org(
            "wholesalers", q, role, user, limit, "wholesaler")
    if "retailers" in requested:
        groups["retailers"] = await _search_org(
            "retailers", q, role, user, limit, "retailer")
    if "warehouses" in requested:
        groups["warehouses"] = await _search_org(
            "warehouses", q, role, user, limit, "warehouse")

    total = sum(len(v) for v in groups.values())
    return {
        "query": q,
        "total": total,
        "groups": groups,
        "limits_per_group": limit,
        "scope": "global" if role == "super_admin" else "tenant",
    }
