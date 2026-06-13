"""Tiny audit dump used during the canonical rebuild verification."""
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> None:
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    print("Tenant breakdown:")
    for mfg in await db.organizations.find(
        {"organization_type": "manufacturer"}, {"_id": 0}
    ).to_list(5):
        print(f"  {mfg['organization_name']} ({mfg['organization_code']}) — lineage: {mfg['lineage_path']}")
        wh = await db.organizations.find(
            {"organization_type": "warehouse", "parent_organization_id": mfg["id"]},
            {"_id": 0},
        ).to_list(10)
        for w in wh:
            print(f"    WH {w['organization_code']:18s} {w['organization_name']:35s} ({w['region']})")
            ds = await db.organizations.find(
                {"organization_type": "distributor", "parent_organization_id": w["id"]},
                {"_id": 0},
            ).to_list(10)
            for d in ds:
                ws = await db.organizations.count_documents(
                    {"organization_type": "wholesaler", "parent_organization_id": d["id"]}
                )
                rt_ka = await db.organizations.count_documents(
                    {"organization_type": "retailer", "parent_organization_id": d["id"]}
                )
                print(f"      DST {d['organization_code']:18s} {d['organization_name']:35s} {ws} WS · {rt_ka} key-account")

    print()
    print("Users (seeded demo accounts):")
    async for u in db.users.find({}, {"_id": 0, "email": 1, "role": 1, "entity_id": 1}):
        eid = u.get("entity_id", "-") or "-"
        print(f"  {u['email']:45s} role={u['role']:14s} entity={eid[:36]}")


if __name__ == "__main__":
    asyncio.run(main())
