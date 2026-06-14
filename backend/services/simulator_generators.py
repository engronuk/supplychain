"""Activity generators for the TradeKonekt simulator.

Each generator mirrors the side-effects of the equivalent real workflow:
    • Retail sale → decrement retailer inventory + insert `retail_sales`
    • Distributor order → insert `distributor_orders` (manufacturer path)
      or `wholesaler_orders` (wholesaler path) in a submitted/approved state
    • Warehouse allocation → insert `order_allocations` against a recent
      submitted order
    • Shipment → progress existing shipment status OR create + insert
    • Inventory transfer → debit src warehouse, credit dst, insert
      `inventory_transfers`
    • Replenishment request → insert `replenishment_requests`

Every doc inserted by these generators carries `generated_by=SIMULATOR_MARKER`
so a single purge query can delete them cleanly.

This module is deliberately schema-aware but does *not* call HTTP routes —
direct Mongo writes are faster and avoid the HTTP overhead of running
internal traffic against the very service that hosts the simulator.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from core import db

logger = logging.getLogger("tradekonekt.simulator.gen")

SIMULATOR_MARKER = "SYSTEM_SIMULATOR"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stamp(doc: Dict[str, Any]) -> Dict[str, Any]:
    doc["generated_by"] = SIMULATOR_MARKER
    doc.setdefault("created_at", _now_iso())
    return doc


def _retailers(parts: List[dict]) -> List[dict]:
    return [p for p in parts if p.get("organization_type") == "retailer"]


def _distributors(parts: List[dict]) -> List[dict]:
    return [p for p in parts if p.get("organization_type") == "distributor"]


def _wholesalers(parts: List[dict]) -> List[dict]:
    return [p for p in parts if p.get("organization_type") == "wholesaler"]


def _warehouses(parts: List[dict]) -> List[dict]:
    return [p for p in parts if p.get("organization_type") == "warehouse"]


async def _resolve_tenant(org: dict) -> Optional[str]:
    """Walk parent_organization_id chain to find the owning manufacturer id."""
    cur: Optional[dict] = org
    seen: set = set()
    for _ in range(6):
        if not cur:
            return None
        if cur.get("organization_type") == "manufacturer":
            return cur.get("id")
        pid = cur.get("parent_organization_id")
        if not pid or pid in seen:
            return None
        seen.add(pid)
        cur = await db.organizations.find_one(
            {"id": pid},
            {"_id": 0, "id": 1, "organization_type": 1, "parent_organization_id": 1},
        )
    return None


async def _pick_inventory_row(owner_type: str, owner_id: str) -> Optional[dict]:
    """Return one random in-stock inventory row for the entity."""
    rows = await db.inventory.find(
        {"owner_type": owner_type, "owner_id": owner_id, "quantity": {"$gt": 0}},
        {"_id": 0},
    ).to_list(100)
    if not rows:
        return None
    import random as _rand
    return _rand.choice(rows)


async def _product(product_id: str) -> Optional[dict]:
    return await db.products.find_one({"id": product_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# 1) RETAIL SALE — retailer sells units to a consumer.
#
# Mirrors the REAL POS checkout side-effects (routes/sales.py) so every
# retailer-facing surface lights up:
#   • `retail_sales`  — simulator ledger (admin panel counts)
#   • `sales`         — POS sales book (transactions list, revenue_today)
#   • `daily_sales`   — analytics rollup (dashboard "Today's Sales",
#                       top-selling, forecasts, exec summaries)
#   • `inventory`     — quantity decrement + 7-day velocity recompute
# ---------------------------------------------------------------------------
async def generate_retail_sale(retailer: dict, rng) -> Optional[str]:
    tenant = await _resolve_tenant(retailer)
    if not tenant:
        return None
    row = await _pick_inventory_row("retailer", retailer["id"])
    if not row:
        return None
    qty = rng.randint(1, min(8, int(row.get("quantity") or 1)))
    product = await _product(row["product_id"])
    unit_price = float(
        row.get("retail_price") or (product or {}).get("unit_price") or 0
    )
    line_total = round(qty * unit_price, 2)
    now = _now_iso()
    today = now[:10]
    sale_id = str(uuid.uuid4())
    sale = _stamp({
        "id": sale_id,
        "retailer_id": retailer["id"],
        "retailer_name": retailer.get("organization_name"),
        "product_id": row["product_id"],
        "product_name": (product or {}).get("name") or row["product_id"],
        "quantity": qty,
        "unit_price": unit_price,
        "total_amount": line_total,
        "manufacturer_id": tenant,
        "city": retailer.get("city") or "",
        "region": retailer.get("region") or "",
    })
    await db.retail_sales.insert_one(sale)

    # POS sales book entry — identical shape to routes/sales.py checkout.
    await db.sales.insert_one(_stamp({
        "id": str(uuid.uuid4()),
        "transaction_code": f"SIM-{datetime.now(timezone.utc):%y%m%d}-{rng.randint(1000, 9999)}",
        "retailer_id": retailer["id"],
        "items": [{
            "product_id": row["product_id"],
            "product_name": (product or {}).get("name") or row["product_id"],
            "category": (product or {}).get("category", ""),
            "sku": (product or {}).get("sku", ""),
            "quantity": qty,
            "unit_price": unit_price,
            "line_total": line_total,
        }],
        "grand_total": line_total,
        "units_total": qty,
        "payment_method": rng.choice(["cash", "cash", "transfer", "card"]),
        "payment_status": "paid",
        "customer_name": "",
        "attendant": "",
        "notes": "Walk-in sale",
        "paid_at": now,
        "organization_id": retailer["id"],
    }))

    # Analytics rollup — what the retailer dashboard "Today's Sales",
    # top-selling, the forecast engine and exec summaries aggregate.
    await db.daily_sales.insert_one(_stamp({
        "id": str(uuid.uuid4()),
        "retailer_id": retailer["id"],
        "product_id": row["product_id"],
        "date": today,
        "units": qty,
        "quantity_sold": qty,
        "revenue": line_total,
        "source": "simulator",
        "organization_id": retailer["id"],
        "manufacturer_id": tenant,
    }))

    # Decrement inventory + audit trail.
    await db.inventory.update_one(
        {"id": row["id"]},
        {"$inc": {"quantity": -qty}, "$set": {"updated_at": now}},
    )
    await db.inventory_movements.insert_one(_stamp({
        "id": str(uuid.uuid4()),
        "owner_type": "retailer", "owner_id": retailer["id"],
        "product_id": row["product_id"],
        "delta": -qty, "kind": "retail_sale",
        "ref_id": sale_id, "manufacturer_id": tenant,
    }))

    # Recompute the 7-day sales velocity for this SKU so "Fast moving" /
    # urgency / days-of-cover figures reflect simulated demand.
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).date().isoformat()
    agg = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer["id"], "product_id": row["product_id"],
                    "date": {"$gte": week_ago}}},
        {"$group": {"_id": None, "units": {"$sum": "$units"}}},
    ]).to_list(1)
    units_7d = int((agg[0]["units"] if agg else 0) or 0)
    await db.inventory.update_one(
        {"id": row["id"]},
        {"$set": {"velocity": round(units_7d / 7.0, 2)}},
    )
    return sale_id


# ---------------------------------------------------------------------------
# 2) DISTRIBUTOR ORDER — distributor places PO against its parent.
# ---------------------------------------------------------------------------
async def generate_distributor_order(distributor: dict, parts: List[dict], rng) -> Optional[str]:
    tenant = await _resolve_tenant(distributor)
    if not tenant:
        return None
    # Distributors in this seed source from manufacturer directly.
    products = await db.products.find(
        {"manufacturer_id": tenant}, {"_id": 0},
    ).to_list(200)
    if not products:
        return None
    n_lines = rng.randint(1, 3)
    items = []
    total_amount = 0.0
    total_units = 0
    for p in rng.sample(products, min(n_lines, len(products))):
        qty = rng.randint(20, 150)
        unit_price = float(p.get("unit_price") or 0)
        items.append({
            "product_id": p["id"], "product_name": p.get("name") or p["id"],
            "quantity": qty, "unit_price": unit_price,
            "approved_quantity": qty,
        })
        total_amount += qty * unit_price
        total_units += qty
    order_id = str(uuid.uuid4())
    seq = await db.distributor_orders.count_documents({
        "manufacturer_id": tenant,
        "created_at": {"$gte": _now_iso()[:10]},
    })
    order_number = f"DO-{datetime.now(timezone.utc):%Y%m%d}-SIM{seq + 1:03d}"
    doc = _stamp({
        "id": order_id,
        "order_number": order_number,
        "manufacturer_id": tenant,
        "distributor_id": distributor["id"],
        "distributor_name": distributor.get("organization_name"),
        "warehouse_id": distributor.get("parent_organization_id"),  # strict tier: distributor's parent warehouse
        "organization_id": distributor["id"],
        "items": items,
        "status": "approved",
        "approved_at": _now_iso(),
        "total_amount": round(total_amount, 2),
        "total_units": total_units,
        "note": "Simulated distributor order",
    })
    await db.distributor_orders.insert_one(doc)
    # Mirror an allocation so the Manufacturer Allocation Center reflects it.
    alloc_id = str(uuid.uuid4())
    await db.order_allocations.insert_one(_stamp({
        "id": alloc_id,
        "order_id": order_id,
        "manufacturer_id": tenant,
        "decided_at": _now_iso(),
        "lines": [
            {"product_id": it["product_id"], "quantity": it["approved_quantity"]}
            for it in items
        ],
    }))
    return order_id


# ---------------------------------------------------------------------------
# 3) SHIPMENT — generate a fresh shipment to a participant distributor.
# ---------------------------------------------------------------------------
async def generate_shipment(parts: List[dict], rng) -> Optional[str]:
    distributors = _distributors(parts)
    if not distributors:
        return None
    dist = rng.choice(distributors)
    tenant = await _resolve_tenant(dist)
    if not tenant:
        return None
    products = await db.products.find(
        {"manufacturer_id": tenant}, {"_id": 0},
    ).to_list(200)
    if not products:
        return None
    n = rng.randint(1, 3)
    items = []
    total_units = 0
    for p in rng.sample(products, min(n, len(products))):
        qty = rng.randint(40, 200)
        items.append({"product_id": p["id"], "product_name": p.get("name") or p["id"],
                      "quantity": qty})
        total_units += qty
    wh = await db.organizations.find_one(
        {"organization_type": "warehouse", "parent_organization_id": tenant},
        {"_id": 0, "id": 1})
    eta_minutes = rng.choice([60, 90, 180, 360])
    number = f"SHP-SIM-{datetime.now(timezone.utc):%Y%m%d%H%M%S}-{rng.randint(100,999)}"
    shipment = _stamp({
        "id": str(uuid.uuid4()),
        "manufacturer_id": tenant,
        "from_role": "warehouse", "from_id": (wh or {}).get("id"),
        "to_role": "distributor", "to_id": dist["id"],
        "distributor_id": dist["id"],
        "distributor_name": dist.get("organization_name"),
        "shipment_number": number,
        "tracking_code": number,
        "status": "in_transit",
        "items": items,
        "total_units": total_units,
        "origin_city": "Lagos",
        "destination_city": dist.get("city") or "—",
        "eta_minutes": eta_minutes,
    })
    await db.shipments.insert_one(shipment)
    try:
        from services.logistics_events import emit
        await emit(tenant, "shipment_created",
                   f"Shipment {shipment['shipment_number']} created",
                   f"{total_units:,} units → {dist.get('organization_name')}",
                   shipment_id=shipment["id"], ref_code=shipment["shipment_number"])
    except Exception:
        pass
    return shipment["id"]


# ---------------------------------------------------------------------------
# 4) INVENTORY TRANSFER — warehouse → warehouse internal move.
# ---------------------------------------------------------------------------
async def generate_inventory_transfer(parts: List[dict], rng) -> Optional[str]:
    warehouses = _warehouses(parts)
    if len(warehouses) < 1:
        return None
    src = rng.choice(warehouses)
    # Pick destination distributor / retailer in the same tenant.
    tenant = await _resolve_tenant(src)
    if not tenant:
        return None
    candidates = [
        p for p in parts
        if p.get("id") != src.get("id")
        and p.get("organization_type") in ("distributor", "retailer")
    ]
    if not candidates:
        return None
    dst = rng.choice(candidates)
    row = await _pick_inventory_row("warehouse", src["id"])
    if not row:
        return None
    qty = rng.randint(5, min(50, int(row.get("quantity") or 1)))
    transfer_id = str(uuid.uuid4())
    await db.inventory_transfers.insert_one(_stamp({
        "id": transfer_id,
        "from_type": "warehouse", "from_id": src["id"],
        "to_type": dst["organization_type"], "to_id": dst["id"],
        "product_id": row["product_id"],
        "quantity": qty,
        "status": "completed",
        "manufacturer_id": tenant,
    }))
    await db.inventory.update_one(
        {"id": row["id"]},
        {"$inc": {"quantity": -qty}, "$set": {"updated_at": _now_iso()}},
    )
    # Upsert destination inventory row.
    dest_row = await db.inventory.find_one(
        {"owner_type": dst["organization_type"],
         "owner_id": dst["id"], "product_id": row["product_id"]},
        {"_id": 0},
    )
    if dest_row:
        await db.inventory.update_one(
            {"id": dest_row["id"]},
            {"$inc": {"quantity": qty}, "$set": {"updated_at": _now_iso()}},
        )
    else:
        await db.inventory.insert_one(_stamp({
            "id": str(uuid.uuid4()),
            "owner_type": dst["organization_type"], "owner_id": dst["id"],
            "organization_id": dst["id"], "product_id": row["product_id"],
            "quantity": qty, "reserved": 0, "velocity": 0,
            "manufacturer_id": tenant,
        }))
    return transfer_id


# ---------------------------------------------------------------------------
# 5) REPLENISHMENT REQUEST — low-stock signal from any participant.
# ---------------------------------------------------------------------------
async def generate_replenishment_request(parts: List[dict], rng) -> Optional[str]:
    candidates = [
        p for p in parts
        if p.get("organization_type") in ("retailer", "distributor", "wholesaler")
    ]
    if not candidates:
        return None
    org = rng.choice(candidates)
    tenant = await _resolve_tenant(org)
    if not tenant:
        return None
    row = await _pick_inventory_row(org["organization_type"], org["id"])
    if not row:
        return None
    suggested = rng.randint(50, 300)
    req_id = str(uuid.uuid4())
    await db.replenishment_requests.insert_one(_stamp({
        "id": req_id,
        "requested_by_type": org["organization_type"],
        "requested_by_id": org["id"],
        "requested_by_name": org.get("organization_name"),
        "product_id": row["product_id"],
        "current_on_hand": row.get("quantity", 0),
        "suggested_quantity": suggested,
        "priority": rng.choice(["normal", "high", "urgent"]),
        "status": "open",
        "manufacturer_id": tenant,
    }))
    return req_id


# ---------------------------------------------------------------------------
# 6) INTELLIGENCE EVENT — notification feed entry.
# ---------------------------------------------------------------------------
EVENT_TEMPLATES = [
    ("shipment_delay",
     "Shipment delayed",
     "ETA pushed back by {n} hours due to traffic on the corridor.",
     "warning"),
    ("stockout_risk",
     "Stockout risk on {product}",
     "Less than 3 days of cover remaining at {entity}.",
     "high"),
    ("demand_spike",
     "Demand spike in {region}",
     "{entity} ordered {n}× more units than last week.",
     "info"),
    ("low_inventory_alert",
     "Low inventory at {entity}",
     "{product} fell below safety stock target.",
     "warning"),
]


async def generate_intel_event(parts: List[dict], rng) -> Optional[str]:
    if not parts:
        return None
    org = rng.choice(parts)
    tenant = await _resolve_tenant(org)
    if not tenant:
        return None
    kind, title_tpl, body_tpl, severity = rng.choice(EVENT_TEMPLATES)
    product_name = "—"
    row = await _pick_inventory_row(org["organization_type"], org["id"])
    if row:
        prod = await _product(row["product_id"])
        if prod:
            product_name = prod.get("name") or product_name
    fields = {
        "entity": org.get("organization_name") or "—",
        "product": product_name,
        "region": org.get("region") or org.get("city") or "—",
        "n": rng.randint(2, 8),
    }
    notif_id = str(uuid.uuid4())
    await db.notifications.insert_one(_stamp({
        "id": notif_id,
        "kind": kind,
        "title": title_tpl.format(**fields),
        "body": body_tpl.format(**fields),
        "severity": severity,
        "manufacturer_id": tenant,
        "subject_type": org.get("organization_type"),
        "subject_id": org.get("id"),
        "read": False,
    }))
    return notif_id


# ---------------------------------------------------------------------------
# Top-level cycle — fans out into the generators above per the count config.
# ---------------------------------------------------------------------------
async def run_cycle(participants: List[dict], counts: Dict[str, int],
                     rng) -> Dict[str, int]:
    """Generate one tick worth of activity. Returns a tally per kind."""
    tally: Dict[str, int] = {"retail_sales": 0, "distributor_orders": 0,
                              "shipments": 0, "transfers": 0,
                              "replenishments": 0, "intel_events": 0,
                              "errors": 0}

    retailers = _retailers(participants)
    distributors = _distributors(participants)

    # Spotlight retailers — the demo login accounts. Bias retail sales toward
    # them so "Today's Sales" on the demo dashboards is always alive instead
    # of activity being spread invisibly thin across hundreds of shops.
    spotlight: List[dict] = []
    try:
        demo_users = await db.users.find(
            {"role": "retailer", "is_demo": True},
            {"_id": 0, "entity_id": 1},
        ).to_list(50)
        demo_ids = {u.get("entity_id") for u in demo_users}
        spotlight = [r for r in retailers if r.get("id") in demo_ids]
    except Exception:
        logger.exception("[simulator] spotlight lookup failed")

    async def _safe(awaitable, key: str) -> None:
        try:
            res = await awaitable
            if res:
                tally[key] += 1
        except Exception:
            logger.exception("[simulator] generator failed for %s", key)
            tally["errors"] += 1

    for _ in range(counts.get("retail_sales", 0)):
        if not retailers:
            break
        pool = spotlight if (spotlight and rng.random() < 0.5) else retailers
        await _safe(generate_retail_sale(rng.choice(pool), rng),
                     "retail_sales")

    for _ in range(counts.get("distributor_orders", 0)):
        if not distributors:
            break
        await _safe(generate_distributor_order(rng.choice(distributors),
                                                 participants, rng),
                     "distributor_orders")

    for _ in range(counts.get("shipments", 0)):
        await _safe(generate_shipment(participants, rng), "shipments")

    # Lower-frequency activity — once per tick max.
    await _safe(generate_inventory_transfer(participants, rng), "transfers")
    await _safe(generate_replenishment_request(participants, rng),
                "replenishments")

    for _ in range(counts.get("intel_events", 0)):
        await _safe(generate_intel_event(participants, rng), "intel_events")

    return tally
