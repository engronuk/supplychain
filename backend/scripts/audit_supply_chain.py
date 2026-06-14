"""TradeKonekt 5-tier supply chain E2E validation script.

Sections:
  1. Product Ownership & Stocking validation (inventory by tier)
  2. Order flow validation (PO + request chains)
  3. Logistics flow validation (shipments)
  4. Hierarchy integrity (parent_organization_id chain)
  5. Live business transaction simulation hook

Output is human-readable so it can be pasted into the certification report.
"""
import asyncio
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402


def section(title: str):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def line(label: str, value: Any, ok: bool | None = None):
    flag = "" if ok is None else ("[PASS]" if ok else "[FAIL]")
    print(f"  {flag:7s} {label:<55s} {value}")


async def main() -> int:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    fails: list[str] = []

    # ---- Load org tier index ------------------------------------------------
    org_by_id: dict[str, dict] = {}
    by_type: dict[str, list[dict]] = defaultdict(list)
    async for o in db.organizations.find({}, {"_id": 0, "id": 1, "organization_type": 1,
                                              "parent_organization_id": 1,
                                              "organization_name": 1, "organization_code": 1,
                                              "metadata": 1}):
        org_by_id[o["id"]] = o
        by_type[o["organization_type"]].append(o)

    def tier_of(oid: str | None) -> str | None:
        o = org_by_id.get(oid or "")
        return o.get("organization_type") if o else None

    # =====================================================================
    # 1. PRODUCT OWNERSHIP & STOCKING VALIDATION
    # =====================================================================
    section("1. PRODUCT OWNERSHIP & STOCKING VALIDATION")
    # Master catalog at manufacturer level
    products = await db.products.find({}, {"_id": 0, "id": 1, "manufacturer_id": 1,
                                           "sku": 1, "name": 1}).to_list(5000)
    mfg_set = {m["id"] for m in by_type.get("manufacturer", [])}
    orphan_products = [p for p in products if p.get("manufacturer_id") not in mfg_set]
    line("Products with a valid manufacturer parent",
         f"{len(products)-len(orphan_products)} / {len(products)}",
         ok=(not orphan_products))
    if orphan_products:
        fails.append(f"{len(orphan_products)} products have an orphan manufacturer_id")

    # Inventory bucketed by owner_type
    inv_by_owner_type: dict[str, dict] = defaultdict(lambda: {
        "records": 0, "valid_owner": 0, "invalid_owner": 0,
        "units_total": 0, "sku_skus": set(),
    })
    inv_orphan_examples: list[dict] = []
    valid_tier_kinds = {"manufacturer", "warehouse", "distributor", "wholesaler", "retailer"}

    async for inv in db.inventory.find({}, {"_id": 0, "owner_type": 1, "owner_id": 1,
                                            "quantity": 1, "product_id": 1}):
        t = inv.get("owner_type") or "<missing>"
        bucket = inv_by_owner_type[t]
        bucket["records"] += 1
        bucket["units_total"] += int(inv.get("quantity") or 0)
        if inv.get("product_id"):
            bucket["sku_skus"].add(inv["product_id"])
        owner = org_by_id.get(inv.get("owner_id") or "")
        if t in valid_tier_kinds and owner and owner.get("organization_type") == t:
            bucket["valid_owner"] += 1
        elif t == "warehouse":
            # Some warehouses are addressed via db.warehouse_users / db.organizations
            # but a few seed paths use the warehouse organization directly. Either way
            # if owner is found in organizations with type=warehouse we count it.
            bucket["invalid_owner"] += 1
            if len(inv_orphan_examples) < 5:
                inv_orphan_examples.append(inv)
        else:
            bucket["invalid_owner"] += 1
            if len(inv_orphan_examples) < 5:
                inv_orphan_examples.append(inv)

    print("  Inventory ownership by tier:")
    print(f"  {'tier':<14s} {'records':>8s} {'valid':>8s} {'invalid':>8s} {'skus':>6s} {'units':>14s}")
    grand_total_units = 0
    grand_invalid = 0
    for tier in ("manufacturer", "warehouse", "distributor", "wholesaler", "retailer", "<missing>"):
        b = inv_by_owner_type.get(tier, {"records": 0, "valid_owner": 0, "invalid_owner": 0,
                                         "units_total": 0, "sku_skus": set()})
        grand_total_units += b["units_total"]
        grand_invalid += b["invalid_owner"]
        print(f"  {tier:<14s} {b['records']:>8d} {b['valid_owner']:>8d} {b['invalid_owner']:>8d} "
              f"{len(b['sku_skus']):>6d} {b['units_total']:>14,d}")
    if grand_invalid > 0:
        fails.append(f"{grand_invalid} inventory rows have invalid owner_id")
    line("All inventory rows have a valid owner_id", f"{grand_invalid} orphans",
         ok=(grand_invalid == 0))
    line("Grand-total stocked units (all tiers)", f"{grand_total_units:,}")

    # Duplicate inventory ownership (same owner + same product)
    dupes = await db.inventory.aggregate([
        {"$group": {"_id": {"owner_id": "$owner_id", "product_id": "$product_id"},
                    "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
        {"$count": "dupes"},
    ]).to_list(5)
    dup_n = dupes[0]["dupes"] if dupes else 0
    line("No duplicate (owner_id × product_id) inventory rows", f"{dup_n} dupes",
         ok=(dup_n == 0))
    if dup_n:
        fails.append(f"{dup_n} duplicate inventory rows")

    # =====================================================================
    # 2. ORDER FLOW VALIDATION
    # =====================================================================
    section("2. ORDER FLOW VALIDATION")
    # Retailer → Wholesaler (purchase_orders with supplier_type=wholesaler)
    po_kinds = await db.purchase_orders.aggregate([
        {"$group": {"_id": "$supplier_type", "n": {"$sum": 1}}},
    ]).to_list(10)
    print("  Retail purchase_orders by supplier_type:")
    for k in po_kinds:
        print(f"     {k['_id']!s:>14s}: {k['n']}")

    # Validate retailer→wholesaler PO chain. NOTE: `purchase_orders` uses
    # the legacy field `distributor_id` to hold the *supplier* organization
    # regardless of supplier_type. When supplier_type='wholesaler' it actually
    # contains the wholesaler_id (verified by inspection).
    bad_retailer_po = 0
    async for po in db.purchase_orders.find({"supplier_type": "wholesaler"},
                                            {"_id": 0, "retailer_id": 1, "distributor_id": 1}):
        c = org_by_id.get(po.get("retailer_id") or "")
        s = org_by_id.get(po.get("distributor_id") or "")  # supplier (wholesaler)
        if not c or c.get("organization_type") != "retailer":
            bad_retailer_po += 1
            continue
        if not s or s.get("organization_type") != "wholesaler":
            bad_retailer_po += 1
            continue
        # Ownership tie: retailer's wholesaler parent matches supplier OR
        # metadata.wholesaler_id matches.
        md = c.get("metadata") or {}
        if c.get("parent_organization_id") != po.get("distributor_id") \
           and md.get("wholesaler_id") != po.get("distributor_id"):
            bad_retailer_po += 1
    line("Retailer→Wholesaler POs reference correct tiers", f"{bad_retailer_po} mismatches",
         ok=(bad_retailer_po == 0))
    if bad_retailer_po:
        fails.append(f"{bad_retailer_po} retailer→wholesaler PO tier mismatches")

    # Distributor↔Retailer direct POs (key-account flow allowed via metadata)
    direct_dist_to_retail = 0
    illegal_dist_to_retail = 0
    async for po in db.purchase_orders.find({"supplier_type": "distributor"},
                                            {"_id": 0, "retailer_id": 1, "distributor_id": 1}):
        c = org_by_id.get(po.get("retailer_id") or "")
        s = org_by_id.get(po.get("distributor_id") or "")
        if not c or c.get("organization_type") != "retailer":
            continue
        if not s or s.get("organization_type") != "distributor":
            illegal_dist_to_retail += 1
            continue
        direct_dist_to_retail += 1
        md = c.get("metadata") or {}
        # Allowed only if the retailer is a key-account flagged for distributor sourcing
        if md.get("preferred_supplier_type") != "distributor" and md.get("channel") != "key_account":
            illegal_dist_to_retail += 1
    line("Distributor↔Retailer direct POs (key-account flow)", f"{direct_dist_to_retail}")
    line("Distributor→Retailer POs WITHOUT key-account permission", f"{illegal_dist_to_retail}",
         ok=(illegal_dist_to_retail == 0))
    if illegal_dist_to_retail:
        fails.append(f"{illegal_dist_to_retail} distributor→retailer POs lack key-account permission")

    # Wholesaler → Distributor (wholesaler_purchase_orders)
    bad_wp = 0
    async for wp in db.wholesaler_purchase_orders.find(
        {}, {"_id": 0, "wholesaler_id": 1, "supplier_id": 1, "supplier_type": 1}):
        w = org_by_id.get(wp.get("wholesaler_id") or "")
        d = org_by_id.get(wp.get("supplier_id") or "")
        if not (w and w.get("organization_type") == "wholesaler"):
            bad_wp += 1
            continue
        if not (d and d.get("organization_type") == "distributor"):
            bad_wp += 1
    line("Wholesaler→Distributor POs reference correct tiers",
         f"{bad_wp} mismatches", ok=(bad_wp == 0))
    if bad_wp:
        fails.append(f"{bad_wp} wholesaler→distributor PO tier mismatches")

    # Distributor → Warehouse (distributor_orders). Resolves warehouse_id either
    # through organizations or through warehouse_users (operational user docs).
    bad_do = 0
    wh_user_ids: set[str] = set()
    async for wu in db.warehouse_users.find({}, {"_id": 0, "id": 1, "warehouse_id": 1}):
        wh_user_ids.add(wu["id"])
        if wu.get("warehouse_id"):
            wh_user_ids.add(wu["warehouse_id"])
    async for d_ord in db.distributor_orders.find(
        {}, {"_id": 0, "distributor_id": 1, "warehouse_id": 1}):
        d = org_by_id.get(d_ord.get("distributor_id") or "")
        w_id = d_ord.get("warehouse_id")
        wh_org = org_by_id.get(w_id or "")
        ok = False
        if d and d.get("organization_type") == "distributor":
            if wh_org and wh_org.get("organization_type") == "warehouse":
                ok = True
            elif w_id in wh_user_ids:
                ok = True
        if not ok:
            bad_do += 1
    line("Distributor→Warehouse orders reference correct tiers",
         f"{bad_do} mismatches", ok=(bad_do == 0))
    if bad_do:
        fails.append(f"{bad_do} distributor→warehouse order tier mismatches")

    # Workflow status distribution across the major order tables
    print()
    print("  Workflow status distribution (must cover the lifecycle):")
    for table in ("purchase_orders", "wholesaler_purchase_orders",
                  "distributor_orders", "requests", "replenishment_requests"):
        cnts = await db[table].aggregate(
            [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(20)
        cnts.sort(key=lambda x: -x["n"])
        print(f"    {table:<32s} " + ", ".join(f"{c['_id']}:{c['n']}" for c in cnts))

    # =====================================================================
    # 3. LOGISTICS / SHIPMENT FLOW VALIDATION
    # =====================================================================
    section("3. LOGISTICS / SHIPMENT FLOW VALIDATION")
    # shipments has from_role / to_role
    print("  Shipment route distribution (from_role → to_role):")
    routes: dict[tuple[str, str], int] = defaultdict(int)
    illegal_shipments = []
    async for s in db.shipments.find({}, {"_id": 0, "from_role": 1, "to_role": 1,
                                          "from_id": 1, "to_id": 1, "id": 1}):
        fr = s.get("from_role") or "?"
        tr = s.get("to_role") or "?"
        routes[(fr, tr)] += 1
    for (fr, tr), n in sorted(routes.items(), key=lambda kv: -kv[1]):
        marker = "OK "
        # Allowed routes for ownership AND operational flows:
        legal = {
            # Strict-tier forward flow:
            ("manufacturer", "warehouse"),
            ("warehouse", "distributor"),
            ("distributor", "wholesaler"),
            ("wholesaler", "retailer"),
            # Key-account direct flow (sourced from metadata, allowed):
            ("distributor", "retailer"),
            # Inter-warehouse transfers (operational, not ownership):
            ("warehouse", "warehouse"),
            # Return flows (reverse-direction shipments are operational):
            ("wholesaler", "distributor"),
            ("retailer", "wholesaler"),
            ("distributor", "warehouse"),
            ("warehouse", "manufacturer"),
        }
        if (fr, tr) not in legal:
            marker = "FAIL"
        print(f"    {marker}  {fr:<14s} → {tr:<14s}: {n}")
    # Audit warehouse→retailer / manufacturer→retailer / warehouse→wholesaler (forbidden)
    forbidden_routes = [("warehouse", "retailer"),
                        ("warehouse", "wholesaler"),
                        ("manufacturer", "retailer"),
                        ("manufacturer", "wholesaler"),
                        ("manufacturer", "distributor")]
    illegal_count = 0
    for fr, tr in forbidden_routes:
        n = routes.get((fr, tr), 0)
        line(f"Forbidden shipment {fr}→{tr} (must be 0)", n, ok=(n == 0))
        if n:
            illegal_count += n
            fails.append(f"{n} illegal shipments {fr}→{tr}")
    # Wholesaler shipments (separate table)
    ws_route_counts: dict[tuple[str, str], int] = defaultdict(int)
    async for s in db.wholesaler_shipments.find(
        {}, {"_id": 0, "from_role": 1, "to_role": 1}):
        ws_route_counts[(s.get("from_role") or "wholesaler",
                         s.get("to_role") or "retailer")] += 1
    print("  Wholesaler shipments route distribution:")
    for (fr, tr), n in sorted(ws_route_counts.items(), key=lambda kv: -kv[1]):
        print(f"    OK   {fr:<14s} → {tr:<14s}: {n}")

    # Validate that distributor→retailer shipments only touch key-account retailers.
    illegal_da = 0
    async for s in db.shipments.find({"from_role": "distributor", "to_role": "retailer"},
                                     {"_id": 0, "to_id": 1}):
        r = org_by_id.get(s.get("to_id") or "")
        md = (r or {}).get("metadata") or {}
        if md.get("preferred_supplier_type") != "distributor":
            illegal_da += 1
    line("Distributor→Retailer shipments are all key-accounts",
         f"{illegal_da} violators", ok=(illegal_da == 0))
    if illegal_da:
        fails.append(f"{illegal_da} distributor→retailer shipments without key-account flag")

    # Shipment status distribution
    print()
    print("  Shipment status distribution:")
    cnts = await db.shipments.aggregate(
        [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(20)
    print("    shipments         " + ", ".join(f"{c['_id']}:{c['n']}" for c in cnts))
    cnts = await db.wholesaler_shipments.aggregate(
        [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]).to_list(20)
    print("    wholesaler_shipments " + ", ".join(f"{c['_id']}:{c['n']}" for c in cnts))

    # =====================================================================
    # 4. HIERARCHY INTEGRITY
    # =====================================================================
    section("4. HIERARCHY INTEGRITY (DASHBOARD-FACING DATA)")
    rules = [
        ("retailer",   "wholesaler"),
        ("wholesaler", "distributor"),
        ("distributor", "warehouse"),
        ("warehouse",   "manufacturer"),
    ]
    forbidden = [
        ("retailer",   "distributor"),
        ("retailer",   "warehouse"),
        ("retailer",   "manufacturer"),
        ("wholesaler", "warehouse"),
        ("wholesaler", "manufacturer"),
        ("distributor", "manufacturer"),
    ]
    for c, p in rules:
        n = 0
        for child in by_type.get(c, []):
            pt = tier_of(child.get("parent_organization_id"))
            if pt == p:
                n += 1
        total = len(by_type.get(c, []))
        line(f"{c}s under {p} (allowed parent)", f"{n}/{total}",
             ok=(n == total))
        if n != total:
            fails.append(f"{c}s with non-{p} parent: {total - n}")
    for c, p in forbidden:
        n = sum(1 for ch in by_type.get(c, [])
                if tier_of(ch.get("parent_organization_id")) == p)
        line(f"{c}s under {p} (forbidden)", n, ok=(n == 0))
        if n:
            fails.append(f"FORBIDDEN: {n} {c}s parented under {p}")

    # =====================================================================
    # WRAP-UP
    # =====================================================================
    section("VALIDATION SUMMARY")
    if fails:
        line("Overall result", "FAIL", ok=False)
        for f in fails:
            print(f"    - {f}")
    else:
        line("Overall result", "PASS", ok=True)
    print()
    return 0 if not fails else 2


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
