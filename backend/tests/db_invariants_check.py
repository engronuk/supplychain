"""DB-level verification for P0 inventory/PO/financial metadata invariants."""
import os
import sys
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
if not MONGO_URL or not DB_NAME:
    # try backend .env
    with open("/app/backend/.env") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("MONGO_URL="):
                MONGO_URL = line.split("=", 1)[1].strip('"').strip("'")
            elif line.startswith("DB_NAME="):
                DB_NAME = line.split("=", 1)[1].strip('"').strip("'")

print(f"Using DB={DB_NAME}")
db = MongoClient(MONGO_URL)[DB_NAME]

errors = 0
warnings = 0

# --- 1. Delivery completion → inventory_movements shipment_receipt --------
print("\n=== 1. Verify shipment_receipt inventory_movements for arrived retailer deliveries ===")
arrived_count = 0
matched = 0
unmatched_samples = []
cursor = db.vehicles.find({
    "status": "arrived",
    "ref_type": "shipment",
    "to_role": "retailer",
}).limit(50)
for v in cursor:
    arrived_count += 1
    to_id = v.get("to_id")
    ref_id = v.get("ref_id") or v.get("shipment_id")
    if not to_id or not ref_id:
        continue
    mv = db.inventory_movements.find_one({
        "kind": "shipment_receipt",
        "to_id": to_id,
    })
    if mv:
        matched += 1
    else:
        # try with shipment_id link
        mv = db.inventory_movements.find_one({
            "kind": "shipment_receipt",
            "$or": [{"shipment_id": ref_id}, {"ref_id": ref_id}],
        })
        if mv:
            matched += 1
        elif len(unmatched_samples) < 3:
            unmatched_samples.append({"vehicle_id": v.get("vehicle_id") or str(v.get("_id")), "to_id": to_id, "ref_id": ref_id})

print(f"arrived retailer-bound vehicles sampled: {arrived_count}")
print(f"matched shipment_receipt rows: {matched}")
if unmatched_samples:
    warnings += 1
    print(f"WARN unmatched samples: {unmatched_samples}")

total_recv = db.inventory_movements.count_documents({"kind": "shipment_receipt"})
print(f"Total inventory_movements (kind=shipment_receipt): {total_recv}")
if total_recv == 0:
    errors += 1
    print("ERROR: zero shipment_receipt rows — delivery completion did not credit inventory")

# --- 2. PO lifecycle: received shipments → POs status=delivered -----------
print("\n=== 2. PO lifecycle status=delivered ===")
shipments_received = list(db.shipments.find({
    "status": {"$in": ["received", "delivered"]},
    "wholesaler_purchase_order_id": {"$exists": True, "$ne": None},
}).limit(50))
print(f"sampled received shipments with wholesaler_purchase_order_id: {len(shipments_received)}")
mismatched = []
for s in shipments_received:
    po_id = s.get("wholesaler_purchase_order_id")
    po = db.wholesaler_purchase_orders.find_one({"$or": [{"id": po_id}, {"_id": po_id}]})
    if not po:
        continue
    if po.get("status") != "delivered":
        mismatched.append({"po_id": po_id, "status": po.get("status")})
print(f"PO mismatches (not delivered): {len(mismatched)}")
if mismatched[:3]:
    print(f"  samples: {mismatched[:3]}")
if len(mismatched) > 0:
    errors += 1

# purchase_orders (mfr-side)
shipments_mfr = list(db.shipments.find({
    "status": {"$in": ["received", "delivered"]},
    "purchase_order_id": {"$exists": True, "$ne": None},
}).limit(50))
print(f"sampled received shipments with purchase_order_id: {len(shipments_mfr)}")
mfr_mismatched = []
for s in shipments_mfr:
    po_id = s.get("purchase_order_id")
    po = db.purchase_orders.find_one({"$or": [{"id": po_id}, {"_id": po_id}]})
    if not po:
        continue
    if po.get("status") != "delivered":
        mfr_mismatched.append({"po_id": po_id, "status": po.get("status")})
print(f"manufacturer PO mismatches (not delivered): {len(mfr_mismatched)}")
if mfr_mismatched[:3]:
    print(f"  samples: {mfr_mismatched[:3]}")
if len(mfr_mismatched) > 0:
    errors += 1

# --- 3. Financial metadata on factory_replenishment / procurement shipments ---
print("\n=== 3. Financial metadata on shipments ===")
for src in ("factory_replenishment", "procurement"):
    sample = list(db.shipments.find({"source": src}).sort("created_at", -1).limit(5))
    print(f"\n source={src}: sampled {len(sample)}")
    for s in sample:
        sid = s.get("id") or str(s.get("_id"))
        items = s.get("items") or []
        bad_items = []
        for it in items:
            for fld in ("unit_price", "gross_value", "discount", "net_value"):
                if fld not in it:
                    bad_items.append((sid, fld))
                    break
        top_ok = all(k in s for k in ("gross_value", "discount_value", "net_value"))
        if bad_items or not top_ok:
            errors += 1
            print(f"  FAIL shipment {sid}: top_ok={top_ok}, bad_items={bad_items[:2]}")
        else:
            print(f"  OK   shipment {sid}: items={len(items)} gross={s.get('gross_value')} net={s.get('net_value')}")

print("\n=== Summary ===")
print(f"errors={errors}, warnings={warnings}")
sys.exit(0 if errors == 0 else 1)
