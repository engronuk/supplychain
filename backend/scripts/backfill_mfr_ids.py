"""Backfill `manufacturer_id` on shipments + vehicles where the simulator
forgot to set it.

The factory→warehouse and warehouse→distributor legs always carry
manufacturer_id (set explicitly by the simulator). But the
distributor→wholesaler / distributor→retailer / wholesaler→retailer
legs were minted without it — which caused those trucks to vanish
from the manufacturer-scoped Control Tower map.

This script:
1.  Walks every orphaned shipment (no manufacturer_id) and infers it
    from `from_id` (distributor → tier table or org parent chain).
2.  Then walks every orphaned vehicle, copies the manufacturer_id from
    its referenced shipment.
3.  Is fully idempotent — re-running is a no-op.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from dotenv import load_dotenv  # noqa: E402
load_dotenv()

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


async def _mfr_for(db, role: str, _id: str) -> str | None:
    if not _id:
        return None
    if role == "distributor":
        d = await db.distributors.find_one({"id": _id}, {"_id": 0, "manufacturer_id": 1})
        return d.get("manufacturer_id") if d else None
    if role == "wholesaler":
        # Wholesalers reach manufacturer via their distributor parent.
        org = await db.organizations.find_one(
            {"id": _id}, {"_id": 0, "parent_organization_id": 1})
        parent = org and org.get("parent_organization_id")
        if not parent:
            return None
        d = await db.distributors.find_one({"id": parent}, {"_id": 0, "manufacturer_id": 1})
        if d:
            return d.get("manufacturer_id")
        # Parent might itself be an org chain — walk one more level.
        org2 = await db.organizations.find_one(
            {"id": parent}, {"_id": 0, "parent_organization_id": 1})
        return org2.get("parent_organization_id") if org2 else None
    if role == "warehouse":
        org = await db.organizations.find_one(
            {"id": _id}, {"_id": 0, "parent_organization_id": 1})
        return org.get("parent_organization_id") if org else None
    if role == "manufacturer":
        return _id
    return None


async def backfill_manufacturer_ids(db=None) -> dict:
    if db is None:
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        owns_client = client
    else:
        owns_client = None

    stats = {"shipments_patched": 0, "vehicles_patched": 0,
             "shipments_skipped": 0, "vehicles_skipped": 0}

    # 1) Shipments
    async for s in db.shipments.find(
        {"manufacturer_id": None},
        {"_id": 0, "id": 1, "from_role": 1, "from_id": 1, "to_role": 1, "to_id": 1},
    ):
        mfr = await _mfr_for(db, s.get("from_role"), s.get("from_id"))
        if not mfr:
            mfr = await _mfr_for(db, s.get("to_role"), s.get("to_id"))
        if mfr:
            await db.shipments.update_one(
                {"id": s["id"]}, {"$set": {"manufacturer_id": mfr}})
            stats["shipments_patched"] += 1
        else:
            stats["shipments_skipped"] += 1

    # 2) Vehicles (copy from their now-patched referenced shipment)
    async for v in db.vehicles.find(
        {"manufacturer_id": None, "ref_type": "shipment"},
        {"_id": 0, "id": 1, "ref_id": 1},
    ):
        s = await db.shipments.find_one(
            {"id": v.get("ref_id")}, {"_id": 0, "manufacturer_id": 1})
        if s and s.get("manufacturer_id"):
            await db.vehicles.update_one(
                {"id": v["id"]}, {"$set": {"manufacturer_id": s["manufacturer_id"]}})
            stats["vehicles_patched"] += 1
        else:
            stats["vehicles_skipped"] += 1

    print(f"✓ shipments_patched={stats['shipments_patched']} "
          f"vehicles_patched={stats['vehicles_patched']} "
          f"(skipped: s={stats['shipments_skipped']} v={stats['vehicles_skipped']})")
    if owns_client is not None:
        owns_client.close()
    return stats


if __name__ == "__main__":
    asyncio.run(backfill_manufacturer_ids())
