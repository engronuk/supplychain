"""Build the Warehouse → Distributor → Wholesaler → Retailer regional topology.

Strategy
--------
1. Create one Warehouse per Nigerian region under the manufacturer (Unilever).
2. Reparent every existing distributor to its regional warehouse.
3. Create three Wholesalers per region (Hub A / B / C) and parent each one
   under a distributor in that region (round-robin).
4. Reparent every retailer to one of the three wholesalers in its region
   (round-robin so each wholesaler ends up with a similar share).

Idempotent. Re-running the script is a no-op once the topology is in place.

Run with:
    python3 -m services.migrate_regional_topology

(or hit the admin-only endpoint POST /api/admin/migrate-regional-topology)
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import List

from core import db, logger, new_id, now_iso

REGIONS = ["Lagos", "South West", "South East", "South South",
           "North Central", "North East", "North West"]

WAREHOUSE_CITY = {
    "Lagos":         "Lagos",
    "South West":    "Ibadan",
    "South East":    "Onitsha",
    "South South":   "Port Harcourt",
    "North Central": "Abuja",
    "North East":    "Bauchi",
    "North West":    "Kano",
}

WHOLESALER_HUBS = ["Hub A", "Hub B", "Hub C"]


async def _next_code(prefix: str) -> str:
    """Return the next `<prefix>-XXXX` code, kept in sync with the route-side
    `db.counters` collection so subsequent API-driven creates don't collide.
    """
    # Map prefix back to org type for the counter key.
    type_by_prefix = {
        "MFR": "manufacturer", "WHR": "warehouse", "DST": "distributor",
        "WHO": "wholesaler", "RTL": "retailer", "LOG": "logistics_provider",
    }
    org_type = type_by_prefix.get(prefix, prefix.lower())
    key = f"org_seq_{org_type}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    seq = int((doc or {}).get("seq", 1))
    return f"{prefix}-{seq:04d}"


async def _upsert_org(*, kind: str, name: str, prefix: str,
                      parent_id: str, region: str, city: str | None) -> dict:
    """Idempotent get-or-create. Match by (organization_type, organization_name,
    parent_organization_id)."""
    existing = await db.organizations.find_one({
        "organization_type": kind,
        "organization_name": name,
        "parent_organization_id": parent_id,
    }, {"_id": 0})
    if existing:
        return existing
    code = await _next_code(prefix)
    doc = {
        "id": new_id(),
        "organization_code": code,
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
        "metadata": {"seeded_by": "migrate_regional_topology"},
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.organizations.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def run() -> dict:
    manufacturer = await db.organizations.find_one(
        {"organization_type": "manufacturer"}, {"_id": 0},
    )
    if not manufacturer:
        raise RuntimeError("No manufacturer found — seed Unilever first.")
    mfr_id = manufacturer["id"]
    logger.info("Manufacturer root: %s (%s)", manufacturer["organization_name"], mfr_id)

    summary = {
        "warehouses": {},
        "distributors_reparented": 0,
        "wholesalers": {},
        "retailers_reparented": 0,
    }

    # ---------- 1. Warehouses ----------
    region_to_warehouse: dict[str, str] = {}
    for region in REGIONS:
        wh = await _upsert_org(
            kind="warehouse",
            name=f"Unilever {region} Warehouse",
            prefix="WHR",
            parent_id=mfr_id,
            region=region,
            city=WAREHOUSE_CITY.get(region),
        )
        region_to_warehouse[region] = wh["id"]
        summary["warehouses"][region] = {"id": wh["id"], "code": wh["organization_code"]}

    # ---------- 2. Reparent distributors → regional warehouse ----------
    distributors_by_region: dict[str, List[dict]] = defaultdict(list)
    async for d in db.organizations.find(
        {"organization_type": "distributor"}, {"_id": 0},
    ):
        distributors_by_region[d.get("region") or "Unassigned"].append(d)

    for region, dists in distributors_by_region.items():
        wh_id = region_to_warehouse.get(region)
        if not wh_id:
            logger.warning("Skipping %s distributors in region=%r (no warehouse)",
                           len(dists), region)
            continue
        # Sort for deterministic round-robin → wholesaler assignment downstream.
        dists.sort(key=lambda d: d["organization_code"])
        ids_to_move = [d["id"] for d in dists if d.get("parent_organization_id") != wh_id]
        if ids_to_move:
            r = await db.organizations.update_many(
                {"id": {"$in": ids_to_move}},
                {"$set": {"parent_organization_id": wh_id, "updated_at": now_iso()}},
            )
            summary["distributors_reparented"] += r.modified_count

    # ---------- 3. Wholesalers (3 per region, parented to distributors) ----------
    region_to_wholesalers: dict[str, List[str]] = {}
    for region in REGIONS:
        dists = sorted(distributors_by_region.get(region, []),
                       key=lambda d: d["organization_code"])
        if not dists:
            logger.info("No distributors in region=%r — skipping wholesalers", region)
            region_to_wholesalers[region] = []
            continue
        whs_ids: List[str] = []
        for i, hub in enumerate(WHOLESALER_HUBS):
            parent_dist = dists[i % len(dists)]
            wh = await _upsert_org(
                kind="wholesaler",
                name=f"{region} Wholesale {hub}",
                prefix="WHO",
                parent_id=parent_dist["id"],
                region=region,
                city=parent_dist.get("city"),
            )
            whs_ids.append(wh["id"])
            summary["wholesalers"].setdefault(region, []).append({
                "id": wh["id"], "code": wh["organization_code"],
                "parent_distributor_code": parent_dist["organization_code"],
            })
        region_to_wholesalers[region] = whs_ids

    # ---------- 4. Reparent retailers → regional wholesaler (round-robin) ----------
    retailers_by_region: dict[str, List[dict]] = defaultdict(list)
    async for r in db.organizations.find(
        {"organization_type": "retailer"},
        {"_id": 0, "id": 1, "region": 1, "organization_code": 1, "parent_organization_id": 1},
    ):
        retailers_by_region[r.get("region") or "Unassigned"].append(r)

    for region, retailers in retailers_by_region.items():
        whs_ids = region_to_wholesalers.get(region) or []
        if not whs_ids:
            logger.warning("Skipping %s retailers in region=%r (no wholesalers)",
                           len(retailers), region)
            continue
        retailers.sort(key=lambda r: r["organization_code"])
        # Round-robin so each hub gets a roughly equal share.
        buckets: dict[str, List[str]] = defaultdict(list)
        for idx, r in enumerate(retailers):
            target = whs_ids[idx % len(whs_ids)]
            if r.get("parent_organization_id") != target:
                buckets[target].append(r["id"])
        for target, ids in buckets.items():
            if ids:
                res = await db.organizations.update_many(
                    {"id": {"$in": ids}},
                    {"$set": {"parent_organization_id": target, "updated_at": now_iso()}},
                )
                summary["retailers_reparented"] += res.modified_count

    logger.info("Regional topology migration done: %s", summary)
    return summary


if __name__ == "__main__":
    print(asyncio.run(run()))
