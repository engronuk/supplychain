"""Idempotent demo seed for the Logistics Command Center.

Creates per-tenant:
  • vehicles                — truck fleet with GPS positions along real routes
  • transfer_orders         — inter-warehouse transfers in mixed states
  • replenishment_requests  — pending warehouse / wholesaler authorization queue

Safe to run on every boot: each block no-ops once rows exist for the tenant.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from core import db, new_id, now_iso
from routes.logistics import coords_for


def _interp(a: Tuple[float, float], b: Tuple[float, float], t: float) -> Tuple[float, float]:
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def _iso_ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


async def seed_logistics() -> Dict[str, Any]:
    created = {"vehicles": 0, "transfers": 0, "requests": 0}
    mfrs = await db.manufacturers.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)

    for mfr in mfrs:
        mid = mfr["id"]
        warehouses = await db.organizations.find(
            {"organization_type": "warehouse", "parent_organization_id": mid},
            {"_id": 0, "id": 1, "organization_name": 1, "region": 1, "city": 1},
        ).to_list(50)
        if not warehouses:
            continue
        wh_by_region = {(w.get("region") or "").lower(): w for w in warehouses}
        products = await db.products.find(
            {"manufacturer_id": mid}, {"_id": 0, "id": 1, "name": 1},
        ).to_list(None)
        if not products:
            continue

        def wh(region: str) -> Optional[Dict[str, Any]]:
            return wh_by_region.get(region.lower()) or (warehouses[0] if warehouses else None)

        def pos(w: Dict[str, Any]) -> Tuple[float, float]:
            return coords_for(w.get("city"), w.get("region"))

        # ---- vehicles ------------------------------------------------------
        if await db.vehicles.count_documents({"manufacturer_id": mid}) == 0:
            fleet: List[Dict[str, Any]] = []
            multi = len(warehouses) > 1
            lagos, abuja = wh("lagos"), wh("north central")
            kano, bauchi = wh("north west"), wh("north east")
            onitsha, ph = wh("south east"), wh("south south")
            specs = [
                # (code, driver, status, from_wh, to_wh, progress)
                ("TK-019", "Emeka Obi", "in_transit", lagos, abuja, 0.55),
                ("TK-012", "Ibrahim Musa", "in_transit", lagos, kano, 0.35),
                ("TK-021", "Chinedu Eze", "in_transit", onitsha, ph, 0.6),
                ("TK-014", "Sani Bello", "stopped", abuja, bauchi, 0.45),
                ("TK-007", "Tunde Bakare", "idle", lagos, None, 0.0),
                ("TK-009", "Ngozi Ade", "idle", abuja, None, 0.0),
            ] if multi else [
                ("TK-101", "Femi Ojo", "in_transit", warehouses[0], None, 0.0),
                ("TK-102", "Bola Sule", "idle", warehouses[0], None, 0.0),
            ]
            for code, driver, status, src, dst, t in specs:
                if src is None:
                    continue
                o = pos(src)
                if dst is not None and status in ("in_transit", "stopped"):
                    d = pos(dst)
                    lat, lng = _interp(o, d, t)
                    doc = {
                        "id": new_id(), "code": code, "manufacturer_id": mid,
                        "driver_name": driver, "driver_phone": "+234 80x xxx xxxx",
                        "status": status, "lat": lat, "lng": lng,
                        "progress": t, "total_minutes": 6 * 60,
                        "origin_name": src["organization_name"], "origin_lat": o[0], "origin_lng": o[1],
                        "dest_name": dst["organization_name"], "dest_lat": d[0], "dest_lng": d[1],
                        "eta_minutes": int((1 - t) * 6 * 60), "speed_kmh": 0 if status == "stopped" else 64,
                        "ref_type": None, "ref_id": None,
                        "created_at": _iso_ago(30), "updated_at": _iso_ago(1),
                    }
                else:
                    # In-transit truck for single-warehouse tenants heads to Ibadan.
                    if status == "in_transit":
                        d = coords_for("ibadan", "south west")
                        lat, lng = _interp(o, d, 0.4)
                        doc = {
                            "id": new_id(), "code": code, "manufacturer_id": mid,
                            "driver_name": driver, "driver_phone": "+234 80x xxx xxxx",
                            "status": "in_transit", "lat": lat, "lng": lng,
                            "progress": 0.4, "total_minutes": 250,
                            "origin_name": src["organization_name"], "origin_lat": o[0], "origin_lng": o[1],
                            "dest_name": "Ibadan Distribution Hub", "dest_lat": d[0], "dest_lng": d[1],
                            "eta_minutes": 150, "speed_kmh": 58,
                            "ref_type": None, "ref_id": None,
                            "created_at": _iso_ago(8), "updated_at": _iso_ago(0.5),
                        }
                    else:
                        doc = {
                            "id": new_id(), "code": code, "manufacturer_id": mid,
                            "driver_name": driver, "driver_phone": "+234 80x xxx xxxx",
                            "status": "idle", "lat": o[0], "lng": o[1],
                            "origin_name": src["organization_name"], "origin_lat": o[0], "origin_lng": o[1],
                            "dest_name": None, "dest_lat": None, "dest_lng": None,
                            "eta_minutes": None, "speed_kmh": 0,
                            "ref_type": None, "ref_id": None,
                            "created_at": _iso_ago(72), "updated_at": _iso_ago(12),
                        }
                fleet.append(doc)
            if fleet:
                await db.vehicles.insert_many([dict(v) for v in fleet])
                created["vehicles"] += len(fleet)

        # ---- transfer orders -------------------------------------------------
        if len(warehouses) > 1 and await db.transfer_orders.count_documents({"manufacturer_id": mid}) == 0:
            lagos, abuja = wh("lagos"), wh("north central")
            kano, bauchi = wh("north west"), wh("north east")
            ibadan, onitsha = wh("south west"), wh("south east")
            p = products
            specs = [
                ("TRF-112", lagos, abuja, p[0], 4000, "rebalancing", "in_transit", 6),
                ("TRF-113", kano, bauchi, p[1 % len(p)], 2200, "stockout_prevention", "in_transit", 10),
                ("TRF-114", lagos, kano, p[2 % len(p)], 3000, "demand_surge", "processing", None),
                ("TRF-110", ibadan, onitsha, p[3 % len(p)], 1500, "rebalancing", "delivered", None),
            ]
            rows = []
            for num, src, dst, prod, qty, reason, status, eta_h in specs:
                if not src or not dst or src["id"] == dst["id"]:
                    continue
                doc = {
                    "id": new_id(), "transfer_number": num, "manufacturer_id": mid,
                    "from_warehouse_id": src["id"], "from_warehouse_name": src["organization_name"],
                    "to_warehouse_id": dst["id"], "to_warehouse_name": dst["organization_name"],
                    "product_id": prod["id"], "product_name": prod.get("name"),
                    "quantity": qty, "reason": reason, "status": status, "source": "seed",
                    "eta": (datetime.now(timezone.utc) + timedelta(hours=eta_h)).isoformat() if eta_h else None,
                    "created_by": "seed", "created_at": _iso_ago(20),
                    "dispatched_at": _iso_ago(12) if status in ("in_transit", "delivered") else None,
                    "delivered_at": _iso_ago(2) if status == "delivered" else None,
                }
                rows.append(doc)
            if rows:
                await db.transfer_orders.insert_many([dict(r) for r in rows])
                created["transfers"] += len(rows)

        # ---- replenishment requests ------------------------------------------
        if await db.replenishment_requests.count_documents({"manufacturer_id": mid}) == 0:
            rows = []
            seq = 1188
            # Warehouse replenishment: pick the 3 least-stocked warehouses.
            stock: Dict[str, int] = {w["id"]: 0 for w in warehouses}
            inv_by_wh_pid: Dict[Tuple[str, str], int] = {}
            async for r in db.inventory.find(
                {"owner_type": "warehouse", "owner_id": {"$in": list(stock)}},
                {"_id": 0, "owner_id": 1, "product_id": 1, "quantity": 1},
            ):
                stock[r["owner_id"]] += int(r.get("quantity") or 0)
                inv_by_wh_pid[(r["owner_id"], r["product_id"])] = int(r.get("quantity") or 0)
            weakest = sorted(warehouses, key=lambda w: stock.get(w["id"], 0))
            qtys = [5000, 3000, 2500]
            prios = ["high", "high", "medium"]
            if len(warehouses) > 1:
                for i, w in enumerate(weakest[:3]):
                    prod = products[i % len(products)]
                    rows.append({
                        "id": new_id(), "request_number": f"REQ-{seq}",
                        "manufacturer_id": mid, "requester_type": "warehouse",
                        "requester_id": w["id"], "requester_name": w["organization_name"],
                        "region": w.get("region") or "",
                        "product_id": prod["id"], "product_name": prod.get("name"),
                        "quantity": qtys[i], "current_stock": inv_by_wh_pid.get((w["id"], prod["id"]), 0),
                        "priority": prios[i], "status": "pending",
                        "requested_date": datetime.now(timezone.utc).date().isoformat(),
                        "created_at": _iso_ago(5 + i * 3),
                    })
                    seq += 1
            # Wholesaler requests: real wholesaler orgs inside this tenant's subtree.
            dist_ids = [d["id"] for d in await db.distributors.find(
                {"manufacturer_id": mid}, {"_id": 0, "id": 1}).to_list(None)]
            wholesalers = await db.organizations.find(
                {"organization_type": "wholesaler", "parent_organization_id": {"$in": dist_ids}},
                {"_id": 0, "id": 1, "organization_name": 1, "region": 1},
            ).to_list(4)
            for i, who in enumerate(wholesalers[:2]):
                prod = products[(i + 3) % len(products)]
                rows.append({
                    "id": new_id(), "request_number": f"REQ-{seq}",
                    "manufacturer_id": mid, "requester_type": "wholesaler",
                    "requester_id": who["id"], "requester_name": who["organization_name"],
                    "region": who.get("region") or "",
                    "product_id": prod["id"], "product_name": prod.get("name"),
                    "quantity": [2500, 6000][i], "current_stock": None,
                    "priority": ["medium", "high"][i], "status": "pending",
                    "requested_date": (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat(),
                    "created_at": _iso_ago(9 + i * 4),
                })
                seq += 1
            if rows:
                await db.replenishment_requests.insert_many([dict(r) for r in rows])
                created["requests"] += len(rows)

    return created
