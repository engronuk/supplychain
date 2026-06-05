"""Seed sample distributor → manufacturer purchase orders for the demo.

Idempotent: only inserts if the collection is empty. Creates a balanced mix
of pending / approved / dispatched / delivered / rejected so every column of
the Manufacturer's order-fulfillment workspace has real data to render.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone

from core import db, now_iso


async def seed_distributor_orders() -> dict:
    existing = await db.distributor_orders.count_documents({})
    if existing:
        return {"skipped": True, "existing": existing}

    distributors = await db.distributors.find({}, {"_id": 0, "id": 1, "manufacturer_id": 1}).to_list(None)
    if not distributors:
        return {"created": 0, "skipped": "no_distributors"}
    products_by_mfg: dict[str, list[dict]] = {}
    async for p in db.products.find({}, {"_id": 0, "id": 1, "manufacturer_id": 1, "unit_price": 1}):
        products_by_mfg.setdefault(p["manufacturer_id"], []).append(p)

    rng = random.Random(20260605)
    now = datetime.now(timezone.utc)
    created = 0

    # Place ~25 orders per manufacturer's distributor network. Spread them
    # across the last 14 days so the demo timeline looks alive.
    for d in distributors[:30]:
        prods = products_by_mfg.get(d["manufacturer_id"], [])
        if not prods:
            continue
        # 1-3 orders per distributor
        for _ in range(rng.randint(1, 3)):
            n_skus = rng.randint(1, 4)
            chosen = rng.sample(prods, k=min(n_skus, len(prods)))
            items = [{"product_id": p["id"], "quantity": rng.choice([10, 25, 50, 100])}
                     for p in chosen]
            age_days = rng.uniform(0.1, 14)
            created_at = (now - timedelta(days=age_days)).isoformat()

            # Choose status weighted to make every column populated.
            roll = rng.random()
            if roll < 0.30:
                status, approved_at, dispatched_at, delivered_at, rejected_at, ship_id = (
                    "pending", None, None, None, None, None,
                )
            elif roll < 0.50:
                approved_at = (now - timedelta(days=age_days * 0.6)).isoformat()
                status = "approved"
                dispatched_at = delivered_at = rejected_at = ship_id = None
            elif roll < 0.75:
                approved_at = (now - timedelta(days=age_days * 0.6)).isoformat()
                dispatched_at = (now - timedelta(days=age_days * 0.3)).isoformat()
                status = "dispatched"
                delivered_at = rejected_at = None
                ship_id = str(uuid.uuid4())
            elif roll < 0.90:
                approved_at = (now - timedelta(days=age_days * 0.7)).isoformat()
                dispatched_at = (now - timedelta(days=age_days * 0.4)).isoformat()
                delivered_at = (now - timedelta(days=age_days * 0.1)).isoformat()
                status = "delivered"
                rejected_at = None
                ship_id = str(uuid.uuid4())
            else:
                status = "rejected"
                approved_at = dispatched_at = delivered_at = ship_id = None
                rejected_at = (now - timedelta(days=age_days * 0.4)).isoformat()

            order = {
                "id": str(uuid.uuid4()),
                "manufacturer_id": d["manufacturer_id"],
                "distributor_id": d["id"],
                "items": items,
                "note": rng.choice([
                    None, None,
                    "Weekend rush prep — please prioritize.",
                    "Quarterly restock for South-East retailers.",
                    "Need fast-mover SKUs by end of week.",
                    "Top up before promotional push.",
                ]),
                "status": status,
                "created_at": created_at,
                "approved_at": approved_at,
                "rejected_at": rejected_at,
                "dispatched_at": dispatched_at,
                "delivered_at": delivered_at,
                "shipment_id": ship_id,
                "rejection_reason": (
                    rng.choice([
                        "Inventory unavailable for one or more SKUs.",
                        "Distributor allocation reached for the month.",
                    ]) if status == "rejected" else None
                ),
            }
            await db.distributor_orders.insert_one(order)
            created += 1

    return {"created": created, "skipped": False}
