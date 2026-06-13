"""Live-activity orchestrator.

Runs the existing idempotent seeders that populate operational ledgers
(fulfillment_orders, GRNs, wholesaler ops, promotions, intel forecasts,
delay predictions, planned routes) on top of the canonical hierarchy
created by `scripts/rebuild.py`.

Safe to re-run — each underlying seeder is keyed on a `seed_tag` so it
won't duplicate. Records a `seed_meta.live_activity_v1` marker.

    cd /app/backend && python -m scripts.live_activity
"""
from __future__ import annotations

import asyncio
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def days_ago_iso(d: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=d)).isoformat()


# ---------------------------------------------------------------------------
# Wrappers around existing seed functions. We import them lazily so a
# failure in any one doesn't kill the whole run.
# ---------------------------------------------------------------------------
async def safe_call(label: str, coro):
    try:
        res = await coro
        print(f"  ✓ {label}: {res}")
        return res
    except Exception as exc:  # noqa: BLE001
        print(f"  ✗ {label}: {exc}")
        return {"error": str(exc)}


async def seed_promotions(db) -> dict:
    """Two promotions per manufacturer (one running, one upcoming)."""
    existing = await db.promotions.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    async for mfg in db.organizations.find(
        {"organization_type": "manufacturer"}, {"_id": 0, "id": 1, "organization_name": 1}
    ):
        prods = await db.products.find(
            {"manufacturer_id": mfg["id"]}, {"_id": 0, "id": 1, "name": 1, "unit_price": 1}
        ).to_list(20)
        if not prods:
            continue
        # 1 running
        focus_run = random.sample(prods, k=min(3, len(prods)))
        docs.append({
            "id": f"PROMO-{mfg['id'][:8]}-RUN",
            "manufacturer_id": mfg["id"], "organization_id": mfg["id"],
            "name": "Q3 Top-Up Promo", "type": "buy_x_get_y",
            "discount_pct": 12,
            "start_date": days_ago_iso(14), "end_date": days_ago_iso(-14),
            "status": "running",
            "products": [p["id"] for p in focus_run],
            "channels": ["wholesaler", "distributor", "key_account"],
            "regions": ["Lagos", "North", "South-South"],
            "seed_tag": "live_v1",
            "created_at": days_ago_iso(20),
        })
        # 1 upcoming
        focus_up = random.sample(prods, k=min(2, len(prods)))
        docs.append({
            "id": f"PROMO-{mfg['id'][:8]}-UP",
            "manufacturer_id": mfg["id"], "organization_id": mfg["id"],
            "name": "Festive Push 2026", "type": "flat_discount",
            "discount_pct": 18,
            "start_date": days_ago_iso(-7), "end_date": days_ago_iso(-30),
            "status": "scheduled",
            "products": [p["id"] for p in focus_up],
            "channels": ["wholesaler", "key_account"],
            "regions": ["Lagos", "South-South"],
            "seed_tag": "live_v1",
            "created_at": days_ago_iso(2),
        })
    if docs:
        await db.promotions.insert_many(docs)
    return {"created": len(docs)}


async def seed_back_orders(db) -> dict:
    """Synthesise a few back-orders from rejected/in-flight POs."""
    existing = await db.back_orders.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    cursor = db.purchase_orders.find(
        {"status": {"$in": ["rejected", "approved", "submitted"]}},
        {"_id": 0, "id": 1, "po_number": 1, "retailer_id": 1, "distributor_id": 1,
         "supplier_type": 1, "items": 1, "tenant_id": 1, "created_at": 1},
    ).limit(40)
    async for po in cursor:
        for it in (po.get("items") or [])[:2]:
            short = max(1, int(it.get("quantity", 1) * random.uniform(0.2, 0.6)))
            docs.append({
                "id": f"BO-{po['id'][:8]}-{it['product_id'][:6]}",
                "order_id": po["id"], "order_number": po.get("po_number"),
                "retailer_id": po.get("retailer_id"),
                "supplier_id": po.get("distributor_id"),
                "supplier_type": po.get("supplier_type", "wholesaler"),
                "product_id": it["product_id"],
                "quantity": short, "fulfilled_quantity": 0,
                "status": "open",
                "tenant_id": po.get("tenant_id"),
                "organization_id": po.get("retailer_id"),
                "created_at": po.get("created_at") or now_iso(),
                "seed_tag": "live_v1",
            })
    if docs:
        await db.back_orders.insert_many(docs)
    return {"created": len(docs)}


