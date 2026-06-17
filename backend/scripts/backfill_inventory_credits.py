"""One-shot backfill — make the existing data set reflect the new
delivery-credit pipeline.

For every already-received shipment (the simulator had already moved goods
across the country but inventory was never credited downstream), this:
  1. Credits the destination inventory at the right tier (warehouse /
     distributor / wholesaler / retailer).
  2. Writes an inventory_movements ledger row so analytics rollups can see
     the historical flow.
  3. Marks the originating purchase_order / wholesaler_purchase_order as
     delivered if it isn't already.

Idempotent — tags every credited shipment with `inventory_credited=True`
and skips them on subsequent runs.

Run:  python -m backend.scripts.backfill_inventory_credits
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
BACKEND = THIS_DIR.parent
sys.path.insert(0, str(BACKEND))

from core import db, now_iso  # noqa: E402
from services.control_tower_sim import (  # noqa: E402
    _receive_at_owner, _close_purchase_orders_for_shipment,
)


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


async def main() -> None:
    # 1. Backfill manufacturer_id on db.retailers via lineage / parent chain.
    fixed_retailers = 0
    async for r in db.retailers.find(
        {"$or": [{"manufacturer_id": {"$exists": False}}, {"manufacturer_id": None}]},
        {"_id": 0, "id": 1, "lineage_path": 1, "wholesaler_id": 1, "distributor_id": 1},
    ):
        mfr = None
        path = r.get("lineage_path") or ""
        # Expected lineage prefix: MFR/MFR-0001/...
        parts = path.split("/")
        if len(parts) >= 2 and parts[0] == "MFR":
            org = await db.organizations.find_one(
                {"organization_code": parts[1]}, {"_id": 0, "id": 1})
            if org:
                mfr = org["id"]
        if not mfr and r.get("wholesaler_id"):
            w = await db.organizations.find_one(
                {"id": r["wholesaler_id"]},
                {"_id": 0, "metadata.manufacturer_id": 1})
            mfr = ((w or {}).get("metadata") or {}).get("manufacturer_id")
        if not mfr and r.get("distributor_id"):
            d = await db.distributors.find_one(
                {"id": r["distributor_id"]}, {"_id": 0, "manufacturer_id": 1})
            mfr = (d or {}).get("manufacturer_id")
        if mfr:
            await db.retailers.update_one(
                {"id": r["id"]},
                {"$set": {"manufacturer_id": mfr, "updated_at": now_utc()}})
            fixed_retailers += 1
    print(f"✓ manufacturer_id backfilled on {fixed_retailers} retailers")

    # 2. Credit inventory for already-received shipments that never made it
    #    to the inventory ledger.
    credited = 0
    closed_pos = 0
    cursor = db.shipments.find(
        {"status": {"$in": ["received", "delivered", "completed"]},
         "inventory_credited": {"$ne": True}},
        {"_id": 0, "id": 1, "manufacturer_id": 1, "to_role": 1, "to_id": 1,
         "items": 1, "purchase_order_id": 1,
         "wholesaler_purchase_order_id": 1},
    )
    async for sh in cursor:
        to_role = sh.get("to_role")
        to_id = sh.get("to_id")
        items = sh.get("items") or []
        mfr = sh.get("manufacturer_id")
        if to_role not in ("warehouse", "distributor", "wholesaler", "retailer") \
                or not to_id or not items:
            await db.shipments.update_one(
                {"id": sh["id"]},
                {"$set": {"inventory_credited": True,
                          "inventory_credited_at": now_utc(),
                          "inventory_credit_skipped": True}})
            continue
        try:
            await _receive_at_owner(
                mfr, to_role, to_id, items, sh["id"],
                movement_kind=("factory_receipt" if to_role == "warehouse"
                               else "shipment_receipt"))
            await _close_purchase_orders_for_shipment(sh)
            await db.shipments.update_one(
                {"id": sh["id"]},
                {"$set": {"inventory_credited": True,
                          "inventory_credited_at": now_utc()}})
            credited += 1
            if sh.get("purchase_order_id") or sh.get("wholesaler_purchase_order_id"):
                closed_pos += 1
        except Exception as e:
            print(f"  ! skip {sh['id']}: {e}")
    print(f"✓ Credited inventory for {credited} historical shipments")
    print(f"✓ Closed {closed_pos} originating purchase orders")

    # 3. Auto-archive long-arrived trucks so the live map isn't cluttered.
    cutoff = (datetime.now(timezone.utc).timestamp() - 12 * 3600)
    cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
    res = await db.vehicles.update_many(
        {"status": "arrived", "delivered_at": {"$lt": cutoff_iso}},
        {"$set": {"status": "archived", "archived_at": now_utc()}})
    print(f"✓ Archived {res.modified_count} long-arrived vehicles")

    # 4. Auto-ack any orphan critical events whose vehicle has since been
    #    archived (truck delivered cleanly, alert is moot).
    archived_ids = []
    async for v in db.vehicles.find(
        {"status": "archived"}, {"_id": 0, "id": 1}).limit(5000):
        archived_ids.append(v["id"])
    if archived_ids:
        res2 = await db.logistics_events.update_many(
            {"vehicle_id": {"$in": archived_ids},
             "acknowledged": False,
             "severity": {"$in": ["warning", "critical"]}},
            {"$set": {"acknowledged": True,
                      "acknowledged_at": now_utc(),
                      "acknowledged_by": "auto-archive",
                      "auto_resolved": True}})
        print(f"✓ Auto-acked {res2.modified_count} stale events on archived vehicles")


if __name__ == "__main__":
    asyncio.run(main())
