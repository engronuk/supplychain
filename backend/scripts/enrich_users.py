"""Enrich the demo user records with hierarchy refs (manufacturer_id,
warehouse_id, distributor_id, wholesaler_id, organization_id) so the
role-scoped routes can resolve scope without 403'ing.

Idempotent — pulls the latest fields from the org tree each run.
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


async def main() -> None:
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    updated = 0
    async for u in db.users.find({"role": {"$ne": "super_admin"}}, {"_id": 0}):
        entity_id = u.get("entity_id")
        if not entity_id:
            continue
        org = await db.organizations.find_one({"id": entity_id}, {"_id": 0})
        if not org:
            continue
        md = org.get("metadata") or {}
        patch: dict = {
            "organization_id": entity_id,
            "manufacturer_id": md.get("manufacturer_id") or (entity_id if org.get("organization_type") == "manufacturer" else None),
        }
        if org.get("organization_type") == "warehouse":
            patch["warehouse_id"] = entity_id
        elif org.get("organization_type") == "distributor":
            patch["warehouse_id"] = md.get("warehouse_id")
            patch["distributor_id"] = entity_id
        elif org.get("organization_type") == "wholesaler":
            patch["warehouse_id"] = md.get("warehouse_id")
            patch["distributor_id"] = md.get("distributor_id")
            patch["wholesaler_id"] = entity_id
        elif org.get("organization_type") == "retailer":
            patch["warehouse_id"] = md.get("warehouse_id")
            patch["distributor_id"] = md.get("distributor_id")
            patch["wholesaler_id"] = md.get("wholesaler_id")
            patch["retailer_id"] = entity_id
        # Clean nulls so we don't overwrite valid existing values with None.
        patch = {k: v for k, v in patch.items() if v is not None}
        if patch:
            await db.users.update_one({"id": u["id"]}, {"$set": patch})
            updated += 1
    print(f"Updated {updated} users with hierarchy refs.")


if __name__ == "__main__":
    asyncio.run(main())
