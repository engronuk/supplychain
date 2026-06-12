"""Scale the Flour Mills Nigeria demo tenant to a ~500-entity national network.

Target topology (totals INCLUDE the original 8 entities from
seed_flour_mills_tenant):

    8   warehouses    — one per region (+2 in Lagos, the commercial hub)
    120 distributors  — 15 per warehouse
    40  wholesalers   — 5 per region, parented under distributors round-robin
    332 retailers     — ~8 per wholesaler, spread across region city pools
    ─────────────────
    500 entities total

Every entity:
  • lives in `organizations` with the standard org shape
  • is mirrored into the legacy `distributors` / `retailers` collections
    (dashboards still resolve entities from those)
  • is tagged `simulation_participant: True` so the Activity Simulator
    generates background sales / orders / shipments against it
  • gets inventory rows for the 6 Golden Penny products
  • (retailers only) gets a 14-day `daily_sales` history so velocity,
    top-selling and forecast panels are populated immediately

Designed for a one-shot run on an Atlas cluster during deploy:
  • gated by a `seed_meta` marker doc → re-runs are a single find_one no-op
  • all writes are batched (insert_many / bulk_write), no per-doc round trips
"""
from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from pymongo import UpdateOne

from core import db, logger, now_iso

SEED_MARKER_ID = "fmn_network_v1"

TYPE_PREFIX = {
    "manufacturer": "MFR", "warehouse": "WHR", "distributor": "DST",
    "wholesaler": "WHO", "retailer": "RTL", "logistics_provider": "LOG",
}

# (region, warehouse_city, city pool for dist/wholesalers/retailers)
REGION_PLAN: List[Dict] = [
    {"region": "Lagos",         "wh_city": "Ikeja",
     "cities": ["Ikeja", "Surulere", "Yaba", "Lekki", "Ikorodu", "Apapa", "Agege", "Oshodi"]},
    {"region": "South West",    "wh_city": "Ibadan",
     "cities": ["Ibadan", "Abeokuta", "Osogbo", "Akure", "Ado-Ekiti", "Ilorin", "Ogbomoso"]},
    {"region": "South East",    "wh_city": "Enugu",
     "cities": ["Enugu", "Onitsha", "Aba", "Owerri", "Awka", "Abakaliki", "Nnewi", "Umuahia"]},
    {"region": "South South",   "wh_city": "Port Harcourt",
     "cities": ["Port Harcourt", "Benin City", "Warri", "Uyo", "Calabar", "Asaba", "Yenagoa"]},
    {"region": "North Central", "wh_city": "Abuja",
     "cities": ["Abuja", "Jos", "Makurdi", "Minna", "Lokoja", "Lafia", "Keffi"]},
    {"region": "North East",    "wh_city": "Maiduguri",
     "cities": ["Maiduguri", "Bauchi", "Gombe", "Yola", "Damaturu", "Jalingo"]},
    {"region": "North West",    "wh_city": "Kano",
     "cities": ["Kano", "Kaduna", "Sokoto", "Katsina", "Zaria", "Gusau", "Birnin Kebbi"]},
]

BIZ_PREFIXES = [
    "Zenith", "Golden Gate", "Unity", "Crown", "Royal", "Summit", "Horizon",
    "Savannah", "Palmline", "Delta", "TrustPoint", "Victory", "Apex",
    "Liberty", "Heritage", "Phoenix", "Eagle", "Diamond", "Pinnacle",
    "Cornerstone", "Greenfield", "Silverline", "Kingsway", "NewEra",
    "Sunrise", "Prestige", "Atlantic", "Sahel", "Harmony", "Beacon",
]
BIZ_SUFFIXES = [
    "Distribution Ltd", "Distributors", "Trading Co", "Ventures",
    "Global Resources", "Merchants Ltd", "Supply Co", "Commodities Ltd",
    "& Sons Distribution", "Enterprises",
]
SHOP_OWNERS = [
    "Adewale", "Chukwu", "Ngozi", "Emeka", "Bola", "Musa", "Amina", "Tunde",
    "Ifeanyi", "Halima", "Sade", "Obi", "Yusuf", "Funke", "Chinedu", "Kemi",
    "Segun", "Zainab", "Uche", "Femi", "Aisha", "Gbenga", "Nneka", "Sani",
    "Tope", "Chiamaka", "Idris", "Folake", "Eze", "Maryam", "Damilola",
    "Hassan", "Olamide", "Blessing", "Kelechi", "Fatima",
]
SHOP_TYPES = [
    "Supermarket", "Stores", "Provisions", "Mini Mart", "Superstores",
    "Foods", "Mart", "Groceries", "Trading Stores", "Kiosk & Provisions",
]

