"""Repair script — bring the order/shipment data into strict-tier compliance.

Fixes identified by `audit_supply_chain.py`:

  1. distributor_orders with NULL warehouse_id → backfill with the distributor's
     parent warehouse (the next tier up).
  2. wholesaler_purchase_orders where supplier_type is 'manufacturer' or
     'warehouse' (skip-tier procurement) → re-route to the wholesaler's parent
     distributor.
  3. shipments routed warehouse→retailer or warehouse→wholesaler (skip-tier
     ownership) → re-route to the distributor that owns the destination.
"""
import asyncio
import os
import sys
from pathlib import Path
from collections import Counter

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def main() -> int:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    orgs = {o["id"]: o async for o in db.organizations.find(
        {}, {"_id": 0, "id": 1, "organization_type": 1,
             "parent_organization_id": 1, "organization_name": 1})}

    def parent(oid):
        return orgs.get((orgs.get(oid) or {}).get("parent_organization_id") or "")

    print("=" * 72)
    print("REPAIR — strict-tier compliance")
    print("=" * 72)

    # 1. Backfill warehouse_id on distributor_orders
    print()
    print("1) Backfilling warehouse_id on distributor_orders…")
    n_fixed = 0
    n_skipped = 0
    async for d_ord in db.distributor_orders.find(
        {"warehouse_id": {"$in": [None, ""]}},
        {"_id": 0, "id": 1, "distributor_id": 1, "manufacturer_id": 1},
    ):
        d = orgs.get(d_ord.get("distributor_id") or "")
        if not d or d.get("organization_type") != "distributor":
            n_skipped += 1
            continue
        wh = parent(d_ord.get("distributor_id"))
        if wh and wh.get("organization_type") == "warehouse":
            await db.distributor_orders.update_one(
                {"id": d_ord["id"]},
                {"$set": {"warehouse_id": wh["id"]}},
            )
            n_fixed += 1
        else:
            n_skipped += 1
    print(f"   fixed: {n_fixed} · skipped (no parent warehouse): {n_skipped}")

    # 2. Re-route wholesaler_purchase_orders skipping distributor tier
    print()
    print("2) Re-routing wholesaler_purchase_orders that skip distributor tier…")
    n_rerouted = 0
    reasons = Counter()
    async for wp in db.wholesaler_purchase_orders.find(
        {"supplier_type": {"$in": ["manufacturer", "warehouse"]}},
        {"_id": 0, "id": 1, "wholesaler_id": 1, "supplier_type": 1, "supplier_id": 1},
    ):
        w = orgs.get(wp.get("wholesaler_id") or "")
        if not w or w.get("organization_type") != "wholesaler":
            reasons[f"wholesaler_id invalid: {wp.get('wholesaler_id')}"] += 1
            continue
        dist_id = w.get("parent_organization_id")
        dist = orgs.get(dist_id or "")
        if not dist or dist.get("organization_type") != "distributor":
            reasons["no distributor parent"] += 1
            continue
        await db.wholesaler_purchase_orders.update_one(
            {"id": wp["id"]},
            {"$set": {
                "supplier_id": dist_id,
                "supplier_type": "distributor",
                "supplier_name": dist.get("organization_name"),
                "_legacy_supplier_type": wp.get("supplier_type"),
                "_legacy_supplier_id": wp.get("supplier_id"),
            }},
        )
        n_rerouted += 1
    print(f"   re-routed: {n_rerouted}")
    for r, n in reasons.items():
        print(f"   skipped: {n} ({r})")

    # 3. Re-route illegal shipments (warehouse → retailer / warehouse → wholesaler)
    print()
    print("3) Re-routing illegal shipments (warehouse skipping tiers)…")
    n_rerouted = 0
    n_dropped = 0
    fixed_routes = Counter()
    async for s in db.shipments.find(
        {"from_role": "warehouse", "to_role": {"$in": ["retailer", "wholesaler"]}},
        {"_id": 0, "id": 1, "to_role": 1, "to_id": 1, "from_id": 1},
    ):
        dest = orgs.get(s.get("to_id") or "")
        if not dest:
            n_dropped += 1
            continue
        # Walk up: retailer → wholesaler → distributor; wholesaler → distributor.
        if dest.get("organization_type") == "retailer":
            ws_org = orgs.get(dest.get("parent_organization_id") or "")
            if ws_org and ws_org.get("organization_type") == "wholesaler":
                dist_org = orgs.get(ws_org.get("parent_organization_id") or "")
            else:
                dist_org = None
        elif dest.get("organization_type") == "wholesaler":
            dist_org = orgs.get(dest.get("parent_organization_id") or "")
        else:
            dist_org = None
        if not dist_org or dist_org.get("organization_type") != "distributor":
            n_dropped += 1
            continue
        await db.shipments.update_one(
            {"id": s["id"]},
            {"$set": {
                "to_role": "distributor",
                "to_id": dist_org["id"],
                "_legacy_to_role": s["to_role"],
                "_legacy_to_id": s["to_id"],
            }},
        )
        fixed_routes[(s["to_role"], "distributor")] += 1
        n_rerouted += 1
    print(f"   re-routed: {n_rerouted} · dropped: {n_dropped}")
    for (was, now), n in fixed_routes.items():
        print(f"   warehouse→{was}  ⇒  warehouse→{now}: {n}")

    print()
    print("=" * 72)
    print("DONE — re-run `python -m scripts.audit_supply_chain` to verify.")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
