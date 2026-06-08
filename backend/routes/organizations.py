"""Universal Organization API.

Foundation for the multi-tier supply-chain (manufacturer → warehouse →
distributor → wholesaler → retailer + logistics_provider). The new
`organizations` collection is the system of record for hierarchy and
identity; the legacy `manufacturers`/`distributors`/`retailers` collections
remain the runtime source for products/orders/sales and are cross-linked via
matching UUIDs.

Role-based scoping rules:
  - super_admin: full access
  - manufacturer: may create warehouse / distributor under its subtree;
                  may read anything downstream
  - distributor:  may create wholesaler under its subtree;
                  may read connected wholesalers + retailers
  - wholesaler:   may create retailer under its subtree
  - retailer:     read-only on its own org
  - logistics_provider: read-only unless explicitly granted
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from core import (
    ORG_CHILDREN_ALLOWED, db, logger, new_id, now_iso,
)
from models import (
    Organization, OrganizationCreate, OrganizationUpdate,
    OrganizationRelationship, OrganizationRelationshipCreate,
    OrganizationRelationshipUpdate,
)
from services.auth import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
TYPE_CODE_PREFIX = {
    "manufacturer": "MFR", "warehouse": "WHR", "distributor": "DST",
    "wholesaler": "WHO", "retailer": "RTL", "logistics_provider": "LOG",
}


async def _next_org_code(org_type: str) -> str:
    prefix = TYPE_CODE_PREFIX.get(org_type, "ORG")
    key = f"org_seq_{org_type}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = int((doc or {}).get("seq", 1))
    return f"{prefix}-{seq:04d}"


def _can_manage(user_org_type: str, target_type: str) -> bool:
    """Return True if a user of `user_org_type` is allowed to manage (create
    or edit) an org of `target_type` based on supply-chain rules."""
    return target_type in ORG_CHILDREN_ALLOWED.get(user_org_type, [])


async def _resolve_user_org(user: dict) -> Optional[dict]:
    """Resolve the user's owning organization (super_admin has none)."""
    if user.get("role") == "super_admin":
        return None
    eid = user.get("entity_id")
    if not eid:
        return None
    return await db.organizations.find_one({"id": eid}, {"_id": 0})


async def _descendants(root_id: str, max_depth: int = 8) -> List[str]:
    """Return all descendant organization ids (BFS, with depth cap)."""
    out: List[str] = [root_id]
    frontier = [root_id]
    seen = {root_id}
    depth = 0
    while frontier and depth < max_depth:
        children = await db.organizations.find(
            {"parent_organization_id": {"$in": frontier}}, {"_id": 0, "id": 1},
        ).to_list(2000)
        next_frontier = [c["id"] for c in children if c["id"] not in seen]
        for c in next_frontier:
            seen.add(c)
            out.append(c)
        frontier = next_frontier
        depth += 1
    return out


def _is_self_or_ancestor(org_id: str, candidate_parent_id: Optional[str],
                          all_orgs: List[dict]) -> bool:
    """Walk up from candidate parent and return True if we hit `org_id`
    (i.e. would create a cycle)."""
    if not candidate_parent_id:
        return False
    by_id = {o["id"]: o for o in all_orgs}
    cur = by_id.get(candidate_parent_id)
    hops = 0
    while cur and hops < 16:
        if cur["id"] == org_id:
            return True
        cur = by_id.get(cur.get("parent_organization_id"))
        hops += 1
    return False


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.post("/organizations")
async def create_organization(
    payload: OrganizationCreate,
    user: dict = Depends(get_current_user),
):
    user_org = await _resolve_user_org(user)
    user_type = (user_org or {}).get("organization_type") or ""

    if user.get("role") != "super_admin":
        if not user_org:
            raise HTTPException(403, "No organization on your account")
        # Must be authorised to manage this type
        if not _can_manage(user_type, payload.organization_type):
            raise HTTPException(
                403,
                f"Your role ({user_type}) cannot create a '{payload.organization_type}'.",
            )
        # If a parent is given, ensure it's inside the user's subtree.
        if payload.parent_organization_id:
            allowed = set(await _descendants(user_org["id"]))
            if payload.parent_organization_id not in allowed:
                raise HTTPException(
                    403, "Parent organization is outside your network.",
                )
        else:
            # Default the parent to the user's own organization.
            payload = payload.model_copy(
                update={"parent_organization_id": user_org["id"]},
            )

    # Validate hierarchy
    if payload.parent_organization_id:
        parent = await db.organizations.find_one(
            {"id": payload.parent_organization_id}, {"_id": 0},
        )
        if not parent:
            raise HTTPException(404, "Parent organization not found")
        if payload.organization_type not in ORG_CHILDREN_ALLOWED.get(
            parent["organization_type"], []
        ):
            raise HTTPException(
                400,
                f"A '{parent['organization_type']}' cannot have a '{payload.organization_type}' child.",
            )

    org = Organization(
        organization_code=await _next_org_code(payload.organization_type),
        **payload.model_dump(),
    )
    await db.organizations.insert_one(org.model_dump())
    return org


