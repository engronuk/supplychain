"""Seed the Flour Mills Nigeria tenant — a fully isolated second manufacturer
used to validate the multi-tenant Organization architecture.

Topology:
    Flour Mills Nigeria (manufacturer)
    └── Flour Mills Lagos Warehouse (warehouse)
        └── Prime Distribution Services Ltd (distributor)
            └── Lagos Wholesale Hub (wholesaler)
                ├── Flour Mills Retailer 1 (retailer)
                ├── Flour Mills Retailer 2
                ├── Flour Mills Retailer 3
                ├── Flour Mills Retailer 4
                └── Flour Mills Retailer 5

Idempotent — safe to re-run. All operations match by `organization_name` +
`organization_type` so a re-run is a no-op.

This script ONLY:
  - creates organizations in the `organizations` collection
  - mirrors them into legacy `manufacturers` / `distributors` / `retailers`
    so dashboard code (which still reads those collections) keeps working
  - creates 5 test users (one per tier) with bcrypt password hashes

It does NOT seed products / inventory / orders for Flour Mills.
"""
from __future__ import annotations

import asyncio
from typing import Dict, List

import bcrypt

from core import db, logger, new_id, now_iso

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
TYPE_PREFIX = {
    "manufacturer": "MFR", "warehouse": "WHR", "distributor": "DST",
    "wholesaler": "WHO", "retailer": "RTL", "logistics_provider": "LOG",
}


async def _next_code(org_type: str) -> str:
    """Same generator as `routes/organizations._next_org_code` so admin-driven
    creates never collide with seed codes."""
    key = f"org_seq_{org_type}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = int((doc or {}).get("seq", 1))
    return f"{TYPE_PREFIX[org_type]}-{seq:04d}"