async def seed_notifications(db) -> dict:
    """Sprinkle a few cross-role notifications so the bell badge isn't empty."""
    existing = await db.notifications.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    titles_by_role = {
        "manufacturer": [
            ("Forecast confidence dropped", "North region SKUs flagged — review the demand panel."),
            ("New distributor PO awaiting review", "Apex Distributors filed a replenishment request."),
            ("Plant capacity utilisation 92%", "Bottling line 2 near saturation."),
        ],
        "distributor": [
            ("Wholesaler PO submitted", "Royal Trading 1 sent a new PO for 5 SKUs."),
            ("Shipment delayed", "Truck TK-014 reported 90-min ETA slip."),
            ("Inventory low — Knorr Cubes", "Reorder triggered."),
        ],
        "wholesaler": [
            ("3 retailer POs awaiting approval", "Lagos cluster filed at 09:32."),
            ("Distributor confirmed restock ETA", "Tomorrow 10:00 — 4 SKUs."),
        ],
        "retailer": [
            ("Order delivered", "PO-2026-00012 marked received."),
            ("New promo: Q3 Top-Up Promo", "12% off Knorr, Lux Soap — wholesaler stocked."),
        ],
    }
    async for org in db.organizations.find(
        {"organization_type": {"$in": list(titles_by_role)}},
        {"_id": 0, "id": 1, "organization_type": 1},
    ).limit(120):
        role = org["organization_type"]
        for title, body in titles_by_role[role][: random.randint(1, len(titles_by_role[role]))]:
            docs.append({
                "id": f"N-{org['id'][:8]}-{random.randint(1000, 9999)}",
                "target_type": role, "target_id": org["id"],
                "title": title, "body": body,
                "type": "system", "read": random.random() < 0.3,
                "created_at": days_ago_iso(random.uniform(0, 5)),
                "seed_tag": "live_v1",
            })
    if docs:
        await db.notifications.insert_many(docs)
    return {"created": len(docs)}


async def seed_grns_from_shipments(db) -> dict:
    """For every delivered manufacturer → warehouse shipment, drop a GRN."""
    existing = await db.grns.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    async for sh in db.shipments.find(
        {"to_role": "warehouse", "status": "delivered"},
        {"_id": 0},
    ).limit(60):
        docs.append({
            "id": f"GRN-{sh['id'][:8]}",
            "grn_number": f"GRN-2026-{len(docs) + 1:05d}",
            "warehouse_id": sh["to_id"],
            "shipment_id": sh["id"],
            "tracking_code": sh.get("tracking_code"),
            "supplier_id": sh.get("from_id"),
            "supplier_type": sh.get("from_role"),
            "items": [
                {**it, "quantity_received": it["quantity"], "variance": 0}
                for it in sh.get("items", [])
            ],
            "status": "received",
            "received_by": "seed-bot",
            "received_at": sh.get("delivered_at") or now_iso(),
            "tenant_id": sh.get("tenant_id"),
            "organization_id": sh["to_id"],
            "seed_tag": "live_v1",
            "created_at": sh.get("delivered_at") or now_iso(),
        })
    if docs:
        await db.grns.insert_many(docs)
    return {"created": len(docs)}


async def seed_inventory_movements(db) -> dict:
    """Materialise inventory ledger entries from delivered & shipped events."""
    existing = await db.inventory_movements.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    async for sh in db.shipments.find(
        {"status": {"$in": ["delivered", "shipped", "in_transit"]}},
        {"_id": 0},
    ).limit(500):
        from_id = sh.get("from_id")
        to_id = sh.get("to_id")
        if not from_id or not to_id:
            continue
        for it in sh.get("items", []):
            base = {
                "shipment_id": sh["id"],
                "tracking_code": sh.get("tracking_code"),
                "product_id": it["product_id"],
                "quantity": it["quantity"],
                "tenant_id": sh.get("tenant_id"),
                "seed_tag": "live_v1",
                "created_at": sh.get("created_at") or now_iso(),
            }
            # Out of source.
            docs.append({**base, "id": f"MV-OUT-{sh['id'][:8]}-{it['product_id'][:6]}",
                         "movement_type": "shipment_out",
                         "owner_id": from_id, "owner_type": sh.get("from_role"),
                         "organization_id": from_id,
                         "direction": "out"})
            # Into destination if delivered.
            if sh.get("status") == "delivered":
                docs.append({**base, "id": f"MV-IN-{sh['id'][:8]}-{it['product_id'][:6]}",
                             "movement_type": "shipment_in",
                             "owner_id": to_id, "owner_type": sh.get("to_role"),
                             "organization_id": to_id,
                             "direction": "in"})
    if docs:
        # Chunk insert.
        for i in range(0, len(docs), 2000):
            await db.inventory_movements.insert_many(docs[i:i + 2000])
    return {"created": len(docs)}


