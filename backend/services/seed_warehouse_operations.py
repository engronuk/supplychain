"""
Seed comprehensive warehouse operational history across the
Manufacturer Warehouse Module and the standalone WMS.

Idempotent — every record is tagged with `seed_tag = "warehouse_ops_v1"` and
the seeder deletes-then-recreates rows with that tag on every run so the
script can be re-executed safely.

Target warehouses (4):
    • Unilever Lagos Warehouse        (WHR-0002)
    • Unilever North West Warehouse — used as "Kano" (WHR-0008)
    • Unilever North Central Warehouse — used as "Abuja" (WHR-0006)
    • Flour Mills Lagos Warehouse     (WHR-0013)

Populated collections:
    inventory        — enriched with reserved / damaged / last_movement_at
    grns             — 50 inbound shipments across 6 statuses
    shipments        — 75 outbound + 40 transfers (warehouse→warehouse)
    warehouse_users  — 9 users per warehouse (manager / receivers / dispatch /
                       inventory controllers / store keepers)
    tasks            — 50 operational tasks
    notifications    — alerts surfaced by /wms/alerts
    returns          — 30 customer/dispatch returns
    cycle_counts     — periodic cycle-count records

All records carry `organization_id` so they remain inside the tenant boundary
established by the universal organization architecture.
"""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from core import db, logger, new_id, now_iso

SEED_TAG = "warehouse_ops_v1"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TARGET_WAREHOUSES: list[str] = []  # populated dynamically — see resolve_targets()

GRN_STATUS_DIST = {
    "received": 15, "receiving": 10, "expected": 15, "delayed": 5, "awaiting_review": 5,
}
DISPATCH_STATUS_DIST = {
    "completed": 35, "picking": 15, "loaded": 10, "awaiting_dispatch": 10, "delayed": 5,
}
TRANSFER_STATUS_DIST = {
    "completed": 10, "received": 8, "in_transit": 6, "loaded": 5,
    "picking": 5, "awaiting_approval": 3, "draft": 3,
}
TASK_STATUS_DIST = {"completed": 20, "in_progress": 15, "pending": 10, "escalated": 5}

SUPPLIER_POOL = [
    "Apapa Port Logistics", "Tin Can Trucking", "PZ Cussons Supplies",
    "Lagos Trade Imports", "Kano Logistics Co.", "Sahel Transport Ltd",
    "Niger Bulk Carriers", "BUA Sugar Refinery", "FrieslandCampina",
    "Olam Nigeria", "Dangote Group", "Procter & Gamble NG",
]

FIRST_NAMES = ["Ahmed", "Chinedu", "Bukola", "Tunde", "Aisha", "Emeka", "Fatima",
               "Olumide", "Ngozi", "Yusuf", "Hauwa", "Adebayo", "Ifeanyi",
               "Zainab", "Segun", "Chidinma", "Musa", "Funmi", "Kelechi", "Sade"]
LAST_NAMES = ["Adeyemi", "Okafor", "Lawal", "Bello", "Eze", "Mohammed", "Ogun",
              "Nwosu", "Suleiman", "Ibrahim", "Adekunle", "Okonkwo", "Sani",
              "Abubakar", "Onyeka", "Yakubu", "Olawale", "Abiodun", "Adamu"]

ROLES_PER_WAREHOUSE = [
    ("Warehouse Manager", 1),
    ("Receiving Officer", 2),
    ("Dispatch Officer", 2),
    ("Inventory Controller", 2),
    ("Store Keeper", 2),
]

RETURN_REASONS = ["damaged", "expired", "wrong_product", "quality_issue", "customer_rejection"]
RETURN_STATUSES = ["received", "under_inspection", "approved", "rejected", "disposed", "restocked"]

