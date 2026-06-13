"""Clean-slate supply-chain rebuild.

Wipes transactional + entity data, rebuilds the canonical hierarchy for the
two configured tenants (Unilever, Flour Mills Nigeria), seeds 90 days of
operational data and produces an audit report.

Hierarchy enforced:
    Manufacturer → Warehouse → Distributor → Wholesaler → Retailer

with a strict parent chain and `lineage_path` on every node. Up to 2 direct
distributor → key-account retailers (Shoprite / Spar / Game style) are
attached per distributor.

Run with:
    cd /app/backend && python -m scripts.rebuild
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

# Make backend importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from passlib.hash import bcrypt  # noqa: E402


RNG = random.Random(20260613)


# ---------------------------------------------------------------------------
# Collections we wipe (keep auth `users`, simulation settings, route_cache).
# ---------------------------------------------------------------------------
KEEP_COLLECTIONS = {
    "users",            # auth — remapped later
    "simulation_settings",
    "route_cache",      # caches; harmless
    "geofences",        # tenant-agnostic geofence definitions
    "seed_meta",        # seeded once, idempotency markers
}

# Tenant configuration --------------------------------------------------------
TENANT_CFG: list[dict[str, Any]] = [
    {
        "id": "b21c1dbe-1a6f-4c33-b036-f416579455d0",
        "code": "MFR-0001",
        "name": "Unilever",
        "contact_email": "ops@unilever.com",
        "products": [
            ("UL-OMO-DETERGENT",    "Omo Detergent 1kg",          "Home Care",     6500),
            ("UL-CLOSEUP-TOOTHP",   "Close-Up Toothpaste 100ml",  "Personal Care", 1200),
            ("UL-LIPTON-TEA",       "Lipton Yellow Label 100s",   "Foods",         2900),
            ("UL-KNORR-CUBES",      "Knorr Beef Cubes 50s",       "Foods",         1450),
            ("UL-ROYCO-CUBES",      "Royco Classic 100s",         "Foods",         2200),
            ("UL-AXE-BODY-SPRAY",   "Axe Body Spray 150ml",       "Personal Care", 4100),
            ("UL-LUX-SOAP",         "Lux Soft Touch Soap 175g",   "Personal Care",  850),
            ("UL-PEARS-BABY",       "Pears Baby Oil 200ml",       "Baby Care",     2700),
            ("UL-VASELINE-BLU",     "Vaseline Blue Seal 250ml",   "Personal Care", 1850),
            ("UL-BLUEBAND-SPREAD",  "Blue Band Spread 250g",      "Foods",         1750),
        ],
    },
    {
        "id": "a2d92c39-f014-47f6-b2cb-506da8c56831",
        "code": "MFR-0002",
        "name": "Flour Mills Nigeria",
        "contact_email": "ops@fmn.ng",
        "products": [
            ("FMN-GOLDEN-PENNY-1KG",     "Golden Penny Flour 1kg",     "Foods", 1450),
            ("FMN-SEMOLINA-1KG",         "Golden Penny Semolina 1kg",  "Foods", 1700),
            ("FMN-PASTA-500G",           "Golden Penny Spaghetti 500g","Foods",  650),
            ("FMN-VITAL-NOODLES",        "Vital Noodles 70g",          "Foods",  200),
            ("FMN-GP-VEG-OIL-1L",        "Golden Penny Veg Oil 1L",    "Foods", 3200),
            ("FMN-GP-RICE-5KG",          "Golden Penny Rice 5kg",      "Foods", 7900),
            ("FMN-BLUE-BREAD-FLOUR",     "Blue Star Bread Flour 50kg", "B2B",  43000),
            ("FMN-SUGAR-1KG",            "Sunti Sugar 1kg",            "Foods", 1300),
            ("FMN-GP-NOODLES-PACK",      "Golden Penny Noodles 5pk",   "Foods", 1100),
            ("FMN-GP-WHEAT-MEAL-1KG",    "Golden Penny Wheat Meal 1kg","Foods", 1400),
        ],
    },
]

# Geography per warehouse -----------------------------------------------------
REGIONS = [
    {"region": "Lagos",          "state": "Lagos",   "cities": ["Apapa", "Ikeja", "Lekki", "Surulere", "Yaba", "Ajah"]},
    {"region": "North",          "state": "Kano",    "cities": ["Kano", "Sabon Gari", "Kumbotso", "Dawakin Tofa"]},
    {"region": "South-South",    "state": "Rivers",  "cities": ["Port Harcourt", "Aba", "Eleme", "Uyo"]},
]

# Key-account retailer brand pool --------------------------------------------
KEY_ACCOUNT_BRANDS = ["Shoprite", "Spar", "Game", "Hubmart", "Justrite", "MarketSquare", "Ebeano", "Prince Ebeano"]

# Wholesaler name pool --------------------------------------------------------
WS_PREFIXES  = ["Royal", "Crown", "Sunrise", "Prime", "Apex", "Golden", "Pearl", "Star", "Premier", "Diamond"]
WS_SUFFIXES  = ["Trading", "Bulk Mart", "Wholesale", "Cash & Carry", "Mega Hub", "Aggregators", "Wholesale Depot"]

# Distributor name pool -------------------------------------------------------
DS_NAMES = [
    "Apex Distributors", "Greenfield Distribution", "Bluewave Logistics", "Pinnacle Trade Co.",
    "Vanguard Distributors", "Horizon Trade Partners", "Summit Distribution", "Crescent Trading",
    "Ironwood Distribution", "Northstar Distributors", "Coastal Trade Co.", "Highland Distribution",
]

# Standard size profile -------------------------------------------------------
WAREHOUSES_PER_MFR = 3
DISTRIBUTORS_PER_WAREHOUSE = 2     # 6 per tenant
WHOLESALERS_PER_DISTRIBUTOR = 3    # 18 per tenant
RETAILERS_PER_WHOLESALER = 4       # 72 regular per tenant
KEY_RETAILERS_PER_DISTRIBUTOR = 2  # 12 key per tenant — total 84

# Transactional shape ---------------------------------------------------------
HISTORY_DAYS = 90
STATUS_MIX = [
    ("draft", 0.05),
    ("submitted", 0.20),
    ("approved", 0.10),
    ("rejected", 0.04),
    ("picking", 0.06),
    ("packed", 0.06),
    ("shipped", 0.10),
    ("in_transit", 0.09),
    ("delivered", 0.25),
    ("closed", 0.05),
]

PASSWORD_HASH = "$2b$12$" + "x" * 53  # placeholder, replaced below


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def days_ago(d: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=d)).isoformat()


def uid(prefix: str, n: int) -> str:
    """Deterministic UUID-ish for repeatable seeds."""
    h = hashlib.md5(f"{prefix}-{n}".encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def jitter(base: float, pct: float = 0.25) -> float:
    delta = base * pct
    return base + RNG.uniform(-delta, delta)


def pick_status() -> str:
    r = RNG.random()
    cum = 0.0
    for st, p in STATUS_MIX:
        cum += p
        if r <= cum:
            return st
    return "delivered"


def coord_for(region: str) -> tuple[float, float]:
    base = {
        "Lagos":        (6.55, 3.35),
        "North":        (12.00, 8.50),
        "South-South":  (4.85, 7.05),
    }[region]
    return (base[0] + RNG.uniform(-0.20, 0.20),
            base[1] + RNG.uniform(-0.20, 0.20))


def short_id(prefix: str, idx: int) -> str:
    return f"{prefix}-{idx:04d}"


# ---------------------------------------------------------------------------
# 1) WIPE
# ---------------------------------------------------------------------------
async def wipe(db) -> dict:
    names = await db.list_collection_names()
    wiped: dict[str, int] = {}
    for name in names:
        if name in KEEP_COLLECTIONS:
            continue
        cnt = await db[name].count_documents({})
        await db[name].drop()
        wiped[name] = cnt
    return wiped


# ---------------------------------------------------------------------------
# 2) ENTITY REBUILD
# ---------------------------------------------------------------------------
async def build_tenant(db, cfg: dict) -> dict:
    """Build manufacturer + warehouses + distributors + wholesalers + retailers."""
    tenant_id = cfg["id"]
    mfg_id = tenant_id
    mfg_name = cfg["name"]

    # ---- Manufacturer (organizations + legacy manufacturers) ----
    mfg_doc = {
        "id": mfg_id, "organization_code": cfg["code"], "organization_name": mfg_name,
        "organization_type": "manufacturer", "parent_organization_id": None,
        "parent_id": None, "parent_type": None,
        "lineage_path": f"MFR/{cfg['code']}",
        "status": "active", "region": None, "state": None, "city": None, "address": None,
        "contact_email": cfg["contact_email"], "contact_phone": None, "contact_name": None,
        "metadata": {"tenant_id": tenant_id},
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.organizations.insert_one(mfg_doc)
    await db.manufacturers.insert_one({"id": mfg_id, "name": mfg_name})

    # ---- Products ----
    products: list[dict] = []
    for sku, name, cat, price in cfg["products"]:
        p = {
            "id": uid(f"{cfg['code']}-PRD", len(products)),
            "sku": sku, "name": name, "category": cat,
            "unit_price": price,
            "manufacturer_id": mfg_id, "organization_id": mfg_id,
            "created_at": now_iso(),
        }
        await db.products.insert_one(p)
        products.append(p)

    # ---- Warehouses ----
    warehouses: list[dict] = []
    for i, region in enumerate(REGIONS[:WAREHOUSES_PER_MFR]):
        wh_id = uid(f"{cfg['code']}-WH", i)
        wh = {
            "id": wh_id,
            "organization_code": short_id(f"{cfg['code']}-WH", i + 1),
            "organization_name": f"{mfg_name} {region['region']} Warehouse",
            "organization_type": "warehouse",
            "parent_organization_id": mfg_id,
            "parent_id": mfg_id, "parent_type": "manufacturer",
            "lineage_path": "",  # set below
            "status": "active",
            "region": region["region"], "state": region["state"],
            "city": region["cities"][0],
            "address": f"{RNG.randint(1, 200)} Industrial Avenue, {region['cities'][0]}",
            "contact_email": f"warehouse{i+1}@{cfg['code'].lower()}.local",
            "metadata": {"tenant_id": tenant_id, "manufacturer_id": mfg_id},
            "created_at": now_iso(), "updated_at": now_iso(),
        }
        # Recompute lineage_path cleanly (string-fmt above had escape gymnastics).
        wh["lineage_path"] = f"{mfg_doc['lineage_path']}/{wh['organization_code']}"
        await db.organizations.insert_one(wh)
        warehouses.append(wh)

    # ---- Distributors ----
    distributors: list[dict] = []
    ds_idx = 0
    for wh in warehouses:
        region = wh["region"]
        cities = next(r["cities"] for r in REGIONS if r["region"] == region)
        for j in range(DISTRIBUTORS_PER_WAREHOUSE):
            ds_idx += 1
            d_id = uid(f"{cfg['code']}-DS", ds_idx)
            d_code = short_id(f"{cfg['code']}-DST", ds_idx)
            d_name = f"{DS_NAMES[(ds_idx - 1) % len(DS_NAMES)]} ({wh['city']})"
            city = cities[(j + 1) % len(cities)]
            lat, lng = coord_for(region)
            ds_org = {
                "id": d_id,
                "organization_code": d_code,
                "organization_name": d_name,
                "organization_type": "distributor",
                "parent_organization_id": wh["id"],
                "parent_id": wh["id"], "parent_type": "warehouse",
                "lineage_path": f"{wh['lineage_path']}/{d_code}",
                "status": "active", "region": region, "state": wh["state"], "city": city,
                "address": f"{RNG.randint(1, 500)} Trade Lane, {city}",
                "contact_email": f"{d_code.lower()}@{cfg['code'].lower()}.local",
                "latitude": lat, "longitude": lng,
                "metadata": {
                    "tenant_id": tenant_id, "manufacturer_id": mfg_id,
                    "warehouse_id": wh["id"],
                },
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            await db.organizations.insert_one(ds_org)
            await db.distributors.insert_one({
                "id": d_id, "name": d_name, "code": d_code,
                "region": region, "city": city,
                "contact_email": ds_org["contact_email"],
                "manufacturer_id": mfg_id, "warehouse_id": wh["id"],
                "organization_id": d_id, "lineage_path": ds_org["lineage_path"],
                "latitude": lat, "longitude": lng,
                "created_at": now_iso(),
            })
            distributors.append(ds_org)

    # ---- Wholesalers ----
    wholesalers: list[dict] = []
    ws_idx = 0
    for ds in distributors:
        cities = next(r["cities"] for r in REGIONS if r["region"] == ds["region"])
        for k in range(WHOLESALERS_PER_DISTRIBUTOR):
            ws_idx += 1
            w_id = uid(f"{cfg['code']}-WS", ws_idx)
            w_code = short_id(f"{cfg['code']}-WHO", ws_idx)
            prefix = WS_PREFIXES[(ws_idx - 1) % len(WS_PREFIXES)]
            suffix = WS_SUFFIXES[(ws_idx - 1) % len(WS_SUFFIXES)]
            w_name = f"{prefix} {suffix} {ws_idx}"
            city = cities[(k + 2) % len(cities)]
            lat, lng = coord_for(ds["region"])
            ws_org = {
                "id": w_id,
                "organization_code": w_code,
                "organization_name": w_name,
                "organization_type": "wholesaler",
                "parent_organization_id": ds["id"],
                "parent_id": ds["id"], "parent_type": "distributor",
                "lineage_path": f"{ds['lineage_path']}/{w_code}",
                "status": "active", "region": ds["region"], "state": ds["state"], "city": city,
                "address": f"{RNG.randint(1, 500)} Market Road, {city}",
                "contact_email": f"{w_code.lower()}@{cfg['code'].lower()}.local",
                "latitude": lat, "longitude": lng,
                "metadata": {
                    "tenant_id": tenant_id, "manufacturer_id": mfg_id,
                    "warehouse_id": ds["metadata"]["warehouse_id"],
                    "distributor_id": ds["id"],
                },
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            await db.organizations.insert_one(ws_org)
            wholesalers.append(ws_org)

    # ---- Retailers (wholesaler-served + key-account direct) ----
    retailers: list[dict] = []
    rt_idx = 0
    # (a) wholesaler-served retailers
    for ws in wholesalers:
        cities = next(r["cities"] for r in REGIONS if r["region"] == ws["region"])
        for n in range(RETAILERS_PER_WHOLESALER):
            rt_idx += 1
            r_id = uid(f"{cfg['code']}-RT", rt_idx)
            r_code = short_id(f"{cfg['code']}-RTL", rt_idx)
            city = cities[(n + 1) % len(cities)]
            r_name = RNG.choice([
                f"Best Mart {rt_idx}", f"Family Shop {rt_idx}", f"Quick Stop {rt_idx}",
                f"Daily Needs {rt_idx}", f"Corner Store {rt_idx}", f"Big Apple {rt_idx}",
                f"Neighborhood Mini {rt_idx}",
            ])
            lat, lng = coord_for(ws["region"])
            r_org = {
                "id": r_id, "organization_code": r_code, "organization_name": r_name,
                "organization_type": "retailer",
                "parent_organization_id": ws["id"],
                "parent_id": ws["id"], "parent_type": "wholesaler",
                "lineage_path": f"{ws['lineage_path']}/{r_code}",
                "status": "active", "region": ws["region"], "state": ws["state"], "city": city,
                "address": f"{RNG.randint(1, 500)} Main Street, {city}",
                "latitude": lat, "longitude": lng,
                "metadata": {
                    "tenant_id": tenant_id, "manufacturer_id": mfg_id,
                    "warehouse_id": ws["metadata"]["warehouse_id"],
                    "distributor_id": ws["metadata"]["distributor_id"],
                    "wholesaler_id": ws["id"],
                    "channel": "wholesaler",
                },
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            await db.organizations.insert_one(r_org)
            await db.retailers.insert_one({
                "id": r_id, "name": r_name, "code": r_code,
                "region": ws["region"], "city": city,
                "address": r_org["address"],
                "distributor_id": ws["metadata"]["distributor_id"],
                "wholesaler_id": ws["id"],
                "store_code": r_code, "latitude": lat, "longitude": lng,
                "organization_id": r_id, "lineage_path": r_org["lineage_path"],
                "channel": "wholesaler",
                "created_at": now_iso(),
            })
            retailers.append(r_org)

    # (b) key-account retailers under distributors directly
    key_idx = 0
    for ds in distributors:
        cities = next(r["cities"] for r in REGIONS if r["region"] == ds["region"])
        for n in range(KEY_RETAILERS_PER_DISTRIBUTOR):
            key_idx += 1
            rt_idx += 1
            brand = KEY_ACCOUNT_BRANDS[(key_idx - 1) % len(KEY_ACCOUNT_BRANDS)]
            city = cities[n % len(cities)]
            r_id = uid(f"{cfg['code']}-KA", key_idx)
            r_code = short_id(f"{cfg['code']}-RTL-KA", key_idx)
            r_name = f"{brand} {city}"
            lat, lng = coord_for(ds["region"])
            r_org = {
                "id": r_id, "organization_code": r_code, "organization_name": r_name,
                "organization_type": "retailer",
                "parent_organization_id": ds["id"],
                "parent_id": ds["id"], "parent_type": "distributor",
                "lineage_path": f"{ds['lineage_path']}/{r_code}",
                "status": "active", "region": ds["region"], "state": ds["state"], "city": city,
                "address": f"{RNG.randint(1, 50)} Premium Mall, {city}",
                "latitude": lat, "longitude": lng,
                "metadata": {
                    "tenant_id": tenant_id, "manufacturer_id": mfg_id,
                    "warehouse_id": ds["metadata"]["warehouse_id"],
                    "distributor_id": ds["id"], "wholesaler_id": None,
                    "channel": "key_account", "key_account_brand": brand,
                },
                "created_at": now_iso(), "updated_at": now_iso(),
            }
            await db.organizations.insert_one(r_org)
            await db.retailers.insert_one({
                "id": r_id, "name": r_name, "code": r_code,
                "region": ds["region"], "city": city, "address": r_org["address"],
                "distributor_id": ds["id"], "wholesaler_id": None,
                "store_code": r_code, "latitude": lat, "longitude": lng,
                "organization_id": r_id, "lineage_path": r_org["lineage_path"],
                "channel": "key_account",
                "created_at": now_iso(),
            })
            retailers.append(r_org)

    return {
        "tenant_id": tenant_id, "mfg": mfg_doc, "products": products,
        "warehouses": warehouses, "distributors": distributors,
        "wholesalers": wholesalers, "retailers": retailers,
    }


# ---------------------------------------------------------------------------
# 3) INVENTORY + 4) TRANSACTIONS
# ---------------------------------------------------------------------------
async def seed_inventory(db, tree: dict) -> dict:
    """Stock every warehouse / distributor / wholesaler / retailer with each tenant SKU."""
    rows = []
    for kind, nodes, base in [
        ("warehouse", tree["warehouses"], (10000, 25000)),
        ("distributor", tree["distributors"], (3000, 8000)),
        ("wholesaler", tree["wholesalers"], (600, 1800)),
        ("retailer", tree["retailers"], (40, 250)),
    ]:
        for node in nodes:
            for prod in tree["products"]:
                qty = RNG.randint(*base)
                rows.append({
                    "owner_id": node["id"], "owner_type": kind,
                    "product_id": prod["id"], "tenant_id": tree["tenant_id"],
                    "warehouse_id": node["id"] if kind == "warehouse" else None,
                    "organization_id": node["id"],
                    "quantity": qty, "available": qty,
                    "reserved": 0, "in_transit": 0,
                    "updated_at": now_iso(),
                })
    if rows:
        await db.inventory.insert_many(rows)
    return {"inventory_rows": len(rows)}


async def seed_transactions(db, tree: dict) -> dict:
    """Seed retailer sales, retailer→wholesaler POs, wholesaler→distributor POs,
    distributor→warehouse orders, fulfillment + shipments — all with realistic
    status distribution across the last HISTORY_DAYS days."""
    out = {
        "daily_sales": 0, "retailer_pos": 0, "wholesaler_pos": 0,
        "distributor_orders": 0, "shipments": 0, "fulfillment_orders": 0,
        "wholesaler_orders_legacy_skip": 0,
    }
    tenant_id = tree["tenant_id"]
    products = tree["products"]
    if not products:
        return out

    # ---- (a) Retailer daily_sales for the past 90 days ----
    sales_rows = []
    for retailer in tree["retailers"]:
        for d in range(HISTORY_DAYS):
            day = (datetime.now(timezone.utc) - timedelta(days=d)).date().isoformat()
            # Pick 1–3 products sold that day
            for prod in RNG.sample(products, k=min(len(products), RNG.randint(1, 3))):
                qty = RNG.randint(1, 10)
                sales_rows.append({
                    "retailer_id": retailer["id"], "organization_id": retailer["id"],
                    "product_id": prod["id"], "tenant_id": tenant_id,
                    "date": day, "units": qty,
                    "revenue": round(qty * prod["unit_price"] * RNG.uniform(1.1, 1.3), 2),
                    "channel": retailer["metadata"].get("channel", "wholesaler"),
                    "created_at": days_ago(d),
                })
    # Bulk insert in chunks of 5000
    for i in range(0, len(sales_rows), 5000):
        await db.daily_sales.insert_many(sales_rows[i:i + 5000])
    out["daily_sales"] = len(sales_rows)

    # ---- (b) Retailer → Wholesaler/Distributor purchase orders ----
    po_counter = 0
    for retailer in tree["retailers"]:
        # 4–10 POs per retailer across the period
        n_pos = RNG.randint(4, 10)
        for _ in range(n_pos):
            d = RNG.randint(0, HISTORY_DAYS - 1)
            channel = retailer["metadata"].get("channel", "wholesaler")
            if channel == "key_account":
                supplier_id = retailer["metadata"]["distributor_id"]
                supplier_type = "distributor"
            else:
                supplier_id = retailer["metadata"]["wholesaler_id"]
                supplier_type = "wholesaler"
            picked = RNG.sample(products, k=min(len(products), RNG.randint(1, 3)))
            lines = []
            total = 0.0
            for prod in picked:
                qty = RNG.randint(5, 50)
                lt = round(qty * prod["unit_price"], 2)
                lines.append({
                    "product_id": prod["id"], "quantity": qty,
                    "unit_cost": prod["unit_price"], "line_total": lt,
                })
                total += lt
            po_counter += 1
            st = pick_status()
            po = {
                "id": uid(f"PO-{tenant_id}", po_counter),
                "po_number": f"PO-2026-{po_counter:05d}",
                "retailer_id": retailer["id"],
                "distributor_id": supplier_id,
                "supplier_type": supplier_type,
                "items": lines,
                "total_amount": round(total, 2),
                "status": st,
                "tenant_id": tenant_id, "organization_id": retailer["id"],
                "submitted_at": days_ago(d) if st != "draft" else None,
                "shipped_at": days_ago(max(0, d - 1)) if st in ("shipped", "in_transit", "delivered", "closed") else None,
                "delivered_at": days_ago(max(0, d - 2)) if st in ("delivered", "closed") else None,
                "created_at": days_ago(d), "updated_at": days_ago(max(0, d - 1)),
                "status_history": [{"status": "draft", "at": days_ago(d), "note": "Created"}],
            }
            await db.purchase_orders.insert_one(po)
            out["retailer_pos"] += 1

            # If shipped → create a shipment
            if st in ("shipped", "in_transit", "delivered", "closed"):
                sh = {
                    "id": uid(f"SH-{po['id']}", 1),
                    "tracking_code": f"SHP-{po_counter:06X}".upper(),
                    "from_role": supplier_type, "from_id": supplier_id,
                    "to_role": "retailer", "to_id": retailer["id"],
                    "items": [{"product_id": ln["product_id"], "quantity": ln["quantity"]} for ln in lines],
                    "status": "delivered" if st in ("delivered", "closed") else ("in_transit" if st == "in_transit" else "shipped"),
                    "request_id": po["id"],
                    "tenant_id": tenant_id, "organization_id": supplier_id,
                    "created_at": po.get("shipped_at"),
                    "delivered_at": po.get("delivered_at"),
                }
                await db.shipments.insert_one(sh)
                out["shipments"] += 1

    # ---- (c) Wholesaler → Distributor procurement POs ----
    wpo_counter = 0
    for ws in tree["wholesalers"]:
        n_pos = RNG.randint(3, 6)
        for _ in range(n_pos):
            d = RNG.randint(0, HISTORY_DAYS - 1)
            dist_id = ws["metadata"]["distributor_id"]
            picked = RNG.sample(products, k=min(len(products), RNG.randint(2, 5)))
            lines = []
            total = 0.0
            for prod in picked:
                qty = RNG.randint(50, 400)
                lt = round(qty * prod["unit_price"] * 0.9, 2)
                lines.append({
                    "product_id": prod["id"], "product_name": prod["name"],
                    "sku": prod["sku"], "quantity": qty,
                    "unit_cost": round(prod["unit_price"] * 0.9, 2), "line_total": lt,
                })
                total += lt
            wpo_counter += 1
            st = pick_status()
            wpo = {
                "id": uid(f"WPO-{tenant_id}", wpo_counter),
                "po_number": f"WPO-2026-{wpo_counter:05d}",
                "wholesaler_id": ws["id"],
                "supplier_id": dist_id,
                "supplier_type": "distributor",
                "supplier_name": next(d["organization_name"] for d in tree["distributors"] if d["id"] == dist_id),
                "items": lines,
                "total_amount": round(total, 2),
                "status": st,
                "tenant_id": tenant_id, "organization_id": ws["id"],
                "created_at": days_ago(d), "updated_at": days_ago(max(0, d - 1)),
                "submitted_at": days_ago(d) if st != "draft" else None,
                "shipped_at": days_ago(max(0, d - 1)) if st in ("shipped", "in_transit", "delivered", "closed") else None,
                "delivered_at": days_ago(max(0, d - 2)) if st in ("delivered", "closed") else None,
                "status_history": [{"status": "draft", "at": days_ago(d), "note": "Created"}],
            }
            await db.wholesaler_purchase_orders.insert_one(wpo)
            out["wholesaler_pos"] += 1

            if st in ("shipped", "in_transit", "delivered", "closed"):
                sh = {
                    "id": uid(f"SH-{wpo['id']}", 1),
                    "tracking_code": f"SHW-{wpo_counter:06X}".upper(),
                    "from_role": "distributor", "from_id": dist_id,
                    "to_role": "wholesaler", "to_id": ws["id"],
                    "items": [{"product_id": ln["product_id"], "quantity": ln["quantity"]} for ln in lines],
                    "status": "delivered" if st in ("delivered", "closed") else ("in_transit" if st == "in_transit" else "shipped"),
                    "request_id": wpo["id"],
                    "tenant_id": tenant_id, "organization_id": dist_id,
                    "created_at": wpo["shipped_at"], "delivered_at": wpo["delivered_at"],
                }
                await db.shipments.insert_one(sh)
                out["shipments"] += 1

    # ---- (d) Distributor → Warehouse orders (replenishment) ----
    do_counter = 0
    for ds in tree["distributors"]:
        wh_id = ds["metadata"]["warehouse_id"]
        n_orders = RNG.randint(4, 8)
        for _ in range(n_orders):
            d = RNG.randint(0, HISTORY_DAYS - 1)
            picked = RNG.sample(products, k=min(len(products), RNG.randint(3, 7)))
            lines = []
            total = 0.0
            units = 0
            for prod in picked:
                qty = RNG.randint(200, 800)
                lt = round(qty * prod["unit_price"] * 0.8, 2)
                lines.append({
                    "product_id": prod["id"], "product_name": prod["name"],
                    "quantity": qty,
                    "unit_cost": round(prod["unit_price"] * 0.8, 2),
                    "line_total": lt,
                })
                total += lt
                units += qty
            do_counter += 1
            st = pick_status()
            do = {
                "id": uid(f"DO-{tenant_id}", do_counter),
                "order_number": f"DO-2026-{do_counter:05d}",
                "distributor_id": ds["id"],
                "warehouse_id": wh_id,
                "manufacturer_id": tenant_id,
                "items": lines, "total_units": units,
                "total_amount": round(total, 2),
                "status": st,
                "tenant_id": tenant_id, "organization_id": ds["id"],
                "created_at": days_ago(d),
            }
            await db.distributor_orders.insert_one(do)
            out["distributor_orders"] += 1

    return out


# ---------------------------------------------------------------------------
# 5) USERS REMAP
# ---------------------------------------------------------------------------
async def remap_users(db, trees: list[dict]) -> dict:
    """Rebuild the demo login accounts so they point at the new entities.
    Other auth users (super_admin) are left alone."""
    # Drop all non-super_admin users to start clean.
    await db.users.delete_many({"role": {"$ne": "super_admin"}})

    pwd = bcrypt.hash("TradeKonekt2026!")
    created: list[str] = []

    def base_user(email: str, role: str, name: str, entity_id: str, tenant_id: str) -> dict:
        return {
            "id": uid(email, 1),
            "email": email, "password_hash": pwd,
            "role": role, "name": name,
            "entity_id": entity_id, "tenant_id": tenant_id,
            "status": "active", "created_at": now_iso(),
            "last_login": None, "failed_login_attempts": 0,
        }

    for tree in trees:
        mfg_id = tree["mfg"]["id"]
        mfg_code = tree["mfg"]["organization_code"]
        tenant_prefix = "unilever" if "Unilever" in tree["mfg"]["organization_name"] else "fmn"

        # Manufacturer admin
        await db.users.insert_one(base_user(
            f"{tenant_prefix}@tradekonekt.io", "manufacturer",
            f"{tree['mfg']['organization_name']} Admin", mfg_id, mfg_id))
        created.append(f"{tenant_prefix}@tradekonekt.io")

        # First warehouse manager
        first_wh = tree["warehouses"][0]
        await db.users.insert_one(base_user(
            f"{tenant_prefix}.warehouse@tradekonekt.io", "warehouse",
            f"{first_wh['organization_name']} Manager",
            first_wh["id"], mfg_id))
        created.append(f"{tenant_prefix}.warehouse@tradekonekt.io")

        # First distributor admin
        first_ds = tree["distributors"][0]
        await db.users.insert_one(base_user(
            f"{tenant_prefix}.distributor@tradekonekt.io", "distributor",
            f"{first_ds['organization_name']} Admin", first_ds["id"], mfg_id))
        created.append(f"{tenant_prefix}.distributor@tradekonekt.io")

        # First wholesaler admin
        first_ws = tree["wholesalers"][0]
        await db.users.insert_one(base_user(
            f"{tenant_prefix}.wholesaler@tradekonekt.io", "wholesaler",
            f"{first_ws['organization_name']} Admin", first_ws["id"], mfg_id))
        created.append(f"{tenant_prefix}.wholesaler@tradekonekt.io")

        # First retailer
        first_rt = tree["retailers"][0]
        await db.users.insert_one(base_user(
            f"{tenant_prefix}.retailer@tradekonekt.io", "retailer",
            f"{first_rt['organization_name']} Owner", first_rt["id"], mfg_id))
        created.append(f"{tenant_prefix}.retailer@tradekonekt.io")

    # Re-create or upsert super_admin so login is always possible.
    if not await db.users.find_one({"email": "admin@tradekonekt.io"}):
        await db.users.insert_one(base_user(
            "admin@tradekonekt.io", "super_admin", "Super Admin", "", ""))

    # Enrich every seeded user with hierarchy refs so role-scoped routes
    # (which expect `manufacturer_id`/`warehouse_id`/etc on the user dict)
    # can resolve scope without falling back to 403.
    async for u in db.users.find({"role": {"$ne": "super_admin"}}, {"_id": 0}):
        entity_id = u.get("entity_id")
        if not entity_id:
            continue
        org = await db.organizations.find_one({"id": entity_id}, {"_id": 0})
        if not org:
            continue
        md = org.get("metadata") or {}
        patch = {
            "organization_id": entity_id,
            "manufacturer_id": md.get("manufacturer_id")
                or (entity_id if org.get("organization_type") == "manufacturer" else None),
        }
        otype = org.get("organization_type")
        if otype == "warehouse":
            patch["warehouse_id"] = entity_id
        elif otype == "distributor":
            patch["warehouse_id"] = md.get("warehouse_id")
            patch["distributor_id"] = entity_id
        elif otype == "wholesaler":
            patch["warehouse_id"] = md.get("warehouse_id")
            patch["distributor_id"] = md.get("distributor_id")
            patch["wholesaler_id"] = entity_id
        elif otype == "retailer":
            patch["warehouse_id"] = md.get("warehouse_id")
            patch["distributor_id"] = md.get("distributor_id")
            patch["wholesaler_id"] = md.get("wholesaler_id")
            patch["retailer_id"] = entity_id
        patch = {k: v for k, v in patch.items() if v is not None}
        if patch:
            await db.users.update_one({"id": u["id"]}, {"$set": patch})

    return {"users_created": created}


# ---------------------------------------------------------------------------
# 6) AUDIT
# ---------------------------------------------------------------------------
async def audit(db) -> dict:
    report: dict[str, Any] = {"per_manufacturer": [], "integrity": {}}
    async for mfg in db.organizations.find({"organization_type": "manufacturer"}, {"_id": 0}):
        wh_count = await db.organizations.count_documents(
            {"organization_type": "warehouse", "parent_organization_id": mfg["id"]})
        # distributors of all those warehouses
        wh_ids = [w["id"] for w in await db.organizations.find(
            {"organization_type": "warehouse", "parent_organization_id": mfg["id"]},
            {"_id": 0, "id": 1}).to_list(50)]
        ds_count = await db.organizations.count_documents(
            {"organization_type": "distributor", "parent_organization_id": {"$in": wh_ids}})
        ds_ids = [d["id"] for d in await db.organizations.find(
            {"organization_type": "distributor", "parent_organization_id": {"$in": wh_ids}},
            {"_id": 0, "id": 1}).to_list(100)]
        ws_count = await db.organizations.count_documents(
            {"organization_type": "wholesaler", "parent_organization_id": {"$in": ds_ids}})
        ws_ids = [w["id"] for w in await db.organizations.find(
            {"organization_type": "wholesaler", "parent_organization_id": {"$in": ds_ids}},
            {"_id": 0, "id": 1}).to_list(200)]
        rt_count_ws = await db.organizations.count_documents(
            {"organization_type": "retailer", "parent_organization_id": {"$in": ws_ids}})
        rt_count_ka = await db.organizations.count_documents(
            {"organization_type": "retailer", "parent_organization_id": {"$in": ds_ids}})
        report["per_manufacturer"].append({
            "manufacturer": mfg["organization_name"],
            "code": mfg["organization_code"],
            "warehouses": wh_count, "distributors": ds_count,
            "wholesalers": ws_count,
            "retailers_via_wholesaler": rt_count_ws,
            "retailers_key_account_direct": rt_count_ka,
            "total_retailers": rt_count_ws + rt_count_ka,
        })

    # Integrity checks
    report["integrity"] = {
        "retailers_without_parent": await db.organizations.count_documents(
            {"organization_type": "retailer", "parent_organization_id": None}),
        "wholesalers_without_distributor": await db.organizations.count_documents(
            {"organization_type": "wholesaler", "parent_organization_id": None}),
        "distributors_without_warehouse": await db.organizations.count_documents(
            {"organization_type": "distributor", "parent_organization_id": None}),
        "warehouses_without_manufacturer": await db.organizations.count_documents(
            {"organization_type": "warehouse", "parent_organization_id": None}),
    }
    return report


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def main() -> None:
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]

    print("[1/6] Wiping data…")
    wiped = await wipe(db)
    print(f"      Wiped {sum(wiped.values()):,} docs across {len(wiped)} collections")

    print("[2/6] Building entity hierarchy…")
    trees = []
    for cfg in TENANT_CFG:
        tree = await build_tenant(db, cfg)
        trees.append(tree)
        print(f"      {cfg['name']}: {len(tree['warehouses'])} WH · "
              f"{len(tree['distributors'])} DST · {len(tree['wholesalers'])} WHO · "
              f"{len(tree['retailers'])} RTL · {len(tree['products'])} SKU")

    print("[3/6] Seeding inventory…")
    for tree in trees:
        res = await seed_inventory(db, tree)
        print(f"      {tree['mfg']['organization_name']}: {res['inventory_rows']:,} rows")

    print("[4/6] Seeding 90-day transactional data…")
    for tree in trees:
        res = await seed_transactions(db, tree)
        print(f"      {tree['mfg']['organization_name']}: {res}")

    print("[5/6] Remapping demo users…")
    res = await remap_users(db, trees)
    print(f"      Created {len(res['users_created'])} users")

    print("[6/6] Hierarchy audit…")
    report = await audit(db)

    # Map a login user onto every entity in the tree (224 accounts) on top of
    # the per-role admin shortcuts created above.
    try:
        from scripts.map_users import main as map_users_main
        await map_users_main()
    except Exception:
        # Fall back gracefully — admin shortcuts still work.
        pass

    # Drop a sentinel so the FastAPI bootstrap skips its demo seeders on
    # next reload (otherwise the legacy FMN / Unilever seeders would
    # re-inject parallel entities and pollute our hierarchy).
    await db.seed_meta.update_one(
        {"key": "canonical_rebuild_v1"},
        {"$set": {"key": "canonical_rebuild_v1",
                  "applied_at": now_iso(),
                  "report": report}},
        upsert=True,
    )
    out_path = Path("/app/backups/rebuild_audit_report.json")
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"\nAudit report saved to: {out_path}")
    print("✓ Rebuild complete.")


if __name__ == "__main__":
    asyncio.run(main())