@router.get("/organizations")
async def list_organizations(
    organization_type: Optional[str] = None,
    parent_organization_id: Optional[str] = Query(None),
    status: Optional[str] = None,
    q: Optional[str] = None,
    region: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    user_org = await _resolve_user_org(user)
    query: Dict[str, Any] = {}
    if organization_type:
        query["organization_type"] = organization_type
    if parent_organization_id == "null":
        query["parent_organization_id"] = None
    elif parent_organization_id:
        query["parent_organization_id"] = parent_organization_id
    if status:
        query["status"] = status
    if region:
        query["region"] = region

    # Scope: non-super-admin users only see their subtree.
    if user.get("role") != "super_admin" and user_org:
        scope_ids = await _descendants(user_org["id"])
        query["id"] = {"$in": scope_ids}

    docs = await db.organizations.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if q:
        ql = q.lower()
        docs = [d for d in docs
                if ql in (d.get("organization_name", "") or "").lower()
                or ql in (d.get("organization_code", "") or "").lower()]
    return docs


@router.get("/organizations/{org_id}")
async def get_organization(org_id: str, user: dict = Depends(get_current_user)):
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    if not org:
        raise HTTPException(404, "Organization not found")
    user_org = await _resolve_user_org(user)
    if user.get("role") != "super_admin" and user_org:
        scope = await _descendants(user_org["id"])
        if org_id not in scope:
            raise HTTPException(403, "Outside your organization scope")
    return org


@router.patch("/organizations/{org_id}")
async def update_organization(
    org_id: str, payload: OrganizationUpdate,
    user: dict = Depends(get_current_user),
):
    org = await db.organizations.find_one({"id": org_id})
    if not org:
        raise HTTPException(404, "Organization not found")
    user_org = await _resolve_user_org(user)
    user_type = (user_org or {}).get("organization_type") or ""

    if user.get("role") != "super_admin":
        if not user_org:
            raise HTTPException(403, "No organization on your account")
        if not _can_manage(user_type, org["organization_type"]):
            raise HTTPException(
                403, f"You cannot manage a '{org['organization_type']}'",
            )
        scope = await _descendants(user_org["id"])
        if org_id not in scope:
            raise HTTPException(403, "Outside your organization scope")

    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "parent_organization_id" in update and update["parent_organization_id"]:
        all_orgs = await db.organizations.find({}, {"_id": 0, "id": 1, "parent_organization_id": 1}).to_list(20000)
        if _is_self_or_ancestor(org_id, update["parent_organization_id"], all_orgs):
            raise HTTPException(400, "Hierarchy cycle detected")
    update["updated_at"] = now_iso()
    await db.organizations.update_one({"id": org_id}, {"$set": update})
    return await db.organizations.find_one({"id": org_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Hierarchy
# ---------------------------------------------------------------------------
@router.get("/organizations/{org_id}/parent")
async def get_parent(org_id: str, user: dict = Depends(get_current_user)):
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    if not org:
        raise HTTPException(404, "Organization not found")
    pid = org.get("parent_organization_id")
    if not pid:
        return None
    return await db.organizations.find_one({"id": pid}, {"_id": 0})


@router.get("/organizations/{org_id}/children")
async def get_children(org_id: str, user: dict = Depends(get_current_user)):
    return await db.organizations.find(
        {"parent_organization_id": org_id}, {"_id": 0},
    ).sort("organization_name", 1).to_list(2000)


@router.get("/organizations/{org_id}/hierarchy")
async def get_hierarchy(org_id: str, user: dict = Depends(get_current_user),
                         max_depth: int = 6):
    """Return the recursive tree rooted at `org_id`."""
    root = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    if not root:
        raise HTTPException(404, "Organization not found")
    user_org = await _resolve_user_org(user)
    if user.get("role") != "super_admin" and user_org:
        scope = await _descendants(user_org["id"])
        if org_id not in scope:
            raise HTTPException(403, "Outside your organization scope")
    # BFS gather all descendants once, then assemble tree.
    desc_ids = await _descendants(org_id, max_depth=max_depth)
    docs = await db.organizations.find(
        {"id": {"$in": desc_ids}}, {"_id": 0},
    ).to_list(20000)
    by_id = {d["id"]: {**d, "children": []} for d in docs}
    tree = None
    for d in docs:
        if d["id"] == org_id:
            tree = by_id[d["id"]]
            continue
        parent = by_id.get(d.get("parent_organization_id"))
        if parent:
            parent["children"].append(by_id[d["id"]])
    return tree


@router.get("/organizations/me/network")
async def my_network(user: dict = Depends(get_current_user)):
    """Return the calling user's own network — their org + descendants tree.
    Super-admin gets a virtual root with all top-level orgs as children."""
    if user.get("role") == "super_admin":
        roots = await db.organizations.find(
            {"parent_organization_id": None}, {"_id": 0},
        ).sort("organization_name", 1).to_list(5000)
        trees = []
        for r in roots:
            trees.append(await get_hierarchy(r["id"], user))
        return {
            "id": "__root__", "organization_name": "All Organizations",
            "organization_type": "super_admin", "children": trees,
        }
    user_org = await _resolve_user_org(user)
    if not user_org:
        raise HTTPException(404, "No organization linked to your account")
    return await get_hierarchy(user_org["id"], user)


@router.get("/organizations/me/permissions")
async def my_permissions(user: dict = Depends(get_current_user)):
    """Tells the UI what the calling user is allowed to manage."""
    if user.get("role") == "super_admin":
        return {
            "is_super_admin": True,
            "user_org_type": None,
            "can_create_types": list(ORG_CHILDREN_ALLOWED.keys()),
            "can_manage": True,
        }
    user_org = await _resolve_user_org(user)
    if not user_org:
        return {"is_super_admin": False, "user_org_type": None,
                "can_create_types": [], "can_manage": False}
    t = user_org["organization_type"]
    allowed = ORG_CHILDREN_ALLOWED.get(t, [])
    return {
        "is_super_admin": False,
        "user_org_type": t,
        "user_org_id": user_org["id"],
        "user_org_name": user_org.get("organization_name"),
        "can_create_types": allowed,
        "can_manage": len(allowed) > 0,
    }


# ---------------------------------------------------------------------------
# Cross-tier many-to-many Organization Relationships
# ---------------------------------------------------------------------------
async def _scope_org_ids(user: dict) -> Optional[set]:
    """None for super_admin (no scoping). Otherwise the set of org ids
    visible to the user (their own + descendants)."""
    if user.get("role") == "super_admin":
        return None
    user_org = await _resolve_user_org(user)
    if not user_org:
        return set()
    return set(await _descendants(user_org["id"]))


@router.post("/organization-relationships")
async def create_relationship(
    payload: OrganizationRelationshipCreate,
    user: dict = Depends(get_current_user),
):
    if payload.from_organization_id == payload.to_organization_id:
        raise HTTPException(400, "Self-relationships are not allowed")
    a = await db.organizations.find_one({"id": payload.from_organization_id}, {"_id": 0})
    b = await db.organizations.find_one({"id": payload.to_organization_id}, {"_id": 0})
    if not a or not b:
        raise HTTPException(404, "Both organizations must exist")
    scope = await _scope_org_ids(user)
    if scope is not None and (a["id"] not in scope and b["id"] not in scope):
        raise HTTPException(403, "Relationship endpoints are outside your scope")
    # Prevent duplicate active relationships of the same type/direction.
    dup = await db.organization_relationships.find_one({
        "from_organization_id": payload.from_organization_id,
        "to_organization_id": payload.to_organization_id,
        "relationship_type": payload.relationship_type,
        "status": "active",
    })
    if dup:
        raise HTTPException(409, "An active relationship of this type already exists")
    rel = OrganizationRelationship(**payload.model_dump())
    await db.organization_relationships.insert_one(rel.model_dump())
    return rel


@router.get("/organization-relationships")
async def list_relationships(
    organization_id: Optional[str] = None,
    relationship_type: Optional[str] = None,
    status: Optional[str] = None,
    direction: Optional[str] = Query(None, regex="^(from|to|both)$"),
    user: dict = Depends(get_current_user),
):
    """List relationships. If `organization_id` is supplied, returns links
    where it appears (direction `from`, `to`, or `both` — default both)."""
    query: Dict[str, Any] = {}
    if relationship_type:
        query["relationship_type"] = relationship_type
    if status:
        query["status"] = status
    if organization_id:
        if direction == "from":
            query["from_organization_id"] = organization_id
        elif direction == "to":
            query["to_organization_id"] = organization_id
        else:
            query["$or"] = [
                {"from_organization_id": organization_id},
                {"to_organization_id": organization_id},
            ]
    scope = await _scope_org_ids(user)
    docs = await db.organization_relationships.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    if scope is not None:
        docs = [d for d in docs
                if d["from_organization_id"] in scope
                or d["to_organization_id"] in scope]
    return docs


@router.patch("/organization-relationships/{rel_id}")
async def update_relationship(
    rel_id: str, payload: OrganizationRelationshipUpdate,
    user: dict = Depends(get_current_user),
):
    rel = await db.organization_relationships.find_one({"id": rel_id}, {"_id": 0})
    if not rel:
        raise HTTPException(404, "Relationship not found")
    scope = await _scope_org_ids(user)
    if scope is not None and (rel["from_organization_id"] not in scope and rel["to_organization_id"] not in scope):
        raise HTTPException(403, "Outside your scope")
    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    update["updated_at"] = now_iso()
    if update.get("status") == "ended" and not update.get("ended_at"):
        update["ended_at"] = now_iso()
    await db.organization_relationships.update_one({"id": rel_id}, {"$set": update})
    return await db.organization_relationships.find_one({"id": rel_id}, {"_id": 0})


@router.delete("/organization-relationships/{rel_id}")
async def delete_relationship(rel_id: str, user: dict = Depends(get_current_user)):
    rel = await db.organization_relationships.find_one({"id": rel_id}, {"_id": 0})
    if not rel:
        raise HTTPException(404, "Relationship not found")
    scope = await _scope_org_ids(user)
    if scope is not None and (rel["from_organization_id"] not in scope and rel["to_organization_id"] not in scope):
        raise HTTPException(403, "Outside your scope")
    await db.organization_relationships.delete_one({"id": rel_id})
    return {"deleted": rel_id}


@router.get("/organizations/{org_id}/relationships")
async def org_relationships(org_id: str, user: dict = Depends(get_current_user)):
    """Convenience helper — relationships in either direction with the
    counterpart organization document inlined."""
    org = await db.organizations.find_one({"id": org_id}, {"_id": 0})
    if not org:
        raise HTTPException(404, "Organization not found")
    scope = await _scope_org_ids(user)
    if scope is not None and org_id not in scope:
        raise HTTPException(403, "Outside your scope")
    rels = await db.organization_relationships.find({
        "$or": [
            {"from_organization_id": org_id},
            {"to_organization_id": org_id},
        ],
    }, {"_id": 0}).sort("created_at", -1).to_list(5000)
    # Bulk-load counterpart org docs once.
    other_ids = list({
        r["to_organization_id"] if r["from_organization_id"] == org_id else r["from_organization_id"]
        for r in rels
    })
    others = {o["id"]: o for o in await db.organizations.find(
        {"id": {"$in": other_ids}}, {"_id": 0},
    ).to_list(5000)}
    out = []
    for r in rels:
        other_id = r["to_organization_id"] if r["from_organization_id"] == org_id else r["from_organization_id"]
        out.append({
            **r,
            "direction": "outgoing" if r["from_organization_id"] == org_id else "incoming",
            "counterpart": others.get(other_id),
        })
    return out