async def _upsert_org(*, kind: str, name: str, parent_id: str | None,
                      region: str, city: str | None = None) -> Dict:
    """Idempotent — match on (organization_type, organization_name).

    Self-healing: if a matching org exists but its parent_organization_id
    drifted (e.g. an earlier non-tenant-aware migration moved it), reset
    it to the expected parent.
    """
    existing = await db.organizations.find_one(
        {"organization_type": kind, "organization_name": name}, {"_id": 0},
    )
    if existing:
        if existing.get("parent_organization_id") != parent_id:
            await db.organizations.update_one(
                {"id": existing["id"]},
                {"$set": {"parent_organization_id": parent_id,
                          "updated_at": now_iso()}},
            )
            existing["parent_organization_id"] = parent_id
        return existing
    doc = {
        "id": new_id(),
        "organization_code": await _next_code(kind),
        "organization_name": name,
        "organization_type": kind,
        "parent_organization_id": parent_id,
        "status": "active",
        "region": region,
        "state": None,
        "city": city,
        "address": None,
        "contact_email": None,
        "contact_phone": None,
        "contact_name": None,
        "metadata": {"seeded_by": "seed_flour_mills_tenant"},
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.organizations.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def _upsert_user(*, email: str, name: str, role: str, entity_id: str,
                       manufacturer_id: str, password: str) -> Dict:
    """Idempotent user upsert keyed on email."""
    existing = await db.users.find_one({"email": email})
    payload = {
        "id": (existing or {}).get("id") or new_id(),
        "email": email,
        "name": name,
        "role": role,
        "entity_type": role,
        "entity_id": entity_id,
        "manufacturer_id": manufacturer_id,
        "password_hash": _hash(password),
        "status": "active",
        "created_at": (existing or {}).get("created_at", now_iso()),
        "updated_at": now_iso(),
    }
    if existing:
        await db.users.update_one({"id": existing["id"]}, {"$set": payload})
    else:
        await db.users.insert_one(payload)
    payload.pop("password_hash", None)
    return payload


async def _mirror_legacy(*, org: Dict, kind: str, extra: Dict | None = None) -> None:
    """Mirror a tenant org into the legacy `manufacturers`/`distributors`/
    `retailers` collection. The auth/dashboard layer still resolves entities
    from these legacy collections; this keeps them in sync for the new tenant.
    Idempotent — matches on id.
    """
    coll_by_kind = {
        "manufacturer": "manufacturers",
        "distributor":  "distributors",
        "retailer":     "retailers",
    }
    coll = coll_by_kind.get(kind)
    if not coll:
        return  # warehouse + wholesaler don't have legacy collections
    doc = {
        "id": org["id"],
        "name": org["organization_name"],
        "code": org.get("organization_code"),
        "region": org.get("region"),
        "city": org.get("city"),
        "status": "active",
        "organization_id": org["id"],
        "created_at": org.get("created_at", now_iso()),
    }
    if extra:
        doc.update(extra)
    await db[coll].update_one({"id": org["id"]}, {"$set": doc}, upsert=True)


# ---------------------------------------------------------------------------
# Main seed
# ---------------------------------------------------------------------------
async def run() -> Dict:
    summary: Dict = {"created": {}, "users": []}

    # ---- 1. Manufacturer ---------------------------------------------------
    mfr = await _upsert_org(
        kind="manufacturer", name="Flour Mills Nigeria",
        parent_id=None, region="Lagos", city="Lagos",
    )
    await _mirror_legacy(org=mfr, kind="manufacturer")
    summary["created"]["manufacturer"] = {
        "id": mfr["id"], "code": mfr["organization_code"],
        "name": mfr["organization_name"],
    }

    # ---- 2. Warehouse ------------------------------------------------------
    wh = await _upsert_org(
        kind="warehouse", name="Flour Mills Lagos Warehouse",
        parent_id=mfr["id"], region="Lagos", city="Apapa",
    )
    summary["created"]["warehouse"] = {
        "id": wh["id"], "code": wh["organization_code"],
        "name": wh["organization_name"],
    }

    # ---- 3. Distributor ----------------------------------------------------
    dist = await _upsert_org(
        kind="distributor", name="Prime Distribution Services Ltd",
        parent_id=wh["id"], region="Lagos", city="Lagos",
    )
    await _mirror_legacy(org=dist, kind="distributor",
                         extra={"manufacturer_id": mfr["id"]})
    summary["created"]["distributor"] = {
        "id": dist["id"], "code": dist["organization_code"],
        "name": dist["organization_name"],
    }

    # ---- 4. Wholesaler -----------------------------------------------------
    whs = await _upsert_org(
        kind="wholesaler", name="Lagos Wholesale Hub",
        parent_id=dist["id"], region="Lagos", city="Lagos",
    )
    summary["created"]["wholesaler"] = {
        "id": whs["id"], "code": whs["organization_code"],
        "name": whs["organization_name"],
    }

    # ---- 5. Retailers ------------------------------------------------------
    retailers: List[Dict] = []
    for i in range(1, 6):
        r = await _upsert_org(
            kind="retailer", name=f"Flour Mills Retailer {i}",
            parent_id=whs["id"], region="Lagos", city="Lagos",
        )
        await _mirror_legacy(org=r, kind="retailer",
                             extra={"distributor_id": dist["id"],
                                    "manufacturer_id": mfr["id"]})
        retailers.append(r)
    summary["created"]["retailers"] = [
        {"id": r["id"], "code": r["organization_code"], "name": r["organization_name"]}
        for r in retailers
    ]

    # ---- 6. Test users -----------------------------------------------------
    PWD = "FlourMills2026!"
    users_spec = [
        ("flour.admin@tradekonekt.io",       "Flour Mills Admin",            "manufacturer", mfr["id"]),
        ("flour.warehouse@tradekonekt.io",   "Flour Mills Warehouse Mgr",    "warehouse",    wh["id"]),
        ("prime.distributor@tradekonekt.io", "Prime Distribution Admin",     "distributor",  dist["id"]),
        ("lagos.wholesaler@tradekonekt.io",  "Lagos Wholesale Admin",        "wholesaler",   whs["id"]),
        ("flour.retailer1@tradekonekt.io",   "Flour Mills Retailer 1 User",  "retailer",     retailers[0]["id"]),
    ]
    for email, name, role, eid in users_spec:
        u = await _upsert_user(
            email=email, name=name, role=role,
            entity_id=eid, manufacturer_id=mfr["id"], password=PWD,
        )
        summary["users"].append({
            "email": u["email"], "role": u["role"],
            "entity_id": u["entity_id"], "name": u["name"],
        })

    summary["password"] = PWD
    logger.info("Flour Mills tenant seeded: %s", {
        "mfr": mfr["organization_code"],
        "warehouse": wh["organization_code"],
        "distributor": dist["organization_code"],
        "wholesaler": whs["organization_code"],
        "retailers": [r["organization_code"] for r in retailers],
        "users": len(summary["users"]),
    })
    return summary


if __name__ == "__main__":
    import json
    print(json.dumps(asyncio.run(run()), indent=2))
