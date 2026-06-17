"""Backfill financial metadata (unit_price, gross_value, discount, net_value)
on legacy shipment line items + shipment totals. Idempotent — tags
processed shipments with `financials_backfilled=True`.

Run: python -m backend.scripts.backfill_shipment_financials
"""
from __future__ import annotations
import asyncio, sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR.parent))

from core import db, now_iso  # noqa: E402


async def main() -> None:
    # 1) Build product price map once.
    prod_price = {}
    async for p in db.products.find({}, {"_id": 0, "id": 1, "unit_price": 1}):
        prod_price[p["id"]] = float(p.get("unit_price") or 0)

    touched = 0
    cursor = db.shipments.find(
        {"financials_backfilled": {"$ne": True}},
        {"_id": 0, "id": 1, "items": 1},
    )
    async for sh in cursor:
        items = sh.get("items") or []
        if not items:
            await db.shipments.update_one(
                {"id": sh["id"]},
                {"$set": {"financials_backfilled": True,
                          "financials_backfilled_at": now_iso()}})
            continue
        new_items = []
        gross = disc = net = 0.0
        for it in items:
            qty = int(it.get("quantity") or 0)
            unit_price = float(it.get("unit_price")
                               or prod_price.get(it.get("product_id"))
                               or 0)
            discount = float(it.get("discount") or 0)
            gross_value = round(unit_price * qty, 2)
            net_value = round(gross_value - discount, 2)
            new_it = {**it,
                      "unit_price": unit_price,
                      "gross_value": gross_value,
                      "discount": discount,
                      "net_value": net_value}
            new_items.append(new_it)
            gross += gross_value
            disc += discount
            net += net_value
        await db.shipments.update_one(
            {"id": sh["id"]},
            {"$set": {"items": new_items,
                      "gross_value": round(gross, 2),
                      "discount_value": round(disc, 2),
                      "net_value": round(net, 2),
                      "financials_backfilled": True,
                      "financials_backfilled_at": now_iso()}})
        touched += 1
    print(f"✓ Backfilled financials on {touched} shipments")


if __name__ == "__main__":
    asyncio.run(main())