async def seed_intel_alerts(db) -> dict:
    """Sprinkle intelligence alerts per manufacturer."""
    existing = await db.intel_alerts.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    templates = [
        ("stockout_risk", "Stock-out risk: {prod} — North region",
         "Days of cover dropped below 7. Trigger a transfer from Lagos."),
        ("demand_spike", "Demand spike on {prod}",
         "21% week-on-week uptick in the Lagos cluster. Push promo."),
        ("price_variance", "Distributor price variance > 5%",
         "Apex Distributors trading 6.4% above SRP on {prod}."),
        ("forecast_breach", "Forecast breached on {prod}",
         "Actual sales 18% above 14-day rolling forecast — reorder upstream."),
        ("delay_alert", "Two shipments delayed today",
         "TK-014 & TK-022 reporting 90-min slip — re-sequence dispatch."),
    ]
    docs: list[dict] = []
    async for mfg in db.organizations.find(
        {"organization_type": "manufacturer"}, {"_id": 0, "id": 1},
    ):
        prods = await db.products.find(
            {"manufacturer_id": mfg["id"]}, {"_id": 0, "id": 1, "name": 1, "sku": 1},
        ).to_list(20)
        for _ in range(12):
            tpl = random.choice(templates)
            p = random.choice(prods) if prods else None
            docs.append({
                "id": f"AL-{mfg['id'][:8]}-{random.randint(10000, 99999)}",
                "manufacturer_id": mfg["id"], "organization_id": mfg["id"],
                "alert_type": tpl[0],
                "title": tpl[1].format(prod=(p or {}).get("name", "SKU")),
                "body": tpl[2].format(prod=(p or {}).get("name", "SKU")),
                "severity": random.choice(["info", "warning", "critical"]),
                "status": random.choice(["open", "open", "open", "acknowledged"]),
                "product_id": (p or {}).get("id"),
                "created_at": days_ago_iso(random.uniform(0, 6)),
                "seed_tag": "live_v1",
            })
    if docs:
        await db.intel_alerts.insert_many(docs)
    return {"created": len(docs)}


async def seed_intel_forecasts(db) -> dict:
    """Compact forecast — one row per (product, region) for 14 future days."""
    existing = await db.intel_forecasts.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    regions = ["Lagos", "North", "South-South"]
    async for prod in db.products.find({}, {"_id": 0, "id": 1, "manufacturer_id": 1, "name": 1, "unit_price": 1}):
        for region in regions:
            base = random.randint(800, 4500)
            forecast = []
            for d in range(14):
                forecast.append({
                    "date": (datetime.now(timezone.utc) + timedelta(days=d)).date().isoformat(),
                    "units": int(base * random.uniform(0.85, 1.15)),
                    "confidence": round(random.uniform(0.7, 0.95), 2),
                })
            docs.append({
                "id": f"FC-{prod['id'][:8]}-{region[:3]}",
                "manufacturer_id": prod["manufacturer_id"],
                "organization_id": prod["manufacturer_id"],
                "product_id": prod["id"], "product_name": prod["name"],
                "region": region,
                "horizon_days": 14,
                "forecast": forecast,
                "accuracy_30d": round(random.uniform(78, 94), 1),
                "model_version": "demand-v2.3",
                "created_at": now_iso(),
                "seed_tag": "live_v1",
            })
    if docs:
        for i in range(0, len(docs), 1000):
            await db.intel_forecasts.insert_many(docs[i:i + 1000])
    return {"created": len(docs)}