# Inventory targets per tier (±5 % jitter applied)
TIER_QTY = {"warehouse": 5000, "distributor": 1500, "wholesaler": 600, "retailer": 120}
TIER_REORDER = {"warehouse": 1000, "distributor": 300, "wholesaler": 120, "retailer": 30}

HISTORY_DAYS = 14


async def _alloc_codes(org_type: str, n: int) -> List[str]:
    """Reserve a contiguous block of N org codes with ONE counter round trip."""
    key = f"org_seq_{org_type}"
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": n}}, upsert=True, return_document=True,
    )
    end = int((doc or {}).get("seq", n))
    start = end - n + 1
    return [f"{TYPE_PREFIX[org_type]}-{i:04d}" for i in range(start, end + 1)]


def _org_doc(*, code: str, name: str, kind: str, parent_id: str,
             region: str, city: str) -> Dict:
    return {
        "id": str(uuid.uuid4()),
        "organization_code": code,
        "organization_name": name,
        "organization_type": kind,
        "parent_organization_id": parent_id,
        "status": "active",
        "region": region,
        "state": None,
        "city": city,
        "address": None,
        "contact_email": None,
        "contact_phone": None,
        "contact_name": None,
        "metadata": {"seeded_by": "seed_flour_mills_network"},
        "simulation_participant": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def _unique_name(base: str, used: set) -> str:
    name = base
    i = 2
    while name in used:
        name = f"{base} {i}"
        i += 1
    used.add(name)
    return name


async def run() -> Dict:
    # ---- One-shot gate ------------------------------------------------------
    if await db.seed_meta.find_one({"id": SEED_MARKER_ID}, {"_id": 1}):
        return {"skipped": "already seeded"}

    mfg = await db.organizations.find_one(
        {"organization_name": "Flour Mills Nigeria", "organization_type": "manufacturer"},
        {"_id": 0, "id": 1},
    )
    if not mfg:
        return {"skipped": "Flour Mills tenant not seeded yet"}
    mfg_id = mfg["id"]

    products = await db.products.find(
        {"manufacturer_id": mfg_id}, {"_id": 0, "id": 1, "name": 1, "unit_price": 1},
    ).to_list(50)
    if not products:
        return {"skipped": "Flour Mills products not seeded yet"}

    rng = random.Random(20260612)  # deterministic
    used_names = {
        o["organization_name"] async for o in
        db.organizations.find({}, {"_id": 0, "organization_name": 1})
    }

    new_warehouses: List[Dict] = []
    new_distributors: List[Dict] = []
    new_wholesalers: List[Dict] = []
    new_retailers: List[Dict] = []
    # retailer.id → parent distributor id (for the legacy mirror)
    retailer_dist: Dict[str, str] = {}

    # ---- Existing FMN anchors (Apapa warehouse / Prime / Lagos Hub) ---------
    existing_wh = await db.organizations.find_one(
        {"organization_name": "Flour Mills Lagos Warehouse"}, {"_id": 0, "id": 1})
    existing_dist = await db.organizations.find_one(
        {"organization_name": "Prime Distribution Services Ltd"}, {"_id": 0, "id": 1})

    wh_codes = await _alloc_codes("warehouse", 7)
    dist_codes = await _alloc_codes("distributor", 119)
    who_codes = await _alloc_codes("wholesaler", 39)
    rtl_codes = await _alloc_codes("retailer", 327)
    code_iters = {
        "warehouse": iter(wh_codes), "distributor": iter(dist_codes),
        "wholesaler": iter(who_codes), "retailer": iter(rtl_codes),
    }

    # ---- Build the tree in memory -------------------------------------------
    # 7 new warehouses (Lagos/Apapa already exists → Lagos gets a 2nd in Ikeja).
    region_warehouses: Dict[str, List[Dict]] = {"Lagos": []}
    if existing_wh:
        region_warehouses["Lagos"].append({"id": existing_wh["id"], "region": "Lagos"})
    for plan in REGION_PLAN:
        wh = _org_doc(
            code=next(code_iters["warehouse"]),
            name=_unique_name(f"Flour Mills {plan['wh_city']} Warehouse", used_names),
            kind="warehouse", parent_id=mfg_id,
            region=plan["region"], city=plan["wh_city"],
        )
        new_warehouses.append(wh)
        region_warehouses.setdefault(plan["region"], []).append(
            {"id": wh["id"], "region": plan["region"]})

    # 119 new distributors — 15 per warehouse slot (Apapa gets 14, Prime exists).
    region_distributors: Dict[str, List[Dict]] = {r["region"]: [] for r in REGION_PLAN}
    if existing_dist:
        region_distributors["Lagos"].append(
            {"id": existing_dist["id"], "region": "Lagos"})
    per_wh = 15
    for plan in REGION_PLAN:
        whs = region_warehouses[plan["region"]]
        # Total distributors this region should gain.
        target = per_wh * len(whs) - len(region_distributors[plan["region"]])
        for i in range(target):
            parent_wh = whs[i % len(whs)]
            city = rng.choice(plan["cities"])
            base = f"{rng.choice(BIZ_PREFIXES)} {rng.choice(BIZ_SUFFIXES)} {city}"
            d = _org_doc(
                code=next(code_iters["distributor"]),
                name=_unique_name(base, used_names),
                kind="distributor", parent_id=parent_wh["id"],
                region=plan["region"], city=city,
            )
            new_distributors.append(d)
            region_distributors[plan["region"]].append(
                {"id": d["id"], "region": plan["region"]})

    # 39 new wholesalers — 10 in Lagos (commercial hub, 1 exists → +9),
    # 5 in every other region → 40 total.
    region_wholesalers: Dict[str, List[Dict]] = {r["region"]: [] for r in REGION_PLAN}
    existing_who = await db.organizations.find_one(
        {"organization_name": "Lagos Wholesale Hub", "organization_type": "wholesaler"},
        {"_id": 0, "id": 1, "parent_organization_id": 1})
    if existing_who and existing_dist:
        region_wholesalers["Lagos"].append(
            {"id": existing_who["id"], "dist_id": existing_dist["id"]})
    for plan in REGION_PLAN:
        dists = region_distributors[plan["region"]]
        region_target = 10 if plan["region"] == "Lagos" else 5
        target = region_target - len(region_wholesalers[plan["region"]])
        for i in range(target):
            parent_d = dists[(i * 3) % len(dists)]
            city = rng.choice(plan["cities"])
            n_existing = len(region_wholesalers[plan["region"]])
            base = f"{city} Wholesale Hub {n_existing + 1}"
            w = _org_doc(
                code=next(code_iters["wholesaler"]),
                name=_unique_name(base, used_names),
                kind="wholesaler", parent_id=parent_d["id"],
                region=plan["region"], city=city,
            )
            new_wholesalers.append(w)
            region_wholesalers[plan["region"]].append(
                {"id": w["id"], "dist_id": parent_d["id"]})

    # 327 new retailers — spread over the 40 wholesalers (~8 each).
    all_whos: List[Dict] = []
    for plan in REGION_PLAN:
        for who in region_wholesalers[plan["region"]]:
            all_whos.append({**who, "region": plan["region"],
                             "cities": plan["cities"]})
    remaining = 327
    idx = 0
    while remaining > 0:
        who = all_whos[idx % len(all_whos)]
        idx += 1
        city = rng.choice(who["cities"])
        base = f"{rng.choice(SHOP_OWNERS)} {rng.choice(SHOP_TYPES)} {city}"
        r = _org_doc(
            code=next(code_iters["retailer"]),
            name=_unique_name(base, used_names),
            kind="retailer", parent_id=who["id"],
            region=who["region"], city=city,
        )
        new_retailers.append(r)
        retailer_dist[r["id"]] = who["dist_id"]
        remaining -= 1

    # ---- Bulk insert organizations ------------------------------------------
    all_new = new_warehouses + new_distributors + new_wholesalers + new_retailers
    if all_new:
        await db.organizations.insert_many([dict(d) for d in all_new])

    # ---- Legacy mirrors (bulk upserts) ---------------------------------------
    dist_mirror = [
        UpdateOne({"id": d["id"]}, {"$set": {
            "id": d["id"], "name": d["organization_name"],
            "code": d["organization_code"], "region": d["region"],
            "city": d["city"], "status": "active",
            "organization_id": d["id"], "manufacturer_id": mfg_id,
            "created_at": d["created_at"],
        }}, upsert=True)
        for d in new_distributors
    ]
    if dist_mirror:
        await db.distributors.bulk_write(dist_mirror, ordered=False)
    rtl_mirror = [
        UpdateOne({"id": r["id"]}, {"$set": {
            "id": r["id"], "name": r["organization_name"],
            "code": r["organization_code"], "region": r["region"],
            "city": r["city"], "status": "active",
            "organization_id": r["id"], "manufacturer_id": mfg_id,
            "distributor_id": retailer_dist[r["id"]],
            "created_at": r["created_at"],
        }}, upsert=True)
        for r in new_retailers
    ]
    if rtl_mirror:
        await db.retailers.bulk_write(rtl_mirror, ordered=False)

    # ---- 14-day daily_sales history for the new retailers --------------------
    # Generated FIRST so retailer inventory velocity can be derived from it.
    today = datetime.now(timezone.utc).date()
    sales_rows: List[Dict] = []
    # (retailer_id, product_id) → total units over the window
    sold_units: Dict[tuple, int] = {}
    for r in new_retailers:
        for day_back in range(HISTORY_DAYS):
            date_iso = (today - timedelta(days=day_back)).isoformat()
            for p in rng.sample(products, rng.choice([1, 2, 2, 3])):
                units = rng.randint(1, 6)
                price = round(float(p["unit_price"]) * 1.15, 2)
                sales_rows.append({
                    "id": str(uuid.uuid4()),
                    "retailer_id": r["id"],
                    "product_id": p["id"],
                    "date": date_iso,
                    "units": units,
                    "quantity_sold": units,
                    "revenue": round(units * price, 2),
                    "source": "network_seed",
                    "organization_id": r["id"],
                    "manufacturer_id": mfg_id,
                })
                key = (r["id"], p["id"])
                sold_units[key] = sold_units.get(key, 0) + units
    for i in range(0, len(sales_rows), 2000):
        await db.daily_sales.insert_many(sales_rows[i:i + 2000])

    # ---- Inventory rows for every new entity ---------------------------------
    def _jit(target: int) -> int:
        spread = max(1, int(target * 0.05))
        return target + rng.randint(-spread, spread)

    inv_rows: List[Dict] = []
    tiers = [
        ("warehouse", new_warehouses), ("distributor", new_distributors),
        ("wholesaler", new_wholesalers), ("retailer", new_retailers),
    ]
    for kind, orgs in tiers:
        for org in orgs:
            for p in products:
                row = {
                    "id": str(uuid.uuid4()),
                    "owner_type": kind,
                    "owner_id": org["id"],
                    "product_id": p["id"],
                    "quantity": _jit(TIER_QTY[kind]),
                    "reorder_level": TIER_REORDER[kind],
                    "velocity": 0.0,
                    "organization_id": org["id"],
                    "warehouse_id": org["id"] if kind == "warehouse" else None,
                    "retail_price": (round(float(p["unit_price"]) * 1.15, 2)
                                     if kind == "retailer" else None),
                    "updated_at": now_iso(),
                }
                if kind == "retailer":
                    units = sold_units.get((org["id"], p["id"]), 0)
                    row["velocity"] = round(units / HISTORY_DAYS, 2)
                inv_rows.append(row)
    for i in range(0, len(inv_rows), 2000):
        await db.inventory.insert_many(inv_rows[i:i + 2000])

    # ---- Make sure the ORIGINAL 8 FMN entities stay sim participants ---------
    await db.organizations.update_many(
        {"id": {"$in": [x["id"] for x in
                        ([existing_wh] if existing_wh else []) +
                        ([existing_dist] if existing_dist else []) +
                        ([existing_who] if existing_who else [])]}},
        {"$set": {"simulation_participant": True}},
    )

    summary = {
        "created_total": len(all_new),
        "warehouses": len(new_warehouses),
        "distributors": len(new_distributors),
        "wholesalers": len(new_wholesalers),
        "retailers": len(new_retailers),
        "inventory_rows": len(inv_rows),
        "daily_sales_rows": len(sales_rows),
        "seeded_at": now_iso(),
    }
    await db.seed_meta.update_one(
        {"id": SEED_MARKER_ID},
        {"$set": {"id": SEED_MARKER_ID, **summary}},
        upsert=True,
    )
    logger.info("Flour Mills national network seeded: %s", summary)
    return summary


if __name__ == "__main__":
    import json
    print(json.dumps(asyncio.run(run()), indent=2))
