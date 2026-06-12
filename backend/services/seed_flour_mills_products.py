"""Seed the Flour Mills `Oil and Fat` product line and its inventory positions
across Warehouse → Distributor → Wholesaler → Retailer.

Idempotent — matches by SKU (products), batch_number (batches), and
(owner_id, product_id) (inventory). Re-running is a no-op once the data has
been planted.

Quantities (approximate, user-specified):
    Warehouse   ~5000 units / product
    Distributor ~4000 units / product
    Wholesaler  ~1400 units / product
    Retailer     ~150 units / product (spread across all 5 retailers)

Inventory rows are written as raw dicts because `PartyRole` (the Pydantic
literal on `InventoryItem.owner_type`) only allows manufacturer/distributor/
retailer today. Storing the real org type in `owner_type` keeps the new
unified `organization_id` query path useful while staying additive (no
schema break).
"""
from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple

from core import db, logger, new_id, now_iso


# ---------------------------------------------------------------------------
# Product catalogue (Flour Mills · Oil and Fat)
# ---------------------------------------------------------------------------
CATEGORY = "Oil and Fat"
BRAND = "Golden Penny"

PRODUCTS: List[Dict] = [
    {"name": "Golden Penny Soya Oil",        "sku": "GP-SOYA-5L",   "unit_price": 12500.0, "barcode": "6151001230011", "pack": "5L bottle"},
    {"name": "Golden Penny Vegetable Oil",   "sku": "GP-VEG-5L",    "unit_price": 11800.0, "barcode": "6151001230028", "pack": "5L bottle"},
    {"name": "Golden Penny Spread",          "sku": "GP-SPRD-250G", "unit_price":  2200.0, "barcode": "6151001230035", "pack": "250g tub"},
    {"name": "Golden Penny Margarine",       "sku": "GP-MARG-250G", "unit_price":  1800.0, "barcode": "6151001230042", "pack": "250g tub"},
    {"name": "Golden Penny Choc Oh",         "sku": "GP-CHOC-500G", "unit_price":  3500.0, "barcode": "6151001230059", "pack": "500g jar"},
    {"name": "Industrial Fat Products",      "sku": "GP-IFAT-25KG", "unit_price": 42000.0, "barcode": "6151001230066", "pack": "25kg drum"},
]