async def seed_delay_predictions(db) -> dict:
    """One delay-prediction doc per in-flight shipment."""
    existing = await db.delay_predictions.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    async for sh in db.shipments.find(
        {"status": {"$in": ["in_transit", "shipped"]}}, {"_id": 0},
    ).limit(150):
        prob = round(random.uniform(0.1, 0.85), 2)
        docs.append({
            "id": f"DP-{sh['id'][:8]}",
            "shipment_id": sh["id"],
            "tracking_code": sh.get("tracking_code"),
            "delay_probability": prob,
            "expected_delay_hours": round(random.uniform(0, 8) * prob, 1),
            "drivers": random.sample([
                "weather", "traffic", "border_check", "fuel_queue", "loading_lag",
            ], k=random.randint(1, 3)),
            "recommendation": "Re-sequence dispatch from a secondary hub." if prob > 0.5 else "Monitor — within tolerance.",
            "tenant_id": sh.get("tenant_id"),
            "organization_id": sh.get("from_id"),
            "created_at": now_iso(),
            "seed_tag": "live_v1",
        })
    if docs:
        await db.delay_predictions.insert_many(docs)
    return {"created": len(docs)}


async def seed_planned_routes(db) -> dict:
    """A handful of saved planned routes for each warehouse."""
    existing = await db.planned_routes.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    async for wh in db.organizations.find(
        {"organization_type": "warehouse"}, {"_id": 0, "id": 1, "organization_name": 1, "region": 1},
    ):
        dist_cursor = db.organizations.find(
            {"organization_type": "distributor", "parent_organization_id": wh["id"]},
            {"_id": 0, "id": 1, "organization_name": 1, "region": 1},
        ).limit(3)
        async for ds in dist_cursor:
            docs.append({
                "id": f"PR-{wh['id'][:8]}-{ds['id'][:6]}",
                "name": f"{wh['organization_name']} → {ds['organization_name']}",
                "origin_id": wh["id"], "destination_id": ds["id"],
                "region": wh.get("region"),
                "distance_km": round(random.uniform(40, 380), 1),
                "duration_min": random.randint(60, 540),
                "fuel_cost": random.randint(8000, 65000),
                "polyline": [],
                "active": True,
                "created_at": now_iso(),
                "seed_tag": "live_v1",
            })
    if docs:
        await db.planned_routes.insert_many(docs)
    return {"created": len(docs)}


async def seed_transfer_orders(db) -> dict:
    """Inter-warehouse rebalancing transfers (a few per manufacturer)."""
    existing = await db.transfer_orders.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    statuses = ["draft", "approved", "in_transit", "completed"]
    async for mfg in db.organizations.find(
        {"organization_type": "manufacturer"}, {"_id": 0, "id": 1},
    ):
        warehouses = await db.organizations.find(
            {"organization_type": "warehouse", "parent_organization_id": mfg["id"]},
            {"_id": 0, "id": 1, "organization_name": 1, "region": 1},
        ).to_list(10)
        prods = await db.products.find(
            {"manufacturer_id": mfg["id"]}, {"_id": 0, "id": 1, "name": 1},
        ).to_list(20)
        if len(warehouses) < 2 or not prods:
            continue
        for _ in range(5):
            a, b = random.sample(warehouses, 2)
            picked = random.sample(prods, k=min(3, len(prods)))
            st = random.choice(statuses)
            docs.append({
                "id": f"TRF-{mfg['id'][:6]}-{random.randint(1000, 9999)}",
                "transfer_number": f"TRF-2026-{len(docs) + 1:04d}",
                "manufacturer_id": mfg["id"], "organization_id": mfg["id"],
                "from_warehouse_id": a["id"], "from_warehouse_name": a["organization_name"],
                "to_warehouse_id": b["id"], "to_warehouse_name": b["organization_name"],
                "reason": random.choice([
                    "Rebalancing — North-West shortage",
                    "Demand-spike support",
                    "Promo build-up",
                    "Stockout prevention",
                ]),
                "items": [{
                    "product_id": p["id"], "product_name": p["name"],
                    "quantity": random.randint(500, 4000),
                } for p in picked],
                "status": st,
                "created_at": days_ago_iso(random.uniform(0, 10)),
                "eta": days_ago_iso(-random.uniform(0, 4)),
                "seed_tag": "live_v1",
            })
    if docs:
        await db.transfer_orders.insert_many(docs)
    return {"created": len(docs)}


