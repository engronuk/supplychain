"""CSV seed: wipes collections and rebuilds the dataset from /backend/data."""
from __future__ import annotations

import csv
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from core import DATA_DIR, db, new_id
from models import (
    Distributor, InventoryItem, Manufacturer, Notification,
    Product, RequestLine, Retailer, StockRequest,
)

PRODUCT_COL_MAP = {
    "Blue Band Margarine": "Blue Band Margarine",
    "Lipton Yellow Label Tea": "Lipton Yellow Label Tea",
    "Royco Bouillon Cubes": "Royco Bouillon Cubes",
    "Knorr Bouillon Cubes": "Knorr Bouillon Cubes",
    "OMO Detergent": "OMO Multi-Active Detergent",
    "Sunlight Washing Powder": "Sunlight Washing Powder",
    "Sunlight Dishwashing Liquid": "Sunlight Dishwashing Liquid",
    "Close-Up Toothpaste": "Close-Up Toothpaste",
    "Pepsodent Toothpaste": "Pepsodent Toothpaste",
    "Lux Soap": "LUX Beauty Soap",
    "Lifebuoy Soap": "Lifebuoy Soap",
    "Rexona": "Rexona Deodorant",
    "Pears": "Pears Baby Products",
    "Vaseline": "Vaseline Lotion & Jelly",
    "Axe Body Spray": "Axe Body Spray",
}

PRODUCT_CATEGORY = {
    "Blue Band Margarine": "Food",
    "Lipton Yellow Label Tea": "Beverages",
    "Royco Bouillon Cubes": "Food",
    "Knorr Bouillon Cubes": "Food",
    "OMO Multi-Active Detergent": "Home Care",
    "Sunlight Washing Powder": "Home Care",
    "Sunlight Dishwashing Liquid": "Home Care",
    "Close-Up Toothpaste": "Personal Care",
    "Pepsodent Toothpaste": "Personal Care",
    "LUX Beauty Soap": "Personal Care",
    "Lifebuoy Soap": "Personal Care",
    "Rexona Deodorant": "Personal Care",
    "Pears Baby Products": "Personal Care",
    "Vaseline Lotion & Jelly": "Personal Care",
    "Axe Body Spray": "Personal Care",
}

PRODUCT_PRICE_NGN = {
    "Blue Band Margarine": 2200,
    "Lipton Yellow Label Tea": 3500,
    "Royco Bouillon Cubes": 800,
    "Knorr Bouillon Cubes": 850,
    "OMO Multi-Active Detergent": 4200,
    "Sunlight Washing Powder": 3800,
    "Sunlight Dishwashing Liquid": 1500,
    "Close-Up Toothpaste": 1800,
    "Pepsodent Toothpaste": 1700,
    "LUX Beauty Soap": 950,
    "Lifebuoy Soap": 900,
    "Rexona Deodorant": 3200,
    "Pears Baby Products": 2400,
    "Vaseline Lotion & Jelly": 2100,
    "Axe Body Spray": 4500,
}


def _slug_sku(name: str) -> str:
    base = "".join(c for c in name.upper() if c.isalnum() or c == " ").split()
    return "UL-" + "-".join(base[:3])[:18]


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


