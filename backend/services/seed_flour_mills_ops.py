"""Seed a 30-day operational history for the Flour Mills Nigeria tenant.

The FMN network seeder creates the entities; this seeder gives the tenant a
believable order + shipment history so the Shipment Command Center,
distributor performance and regional panels are populated immediately —
instead of waiting for the activity simulator to accumulate data.

Creates (all bulk-inserted, one-shot via the `fmn_ops_v1` seed_meta marker):
  • ~130 distributor_orders across the legacy lifecycle
    (delivered / dispatched / approved / pending / rejected)
  • matching shipments for the delivered + dispatched cohorts
    (status received / in_transit, with realistic transit times)
Also normalizes FMN batch docs: `manufactured_date` → `manufactured_at`
(the rest of the codebase reads `manufactured_at`).
"""
from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from core import db, logger, now_iso

SEED_MARKER_ID = "fmn_ops_v1"

# status → how many orders to create
ORDER_MIX = {
    "delivered": 80,
    "dispatched": 12,
    "approved": 15,
    "pending": 15,
    "rejected": 8,
}
HISTORY_DAYS = 30


async def run() -> Dict:
    if await db.seed_meta.find_one({"id": SEED_MARKER_ID}, {"_id": 1}):
        return {"skipped": "already seeded"}

    mfg = await db.organizations.find_one(
        {"organization_name": "Flour Mills Nigeria", "organization_type": "manufacturer"},
        {"_id": 0, "id": 1},
    )
    if not mfg:
        return {"skipped": "Flour Mills tenant not seeded yet"}
    mfg_id = mfg["id"]

    # Normalize legacy FMN batch field naming (manufactured_date → manufactured_at).
    renamed = await db.batches.update_many(
        {"manufactured_date": {"$exists": True}, "manufactured_at": {"$exists": False}},
        {"$rename": {"manufactured_date": "manufactured_at"}},
    )

    products = await db.products.find(
        {"manufacturer_id": mfg_id}, {"_id": 0, "id": 1, "unit_price": 1},
    ).to_list(50)
    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(500)
    if not products or not distributors:
        return {"skipped": "FMN products/distributors not seeded yet"}

    rng = random.Random(20260613)
    now = datetime.now(timezone.utc)

    orders: List[Dict] = []
    shipments: List[Dict] = []
    seq = 0

    for status, count in ORDER_MIX.items():
        for _ in range(count):
            seq += 1
            dist = rng.choice(distributors)
            items = [
                {"product_id": p["id"], "quantity": rng.randint(60, 400)}
                for p in rng.sample(products, rng.randint(1, 3))
            ]
            created = now - timedelta(
                days=rng.uniform(0 if status in ("pending",) else 2, HISTORY_DAYS),
                hours=rng.uniform(0, 12),
            )
            order_id = str(uuid.uuid4())
            order = {
                "id": order_id,
                "manufacturer_id": mfg_id,
                "distributor_id": dist["id"],
                "items": items,
                "note": "",
                "status": status,
                "created_at": created.isoformat(),
                "approved_at": None,
                "rejected_at": None,
                "dispatched_at": None,
                "delivered_at": None,
                "shipment_id": None,
                "rejection_reason": None,
                "organization_id": dist["id"],
                "seeded_by": "seed_flour_mills_ops",
            }

            if status == "rejected":
                order["rejected_at"] = (created + timedelta(hours=rng.uniform(2, 36))).isoformat()
                order["rejection_reason"] = rng.choice([
                    "Credit limit exceeded", "Duplicate order",
                    "Region temporarily out of coverage", "Pricing dispute",
                ])
            elif status != "pending":
                approved = created + timedelta(hours=rng.uniform(2, 30))
                order["approved_at"] = approved.isoformat()
                if status in ("dispatched", "delivered"):
                    dispatched = approved + timedelta(hours=rng.uniform(6, 48))
                    order["dispatched_at"] = dispatched.isoformat()
                    ship_id = str(uuid.uuid4())
                    order["shipment_id"] = ship_id
                    shipment = {
                        "id": ship_id,
                        "from_role": "manufacturer",
                        "from_id": mfg_id,
                        "to_role": "distributor",
                        "to_id": dist["id"],
                        "manufacturer_id": mfg_id,
                        "distributor_id": dist["id"],
                        "retailer_id": None,
                        "items": items,
                        "status": "in_transit",
                        "tracking_code": f"FMN-{seq:05d}",
                        "notes": "",
                        "created_at": approved.isoformat(),
                        "dispatched_at": dispatched.isoformat(),
                        "received_at": None,
                        "request_id": None,
                        "organization_id": mfg_id,
                        "seeded_by": "seed_flour_mills_ops",
                    }
                    if status == "delivered":
                        received = dispatched + timedelta(days=rng.uniform(1, 4))
                        order["delivered_at"] = received.isoformat()
                        shipment["status"] = "received"
                        shipment["received_at"] = received.isoformat()
                    shipments.append(shipment)
            orders.append(order)

    if orders:
        await db.distributor_orders.insert_many(orders)
    if shipments:
        await db.shipments.insert_many(shipments)

    summary = {
        "orders": len(orders),
        "shipments": len(shipments),
        "batches_renamed": renamed.modified_count,
        "seeded_at": now_iso(),
    }
    await db.seed_meta.update_one(
        {"id": SEED_MARKER_ID},
        {"$set": {"id": SEED_MARKER_ID, **summary}},
        upsert=True,
    )
    logger.info("Flour Mills ops history seeded: %s", summary)
    return summary


if __name__ == "__main__":
    import json
    print(json.dumps(asyncio.run(run()), indent=2))