async def seed_replenishment_requests(db) -> dict:
    """Warehouse / distributor replenishment requests, distributor in-bound."""
    existing = await db.requests.count_documents({"seed_tag": "live_v1"})
    if existing:
        return {"skipped": True, "existing": existing}
    docs: list[dict] = []
    statuses = ["pending", "approved", "fulfilled", "rejected"]
    async for ds in db.organizations.find(
        {"organization_type": "distributor"}, {"_id": 0, "id": 1, "organization_name": 1, "metadata": 1},
    ).limit(40):
        wh_id = (ds.get("metadata") or {}).get("warehouse_id")
        prods = await db.products.find(
            {"manufacturer_id": (ds.get("metadata") or {}).get("manufacturer_id")},
            {"_id": 0, "id": 1, "name": 1},
        ).to_list(20)
        if not prods:
            continue
        for _ in range(random.randint(2, 4)):
            picked = random.sample(prods, k=min(2, len(prods)))
            st = random.choice(statuses)
            docs.append({
                "id": f"REQ-{ds['id'][:6]}-{random.randint(1000, 9999)}",
                "request_number": f"REQ-2026-{len(docs) + 1:04d}",
                "type": "replenishment",
                "from_id": ds["id"], "from_type": "distributor",
                "to_id": wh_id, "to_type": "warehouse",
                "items": [{
                    "product_id": p["id"], "product_name": p["name"],
                    "quantity": random.randint(50, 500),
                } for p in picked],
                "status": st,
                "priority": random.choice(["normal", "high", "urgent"]),
                "tenant_id": (ds.get("metadata") or {}).get("manufacturer_id"),
                "organization_id": ds["id"],
                "created_at": days_ago_iso(random.uniform(0, 7)),
                "seed_tag": "live_v1",
            })
    if docs:
        await db.requests.insert_many(docs)
    return {"created": len(docs)}


async def main() -> None:
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    random.seed(20260213)

    print("Live-activity seed — populating operational ledgers…")

    # External seeders (existing infrastructure) ---------------------------
    from services.seed_warehouse_operations import seed as seed_warehouse_ops
    from services.seed_allocation import seed as seed_allocation
    from services.seed_logistics import seed_logistics
    from services.seed_wholesaler import seed_wholesaler_data
    from services.seed_wholesaler_orders import seed_wholesaler_orders
    from services.seed_pulse_events import main as seed_pulse_events
    from services.seed_procurement import seed_procurement

    await safe_call("allocation/fulfillment_orders", seed_allocation())
    await safe_call("warehouse_ops (GRNs/dispatches)", seed_warehouse_ops())
    await safe_call("logistics (vehicles/transfers/requests)", seed_logistics())
    await safe_call("wholesaler inventory + POs", seed_wholesaler_data())
    await safe_call("wholesaler orders + fulfillments", seed_wholesaler_orders())
    # seed_pulse_events.main is sync — wrap in run_in_executor
    loop = asyncio.get_event_loop()
    try:
        res = await loop.run_in_executor(None, seed_pulse_events)
        print(f"  ✓ pulse intelligence: {res}")
    except Exception as exc:  # noqa: BLE001
        print(f"  ✗ pulse intelligence: {exc}")
    await safe_call("procurement quotes", seed_procurement())

    # Tailored seeders (live_activity-specific) ----------------------------
    await safe_call("promotions", seed_promotions(db))
    await safe_call("back_orders", seed_back_orders(db))
    await safe_call("notifications", seed_notifications(db))
    await safe_call("GRNs (from delivered shipments)", seed_grns_from_shipments(db))
    await safe_call("inventory_movements", seed_inventory_movements(db))
    await safe_call("intel_alerts", seed_intel_alerts(db))
    await safe_call("intel_forecasts", seed_intel_forecasts(db))
    await safe_call("delay_predictions", seed_delay_predictions(db))
    await safe_call("planned_routes", seed_planned_routes(db))
    await safe_call("transfer_orders", seed_transfer_orders(db))
    await safe_call("requests (replenishment)", seed_replenishment_requests(db))

    await db.seed_meta.update_one(
        {"key": "live_activity_v1"},
        {"$set": {"key": "live_activity_v1", "applied_at": now_iso()}},
        upsert=True,
    )
    print("\n✓ Live-activity seed complete.")


if __name__ == "__main__":
    asyncio.run(main())
