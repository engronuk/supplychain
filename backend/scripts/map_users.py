"""Map a demo login user to every entity in the canonical hierarchy.

Per-tenant, this creates a login for each:
  - manufacturer  (1)
  - warehouse     (3)
  - distributor   (6)
  - wholesaler    (18)
  - retailer      (84 — 72 via wholesaler + 12 key-account)

→ 224 user records across both tenants (plus 1 super_admin).

Email pattern: ``<lowercased org code>@tradekonekt.io``
e.g. ``mfr-0001-wh-0001@tradekonekt.io`` → Unilever Lagos Warehouse manager.

The single-name accounts (unilever.warehouse@, unilever.distributor@, etc.)
created by ``scripts/rebuild.py`` are preserved.

Idempotent — safe to re-run; existing users are updated in place.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from passlib.hash import bcrypt  # noqa: E402

PASSWORD = "TradeKonekt2026!"
ROLE_BY_ORG_TYPE = {
    "manufacturer": "manufacturer",
    "warehouse":    "warehouse",
    "distributor":  "distributor",
    "wholesaler":   "wholesaler",
    "retailer":     "retailer",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def deterministic_id(email: str) -> str:
    import hashlib
    h = hashlib.md5(email.encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def hierarchy_refs(org: dict) -> dict:
    """Compute manufacturer_id / warehouse_id / distributor_id / wholesaler_id
    refs for the role-scoped auth checks."""
    md = org.get("metadata") or {}
    out: dict = {
        "organization_id": org["id"],
        "manufacturer_id": md.get("manufacturer_id") or (
            org["id"] if org.get("organization_type") == "manufacturer" else None
        ),
    }
    otype = org.get("organization_type")
    if otype == "warehouse":
        out["warehouse_id"] = org["id"]
    elif otype == "distributor":
        out["warehouse_id"] = md.get("warehouse_id")
        out["distributor_id"] = org["id"]
    elif otype == "wholesaler":
        out["warehouse_id"] = md.get("warehouse_id")
        out["distributor_id"] = md.get("distributor_id")
        out["wholesaler_id"] = org["id"]
    elif otype == "retailer":
        out["warehouse_id"] = md.get("warehouse_id")
        out["distributor_id"] = md.get("distributor_id")
        out["wholesaler_id"] = md.get("wholesaler_id")
        out["retailer_id"] = org["id"]
    return {k: v for k, v in out.items() if v is not None}


async def main() -> None:
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    pwd_hash = bcrypt.hash(PASSWORD)

    by_role_created = {r: 0 for r in ROLE_BY_ORG_TYPE.values()}
    by_role_updated = {r: 0 for r in ROLE_BY_ORG_TYPE.values()}

    async for org in db.organizations.find({}, {"_id": 0}):
        otype = org.get("organization_type")
        role = ROLE_BY_ORG_TYPE.get(otype)
        if not role:
            continue
        code = (org.get("organization_code") or "").strip().lower()
        if not code:
            continue
        email = f"{code}@tradekonekt.io"
        name = org.get("organization_name", code.upper())

        refs = hierarchy_refs(org)
        user_doc = {
            "id": deterministic_id(email),
            "email": email,
            "password_hash": pwd_hash,
            "role": role,
            "name": f"{name} Account",
            "entity_id": org["id"],
            "tenant_id": refs.get("manufacturer_id", ""),
            "status": "active",
            "failed_login_attempts": 0,
            "last_login": None,
            **refs,
        }

        existing = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
        if existing:
            await db.users.update_one(
                {"email": email},
                {"$set": {**user_doc, "id": existing["id"]}},
            )
            by_role_updated[role] += 1
        else:
            user_doc["created_at"] = now_iso()
            await db.users.insert_one(user_doc)
            by_role_created[role] += 1

    total_created = sum(by_role_created.values())
    total_updated = sum(by_role_updated.values())
    print(f"Created: {total_created}  ·  Updated: {total_updated}")
    print()
    print(f"  {'Role':<14}{'Created':>10}{'Updated':>10}")
    for r in by_role_created:
        print(f"  {r:<14}{by_role_created[r]:>10}{by_role_updated[r]:>10}")
    print()
    print(f"Total users in DB now: {await db.users.count_documents({})}")
    print("Default password for every account: TradeKonekt2026!")


if __name__ == "__main__":
    asyncio.run(main())
