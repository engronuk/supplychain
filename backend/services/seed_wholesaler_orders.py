"""Seed wholesaler orders, fulfillments, and shipments (Phase 2).

Idempotent — keyed on `seed_tag`. For each wholesaler with inventory and
at least one same-region distributor in the tenant, drops a few orders
spread across the funnel:
  * 1 submitted   (awaits approval)
  * 1 approved    (allocated, awaiting picking)
  * 1 picking
  * 1 packed
  * 1 shipped (with a live shipment in transit)
  * 1 delivered (closed loop)
  * 1 backordered (for the dashboard)
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from core import db, logger, new_id, now_iso

SEED_TAG = "wholesaler_orders_seed_v1"
_RNG = random.Random(2026_06_12)


def _hist(status: str, days_ago: float, by: str = "system",
          note: str = "") -> dict:
    return {
        "status": status,
        "at": (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat(),
        "by": by,
        "note": note,
    }


async def _walk_tenant(wh: dict) -> str:
    pid = wh.get("parent_organization_id")
    seen: set[str] = set()
    while pid and pid not in seen:
        seen.add(pid)
        p = await db.organizations.find_one(
            {"id": pid}, {"_id": 0, "id": 1, "organization_type": 1,
                          "parent_organization_id": 1},
        )
        if not p:
            break
        if p.get("organization_type") == "manufacturer":
            return p["id"]
        pid = p.get("parent_organization_id")
    return wh.get("manufacturer_id") or ""


async def _region_distributors(tenant_id: str, region: str) -> List[dict]:
    org_rows = await db.organizations.find(
        {"organization_type": "distributor", "region": region}, {"_id": 0},
    ).to_list(200) if region else []
    if not org_rows:
        return []
    ids = [d["id"] for d in org_rows]
    legacy_map: dict = {}
    async for ld in db.distributors.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "manufacturer_id": 1, "city": 1, "name": 1},
    ):
        legacy_map[ld["id"]] = ld
    out: List[dict] = []
    for d in org_rows:
        legacy = legacy_map.get(d["id"])
        if legacy and tenant_id and legacy.get("manufacturer_id") != tenant_id:
            continue
        out.append({
            "id": d["id"],
            "name": d.get("organization_name") or (legacy or {}).get("name") or "",
            "code": d.get("organization_code", ""),
            "region": d.get("region", ""),
            "city": d.get("city") or (legacy or {}).get("city") or "",
            "address": d.get("address", ""),
        })
    return out


def _build_items(products: List[dict], k: int) -> List[dict]:
    picks = _RNG.sample(products, k=min(k, len(products)))
    items = []
    for p in picks:
        qty = _RNG.randint(40, 600)
        unit_price = float(p.get("unit_price") or 0)
        items.append({
            "product_id": p["id"],
            "product_name": p.get("name"),
            "sku": p.get("sku"),
            "quantity": qty,
            "approved_quantity": 0,
            "fulfilled_quantity": 0,
            "unit_price": unit_price,
            "line_total": round(unit_price * qty, 2),
        })
    return items


async def seed_wholesaler_orders() -> Dict[str, int]:
    summary = {"orders": 0, "fulfillments": 0, "shipments": 0,
               "wholesalers_seeded": 0, "skipped": 0}

    wholesalers = await db.organizations.find(
        {"organization_type": "wholesaler"}, {"_id": 0},
    ).to_list(500)
    if not wholesalers:
        return summary

    for wh in wholesalers:
        if await db.wholesaler_orders.count_documents(
            {"wholesaler_id": wh["id"], "seed_tag": SEED_TAG}
        ):
            summary["skipped"] += 1
            continue

        tenant_id = await _walk_tenant(wh)
        if not tenant_id:
            continue
        products = await db.products.find(
            {"manufacturer_id": tenant_id}, {"_id": 0},
        ).to_list(50)
        if not products:
            continue
        distributors = await _region_distributors(tenant_id, wh.get("region") or "")
        if not distributors:
            continue

        # Build 7 sample orders across the funnel
        order_specs = [
            {"status": "submitted",   "days_ago": 0.5, "priority": "normal"},
            {"status": "allocated",   "days_ago": 1,   "priority": "high"},
            {"status": "picking",     "days_ago": 1.5, "priority": "normal"},
            {"status": "packed",      "days_ago": 2,   "priority": "urgent"},
            {"status": "shipped",     "days_ago": 2.5, "priority": "normal"},
            {"status": "delivered",   "days_ago": 6,   "priority": "normal"},
            {"status": "backordered", "days_ago": 1,   "priority": "normal"},
        ]

        order_docs: List[dict] = []
        ful_docs: List[dict] = []
        ship_docs: List[dict] = []

        wo_seq = await db.wholesaler_orders.count_documents({})
        ful_seq = await db.wholesaler_fulfillment_orders.count_documents({})
        ship_seq = await db.wholesaler_shipments.count_documents({})

        for i, spec in enumerate(order_specs):
            distributor = _RNG.choice(distributors)
            items = _build_items(products, k=_RNG.randint(2, 4))
            for it in items:
                if spec["status"] in ("backordered",):
                    it["approved_quantity"] = 0
                else:
                    it["approved_quantity"] = it["quantity"]

            total_units = sum(it["quantity"] for it in items)
            total_amount = sum(it["line_total"] for it in items)
            created_at = (datetime.now(timezone.utc)
                          - timedelta(days=spec["days_ago"] + 0.2)).isoformat()
            year = datetime.now(timezone.utc).year

            history = [_hist("submitted", spec["days_ago"] + 0.2,
                             by=f"{distributor['name']}", note="Submitted")]
            timestamps: Dict[str, str] = {"submitted_at": created_at}
            status = spec["status"]
            if status in ("approved", "allocated", "picking", "picked",
                          "packing", "packed", "ready_for_dispatch", "shipped",
                          "delivered"):
                t = (datetime.now(timezone.utc)
                     - timedelta(days=spec["days_ago"])).isoformat()
                history.append(_hist("approved", spec["days_ago"], note="Approved"))
                history.append(_hist("allocated", spec["days_ago"],
                                     note="Inventory reserved"))
                timestamps["approved_at"] = t
                timestamps["allocated_at"] = t
            if status in ("picking", "picked", "packing", "packed",
                          "ready_for_dispatch", "shipped", "delivered"):
                history.append(_hist("picking", max(0, spec["days_ago"] - 0.2),
                                     note="Picking started"))
                timestamps["picking_started_at"] = (
                    datetime.now(timezone.utc)
                    - timedelta(days=max(0, spec["days_ago"] - 0.2))
                ).isoformat()
            if status in ("packed", "ready_for_dispatch", "shipped", "delivered"):
                history.append(_hist("packing", max(0, spec["days_ago"] - 0.4),
                                     note="Packing"))
                history.append(_hist("ready_for_dispatch",
                                     max(0, spec["days_ago"] - 0.5),
                                     note="Ready"))
            if status in ("shipped", "delivered"):
                history.append(_hist("shipped", max(0, spec["days_ago"] - 0.6),
                                     note="Dispatched"))
                timestamps["shipped_at"] = (
                    datetime.now(timezone.utc)
                    - timedelta(days=max(0, spec["days_ago"] - 0.6))
                ).isoformat()
            if status == "delivered":
                history.append(_hist("delivered", max(0, spec["days_ago"] - 1.0),
                                     note="Delivered"))
                timestamps["delivered_at"] = (
                    datetime.now(timezone.utc)
                    - timedelta(days=max(0, spec["days_ago"] - 1.0))
                ).isoformat()
            if status == "backordered":
                history.append(_hist("backordered", spec["days_ago"],
                                     note="No stock — backordered"))

            order_id = new_id()
            order_number = f"WO-{year}-{wo_seq + i + 1:04d}"
            order_docs.append({
                "id": order_id,
                "order_number": order_number,
                "wholesaler_id": wh["id"],
                "tenant_id": tenant_id,
                "distributor_id": distributor["id"],
                "distributor": distributor,
                "items": items,
                "total_units": total_units,
                "total_amount": round(total_amount, 2),
                "status": status,
                "priority": spec["priority"],
                "note": "",
                "requested_delivery_date": (
                    datetime.now(timezone.utc)
                    + timedelta(days=_RNG.randint(2, 6))
                ).isoformat(),
                "status_history": history,
                "created_at": created_at,
                "updated_at": now_iso(),
                "seed_tag": SEED_TAG,
                **timestamps,
            })

            # Linked fulfillment for orders past 'approved'
            if status in ("allocated", "picking", "picked", "packing", "packed",
                          "ready_for_dispatch", "shipped", "delivered"):
                ful_id = new_id()
                ful_status_map = {
                    "allocated": "allocated",
                    "picking": "picking",
                    "picked": "picked",
                    "packing": "packing",
                    "packed": "packed",
                    "ready_for_dispatch": "ready_for_dispatch",
                    "shipped": "dispatched",
                    "delivered": "delivered",
                }
                ful_status = ful_status_map[status]
                ful_items = [{
                    "product_id": it["product_id"],
                    "product_name": it.get("product_name"),
                    "sku": it.get("sku"),
                    "quantity": int(it.get("approved_quantity", it["quantity"])),
                    "picked_quantity": int(it.get("approved_quantity", it["quantity"]))
                                       if status in ("picked", "packing", "packed",
                                                     "ready_for_dispatch", "shipped",
                                                     "delivered") else 0,
                    "packed_quantity": int(it.get("approved_quantity", it["quantity"]))
                                       if status in ("packed", "ready_for_dispatch",
                                                     "shipped", "delivered") else 0,
                    "batch_number": f"BATCH-{_RNG.randint(1000, 9999)}",
                } for it in items]

                ful_docs.append({
                    "id": ful_id,
                    "fulfillment_number": f"FUL-{year}-{ful_seq + len(ful_docs) + 1:04d}",
                    "wholesaler_id": wh["id"],
                    "order_id": order_id,
                    "order_number": order_number,
                    "distributor_id": distributor["id"],
                    "distributor": distributor,
                    "items": ful_items,
                    "status": ful_status,
                    "priority": spec["priority"],
                    "assigned_warehouse": wh["id"],
                    "shortage_reported": False,
                    "status_history": history[1:],  # share post-submission history
                    "created_at": created_at,
                    "updated_at": now_iso(),
                    "seed_tag": SEED_TAG,
                })

                # Linked shipment for shipped + delivered
                if status in ("shipped", "delivered"):
                    ship_id = new_id()
                    ship_status = "in_transit" if status == "shipped" else "delivered"
                    ship_history = [
                        _hist("created", spec["days_ago"] - 0.6,
                              note="Shipment created"),
                        _hist("loaded", spec["days_ago"] - 0.6,
                              note="Goods loaded"),
                        _hist("in_transit", spec["days_ago"] - 0.55,
                              note="Departed wholesaler"),
                    ]
                    if status == "delivered":
                        ship_history.append(
                            _hist("delivered", max(0, spec["days_ago"] - 1.0),
                                  note="Delivered to distributor"),
                        )
                    ship_items = [{
                        "product_id": it["product_id"],
                        "product_name": it.get("product_name"),
                        "sku": it.get("sku"),
                        "batch_number": it.get("batch_number", ""),
                        "quantity": int(it.get("packed_quantity") or it.get("quantity") or 0),
                    } for it in ful_items]

                    ship_docs.append({
                        "id": ship_id,
                        "shipment_number": f"WSHIP-{year}-{ship_seq + len(ship_docs) + 1:04d}",
                        "wholesaler_id": wh["id"],
                        "fulfillment_id": ful_id,
                        "order_id": order_id,
                        "order_number": order_number,
                        "distributor_id": distributor["id"],
                        "distributor": distributor,
                        "items": ship_items,
                        "total_units": sum(it["quantity"] for it in ship_items),
                        "status": ship_status,
                        "origin_lat": wh.get("latitude"),
                        "origin_lng": wh.get("longitude"),
                        "destination_lat": None,
                        "destination_lng": None,
                        "eta_minutes": 60 if status == "shipped" else 0,
                        "shipment_date": (
                            datetime.now(timezone.utc)
                            - timedelta(days=spec["days_ago"] - 0.6)
                        ).isoformat(),
                        "expected_delivery_date": (
                            datetime.now(timezone.utc)
                            + timedelta(days=2)
                        ).isoformat(),
                        "status_history": ship_history,
                        "created_at": (
                            datetime.now(timezone.utc)
                            - timedelta(days=spec["days_ago"] - 0.6)
                        ).isoformat(),
                        "loaded_at": (
                            datetime.now(timezone.utc)
                            - timedelta(days=spec["days_ago"] - 0.6)
                        ).isoformat(),
                        "in_transit_at": (
                            datetime.now(timezone.utc)
                            - timedelta(days=spec["days_ago"] - 0.55)
                        ).isoformat(),
                        "delivered_at": (
                            (datetime.now(timezone.utc)
                             - timedelta(days=max(0, spec["days_ago"] - 1.0))
                             ).isoformat() if status == "delivered" else None
                        ),
                        "updated_at": now_iso(),
                        "seed_tag": SEED_TAG,
                    })
                    # Reference back from fulfillment + order
                    ful_docs[-1]["shipment_id"] = ship_id
                    ful_docs[-1]["shipment_number"] = ship_docs[-1]["shipment_number"]
                    order_docs[-1]["shipment_id"] = ship_id
                    order_docs[-1]["fulfillment_id"] = ful_id

        if order_docs:
            await db.wholesaler_orders.insert_many(order_docs)
        if ful_docs:
            await db.wholesaler_fulfillment_orders.insert_many(ful_docs)
        if ship_docs:
            await db.wholesaler_shipments.insert_many(ship_docs)

        summary["orders"] += len(order_docs)
        summary["fulfillments"] += len(ful_docs)
        summary["shipments"] += len(ship_docs)
        summary["wholesalers_seeded"] += 1

    logger.info("Wholesaler orders/fulfillments/shipments seeded: %s", summary)
    return summary