ALERT_TEMPLATES = [
    ("low_stock",        "warning",  "Low Stock Alert",
        "Reorder point reached for {product}"),
    ("variance",         "warning",  "Inventory Variance Alert",
        "Cycle count variance detected for {product} ({delta} units)"),
    ("shipment_delay",   "critical", "Shipment Delay Alert",
        "{ref} is delayed past expected arrival window"),
    ("transfer_approve", "info",     "Transfer Approval Required",
        "{ref} awaiting approval from warehouse manager"),
    ("adjustment",       "info",     "Inventory Adjustment Pending",
        "Pending adjustment request for {product}"),
    ("expiring",         "critical", "Expiring Product Alert",
        "Batch for {product} expires in 14 days"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def iso_days_ago(days: int, *, jitter_hours: int = 12) -> str:
    base = datetime.now(timezone.utc) - timedelta(days=days, hours=random.randint(0, jitter_hours))
    return base.isoformat()


def fake_name() -> str:
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


def email_from(name: str, domain: str) -> str:
    parts = name.lower().replace("'", "").split()
    return f"{parts[0]}.{parts[1]}@{domain}"


def status_pool(dist: Dict[str, int]) -> List[str]:
    pool: List[str] = []
    for k, v in dist.items():
        pool.extend([k] * v)
    random.shuffle(pool)
    return pool


# ---------------------------------------------------------------------------
# Main seeder
# ---------------------------------------------------------------------------
async def seed() -> Dict[str, int]:
    random.seed(2026)
    summary: Dict[str, int] = {}

    # ------- 1. Resolve target warehouses + their parent manufacturers -------
    # Use the hard-coded list when present, otherwise grab one warehouse per
    # manufacturer (Lagos preferred) from the live hierarchy.
    warehouses: List[dict] = []
    if TARGET_WAREHOUSES:
        async for w in db.organizations.find(
            {"organization_code": {"$in": TARGET_WAREHOUSES}}, {"_id": 0}
        ):
            warehouses.append(w)
        if len(warehouses) != len(TARGET_WAREHOUSES):
            codes = [w["organization_code"] for w in warehouses]
            raise RuntimeError(f"Expected 4 target warehouses; found {codes}")
    else:
        async for mfr in db.organizations.find(
            {"organization_type": "manufacturer"}, {"_id": 0, "id": 1},
        ):
            async for w in db.organizations.find(
                {"organization_type": "warehouse", "parent_organization_id": mfr["id"]},
                {"_id": 0},
            ).sort("organization_code", 1).limit(2):
                warehouses.append(w)
        if not warehouses:
            raise RuntimeError("No warehouses found in hierarchy")
    logger.info("[seed] target warehouses: %s", [w["organization_code"] for w in warehouses])

    # ------- 2. Wipe previously-tagged rows so re-runs stay clean -------
    purged: Dict[str, int] = {}
    for col in ("grns", "shipments", "warehouse_users", "tasks",
                "notifications", "returns", "cycle_counts"):
        r = await db[col].delete_many({"seed_tag": SEED_TAG})
        purged[col] = r.deleted_count
    logger.info("[seed] purged previous-run rows: %s", purged)

    # ------- 3. Inventory enrichment per warehouse -------
    # Each warehouse stocks products from its parent manufacturer's catalogue.
    inv_count = 0
    inv_value_by_wh: Dict[str, float] = {}
    for wh in warehouses:
        mfr_id = wh.get("parent_organization_id", "")
        org_id = wh["id"]
        products = await db.products.find(
            {"manufacturer_id": mfr_id}, {"_id": 0},
        ).to_list(50)
        if not products:
            continue
        inv_value = 0.0
        for i, p in enumerate(products):
            # Bell-curve mix: a few low-stock, mostly healthy, one over-stocked.
            band = i % 5
            if band == 0:
                qty = random.randint(40, 140)            # low
            elif band == 4:
                qty = random.randint(8000, 12000)        # over
            else:
                qty = random.randint(1200, 5800)         # healthy
            reorder   = random.choice([500, 800, 1000, 1500])
            reserved  = int(qty * random.uniform(0.06, 0.18))
            damaged   = int(qty * random.uniform(0.005, 0.02))
            last_move = iso_days_ago(random.randint(0, 5))
            updated   = now_iso()
            inv_value += float(p.get("unit_price") or 0) * qty
            # Upsert the inventory row (warehouse owner).
            await db.inventory.update_one(
                {"owner_type": "warehouse", "owner_id": org_id, "product_id": p["id"]},
                {"$set": {
                    "quantity": qty,
                    "reorder_level": reorder,
                    "reserved": reserved,
                    "damaged": damaged,
                    "last_movement_at": last_move,
                    "organization_id": org_id,
                    "updated_at": updated,
                    "seed_tag": SEED_TAG,
                },
                 "$setOnInsert": {
                    "id": new_id(),
                    "owner_type": "warehouse",
                    "owner_id": org_id,
                    "product_id": p["id"],
                    "manufacturer_id": mfr_id,
                    "created_at": updated,
                }},
                upsert=True,
            )
            inv_count += 1
        inv_value_by_wh[org_id] = inv_value
    summary["inventory_rows"] = inv_count

    # Helper: pick a random product for a warehouse.
    async def random_products_for(wh_id: str, mfr_id: str, k: int) -> List[dict]:
        rows = await db.products.find(
            {"manufacturer_id": mfr_id}, {"_id": 0},
        ).to_list(50)
        if not rows:
            return []
        return random.sample(rows, min(k, len(rows)))

    # ------- 4. Inbound (GRNs) — 50 total -------
    grn_docs: List[dict] = []
    grn_status_pool = status_pool(GRN_STATUS_DIST)
    grn_idx = 1
    for status in grn_status_pool:
        wh = random.choice(warehouses)
        mfr = wh.get("parent_organization_id", "")
        prods = await random_products_for(wh["id"], mfr, random.randint(2, 5))
        items = [{
            "product_id": p["id"],
            "product_name": p.get("name"),
            "sku": p.get("sku"),
            "quantity_expected": random.randint(200, 2000),
            "quantity_received": random.randint(180, 2000) if status in ("received", "receiving") else 0,
        } for p in prods]
        expected = datetime.now(timezone.utc) - timedelta(days=random.randint(-7, 30))
        received = expected + timedelta(hours=random.randint(2, 48)) if status == "received" else None
        if status == "delayed":
            expected = datetime.now(timezone.utc) - timedelta(days=random.randint(2, 6))
        grn_docs.append({
            "id": new_id(),
            "grn_number": f"GRN-2026-{grn_idx:03d}",
            "warehouse_id": wh["id"],
            "organization_id": wh["id"],
            "supplier_name": random.choice(SUPPLIER_POOL),
            "expected_at": expected.isoformat(),
            "received_at": received.isoformat() if received else None,
            "items": items,
            "status": status,
            "created_by_name": fake_name(),
            "notes": "" if status != "delayed" else "Carrier reported route closure",
            "created_at": (expected - timedelta(days=2)).isoformat(),
            "seed_tag": SEED_TAG,
        })
        grn_idx += 1
    if grn_docs:
        await db.grns.insert_many(grn_docs)
    summary["grns"] = len(grn_docs)

    # Apply inbound stock increments for "received" GRNs.
    for g in grn_docs:
        if g["status"] != "received":
            continue
        for line in g["items"]:
            await db.inventory.update_one(
                {"owner_type": "warehouse", "owner_id": g["warehouse_id"],
                 "product_id": line["product_id"]},
                {"$inc": {"quantity": line.get("quantity_received") or 0},
                 "$set": {"last_movement_at": g["received_at"], "updated_at": now_iso()}},
            )

    # ------- 5. Outbound (Dispatches) — 75 total -------
    dispatch_docs: List[dict] = []
    dispatch_status_pool = status_pool(DISPATCH_STATUS_DIST)
    dsp_idx = 1
    for status in dispatch_status_pool:
        wh = random.choice(warehouses)
        mfr = wh.get("parent_organization_id", "")
        prods = await random_products_for(wh["id"], mfr, random.randint(2, 5))
        items = [{
            "product_id": p["id"],
            "product_name": p.get("name"),
            "sku": p.get("sku"),
            "quantity": random.randint(50, 900),
        } for p in prods]
        to_role = random.choice(["distributor", "wholesaler", "retailer"])
        # Pick a real downstream org if we can find one in the same tenant.
        downstream = await db.organizations.find_one(
            {"organization_type": to_role}, {"_id": 0, "id": 1, "organization_name": 1},
        ) or {"id": "", "organization_name": "—"}
        created_at = iso_days_ago(random.randint(0, 80))
        dispatch_docs.append({
            "id": new_id(),
            "tracking_code": f"DSP-2026-{dsp_idx:03d}",
            "from_role": "warehouse",
            "from_id": wh["id"],
            "to_role": to_role,
            "to_id": downstream["id"],
            "to_name": downstream["organization_name"],
            "manufacturer_id": mfr,
            "organization_id": wh["id"],
            "items": items,
            "status": status,
            "created_by_name": fake_name(),
            "created_at": created_at,
            "dispatched_at": created_at if status not in ("awaiting_dispatch", "picking") else None,
            "delivered_at": iso_days_ago(random.randint(0, 60)) if status == "completed" else None,
            "is_transfer": False,
            "seed_tag": SEED_TAG,
        })
        dsp_idx += 1
    if dispatch_docs:
        await db.shipments.insert_many(dispatch_docs)
    summary["dispatches"] = len(dispatch_docs)

    # Decrement inventory for completed dispatches (best effort, floor at 0).
    for d in dispatch_docs:
        if d["status"] != "completed":
            continue
        for line in d["items"]:
            await db.inventory.update_one(
                {"owner_type": "warehouse", "owner_id": d["from_id"],
                 "product_id": line["product_id"]},
                {"$inc": {"quantity": -int(line.get("quantity") or 0)},
                 "$set": {"last_movement_at": d["created_at"], "updated_at": now_iso()}},
            )

    # ------- 6. Transfers — 40 inter-warehouse moves -------
    transfer_docs: List[dict] = []
    transfer_status_pool = status_pool(TRANSFER_STATUS_DIST)
    trf_idx = 1
    for status in transfer_status_pool:
        src, dst = random.sample(warehouses, 2)
        # Constrain transfers to same-tenant pairs to respect isolation.
        if src.get("parent_organization_id") != dst.get("parent_organization_id"):
            # Try one more time within the same tenant.
            same_tenant = [w for w in warehouses if w.get("parent_organization_id") == src.get("parent_organization_id") and w["id"] != src["id"]]
            if same_tenant:
                dst = random.choice(same_tenant)
            else:
                continue
        mfr = src.get("parent_organization_id", "")
        prods = await random_products_for(src["id"], mfr, random.randint(2, 4))
        items = [{
            "product_id": p["id"],
            "product_name": p.get("name"),
            "sku": p.get("sku"),
            "quantity": random.randint(80, 600),
        } for p in prods]
        created_at = iso_days_ago(random.randint(0, 70))
        transfer_docs.append({
            "id": new_id(),
            "tracking_code": f"TRF-2026-{trf_idx:03d}",
            "transfer_number": f"TRF-2026-{trf_idx:03d}",
            "from_role": "warehouse",
            "from_id": src["id"],
            "from_name": src["organization_name"],
            "to_role": "warehouse",
            "to_id": dst["id"],
            "to_name": dst["organization_name"],
            "manufacturer_id": mfr,
            "organization_id": src["id"],
            "items": items,
            "status": status,
            "created_by_name": fake_name(),
            "created_at": created_at,
            "is_transfer": True,
            "seed_tag": SEED_TAG,
        })
        trf_idx += 1
    if transfer_docs:
        await db.shipments.insert_many(transfer_docs)
    summary["transfers"] = len(transfer_docs)

    # Apply inventory effects of completed/received transfers.
    for t in transfer_docs:
        if t["status"] not in ("completed", "received"):
            continue
        for line in t["items"]:
            qty = int(line.get("quantity") or 0)
            await db.inventory.update_one(
                {"owner_type": "warehouse", "owner_id": t["from_id"],
                 "product_id": line["product_id"]},
                {"$inc": {"quantity": -qty},
                 "$set": {"last_movement_at": t["created_at"], "updated_at": now_iso()}},
            )
            await db.inventory.update_one(
                {"owner_type": "warehouse", "owner_id": t["to_id"],
                 "product_id": line["product_id"]},
                {"$inc": {"quantity": qty},
                 "$set": {"last_movement_at": t["created_at"], "updated_at": now_iso()},
                 "$setOnInsert": {
                    "id": new_id(),
                    "owner_type": "warehouse",
                    "owner_id": t["to_id"],
                    "product_id": line["product_id"],
                    "manufacturer_id": t.get("manufacturer_id", ""),
                    "organization_id": t["to_id"],
                    "reorder_level": 1000,
                    "reserved": 0, "damaged": 0,
                    "created_at": t["created_at"],
                 }},
                upsert=True,
            )

    # ------- 7. Warehouse Users — 9 per warehouse -------
    user_docs: List[dict] = []
    domains = {
        "b21c1dbe-1a6f-4c33-b036-f416579455d0": "unilever.com.ng",
        "a2d92c39-f014-47f6-b2cb-506da8c56831": "fmnplc.com",
    }
    for wh in warehouses:
        domain = domains.get(wh.get("parent_organization_id", ""), "tradekonekt.io")
        for role, count in ROLES_PER_WAREHOUSE:
            for _ in range(count):
                name = fake_name()
                user_docs.append({
                    "id": new_id(),
                    "warehouse_id": wh["id"],
                    "organization_id": wh["id"],
                    "name": name,
                    "role": role,
                    "email": email_from(name, domain),
                    "phone": f"+234 80{random.randint(10000000, 99999999)}",
                    "status": "active" if random.random() > 0.08 else "inactive",
                    "joined_at": iso_days_ago(random.randint(30, 600)),
                    "last_active_at": iso_days_ago(random.randint(0, 7)),
                    "created_at": now_iso(),
                    "seed_tag": SEED_TAG,
                })
    if user_docs:
        await db.warehouse_users.insert_many(user_docs)
    summary["warehouse_users"] = len(user_docs)

    # ------- 8. Tasks — 50 -------
    task_docs: List[dict] = []
    task_status_pool = status_pool(TASK_STATUS_DIST)
    task_titles = [
        "Review damaged inventory",
        "Approve warehouse transfer",
        "Investigate shipment delay",
        "Validate cycle count variance",
        "Approve inventory adjustment",
        "Confirm GRN receipt",
        "Reconcile dispatch shortfall",
        "Audit reserved-stock release",
        "Investigate expiring batch",
        "Schedule cycle count",
    ]
    for status in task_status_pool:
        wh = random.choice(warehouses)
        task_docs.append({
            "id": new_id(),
            "warehouse_id": wh["id"],
            "organization_id": wh["id"],
            "title": random.choice(task_titles),
            "status": status,
            "priority": random.choice(["low", "medium", "high", "critical"]),
            "assigned_to": random.choice([u["name"] for u in user_docs if u["warehouse_id"] == wh["id"]] or ["Unassigned"]),
            "due_at": iso_days_ago(-random.randint(1, 7)),
            "created_at": iso_days_ago(random.randint(0, 30)),
            "seed_tag": SEED_TAG,
        })
    if task_docs:
        await db.tasks.insert_many(task_docs)
    summary["tasks"] = len(task_docs)

    # ------- 9. Alerts (notifications) — persisted -------
    notif_docs: List[dict] = []
    for _ in range(35):
        wh = random.choice(warehouses)
        kind, severity, title, body_tpl = random.choice(ALERT_TEMPLATES)
        # Resolve a sample product name & ref to interpolate.
        mfr = wh.get("parent_organization_id", "")
        prods = await db.products.find({"manufacturer_id": mfr}, {"_id": 0}).to_list(20)
        product_name = (random.choice(prods).get("name") if prods else "SKU")
        ref = f"DSP-2026-{random.randint(1, 75):03d}"
        body = body_tpl.format(product=product_name, ref=ref, delta=random.randint(5, 80))
        notif_docs.append({
            "id": new_id(),
            "target_type": "warehouse",
            "target_id": wh["id"],
            "organization_id": wh["id"],
            "kind": kind.upper(),
            "severity": severity,
            "title": title,
            "body": body,
            "message": body,
            "resolved": random.random() > 0.55,
            "created_at": iso_days_ago(random.randint(0, 12)),
            "seed_tag": SEED_TAG,
        })
    if notif_docs:
        await db.notifications.insert_many(notif_docs)
    summary["notifications"] = len(notif_docs)

    # ------- 10. Returns — 30 -------
    return_docs: List[dict] = []
    for i in range(30):
        wh = random.choice(warehouses)
        mfr = wh.get("parent_organization_id", "")
        prods = await random_products_for(wh["id"], mfr, 1)
        if not prods:
            continue
        p = prods[0]
        return_docs.append({
            "id": new_id(),
            "return_number": f"RET-2026-{i+1:03d}",
            "warehouse_id": wh["id"],
            "organization_id": wh["id"],
            "product_id": p["id"],
            "product_name": p.get("name"),
            "sku": p.get("sku"),
            "quantity": random.randint(5, 120),
            "reason": random.choice(RETURN_REASONS),
            "status": random.choice(RETURN_STATUSES),
            "from_party": random.choice(["Suara & Co.", "Prime Distribution", "M&B Distribution", "Bioneeds Ltd.", "Viju Industries"]),
            "received_at": iso_days_ago(random.randint(0, 60)),
            "created_at": iso_days_ago(random.randint(0, 60)),
            "seed_tag": SEED_TAG,
        })
    if return_docs:
        await db.returns.insert_many(return_docs)
    summary["returns"] = len(return_docs)

    # ------- 11. Cycle counts -------
    cc_docs: List[dict] = []
    cc_statuses = ["completed", "completed", "pending_approval", "variance_detected", "in_progress"]
    for wh in warehouses:
        for i in range(6):
            mfr = wh.get("parent_organization_id", "")
            prods = await random_products_for(wh["id"], mfr, random.randint(3, 6))
            counted = sum(random.randint(800, 4000) for _ in prods)
            variance = random.choice([0, 0, 0, random.randint(-120, -20), random.randint(20, 120)])
            status = "variance_detected" if abs(variance) > 50 else random.choice(cc_statuses)
            cc_docs.append({
                "id": new_id(),
                "cycle_number": f"CC-2026-{wh['organization_code']}-{i+1:02d}",
                "warehouse_id": wh["id"],
                "organization_id": wh["id"],
                "skus_counted": len(prods),
                "units_counted": counted,
                "variance": variance,
                "accuracy": round(100 - abs(variance) / max(counted, 1) * 100, 2),
                "status": status,
                "performed_by": fake_name(),
                "performed_at": iso_days_ago(random.randint(0, 90)),
                "created_at": iso_days_ago(random.randint(0, 90)),
                "seed_tag": SEED_TAG,
            })
    if cc_docs:
        await db.cycle_counts.insert_many(cc_docs)
    summary["cycle_counts"] = len(cc_docs)

    logger.info("[seed] DONE %s", summary)

    # Floor any negative inventory back to a sensible positive band so the
    # demo always reads as plausible (low-stock badges still trigger via the
    # reorder_level threshold).
    floored = 0
    async for r in db.inventory.find({"quantity": {"$lt": 0}}, {"_id": 0, "id": 1}):
        await db.inventory.update_one(
            {"id": r["id"]},
            {"$set": {"quantity": random.randint(120, 480)}},  # leave below typical reorder
        )
        floored += 1
    if floored:
        logger.info("[seed] floored %d negative inventory rows", floored)

    return summary


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(asyncio.run(seed()))
