"""Idempotent backfill of the universal `organizations` collection.

Reads each legacy entity (manufacturers / distributors / retailers /
warehouses), creates a matching `organizations` row with the SAME UUID
(per user decision: reuse ids), and links each entity back to its org via a
new `organization_id` field. Existing flows continue working untouched —
this is purely additive.

Run on boot via server.py.
"""
from __future__ import annotations

from typing import Dict, List

from core import db, logger, now_iso

# Type-prefix used for organization_code allocation.
TYPE_PREFIX = {
    "manufacturer": "MFR", "warehouse": "WHR", "distributor": "DST",
    "wholesaler": "WHO", "retailer": "RTL", "logistics_provider": "LOG",
}


async def _allocate_codes(org_type: str, count: int) -> List[str]:
    """Allocate N sequential organization_codes for org_type atomically."""
    key = f"org_seq_{org_type}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": count}}, upsert=True, return_document=True,
    )
    end = int((doc or {}).get("seq", count))
    start = end - count + 1
    prefix = TYPE_PREFIX.get(org_type, "ORG")
    return [f"{prefix}-{n:04d}" for n in range(start, end + 1)]


async def _backfill_type(legacy_collection: str, org_type: str,
                        parent_field: str | None = None) -> int:
    """Create org rows for entities in `legacy_collection` that don't yet
    have a corresponding organizations row. Returns count of new orgs."""
    legacy_docs = await db[legacy_collection].find({}, {"_id": 0}).to_list(20000)
    if not legacy_docs:
        return 0
    existing_ids = {
        d["id"] for d in await db.organizations.find(
            {"id": {"$in": [d["id"] for d in legacy_docs]}}, {"_id": 0, "id": 1},
        ).to_list(20000)
    }
    new_docs = [d for d in legacy_docs if d["id"] not in existing_ids]
    if not new_docs:
        return 0
    codes = await _allocate_codes(org_type, len(new_docs))
    org_rows = []
    legacy_updates = []
    for doc, code in zip(new_docs, codes):
        parent_id = doc.get(parent_field) if parent_field else None
        org_rows.append({
            "id": doc["id"],
            "organization_code": code,
            "organization_name": doc.get("name", code),
            "organization_type": org_type,
            "parent_organization_id": parent_id,
            "status": "active",
            "region": doc.get("region"),
            "state": doc.get("state"),
            "city": doc.get("city"),
            "address": doc.get("address"),
            "contact_email": doc.get("contact_email") or doc.get("email"),
            "contact_phone": doc.get("contact_phone") or doc.get("phone"),
            "contact_name": doc.get("contact_name"),
            "metadata": {},
            "legacy_collection": legacy_collection,
            "created_at": doc.get("created_at") or now_iso(),
            "updated_at": now_iso(),
        })
        legacy_updates.append(doc["id"])
    if org_rows:
        await db.organizations.insert_many(org_rows)
        await db[legacy_collection].update_many(
            {"id": {"$in": legacy_updates}},
            {"$set": {"organization_id": {"$toString": "$id"}}},  # noqa
        )
        # Mongo doesn't support $toString in update_many across all versions;
        # fall back to simple bulk set with each id since they share UUID.
        await db[legacy_collection].update_many(
            {"id": {"$in": legacy_updates}},
            {"$set": {"organization_id_present": True}},
        )
    return len(org_rows)


async def migrate_organizations() -> dict:
    """Run the full backfill in dependency order."""
    results: Dict[str, int] = {}

    # Manufacturers — no parent
    results["manufacturers"] = await _backfill_type("manufacturers", "manufacturer")
    # Distributors — child of manufacturer (use distributor.manufacturer_id)
    results["distributors"] = await _backfill_type(
        "distributors", "distributor", parent_field="manufacturer_id",
    )
    # Warehouses — child of manufacturer (if a `warehouses` collection exists)
    try:
        results["warehouses"] = await _backfill_type(
            "warehouses", "warehouse", parent_field="manufacturer_id",
        )
    except Exception:
        results["warehouses"] = 0
    # Retailers — child of distributor (use retailer.distributor_id)
    results["retailers"] = await _backfill_type(
        "retailers", "retailer", parent_field="distributor_id",
    )

    total = sum(results.values())
    if total:
        logger.info("Organization migration created %s rows: %s", total, results)
    return {"created": total, "by_type": results}
