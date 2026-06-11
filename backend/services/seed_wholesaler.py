"""Seed wholesaler-side data for Phase 1.

For every wholesaler in `db.organizations`:
* Stock 10-20 products (owned by the wholesaler) with realistic on-hand
  numbers, reorder points, max stock, reserved/damaged/in_transit, and
  a fraction marked with near-term expiry dates.
* Create 3 sample purchase orders in mixed states (delivered, shipped,
  submitted) referencing the parent manufacturer / warehouse.
* Drop a few movement records (cycle counts / receipts) to populate the
  movements feed.

Idempotent: keyed on a `seed_tag` so we never duplicate rows on reboot.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from core import db, logger, new_id, now_iso

SEED_TAG = "wholesaler_seed_v1"
_RNG = random.Random(2026_06_12)


async def _tenant_for(wh: dict) -> tuple[str, str]:
    """Walk up the org tree to return (manufacturer_id, parent_warehouse_id|"")."""
    parent_id = wh.get("parent_organization_id")
    seen: set[str] = set()
    last_warehouse = ""
    while parent_id and parent_id not in seen:
        seen.add(parent_id)
        doc = await db.organizations.find_one(
            {"id": parent_id}, {"_id": 0, "id": 1, "organization_type": 1,
                                "parent_organization_id": 1},
        )
        if not doc:
            break
        if doc.get("organization_type") == "warehouse":
            last_warehouse = doc["id"]
        if doc.get("organization_type") == "manufacturer":
            return doc["id"], last_warehouse
        parent_id = doc.get("parent_organization_id")
    return "", last_warehouse


async def seed_wholesaler_data() -> Dict[str, int]:
    summary = {"wholesalers": 0, "inventory_rows": 0,
               "purchase_orders": 0, "movements": 0, "skipped": 0}

    wholesalers = await db.organizations.find(
        {"organization_type": "wholesaler"}, {"_id": 0}
    ).to_list(500)
    if not wholesalers:
        logger.info("No wholesalers — skipping wholesaler seed.")
        return summary

    for wh in wholesalers:
        # Already seeded? skip
        if await db.inventory.count_documents(
            {"owner_type": "wholesaler", "owner_id": wh["id"], "seed_tag": SEED_TAG}
        ):
            summary["skipped"] += 1
            continue

        mfr_id, warehouse_id = await _tenant_for(wh)
        products = await db.products.find(
            {"manufacturer_id": mfr_id} if mfr_id else {}, {"_id": 0},
        ).to_list(50)
        if not products:
            logger.info("No products for tenant of wholesaler %s — skipping",
                        wh.get("organization_code"))
            continue

        sample = _RNG.sample(products, k=min(12, len(products)))
        inv_count = 0
        for p in sample:
            qty = _RNG.randint(0, 2000)
            reorder = _RNG.choice([50, 100, 150, 200])
            max_stock = reorder * _RNG.randint(8, 12)
            reserved = int(qty * _RNG.uniform(0.02, 0.08))
            damaged = int(qty * _RNG.uniform(0.0, 0.02))
            in_transit = int(qty * _RNG.uniform(0.0, 0.1))
            velocity = round(_RNG.uniform(20, 120), 1)
            expiry = None
            if _RNG.random() < 0.25:
                expiry = (datetime.now(timezone.utc)
                          + timedelta(days=_RNG.randint(5, 45))).isoformat()
            res = await db.inventory.update_one(
                {"owner_type": "wholesaler", "owner_id": wh["id"],
                 "product_id": p["id"]},
                {
                    "$set": {
                        "quantity": qty,
                        "reorder_level": reorder,
                        "max_stock": max_stock,
                        "reserved": reserved,
                        "damaged": damaged,
                        "in_transit": in_transit,
                        "velocity": velocity,
                        "expiry_date": expiry,
                        "organization_id": wh["id"],
                        "manufacturer_id": mfr_id,
                        "updated_at": now_iso(),
                        "last_movement_at": now_iso(),
                        "seed_tag": SEED_TAG,
                    },
                    "$setOnInsert": {
                        "id": new_id(),
                        "owner_type": "wholesaler",
                        "owner_id": wh["id"],
                        "product_id": p["id"],
                        "created_at": now_iso(),
                    },
                },
                upsert=True,
            )
            inv_count += 1
        summary["inventory_rows"] += inv_count

        # Purchase orders
        po_specs = [
            {"status": "delivered",  "supplier_id": mfr_id or warehouse_id,
             "supplier_type": "manufacturer" if mfr_id else "warehouse",
             "days_ago_created": 35, "items": 4},
            {"status": "shipped",    "supplier_id": warehouse_id or mfr_id,
             "supplier_type": "warehouse" if warehouse_id else "manufacturer",
             "days_ago_created": 6,  "items": 3},
            {"status": "submitted",  "supplier_id": mfr_id or warehouse_id,
             "supplier_type": "manufacturer" if mfr_id else "warehouse",
             "days_ago_created": 1,  "items": 5},
        ]
        seq = await db.wholesaler_purchase_orders.count_documents({})
        po_docs: List[dict] = []
        for i, spec in enumerate(po_specs):
            if not spec["supplier_id"]:
                continue
            picks = _RNG.sample(products, k=min(spec["items"], len(products)))
            items = []
            total_units = 0
            total_amount = 0.0
            for p in picks:
                q = _RNG.randint(100, 800)
                unit_cost = float(p.get("unit_price") or 0) * _RNG.uniform(0.7, 0.85)
                line_total = round(unit_cost * q, 2)
                items.append({
                    "product_id": p["id"],
                    "quantity": q,
                    "unit_cost": round(unit_cost, 2),
                    "line_total": line_total,
                })
                total_units += q
                total_amount += line_total
            created_at = (datetime.now(timezone.utc)
                          - timedelta(days=spec["days_ago_created"])).isoformat()
            history = [{"status": "draft", "at": created_at,
                        "by": "wholesaler", "note": "PO drafted"}]
            timestamps: Dict[str, str] = {}

            def _advance(after_status: str, days_after: int) -> str:
                ts = (datetime.now(timezone.utc)
                      - timedelta(days=spec["days_ago_created"])
                      + timedelta(days=days_after)).isoformat()
                history.append({"status": after_status, "at": ts,
                                "by": "system", "note": ""})
                timestamps[f"{after_status}_at"] = ts
                return ts

            if spec["status"] in ("submitted", "approved", "allocated",
                                  "shipped", "delivered"):
                _advance("submitted", 0)
            if spec["status"] in ("approved", "allocated", "shipped", "delivered"):
                _advance("approved", 1)
            if spec["status"] in ("allocated", "shipped", "delivered"):
                _advance("allocated", 2)
            if spec["status"] in ("shipped", "delivered"):
                _advance("shipped", 3)
            if spec["status"] == "delivered":
                _advance("delivered", min(spec["days_ago_created"], 7))

            po = {
                "id": new_id(),
                "po_number": f"WPO-{datetime.now(timezone.utc).year}-{seq + 1 + i:04d}",
                "wholesaler_id": wh["id"],
                "tenant_id": mfr_id,
                "supplier_id": spec["supplier_id"],
                "supplier_type": spec["supplier_type"],
                "supplier_name": "",  # backfilled on read
                "items": items,
                "total_units": total_units,
                "total_amount": round(total_amount, 2),
                "status": spec["status"],
                "note": "",
                "status_history": history,
                "created_at": created_at,
                "updated_at": now_iso(),
                "seed_tag": SEED_TAG,
                **timestamps,
            }
            po_docs.append(po)
        if po_docs:
            await db.wholesaler_purchase_orders.insert_many(po_docs)
            summary["purchase_orders"] += len(po_docs)

        # Movements feed (cycle counts + receipts)
        move_docs = []
        for p in sample[:4]:
            move_docs.append({
                "id": new_id(),
                "wholesaler_id": wh["id"],
                "product_id": p["id"],
                "kind": _RNG.choice(["receive", "cycle_count", "damage"]),
                "delta": _RNG.choice([+200, +500, -30, -10, +1500]),
                "note": "Initial demo movement",
                "actor": "system",
                "created_at": (datetime.now(timezone.utc)
                               - timedelta(days=_RNG.randint(0, 14))).isoformat(),
                "seed_tag": SEED_TAG,
            })
        if move_docs:
            await db.wholesaler_inventory_movements.insert_many(move_docs)
            summary["movements"] += len(move_docs)

        summary["wholesalers"] += 1

    logger.info("Wholesaler seed complete: %s", summary)
    return summary