async def seed_from_csv() -> dict:
    for c in ["manufacturers", "distributors", "retailers", "products", "inventory",
              "shipments", "requests", "notifications", "daily_sales"]:
        await db[c].delete_many({})

    # 1. Manufacturer
    mfg = Manufacturer(name="Unilever", headquarters="London / Lagos", contact_email="ops@unilever.com")
    await db.manufacturers.insert_one(mfg.model_dump())

    # 2. Products (15 from CSV)
    products_path = DATA_DIR / "products.csv"
    barcodes: Dict[str, str] = {}
    if products_path.exists():
        with products_path.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                name = r["Product"]
                if name and name not in barcodes:
                    barcodes[name] = r.get("Barcode", "")
    product_docs: List[Product] = []
    canonical_names = sorted(set(PRODUCT_COL_MAP.values()))
    name_to_pid: Dict[str, str] = {}
    for name in canonical_names:
        p = Product(
            sku=_slug_sku(name),
            name=name,
            category=PRODUCT_CATEGORY.get(name, "General"),
            unit_price=float(PRODUCT_PRICE_NGN.get(name, 1000)),
            barcode=barcodes.get(name, ""),
            manufacturer_id=mfg.id,
        )
        product_docs.append(p)
        name_to_pid[name] = p.id
    await db.products.insert_many([p.model_dump() for p in product_docs])

    # 3. Distributors + Retailers from CSV
    dist_path = DATA_DIR / "distributors.csv"
    distributor_docs: Dict[str, Distributor] = {}
    retailer_rows: List[dict] = []
    if dist_path.exists():
        with dist_path.open(encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                dname = (r.get("Distributor") or "").strip()
                rname = (r.get("Retailer") or "").strip()
                if not dname:
                    continue
                if dname not in distributor_docs:
                    distributor_docs[dname] = Distributor(
                        name=dname,
                        region=(r.get("Region") or "").strip() or "—",
                        city=(r.get("City") or "").strip(),
                        contact_email="",
                        manufacturer_id=mfg.id,
                    )
                if rname:
                    retailer_rows.append(r)

    distributor_list = list(distributor_docs.values())
    await db.distributors.insert_many([d.model_dump() for d in distributor_list])
    dist_by_name = {d.name: d for d in distributor_list}

    retailer_docs: List[Retailer] = []
    retailer_rows_by_id: Dict[str, dict] = {}
    for r in retailer_rows:
        dname = r["Distributor"].strip()
        rname = r["Retailer"].strip()
        d = dist_by_name.get(dname)
        if not d:
            continue
        ret = Retailer(
            name=rname,
            region=(r.get("Region") or "").strip() or "—",
            city=(r.get("City") or "").strip(),
            address=(r.get("Address") or "").strip(),
            contact_email="",
            distributor_id=d.id,
            store_code=(r.get("Store Code") or "").strip(),
            phone=(r.get("Phone") or "").strip(),
            latitude=_safe_float(r.get("Latitude")),
            longitude=_safe_float(r.get("Longitude")),
        )
        retailer_docs.append(ret)
        retailer_rows_by_id[ret.id] = r
    await db.retailers.insert_many([r.model_dump() for r in retailer_docs])

    # 4. Inventory
    rng = random.Random(42)
    inv_docs = []

    for p in product_docs:
        inv_docs.append(InventoryItem(
            owner_type="manufacturer", owner_id=mfg.id, product_id=p.id,
            quantity=5000 + rng.randint(0, 5000), reorder_level=1000,
        ).model_dump())

    for d in distributor_list:
        for col, prod_name in PRODUCT_COL_MAP.items():
            pid = name_to_pid[prod_name]
            inv_docs.append(InventoryItem(
                owner_type="distributor", owner_id=d.id, product_id=pid,
                quantity=400 + rng.randint(0, 600), reorder_level=100,
            ).model_dump())

    for ridx, ret in enumerate(retailer_docs):
        row = retailer_rows_by_id.get(ret.id, {})
        for pidx, (col, prod_name) in enumerate(PRODUCT_COL_MAP.items()):
            try:
                q = int(row.get(col, "0") or 0)
            except ValueError:
                q = 0
            pid = name_to_pid[prod_name]
            base = 0.4 + ((ridx * 13 + pidx * 7) % 9) * 0.5
            if prod_name in {"OMO Multi-Active Detergent", "Lipton Yellow Label Tea", "Blue Band Margarine"}:
                base *= 1.6
            velocity = round(base, 2)
            inv_docs.append(InventoryItem(
                owner_type="retailer", owner_id=ret.id, product_id=pid,
                quantity=q, reorder_level=30, velocity=velocity,
            ).model_dump())
    if inv_docs:
        await db.inventory.insert_many(inv_docs)

    # 4b. Seed 14 days of synthetic daily sales for a sample of retailers
    sales_docs: List[dict] = []
    today = datetime.now(timezone.utc).date()
    products_by_id = {p.id: p for p in product_docs}
    sample_retailers = (retailer_docs[:1] + retailer_docs[10:11] + retailer_docs[20:21]) if retailer_docs else []
    for ret in sample_retailers:
        ret_inv = [i for i in inv_docs if i["owner_id"] == ret.id and i["owner_type"] == "retailer"]
        for day in range(14, 0, -1):
            d = (today - timedelta(days=day - 1)).isoformat()
            for it in ret_inv:
                v = float(it.get("velocity", 0))
                if v <= 0:
                    continue
                jitter = 0.6 + ((hash(d + it["product_id"]) % 100) / 100.0) * 0.8
                units = max(0, int(round(v * jitter)))
                if units == 0:
                    continue
                price = float(products_by_id.get(it["product_id"]).unit_price) if products_by_id.get(it["product_id"]) else 0.0
                sales_docs.append({
                    "id": new_id(),
                    "retailer_id": ret.id,
                    "product_id": it["product_id"],
                    "date": d,
                    "units": units,
                    "revenue": round(units * price, 2),
                })
    if sales_docs:
        await db.daily_sales.insert_many(sales_docs)

    # 5. Seeded shipments
    now = datetime.now(timezone.utc)
    seed_shipments: List[dict] = []
    plan_mfg = [("received", 9), ("in_transit", 4), ("pending", 1),
                ("received", 12), ("in_transit", 2), ("pending", 0)]
    for idx, (status, days_ago) in enumerate(plan_mfg):
        if idx >= len(distributor_list):
            break
        d = distributor_list[idx]
        chosen = product_docs[idx % len(product_docs): idx % len(product_docs) + 2] or [product_docs[0]]
        items = [{"product_id": p.id, "quantity": 100 + idx * 50} for p in chosen]
        seed_shipments.append({
            "id": new_id(),
            "from_role": "manufacturer", "from_id": mfg.id,
            "to_role": "distributor", "to_id": d.id,
            "manufacturer_id": mfg.id, "distributor_id": d.id, "retailer_id": "",
            "items": items, "status": status,
            "tracking_code": "SHP-" + uuid.uuid4().hex[:8].upper(),
            "notes": None,
            "created_at": (now - timedelta(days=days_ago, hours=idx)).isoformat(),
            "dispatched_at": (now - timedelta(days=max(days_ago - 1, 0))).isoformat() if status in ("in_transit", "received") else None,
            "received_at": (now - timedelta(days=max(days_ago - 2, 0))).isoformat() if status == "received" else None,
            "request_id": None,
        })

    primary_d = distributor_list[0] if distributor_list else None
    primary_retailers = [r for r in retailer_docs if r.distributor_id == (primary_d.id if primary_d else "")]
    plan_ret = [("received", 8), ("received", 5), ("in_transit", 3), ("in_transit", 1),
                ("pending", 0), ("received", 11)]
    for idx, (status, days_ago) in enumerate(plan_ret):
        if not primary_retailers:
            break
        r = primary_retailers[idx % len(primary_retailers)]
        chosen = product_docs[idx % len(product_docs): idx % len(product_docs) + 2] or [product_docs[0]]
        items = [{"product_id": p.id, "quantity": 15 + idx * 5} for p in chosen]
        seed_shipments.append({
            "id": new_id(),
            "from_role": "distributor", "from_id": primary_d.id,
            "to_role": "retailer", "to_id": r.id,
            "manufacturer_id": "", "distributor_id": primary_d.id, "retailer_id": r.id,
            "items": items, "status": status,
            "tracking_code": "SHP-" + uuid.uuid4().hex[:8].upper(),
            "notes": None,
            "created_at": (now - timedelta(days=days_ago, hours=idx)).isoformat(),
            "dispatched_at": (now - timedelta(days=max(days_ago - 1, 0))).isoformat() if status in ("in_transit", "received") else None,
            "received_at": (now - timedelta(days=max(days_ago - 2, 0))).isoformat() if status == "received" else None,
            "request_id": None,
        })

    if seed_shipments:
        await db.shipments.insert_many(seed_shipments)

    # 6. Pending request from primary retailer
    if primary_retailers and primary_d:
        r = primary_retailers[0]
        await db.requests.insert_one(StockRequest(
            retailer_id=r.id, distributor_id=primary_d.id,
            items=[
                RequestLine(product_id=product_docs[0].id, quantity=40),
                RequestLine(product_id=product_docs[3].id, quantity=25),
            ],
            note="Weekend rush prep — please prioritize.",
        ).model_dump())

    # 7. Welcome notifications
    notifs = []
    notifs.append(Notification(
        target_type="manufacturer", target_id=mfg.id,
        title="Welcome to TradeKonekt", type="system",
        message=f"Unilever workspace is ready. You have {len(distributor_list)} distributors connected.",
    ).model_dump())
    if primary_d:
        notifs.append(Notification(
            target_type="distributor", target_id=primary_d.id,
            title="Workspace Ready", type="system",
            message=f"{primary_d.name} is connected to {len(primary_retailers)} retailers.",
        ).model_dump())
    if primary_retailers:
        notifs.append(Notification(
            target_type="retailer", target_id=primary_retailers[0].id,
            title="Workspace Ready", type="system",
            message=f"{primary_retailers[0].name} is connected to its distributor.",
        ).model_dump())
    if notifs:
        await db.notifications.insert_many(notifs)

    return {
        "manufacturers": 1,
        "distributors": len(distributor_list),
        "retailers": len(retailer_docs),
        "products": len(product_docs),
        "shipments": len(seed_shipments),
        "inventory_rows": len(inv_docs),
        "primary_distributor_id": (primary_d.id if primary_d else None),
        "primary_retailer_id": (primary_retailers[0].id if primary_retailers else None),
    }
