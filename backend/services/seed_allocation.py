"""Seed the Manufacturer-Controlled Allocation flow with a realistic mix of
orders in every bucket so the Allocation Center and Warehouse Fulfillment
Queue both look operational from the moment a user logs in.

Tagged `seed_tag = allocation_v1` — re-runnable safely.

Effects per run:
    1. Migrate every legacy `distributor_orders` row that does NOT yet have
       an `allocation_id` / `fulfillment_order_ids` into status="completed"
       (clean-slate per user decision).
    2. Wipe previously-seeded allocation_v1 rows.
    3. Create distributor_orders × N per bucket (pending, awaiting_allocation,
       allocated, partially_allocated, fulfillment_in_progress, completed,
       back_ordered, rejected).
    4. For allocated/in-progress/completed orders, create the corresponding
       order_allocations + fulfillment_orders, increment inventory.reserved
       for non-dispatched FOs, and decrement quantity for completed ones.
"""

from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from core import db, logger, new_id, now_iso

SEED_TAG = "allocation_v1"

# Bucket → count
BUCKET_COUNTS = {
    "pending":                  8,
    "awaiting_allocation":      6,
    "allocated":                5,
    "partially_allocated":      4,
    "fulfillment_in_progress":  6,
    "completed":                8,
    "back_ordered":             4,
    "rejected":                 3,
}

FIRST_NAMES = ["Ahmed", "Chinedu", "Bukola", "Tunde", "Aisha", "Emeka", "Fatima",
               "Olumide", "Ngozi", "Yusuf", "Hauwa", "Adebayo", "Ifeanyi", "Zainab"]
LAST_NAMES = ["Adeyemi", "Okafor", "Lawal", "Bello", "Eze", "Mohammed",
              "Nwosu", "Suleiman", "Ibrahim", "Adekunle", "Okonkwo", "Sani"]


def _ago_iso(days_back: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_back, hours=random.randint(0, 23))).isoformat()


def _fake_name() -> str:
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


