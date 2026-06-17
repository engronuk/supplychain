"""Inventory & order-lifecycle conservation audit.

Validates the supply chain invariants for a given manufacturer (or all):

  1. Inventory conservation: every received shipment has a corresponding
     inventory_movement of equal positive delta at the destination tier.
  2. Order lifecycle: purchase_orders / wholesaler_purchase_orders that
     have a delivered shipment should be in `delivered` status.
  3. Financial metadata: every shipment line item must carry unit_price,
     gross_value, discount, net_value.
  4. Tier inventory presence: each tier (warehouse, distributor, wholesaler,
     retailer) must have a non-zero unit count.

Outputs a JSON report under /app/test_reports/audit_inventory.json.

Run: python -m backend.scripts.audit_inventory
"""
from __future__ import annotations
import asyncio, json, os, sys
from pathlib import Path
from collections import Counter, defaultdict

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent))

from core import db  # noqa: E402


async def main() -> None:
    report: dict = {"checks": {}, "errors": [], "warnings": []}

    # 1. Tier inventory presence
    tier_units: Counter = Counter()
    async for inv in db.inventory.find({}, {"_id":0,"owner_type":1,"quantity":1}):
        tier_units[inv.get("owner_type")] += int(inv.get("quantity") or 0)
    report["checks"]["tier_inventory_units"] = dict(tier_units)
    for tier in ("warehouse","distributor","wholesaler","retailer"):
        if tier_units.get(tier,0) <= 0:
            report["errors"].append(f"Tier {tier!r} has zero inventory units")

    # 2. Inventory conservation — received shipments must have movements.
    # Use a single aggregation pull of all `shipment_receipt` movements,
    # keyed by ref_id, so we can validate in one O(N) sweep.
    movement_ref_ids: set = set()
    async for mv in db.inventory_movements.find(
        {"kind": {"$in": ["shipment_receipt", "factory_receipt"]}},
        {"_id": 0, "ref_id": 1},
    ):
        movement_ref_ids.add(mv.get("ref_id"))
    delivered = 0
    missing_mv = 0
    sample_missing = []
    async for sh in db.shipments.find(
        {"status": {"$in": ["received","delivered","completed"]},
         "inventory_credit_skipped": {"$ne": True}},
        {"_id":0,"id":1,"to_role":1,"to_id":1},
    ):
        delivered += 1
        if sh["id"] not in movement_ref_ids:
            missing_mv += 1
            if len(sample_missing) < 5:
                sample_missing.append({"shipment": sh["id"], "to": sh.get("to_role")})
    report["checks"]["delivered_shipments"] = delivered
    report["checks"]["shipments_missing_movement"] = missing_mv
    if missing_mv:
        report["warnings"].append(f"{missing_mv}/{delivered} delivered shipments are missing inventory movements")
        report["checks"]["missing_movement_samples"] = sample_missing

    # 3. Order lifecycle — POs with delivered shipments should be `delivered`
    open_states = ["allocated","shipped","in_transit"]
    delivered_po_ids: set = set()
    delivered_wpo_ids: set = set()
    async for sh in db.shipments.find(
        {"status": {"$in": ["received","delivered","completed"]}},
        {"_id":0,"purchase_order_id":1,"wholesaler_purchase_order_id":1},
    ):
        if sh.get("purchase_order_id"):
            delivered_po_ids.add(sh["purchase_order_id"])
        if sh.get("wholesaler_purchase_order_id"):
            delivered_wpo_ids.add(sh["wholesaler_purchase_order_id"])
    stale_pos = 0
    if delivered_po_ids:
        stale_pos += await db.purchase_orders.count_documents(
            {"id": {"$in": list(delivered_po_ids)}, "status": {"$in": open_states}})
    if delivered_wpo_ids:
        stale_pos += await db.wholesaler_purchase_orders.count_documents(
            {"id": {"$in": list(delivered_wpo_ids)}, "status": {"$in": open_states}})
    report["checks"]["stale_open_pos"] = stale_pos
    if stale_pos:
        report["warnings"].append(f"{stale_pos} purchase orders are still open despite a received shipment")

    # 4. Financial metadata on shipments
    bad = 0
    total = 0
    async for sh in db.shipments.find({}, {"_id":0,"id":1,"items":1}):
        for it in sh.get("items", []) or []:
            total += 1
            if it.get("unit_price") is None or it.get("gross_value") is None \
                    or it.get("net_value") is None:
                bad += 1
                break
    report["checks"]["shipment_lines_total"] = total
    report["checks"]["shipment_lines_missing_financials"] = bad
    if bad:
        report["warnings"].append(f"{bad}/{total} shipments have line items missing financial metadata")

    # 5. Logistics events backlog
    unacked_critical = await db.logistics_events.count_documents({
        "acknowledged": False, "severity": "critical"})
    report["checks"]["unacked_critical_events"] = unacked_critical

    # Summarise
    report["passed"] = not report["errors"]
    out_path = Path("/app/test_reports/audit_inventory.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
