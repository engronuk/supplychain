"""Backfill missing collections (inventory, notifications, requests, sample
shipments) for environments where master data exists but operational data
is empty — typical production state after deploying without a fresh seed.

All functions are idempotent — they only insert rows that don't already
exist. Safe to run repeatedly.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from core import db, logger, new_id, now_iso

# Per-product velocity baseline tuned to feel realistic for a small Nigerian
# retailer (units/day). Hot categories carry more weight.
HOT_CATEGORIES = {"Food", "Home Care"}


def _synth_inventory(
    *, product, retailer_seed: int
) -> Tuple[int, int, float]:
    """Deterministic per-(retailer,product) inventory tuple.

    Same retailer + same product → same numbers across calls. This guarantees
    that backfilling twice never duplicates rows (combined with the per-row
    existence check it gives full idempotency).
    """
    rng = random.Random(retailer_seed ^ hash(product["id"]) & 0x7FFFFFFF)
    base_qty = 30 + rng.randint(0, 170)            # 30-200 units
    reorder_level = 30
    base_velocity = 0.6 + rng.random() * 1.4       # 0.6-2.0
    if product.get("category") in HOT_CATEGORIES:
        base_velocity *= 1.6
    return base_qty, reorder_level, round(base_velocity, 2)


async def backfill_inventory(*, retailers_limit: int = 5000) -> dict:
    """Populate retailer + distributor inventory for any owner missing rows.

    Idempotent: looks up the existing (owner_type, owner_id, product_id) keys
    and inserts only the gaps. Manufacturers and distributors are seeded with
    larger quantities (network buffer), retailers with shop-floor quantities.
    """
    retailers_limit = max(1, min(int(retailers_limit), 20000))

    products = await db.products.find({}, {"_id": 0}).to_list(5000)
    if not products:
        return {"ok": False, "inserted": 0, "error": "no products — seed master data first"}

    manufacturers = await db.manufacturers.find({}, {"_id": 0, "id": 1}).to_list(50)
    distributors = await db.distributors.find({}, {"_id": 0, "id": 1}).sort("id", 1).to_list(20000)
    retailers = await db.retailers.find({}, {"_id": 0, "id": 1}).sort("id", 1)\
        .limit(retailers_limit).to_list(retailers_limit)

    # Existing keys, once
    existing: set = set()
    async for row in db.inventory.find({}, {"_id": 0, "owner_type": 1, "owner_id": 1, "product_id": 1}):
        existing.add((row["owner_type"], row["owner_id"], row["product_id"]))

    docs: List[dict] = []
    now = now_iso()

    # Manufacturer: 5k-10k buffer per product
    for m in manufacturers:
        for p in products:
            key = ("manufacturer", m["id"], p["id"])
            if key in existing:
                continue
            rng = random.Random(hash(key) & 0x7FFFFFFF)
            docs.append({
                "id": new_id(), "owner_type": "manufacturer", "owner_id": m["id"],
                "product_id": p["id"],
                "quantity": 5000 + rng.randint(0, 5000),
                "reorder_level": 1000, "velocity": 0.0, "updated_at": now,
            })

    # Distributor: 400-1000 per SKU
    for d in distributors:
        for p in products:
            key = ("distributor", d["id"], p["id"])
            if key in existing:
                continue
            rng = random.Random(hash(key) & 0x7FFFFFFF)
            docs.append({
                "id": new_id(), "owner_type": "distributor", "owner_id": d["id"],
                "product_id": p["id"],
                "quantity": 400 + rng.randint(0, 600),
                "reorder_level": 100, "velocity": 0.0, "updated_at": now,
            })

    # Retailers: per-product per-retailer deterministic
    for r in retailers:
        seed = hash(r["id"]) & 0x7FFFFFFF
        for p in products:
            key = ("retailer", r["id"], p["id"])
            if key in existing:
                continue
            qty, reorder, vel = _synth_inventory(product=p, retailer_seed=seed)
            docs.append({
                "id": new_id(), "owner_type": "retailer", "owner_id": r["id"],
                "product_id": p["id"], "quantity": qty,
                "reorder_level": reorder, "velocity": vel, "updated_at": now,
            })

    inserted = 0
    for i in range(0, len(docs), 5000):
        batch = docs[i:i + 5000]
        try:
            res = await db.inventory.insert_many(batch, ordered=False)
            inserted += len(res.inserted_ids)
        except Exception:
            logger.exception("inventory batch insert failed (continuing)")
    return {
        "ok": True, "inserted": inserted,
        "manufacturers": len(manufacturers),
        "distributors": len(distributors),
        "retailers": len(retailers),
        "products": len(products),
    }


async def backfill_notifications() -> dict:
    """Create a tiny set of welcome notifications when the collection is empty.

    Idempotent — only writes if zero notifications exist.
    """
    existing = await db.notifications.count_documents({})
    if existing > 0:
        return {"ok": True, "skipped": True, "reason": "notifications already present", "inserted": 0}

    manufacturers = await db.manufacturers.find({}, {"_id": 0}).to_list(50)
    distributors = await db.distributors.find({}, {"_id": 0}).sort("name", 1).limit(1).to_list(1)
    retailers = []
    if distributors:
        retailers = await db.retailers.find(
            {"distributor_id": distributors[0]["id"]}, {"_id": 0}
        ).sort("name", 1).limit(1).to_list(1)

    docs: List[dict] = []
    for m in manufacturers:
        docs.append({
            "id": new_id(), "target_type": "manufacturer", "target_id": m["id"],
            "title": "Welcome to TradeKonekt", "type": "system", "read": False,
            "message": f"{m['name']} workspace is ready.",
            "created_at": now_iso(),
        })
    for d in distributors:
        docs.append({
            "id": new_id(), "target_type": "distributor", "target_id": d["id"],
            "title": "Workspace Ready", "type": "system", "read": False,
            "message": f"{d['name']} is connected.", "created_at": now_iso(),
        })
    for r in retailers:
        docs.append({
            "id": new_id(), "target_type": "retailer", "target_id": r["id"],
            "title": "Workspace Ready", "type": "system", "read": False,
            "message": f"{r['name']} is connected.", "created_at": now_iso(),
        })
    if docs:
        await db.notifications.insert_many(docs)
    return {"ok": True, "inserted": len(docs)}


async def backfill_sample_requests() -> dict:
    """Create 1 pending stock request from the primary retailer if no requests exist."""
    if await db.requests.count_documents({}) > 0:
        return {"ok": True, "skipped": True, "reason": "requests already present", "inserted": 0}
    products = await db.products.find({}, {"_id": 0}).limit(3).to_list(3)
    distributors = await db.distributors.find({}, {"_id": 0}).sort("name", 1).limit(1).to_list(1)
    if not (products and distributors):
        return {"ok": True, "inserted": 0, "skipped": True, "reason": "missing master data"}
    d = distributors[0]
    r = await db.retailers.find_one(
        {"distributor_id": d["id"]}, {"_id": 0}, sort=[("name", 1)],
    )
    if not r:
        return {"ok": True, "inserted": 0, "skipped": True, "reason": "no retailer under primary distributor"}
    req = {
        "id": new_id(),
        "retailer_id": r["id"], "distributor_id": d["id"],
        "items": [
            {"product_id": products[0]["id"], "quantity": 40},
            {"product_id": products[1]["id"], "quantity": 25},
        ],
        "status": "pending",
        "note": "Backfilled sample request — weekend rush prep.",
        "created_at": now_iso(),
        "resolved_at": None,
    }
    await db.requests.insert_one(req)
    return {"ok": True, "inserted": 1}


async def backfill_sample_shipments() -> dict:
    """Create 6 sample shipments if shipments collection is empty.

    Mfg → first 3 distributors, dist → first 3 retailers under primary distributor.
    """
    if await db.shipments.count_documents({}) > 0:
        return {"ok": True, "skipped": True, "reason": "shipments already present", "inserted": 0}
    mfg = await db.manufacturers.find_one({}, {"_id": 0})
    products = await db.products.find({}, {"_id": 0}).limit(4).to_list(4)
    distributors = await db.distributors.find({}, {"_id": 0}).sort("name", 1).limit(3).to_list(3)
    if not (mfg and products and distributors):
        return {"ok": True, "inserted": 0, "skipped": True, "reason": "missing master data"}
    primary_d = distributors[0]
    retailers = await db.retailers.find(
        {"distributor_id": primary_d["id"]}, {"_id": 0}
    ).sort("name", 1).limit(3).to_list(3)

    now = datetime.now(timezone.utc)
    docs: List[dict] = []
    statuses = ["received", "in_transit", "pending"]
    for i, d in enumerate(distributors):
        status = statuses[i % 3]
        days_ago = (i + 1) * 3
        items = [{"product_id": products[(i + j) % len(products)]["id"], "quantity": 100 + i * 50}
                 for j in range(2)]
        docs.append(_shipment("manufacturer", mfg["id"], "distributor", d["id"],
                              items, status, now, days_ago, mfg_id=mfg["id"], distributor_id=d["id"]))
    for i, r in enumerate(retailers):
        status = statuses[i % 3]
        days_ago = (i + 1) * 2
        items = [{"product_id": products[(i + j) % len(products)]["id"], "quantity": 15 + i * 5}
                 for j in range(2)]
        docs.append(_shipment("distributor", primary_d["id"], "retailer", r["id"],
                              items, status, now, days_ago,
                              distributor_id=primary_d["id"], retailer_id=r["id"]))
    await db.shipments.insert_many(docs)
    return {"ok": True, "inserted": len(docs)}


def _shipment(from_role, from_id, to_role, to_id, items, status, now, days_ago,
              mfg_id="", distributor_id="", retailer_id=""):
    import uuid
    return {
        "id": new_id(),
        "from_role": from_role, "from_id": from_id,
        "to_role": to_role, "to_id": to_id,
        "manufacturer_id": mfg_id, "distributor_id": distributor_id, "retailer_id": retailer_id,
        "items": items, "status": status,
        "tracking_code": "SHP-" + uuid.uuid4().hex[:8].upper(),
        "notes": None,
        "created_at": (now - timedelta(days=days_ago)).isoformat(),
        "dispatched_at": (now - timedelta(days=max(days_ago - 1, 0))).isoformat()
            if status in ("in_transit", "received") else None,
        "received_at": (now - timedelta(days=max(days_ago - 2, 0))).isoformat()
            if status == "received" else None,
        "request_id": None,
    }


async def backfill_all(*, retailers_limit: int = 5000) -> dict:
    """Run every backfill in order. Idempotent end-to-end.

    Order matters: inventory must exist before shipments/sample requests so
    inventory rollups stay consistent.
    """
    inv = await backfill_inventory(retailers_limit=retailers_limit)
    notif = await backfill_notifications()
    reqs = await backfill_sample_requests()
    ships = await backfill_sample_shipments()
    return {
        "ok": True,
        "inventory": inv,
        "notifications": notif,
        "requests": reqs,
        "shipments": ships,
    }