# Target inventory per tier (with small ±5% jitter for realism)
TIER_TARGETS = {
    "warehouse":   5000,
    "distributor": 4000,
    "wholesaler":  1400,
    "retailer":     150,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _flour_mills() -> Dict:
    mfg = await db.organizations.find_one(
        {"organization_name": "Flour Mills Nigeria", "organization_type": "manufacturer"},
        {"_id": 0},
    )
    if not mfg:
        raise RuntimeError("Flour Mills Nigeria not seeded yet — run seed_flour_mills_tenant first.")
    return mfg


async def _flour_orgs_by_type(mfg_id: str) -> Dict[str, List[Dict]]:
    """Walk Flour Mills' subtree and bucket every org by its type."""
    seen = {mfg_id}
    frontier = [mfg_id]
    nodes: Dict[str, List[Dict]] = {}
    while frontier:
        children = await db.organizations.find(
            {"parent_organization_id": {"$in": frontier}}, {"_id": 0},
        ).to_list(50000)
        next_frontier = []
        for c in children:
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            next_frontier.append(c["id"])
            nodes.setdefault(c["organization_type"], []).append(c)
        frontier = next_frontier
    return nodes


def _jitter(target: int) -> int:
    """Return a value within ±5 % of `target` so the demo data feels real."""
    spread = max(1, int(target * 0.05))
    return target + random.randint(-spread, spread)


async def _upsert_product(*, sku: str, name: str, category: str,
                          unit_price: float, barcode: str,
                          manufacturer_id: str, pack: str) -> Dict:
    existing = await db.products.find_one({"sku": sku}, {"_id": 0})
    now = now_iso()
    doc = {
        "id": (existing or {}).get("id") or new_id(),
        "sku": sku,
        "name": name,
        "category": category,
        "unit_price": unit_price,
        "barcode": barcode,
        "manufacturer_id": manufacturer_id,
        "organization_id": manufacturer_id,
        "brand": BRAND,
        "pack_size": pack,
        "updated_at": now,
    }
    if not existing:
        doc["created_at"] = now
        await db.products.insert_one(doc)
    else:
        await db.products.update_one({"id": existing["id"]}, {"$set": doc})
    return doc


async def _upsert_batch(*, batch_number: str, product_id: str,
                        manufacturer_id: str, quantity: int,
                        manufactured: datetime, expires: datetime,
                        unit_cost: float) -> Dict:
    existing = await db.batches.find_one({"batch_number": batch_number}, {"_id": 0})
    doc = {
        "id": (existing or {}).get("id") or new_id(),
        "batch_number": batch_number,
        "product_id": product_id,
        "manufacturer_id": manufacturer_id,
        "organization_id": manufacturer_id,
        "quantity": quantity,
        "unit_cost": unit_cost,
        "manufactured_at": manufactured.date().isoformat(),
        "expiry_date":       expires.date().isoformat(),
        "status": "active",
        "created_at": (existing or {}).get("created_at", now_iso()),
        "updated_at": now_iso(),
    }
    if not existing:
        await db.batches.insert_one(doc)
    else:
        await db.batches.update_one({"id": existing["id"]}, {"$set": doc})
    return doc


async def _upsert_inventory(*, owner_type: str, owner_id: str, product_id: str,
                            quantity: int, reorder_level: int,
                            warehouse_id: str | None = None,
                            retail_price: float | None = None) -> None:
    existing = await db.inventory.find_one(
        {"owner_id": owner_id, "product_id": product_id}, {"_id": 0, "id": 1},
    )
    doc = {
        "owner_type": owner_type,
        "owner_id": owner_id,
        "product_id": product_id,
        "quantity": quantity,
        "reorder_level": reorder_level,
        "velocity": 0.0,
        "organization_id": owner_id,
        "warehouse_id": warehouse_id,
        "retail_price": retail_price,
        "updated_at": now_iso(),
    }
    if existing:
        await db.inventory.update_one({"id": existing["id"]}, {"$set": doc})
    else:
        doc["id"] = new_id()
        await db.inventory.insert_one(doc)


# ---------------------------------------------------------------------------
# Main seed
# ---------------------------------------------------------------------------
async def run() -> Dict:
    random.seed(20260608)  # deterministic so re-runs match
    mfg = await _flour_mills()
    mfg_id = mfg["id"]
    orgs = await _flour_orgs_by_type(mfg_id)

    if not all(orgs.get(t) for t in ("warehouse", "distributor", "wholesaler", "retailer")):
        raise RuntimeError(
            f"Flour Mills subtree incomplete: types found = {sorted(orgs)}. "
            "Run seed_flour_mills_tenant.run() first."
        )

    warehouse = orgs["warehouse"][0]
    distributor = orgs["distributor"][0]
    wholesaler = orgs["wholesaler"][0]
    retailers = orgs["retailer"]  # list of 5

    summary: Dict = {
        "products": [],
        "batches": 0,
        "inventory_rows": 0,
        "tier_totals": {},
    }

    today = datetime.now(timezone.utc)

    for idx, spec in enumerate(PRODUCTS):
        product = await _upsert_product(
            sku=spec["sku"], name=spec["name"], category=CATEGORY,
            unit_price=spec["unit_price"], barcode=spec["barcode"],
            manufacturer_id=mfg_id, pack=spec["pack"],
        )
        pid = product["id"]
        # Cost = ~70 % of retail price for the batch ledger.
        unit_cost = round(spec["unit_price"] * 0.7, 2)

        # ----- 2 batches per product: one fresh, one mid-life ----------------
        for b_i in range(1, 3):
            await _upsert_batch(
                batch_number=f"FMN-{spec['sku']}-B{b_i:02d}",
                product_id=pid,
                manufacturer_id=mfg_id,
                quantity=_jitter(8000),
                unit_cost=unit_cost,
                manufactured=today - timedelta(days=30 * b_i),
                expires=today + timedelta(days=365 - 30 * b_i),
            )
            summary["batches"] += 1

        # ----- Inventory positions across the tiers --------------------------
        # Warehouse
        wh_qty = _jitter(TIER_TARGETS["warehouse"])
        await _upsert_inventory(
            owner_type="warehouse", owner_id=warehouse["id"],
            product_id=pid, quantity=wh_qty,
            reorder_level=int(TIER_TARGETS["warehouse"] * 0.2),
            warehouse_id=warehouse["id"],
        )
        # Distributor
        dist_qty = _jitter(TIER_TARGETS["distributor"])
        await _upsert_inventory(
            owner_type="distributor", owner_id=distributor["id"],
            product_id=pid, quantity=dist_qty,
            reorder_level=int(TIER_TARGETS["distributor"] * 0.2),
        )
        # Wholesaler
        ws_qty = _jitter(TIER_TARGETS["wholesaler"])
        await _upsert_inventory(
            owner_type="wholesaler", owner_id=wholesaler["id"],
            product_id=pid, quantity=ws_qty,
            reorder_level=int(TIER_TARGETS["wholesaler"] * 0.2),
        )
        # Retailers (5 of them — each gets ~150 units; retail markup ~15 %)
        retail_price = round(spec["unit_price"] * 1.15, 2)
        for r in retailers:
            r_qty = _jitter(TIER_TARGETS["retailer"])
            await _upsert_inventory(
                owner_type="retailer", owner_id=r["id"],
                product_id=pid, quantity=r_qty,
                reorder_level=30,
                retail_price=retail_price,
            )

        summary["inventory_rows"] += 3 + len(retailers)
        summary["products"].append({
            "id": pid, "sku": spec["sku"], "name": spec["name"],
            "warehouse": wh_qty, "distributor": dist_qty,
            "wholesaler": ws_qty, "retailer_each": TIER_TARGETS["retailer"],
        })

    # Roll-up totals so the user can sanity-check the spread.
    summary["tier_totals"] = {
        "warehouse_units":   sum(p["warehouse"]   for p in summary["products"]),
        "distributor_units": sum(p["distributor"] for p in summary["products"]),
        "wholesaler_units":  sum(p["wholesaler"]  for p in summary["products"]),
        "retailer_units":    sum(p["retailer_each"] * len(retailers)
                                 for p in summary["products"]),
    }
    summary["counterparties"] = {
        "warehouse":   warehouse["organization_code"],
        "distributor": distributor["organization_code"],
        "wholesaler":  wholesaler["organization_code"],
        "retailers":   [r["organization_code"] for r in retailers],
    }
    logger.info("Flour Mills Oil & Fat seed: %s", {
        "products": len(summary["products"]),
        "batches": summary["batches"],
        "inventory_rows": summary["inventory_rows"],
        **summary["tier_totals"],
    })
    return summary


if __name__ == "__main__":
    import json
    print(json.dumps(asyncio.run(run()), indent=2))