async def seed() -> Dict[str, int]:
    random.seed(2026)
    summary: Dict[str, int] = {}

    # ---- 1. Migrate legacy orders to "completed" (idempotent) ------------
    migrated = await db.distributor_orders.update_many(
        {"allocation_id": {"$exists": False}, "fulfillment_order_ids": {"$exists": False},
         "status": {"$in": ["pending", "approved", "dispatched", "delivered"]}},
        {"$set": {"status": "completed", "migrated_from_legacy": True}},
    )
    summary["legacy_migrated"] = migrated.modified_count

    # ---- 2. Purge previous run ----
    for col in ("order_allocations", "fulfillment_orders", "back_orders"):
        await db[col].delete_many({"seed_tag": SEED_TAG})
    await db.distributor_orders.delete_many({"seed_tag": SEED_TAG})

    # ---- 3. Resolve manufacturers + their distributors + warehouses ----
    manufacturers = await db.organizations.find(
        {"organization_type": "manufacturer"}, {"_id": 0},
    ).to_list(50)

    for mfr in manufacturers:
        mfr_id = mfr["id"]
        warehouses = await db.organizations.find(
            {"organization_type": "warehouse", "parent_organization_id": mfr_id}, {"_id": 0},
        ).to_list(20)
        distributors = await db.distributors.find(
            {"manufacturer_id": mfr_id}, {"_id": 0},
        ).to_list(50)
        products = await db.products.find(
            {"manufacturer_id": mfr_id}, {"_id": 0},
        ).to_list(50)
        if not warehouses or not distributors or not products:
            continue

        for bucket, count in BUCKET_COUNTS.items():
            for i in range(count):
                dist = random.choice(distributors)
                line_count = random.randint(2, 4)
                chosen = random.sample(products, min(line_count, len(products)))
                items = [{
                    "product_id": p["id"],
                    "product_name": p.get("name"),
                    "sku": p.get("sku"),
                    "quantity": random.randint(100, 1200),
                    "unit_price": p.get("unit_price", 0) or 0,
                } for p in chosen]
                requested_total = sum(it["quantity"] for it in items)  # noqa: F841 (for future analytics use)

                created_at = _ago_iso(random.randint(0, 60))
                order = {
                    "id": new_id(),
                    "manufacturer_id": mfr_id,
                    "distributor_id": dist["id"],
                    "items": items,
                    "note": "",
                    "status": bucket,
                    "priority": random.choice(["normal", "normal", "high", "critical"]),
                    "created_at": created_at,
                    "updated_at": created_at,
                    "seed_tag": SEED_TAG,
                }
                await db.distributor_orders.insert_one(order)
                summary[f"orders_{bucket}"] = summary.get(f"orders_{bucket}", 0) + 1

                # For buckets that already had an allocation, materialise it.
                if bucket in (
                    "allocated", "partially_allocated",
                    "fulfillment_in_progress", "completed",
                ):
                    # Allocate items across 1-2 warehouses.
                    alloc_lines: List[Dict[str, Any]] = []
                    backorder_lines: List[Dict[str, Any]] = []
                    for it in items:
                        # For partially_allocated, only cover ~60% of qty.
                        coverage = 0.6 if bucket == "partially_allocated" else 1.0
                        to_alloc = max(1, int(it["quantity"] * coverage))
                        # Possibly split across two warehouses.
                        if random.random() > 0.5 and len(warehouses) >= 2:
                            split = to_alloc // 2
                            choices = random.sample(warehouses, 2)
                            for j, wh in enumerate(choices):
                                qty = split if j == 0 else to_alloc - split
                                if qty > 0:
                                    alloc_lines.append({
                                        "warehouse_id": wh["id"],
                                        "warehouse_name": wh["organization_name"],
                                        "product_id": it["product_id"],
                                        "product_name": it["product_name"],
                                        "sku": it["sku"],
                                        "quantity": qty,
                                    })
                        else:
                            wh = random.choice(warehouses)
                            alloc_lines.append({
                                "warehouse_id": wh["id"],
                                "warehouse_name": wh["organization_name"],
                                "product_id": it["product_id"],
                                "product_name": it["product_name"],
                                "sku": it["sku"],
                                "quantity": to_alloc,
                            })
                        if to_alloc < it["quantity"]:
                            backorder_lines.append({
                                "product_id": it["product_id"],
                                "product_name": it["product_name"],
                                "sku": it["sku"],
                                "quantity": it["quantity"] - to_alloc,
                            })

                    alloc_doc = {
                        "id": new_id(),
                        "order_id": order["id"],
                        "manufacturer_id": mfr_id,
                        "distributor_id": dist["id"],
                        "mode": random.choice(["auto", "manual"]),
                        "lines": alloc_lines,
                        "decided_by": "demo-seed",
                        "decided_at": created_at,
                        "notes": "",
                        "seed_tag": SEED_TAG,
                    }
                    await db.order_allocations.insert_one(alloc_doc)

                    # Materialise fulfillment orders (one per warehouse).
                    by_wh: Dict[str, List[Dict[str, Any]]] = {}
                    for a in alloc_lines:
                        by_wh.setdefault(a["warehouse_id"], []).append(a)
                    fo_ids = []
                    fo_idx = 1
                    fo_status_choices = {
                        "allocated":              ["pending_picking"],
                        "partially_allocated":    ["pending_picking", "picking"],
                        "fulfillment_in_progress": ["picking", "picked", "loaded"],
                        "completed":              ["delivered"],
                    }
                    for wh_id, lines in by_wh.items():
                        wh = next((w for w in warehouses if w["id"] == wh_id), {})
                        fo_status = random.choice(fo_status_choices[bucket])
                        fo = {
                            "id": new_id(),
                            "fulfillment_number": f"FO-{order['id'][:6].upper()}-{fo_idx:02d}",
                            "order_id": order["id"],
                            "manufacturer_id": mfr_id,
                            "distributor_id": dist["id"],
                            "warehouse_id": wh_id,
                            "warehouse_name": wh.get("organization_name", ""),
                            "organization_id": wh_id,
                            "items": [{
                                "product_id": ln["product_id"],
                                "product_name": ln["product_name"],
                                "sku": ln["sku"],
                                "allocated_quantity": ln["quantity"],
                                "picked_quantity": ln["quantity"] if fo_status in ("picked", "loaded", "dispatched", "delivered") else 0,
                            } for ln in lines],
                            "priority": order["priority"],
                            "due_date": None,
                            "status": fo_status,
                            "created_at": created_at,
                            "updated_at": created_at,
                            "seed_tag": SEED_TAG,
                        }
                        await db.fulfillment_orders.insert_one(fo)
                        fo_ids.append(fo["id"])
                        fo_idx += 1

                        # Inventory side-effects.
                        for ln in lines:
                            if fo_status in ("delivered", "dispatched"):
                                # Already dispatched — decrement on-hand, no reservation outstanding.
                                await db.inventory.update_one(
                                    {"owner_type": "warehouse", "owner_id": wh_id, "product_id": ln["product_id"]},
                                    {"$inc": {"quantity": -ln["quantity"]}},
                                )
                            else:
                                # Still in flight — hold a reservation.
                                await db.inventory.update_one(
                                    {"owner_type": "warehouse", "owner_id": wh_id, "product_id": ln["product_id"]},
                                    {"$inc": {"reserved": ln["quantity"]}},
                                )

                    await db.distributor_orders.update_one(
                        {"id": order["id"]},
                        {"$set": {
                            "allocation_id": alloc_doc["id"],
                            "fulfillment_order_ids": fo_ids,
                            "allocated_at": created_at,
                        }},
                    )

                    if backorder_lines:
                        bo = {
                            "id": new_id(),
                            "order_id": order["id"],
                            "manufacturer_id": mfr_id,
                            "distributor_id": dist["id"],
                            "items": backorder_lines,
                            "status": "open",
                            "reason": "partial_allocation",
                            "created_at": created_at,
                            "seed_tag": SEED_TAG,
                        }
                        await db.back_orders.insert_one(bo)

                elif bucket == "back_ordered":
                    bo = {
                        "id": new_id(),
                        "order_id": order["id"],
                        "manufacturer_id": mfr_id,
                        "distributor_id": dist["id"],
                        "items": items,
                        "status": "open",
                        "reason": "insufficient_inventory",
                        "created_at": created_at,
                        "seed_tag": SEED_TAG,
                    }
                    await db.back_orders.insert_one(bo)

                elif bucket == "rejected":
                    await db.distributor_orders.update_one(
                        {"id": order["id"]},
                        {"$set": {
                            "rejected_at": created_at,
                            "rejection_reason": random.choice([
                                "Credit hold",
                                "Distributor agreement expired",
                                "Pricing dispute pending",
                                "Insufficient inventory across network",
                            ]),
                        }},
                    )

    # Final pass: floor any negative inventory rows so they read as plausible.
    async for r in db.inventory.find({"quantity": {"$lt": 0}}, {"_id": 0, "id": 1}):
        await db.inventory.update_one({"id": r["id"]}, {"$set": {"quantity": random.randint(50, 250)}})

    logger.info("[allocation seed] %s", summary)
    return summary


if __name__ == "__main__":
    print(asyncio.run(seed()))
