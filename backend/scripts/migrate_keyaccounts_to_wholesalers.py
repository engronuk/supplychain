"""Strict ownership hierarchy migration.

Per the canonical chain (Manufacturer → Warehouse → Distributor → Wholesaler → Retailer)
every Retailer MUST have a Wholesaler as its parent. Some "key-account" retailers
(Shoprite, Spar, Game, MarketSquare, …) were seeded as direct children of distributors
to enable distributor-direct selling. That conflates *ownership* with *transaction flow*.

This script:
  1. Finds all retailers whose `parent_organization_id` resolves to a distributor.
  2. Re-parents each under a wholesaler of that same distributor (region-matched when
     possible, else the largest wholesaler by retailer count).
  3. Rewrites `lineage_path` and metadata fields (`wholesaler_id`, and a new
     `preferred_supplier_type='distributor'` so the transaction-flow flexibility is
     preserved while ownership is strict).
  4. Prints a final validation report.
"""
import asyncio
import os
import sys
from collections import defaultdict
from pathlib import Path

# Load env from backend/.env
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main() -> int:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    # 1. Locate offending retailers (parent = distributor).
    pipe = [
        {"$match": {"organization_type": "retailer"}},
        {"$lookup": {
            "from": "organizations",
            "localField": "parent_organization_id",
            "foreignField": "id",
            "as": "_parent",
        }},
        {"$unwind": "$_parent"},
        {"$match": {"_parent.organization_type": "distributor"}},
    ]
    bad = await db.organizations.aggregate(pipe).to_list(10000)
    print(f"Found {len(bad)} retailers parented under distributors — re-parenting…")

    if not bad:
        print("Nothing to migrate — printing hierarchy validation report.")
        return await print_hierarchy_report(db)

    # 2. Index wholesalers by distributor → region.
    wholesalers = await db.organizations.find(
        {"organization_type": "wholesaler"},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_code": 1,
         "parent_organization_id": 1, "region": 1, "lineage_path": 1},
    ).to_list(2000)
    ws_by_dist: dict[str, list[dict]] = defaultdict(list)
    for w in wholesalers:
        ws_by_dist[w["parent_organization_id"]].append(w)

    # Retailer counts under each wholesaler (used for "largest wholesaler" fallback).
    rt_counts_pipe = [
        {"$match": {"organization_type": "retailer"}},
        {"$group": {"_id": "$parent_organization_id", "n": {"$sum": 1}}},
    ]
    rt_counts = {r["_id"]: r["n"] async for r in db.organizations.aggregate(rt_counts_pipe)}

    # 3. Re-parent each retailer.
    updated = 0
    no_wholesaler = 0
    for r in bad:
        dist = r["_parent"]
        candidates = ws_by_dist.get(dist["id"], [])
        if not candidates:
            print(f"  ! No wholesaler under {dist['organization_code']} for {r['organization_code']} — leaving in place.")
            no_wholesaler += 1
            continue

        # Region-match first, else largest by retailer count.
        region = r.get("region")
        ranked = sorted(
            candidates,
            key=lambda w: (
                0 if w.get("region") == region else 1,
                -rt_counts.get(w["id"], 0),
                w.get("organization_code", ""),
            ),
        )
        chosen = ranked[0]

        new_lineage = f"{chosen['lineage_path']}/{r['organization_code']}"
        meta = r.get("metadata") or {}
        meta.update({
            "wholesaler_id": chosen["id"],
            "distributor_id": dist["id"],         # operational distributor for direct-sell
            "previous_parent_distributor_id": dist["id"],
            "preferred_supplier_type": "distributor",  # transaction flow flexibility
            "channel": meta.get("channel") or "key_account",
        })

        await db.organizations.update_one(
            {"id": r["id"]},
            {"$set": {
                "parent_organization_id": chosen["id"],
                "lineage_path": new_lineage,
                "metadata": meta,
            }},
        )
        updated += 1

    # 4. Validation report.
    print()
    print("=" * 72)
    print("MIGRATION RESULT")
    print("=" * 72)
    print(f"Retailers re-parented under wholesalers : {updated}")
    print(f"Retailers left in place (no wholesaler) : {no_wholesaler}")
    print()
    return await print_hierarchy_report(db)


async def print_hierarchy_report(db) -> int:
    print("=" * 72)
    print("HIERARCHY VALIDATION REPORT")
    print("=" * 72)

    async def parent_type_breakdown(child_type: str) -> dict[str, int]:
        pipe = [
            {"$match": {"organization_type": child_type}},
            {"$lookup": {"from": "organizations", "localField": "parent_organization_id",
                         "foreignField": "id", "as": "p"}},
            {"$unwind": {"path": "$p", "preserveNullAndEmptyArrays": True}},
            {"$group": {"_id": "$p.organization_type", "n": {"$sum": 1}}},
        ]
        return {(r["_id"] or "<root>"): r["n"] async for r in db.organizations.aggregate(pipe)}

    rules = [
        ("retailer",    "wholesaler",   "Retailers under wholesalers"),
        ("wholesaler",  "distributor",  "Wholesalers under distributors"),
        ("distributor", "warehouse",    "Distributors under warehouses"),
        ("warehouse",   "manufacturer", "Warehouses under manufacturers"),
    ]
    forbidden = [
        ("retailer",    "distributor",  "Retailers under distributors"),
        ("retailer",    "warehouse",    "Retailers under warehouses"),
        ("retailer",    "manufacturer", "Retailers under manufacturers"),
        ("wholesaler",  "warehouse",    "Wholesalers under warehouses"),
        ("wholesaler",  "manufacturer", "Wholesalers under manufacturers"),
        ("distributor", "manufacturer", "Distributors under manufacturers"),
    ]

    fails = 0
    print()
    print("Allowed direct relationships:")
    for child, parent, label in rules:
        bd = await parent_type_breakdown(child)
        n = bd.get(parent, 0)
        print(f"  OK  {label:48s} : {n}")

    print()
    print("Forbidden direct relationships (must all be 0):")
    for child, parent, label in forbidden:
        bd = await parent_type_breakdown(child)
        n = bd.get(parent, 0)
        flag = "OK " if n == 0 else "BAD"
        if n != 0:
            fails += 1
        print(f"  {flag} {label:48s} : {n}")

    print()
    # Per-tenant counts
    print("Per-tenant tier counts:")
    pipe = [
        {"$group": {"_id": {"t": "$organization_type", "m": "$metadata.manufacturer_id"},
                    "n": {"$sum": 1}}},
    ]
    out: dict[str, dict[str, int]] = defaultdict(dict)
    async for r in db.organizations.aggregate(pipe):
        key = r["_id"] or {}
        mid = key.get("m") or "<unowned>"
        t = key.get("t") or "<unknown>"
        out[mid][t] = r["n"]
    for mid, tiers in out.items():
        mfr = await db.organizations.find_one({"id": mid}, {"_id": 0, "organization_name": 1, "organization_code": 1})
        label = (mfr or {}).get("organization_code", mid)
        print(f"  {label:24s}  warehouses={tiers.get('warehouse', 0)} "
              f"distributors={tiers.get('distributor', 0)} "
              f"wholesalers={tiers.get('wholesaler', 0)} "
              f"retailers={tiers.get('retailer', 0)}")

    print()
    print("=" * 72)
    if fails:
        print(f"FAIL — {fails} forbidden relationship(s) still present.")
        return 2
    print("PASS — strict ownership hierarchy verified.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
