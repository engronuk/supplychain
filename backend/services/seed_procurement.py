"""Seed sample retailer Purchase Orders & supplier quotes for the demo.

Idempotent: only inserts if the collections are empty.
Creates a balanced mix of statuses so every Procurement tab has real data.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from core import db, new_id, now_iso


PO_STATUSES = [
    "draft", "submitted", "approved", "processing",
    "shipped", "delivered", "delivered", "cancelled", "rejected",
]


async def seed_procurement() -> dict:
    po_existing = await db.purchase_orders.count_documents({})
    quote_existing = await db.supplier_quotes.count_documents({})
    if po_existing and quote_existing:
        return {"skipped": True, "pos": po_existing, "quotes": quote_existing}

    retailers = await db.retailers.find({}, {"_id": 0}).to_list(None)
    if not retailers:
        return {"created_pos": 0, "skipped": "no_retailers"}

    products = await db.products.find({}, {"_id": 0}).to_list(None)
    distributors_by_id = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(None)}

    rng = random.Random(20260607)
    now = datetime.now(timezone.utc)
    created_pos = 0
    po_seq_by_year: dict[int, int] = {}

    # ~6 POs per retailer for the first 40 retailers (≈240 POs total)
    if not po_existing:
        for r in retailers[:40]:
            distributor_id = r.get("distributor_id")
            if not distributor_id or distributor_id not in distributors_by_id:
                continue
            for _ in range(rng.randint(3, 7)):
                age_days = rng.uniform(0.1, 75)
                created_at = (now - timedelta(days=age_days)).isoformat()
                status = rng.choice(PO_STATUSES)
                n_skus = rng.randint(1, 4)
                chosen = rng.sample(products, k=min(n_skus, len(products)))
                items = []
                total = 0.0
                for p in chosen:
                    qty = rng.choice([10, 20, 30, 50, 75, 100])
                    unit_cost = round(rng.uniform(120, 4500), 2)
                    line_total = round(qty * unit_cost, 2)
                    total += line_total
                    items.append({
                        "product_id": p["id"],
                        "quantity": qty,
                        "unit_cost": unit_cost,
                        "line_total": line_total,
                    })

                year = (now - timedelta(days=age_days)).year
                po_seq_by_year[year] = po_seq_by_year.get(year, 0) + 1
                po_number = f"PO-{year}-{po_seq_by_year[year]:05d}"

                # Build status timeline
                history = [{"status": "draft", "at": created_at, "by": None, "note": None}]
                submitted_at = approved_at = processed_at = shipped_at = None
                delivered_at = cancelled_at = None
                cancel_reason = reject_reason = None

                if status != "draft":
                    submitted_at = (datetime.fromisoformat(created_at) + timedelta(hours=rng.randint(1, 12))).isoformat()
                    history.append({"status": "submitted", "at": submitted_at, "by": None, "note": None})
                if status in ("approved", "processing", "shipped", "delivered"):
                    approved_at = (datetime.fromisoformat(submitted_at) + timedelta(hours=rng.randint(2, 24))).isoformat()
                    history.append({"status": "approved", "at": approved_at, "by": None, "note": None})
                if status in ("processing", "shipped", "delivered"):
                    processed_at = (datetime.fromisoformat(approved_at) + timedelta(hours=rng.randint(1, 12))).isoformat()
                    history.append({"status": "processing", "at": processed_at, "by": None, "note": None})
                if status in ("shipped", "delivered"):
                    shipped_at = (datetime.fromisoformat(processed_at) + timedelta(hours=rng.randint(2, 24))).isoformat()
                    history.append({"status": "shipped", "at": shipped_at, "by": None, "note": None})
                if status == "delivered":
                    delivered_at = (datetime.fromisoformat(shipped_at) + timedelta(days=rng.randint(1, 5))).isoformat()
                    history.append({"status": "delivered", "at": delivered_at, "by": None, "note": None})
                if status == "cancelled":
                    cancelled_at = submitted_at or created_at
                    cancel_reason = rng.choice([
                        "Found better price elsewhere", "Order placed in error",
                        "Slow distributor response", "Inventory needs changed",
                    ])
                    history.append({"status": "cancelled", "at": cancelled_at, "by": None, "note": cancel_reason})
                if status == "rejected":
                    reject_reason = rng.choice([
                        "Item out of stock", "Credit limit exceeded",
                        "Outside delivery area",
                    ])
                    history.append({"status": "rejected", "at": submitted_at or created_at,
                                    "by": None, "note": reject_reason})

                doc = {
                    "id": new_id(),
                    "po_number": po_number,
                    "retailer_id": r["id"],
                    "distributor_id": distributor_id,
                    "items": items,
                    "total_amount": round(total, 2),
                    "status": status,
                    "note": None,
                    "cancel_reason": cancel_reason,
                    "reject_reason": reject_reason,
                    "shipment_id": None,
                    "duplicate_of": None,
                    "status_history": history,
                    "created_at": created_at,
                    "updated_at": history[-1]["at"],
                    "submitted_at": submitted_at,
                    "approved_at": approved_at,
                    "processed_at": processed_at,
                    "shipped_at": shipped_at,
                    "delivered_at": delivered_at,
                    "cancelled_at": cancelled_at,
                }
                await db.purchase_orders.insert_one(doc)
                created_pos += 1

        # Persist the counters so future POs continue the sequence
        for year, seq in po_seq_by_year.items():
            await db.counters.update_one(
                {"_id": f"po_seq_{year}"},
                {"$set": {"seq": seq}},
                upsert=True,
            )

    # Seed supplier quotes ----------------------------------------------------
    created_quotes = 0
    if not quote_existing:
        qt_seq_by_year: dict[int, int] = {}
        all_dist_ids = list(distributors_by_id.keys())
        for r in retailers[:20]:
            primary = r.get("distributor_id")
            if not primary or not all_dist_ids:
                continue
            for _ in range(rng.randint(1, 3)):
                product = rng.choice(products)
                quantity = rng.choice([100, 200, 500, 1000])
                # Invite 2-4 distributors including the retailer's primary
                others = [d for d in all_dist_ids if d != primary]
                rng.shuffle(others)
                invited = [primary] + others[: rng.randint(1, 3)]
                age_days = rng.uniform(0.1, 21)
                created_at = (now - timedelta(days=age_days)).isoformat()
                year = (now - timedelta(days=age_days)).year
                qt_seq_by_year[year] = qt_seq_by_year.get(year, 0) + 1
                quote_number = f"QT-{year}-{qt_seq_by_year[year]:04d}"

                # Probability some distributors have responded
                responses = []
                for did in invited:
                    if rng.random() < 0.6:
                        responses.append({
                            "distributor_id": did,
                            "unit_price": round(rng.uniform(200, 4000), 2),
                            "lead_time_days": rng.choice([2, 3, 5, 7, 10]),
                            "moq": rng.choice([25, 50, 100, 200]),
                            "valid_until": (now + timedelta(days=rng.randint(7, 30))).date().isoformat(),
                            "notes": rng.choice([None, "Bulk discount available", "Includes free delivery", None, "Quick turnaround"]),
                            "responded_at": (datetime.fromisoformat(created_at) + timedelta(hours=rng.randint(2, 48))).isoformat(),
                        })

                status = "open"
                if responses:
                    status = "responded"
                if age_days > 14 and rng.random() < 0.3:
                    status = "closed"

                doc = {
                    "id": new_id(),
                    "quote_number": quote_number,
                    "retailer_id": r["id"],
                    "product_id": product["id"],
                    "quantity": quantity,
                    "distributor_ids": invited,
                    "responses": responses,
                    "status": status,
                    "note": None,
                    "created_at": created_at,
                    "closed_at": now_iso() if status == "closed" else None,
                }
                await db.supplier_quotes.insert_one(doc)
                created_quotes += 1

        for year, seq in qt_seq_by_year.items():
            await db.counters.update_one(
                {"_id": f"qt_seq_{year}"},
                {"$set": {"seq": seq}},
                upsert=True,
            )

    return {"created_pos": created_pos, "created_quotes": created_quotes}
