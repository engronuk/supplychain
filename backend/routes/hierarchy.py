"""Radial hierarchy graph endpoints."""
from __future__ import annotations

from typing import Any, Dict, Tuple

from fastapi import APIRouter, HTTPException

from core import db

router = APIRouter()


def _health_from_low_stock(low_count: int, total_skus: int) -> str:
    """Translate low-stock ratio into a coarse health bucket."""
    if total_skus <= 0:
        return "healthy"
    ratio = low_count / total_skus
    if low_count >= 5 or ratio >= 0.5:
        return "critical"
    if low_count >= 2 or ratio >= 0.2:
        return "warning"
    return "healthy"


async def _low_stock_by_owner(owner_type: str) -> Dict[str, Tuple[int, int]]:
    """Return {owner_id: (low_count, total_skus)} for the given owner_type."""
    pipeline = [
        {"$match": {"owner_type": owner_type}},
        {"$group": {
            "_id": "$owner_id",
            "total": {"$sum": 1},
            "low": {"$sum": {"$cond": [{"$lte": ["$quantity", "$reorder_level"]}, 1, 0]}},
        }},
    ]
    out: Dict[str, Tuple[int, int]] = {}
    async for r in db.inventory.aggregate(pipeline):
        out[r["_id"]] = (int(r["low"]), int(r["total"]))
    return out


async def _retailer_count_by_distributor() -> Dict[str, int]:
    pipeline = [{"$group": {"_id": "$distributor_id", "count": {"$sum": 1}}}]
    out: Dict[str, int] = {}
    async for r in db.retailers.aggregate(pipeline):
        out[r["_id"]] = int(r["count"])
    return out


async def _shipment_activity_by_distributor() -> Dict[str, int]:
    """Count active (non-received) shipments per distributor (incoming + outgoing)."""
    pipeline = [
        {"$match": {"status": {"$in": ["pending", "in_transit"]}}},
        {"$match": {"distributor_id": {"$ne": ""}}},
        {"$group": {"_id": "$distributor_id", "count": {"$sum": 1}}},
    ]
    out: Dict[str, int] = {}
    async for r in db.shipments.aggregate(pipeline):
        out[r["_id"]] = int(r["count"])
    return out


@router.get("/hierarchy/manufacturer/{mfg_id}")
async def hierarchy_root(mfg_id: str):
    mfg = await db.manufacturers.find_one({"id": mfg_id}, {"_id": 0})
    if not mfg:
        raise HTTPException(404, "Manufacturer not found")
    distributors = await db.distributors.find({"manufacturer_id": mfg_id}, {"_id": 0}).to_list(5000)
    retailers_count = await db.retailers.count_documents({})
    low_mfg = await _low_stock_by_owner("manufacturer")
    low, total = low_mfg.get(mfg_id, (0, 0))
    pending_ship = await db.shipments.count_documents(
        {"status": {"$in": ["pending", "in_transit"]}, "manufacturer_id": mfg_id}
    )
    return {
        "id": f"mfg:{mfg_id}",
        "ref_id": mfg_id,
        "parent_id": None,
        "name": mfg["name"],
        "type": "manufacturer",
        "status": _health_from_low_stock(low, total),
        "alerts": low + pending_ship,
        "summary": {
            "regions": len({d.get("region") or "—" for d in distributors}),
            "distributors": len(distributors),
            "retailers": retailers_count,
            "low_stock_skus": low,
        },
        "has_children": True,
    }


@router.get("/hierarchy/regions/{mfg_id}")
async def hierarchy_regions(mfg_id: str):
    distributors = await db.distributors.find({"manufacturer_id": mfg_id}, {"_id": 0}).to_list(5000)
    retailers = await db.retailers.find({}, {"_id": 0, "id": 1, "distributor_id": 1}).to_list(20000)

    dist_to_region = {d["id"]: (d.get("region") or "—") for d in distributors}
    region_map: Dict[str, Dict[str, Any]] = {}
    for d in distributors:
        r = d.get("region") or "—"
        rm = region_map.setdefault(r, {"distributors": 0, "retailers": 0, "cities": set()})
        rm["distributors"] += 1
        rm["cities"].add(d.get("city") or "—")
    for ret in retailers:
        r = dist_to_region.get(ret["distributor_id"])
        if r and r in region_map:
            region_map[r]["retailers"] += 1

    low_dist = await _low_stock_by_owner("distributor")
    low_retail = await _low_stock_by_owner("retailer")

    out = []
    for name, info in region_map.items():
        dist_ids = [d["id"] for d in distributors if (d.get("region") or "—") == name]
        ret_ids = [ret["id"] for ret in retailers if dist_to_region.get(ret["distributor_id"]) == name]
        low = sum(low_dist.get(d, (0, 0))[0] for d in dist_ids) + sum(low_retail.get(r, (0, 0))[0] for r in ret_ids)
        total = sum(low_dist.get(d, (0, 0))[1] for d in dist_ids) + sum(low_retail.get(r, (0, 0))[1] for r in ret_ids)
        out.append({
            "id": f"region:{mfg_id}:{name}",
            "parent_id": f"mfg:{mfg_id}",
            "name": name,
            "type": "region",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "cities": len(info["cities"]),
                "distributors": info["distributors"],
                "retailers": info["retailers"],
            },
            "has_children": info["distributors"] > 0,
        })
    out.sort(key=lambda x: x["name"])
    return out


@router.get("/hierarchy/states/{mfg_id}/{region}")
async def hierarchy_states(mfg_id: str, region: str):
    """States = cities here, scoped by manufacturer & region."""
    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id, "region": region}, {"_id": 0}
    ).to_list(5000)
    if not distributors:
        return []
    dist_ids = [d["id"] for d in distributors]
    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}}, {"_id": 0, "id": 1, "distributor_id": 1}
    ).to_list(20000)
    dist_to_city = {d["id"]: (d.get("city") or "—") for d in distributors}

    city_map: Dict[str, Dict[str, Any]] = {}
    for d in distributors:
        c = d.get("city") or "—"
        cm = city_map.setdefault(c, {"distributors": 0, "retailers": 0, "dist_ids": [], "ret_ids": []})
        cm["distributors"] += 1
        cm["dist_ids"].append(d["id"])
    for ret in retailers:
        c = dist_to_city.get(ret["distributor_id"], "—")
        if c in city_map:
            city_map[c]["retailers"] += 1
            city_map[c]["ret_ids"].append(ret["id"])

    low_dist = await _low_stock_by_owner("distributor")
    low_retail = await _low_stock_by_owner("retailer")

    out = []
    for name, info in city_map.items():
        low = sum(low_dist.get(d, (0, 0))[0] for d in info["dist_ids"]) + sum(low_retail.get(r, (0, 0))[0] for r in info["ret_ids"])
        total = sum(low_dist.get(d, (0, 0))[1] for d in info["dist_ids"]) + sum(low_retail.get(r, (0, 0))[1] for r in info["ret_ids"])
        out.append({
            "id": f"state:{mfg_id}:{region}:{name}",
            "parent_id": f"region:{mfg_id}:{region}",
            "name": name,
            "type": "state",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "distributors": info["distributors"],
                "retailers": info["retailers"],
            },
            "has_children": info["distributors"] > 0,
        })
    out.sort(key=lambda x: x["name"])
    return out


@router.get("/hierarchy/distributors/{mfg_id}/{region}/{state}")
async def hierarchy_distributors_in_state(mfg_id: str, region: str, state: str):
    distributors = await db.distributors.find(
        {"manufacturer_id": mfg_id, "region": region, "city": state}, {"_id": 0}
    ).to_list(5000)
    low_dist = await _low_stock_by_owner("distributor")
    low_retail = await _low_stock_by_owner("retailer")
    retailers_by_dist = await _retailer_count_by_distributor()
    activity = await _shipment_activity_by_distributor()

    all_retailers = await db.retailers.find(
        {"distributor_id": {"$in": [d["id"] for d in distributors]}},
        {"_id": 0, "id": 1, "distributor_id": 1},
    ).to_list(20000)
    low_ret_per_dist: Dict[str, int] = {}
    for r in all_retailers:
        rid = r["id"]
        if low_retail.get(rid, (0, 0))[0] > 0:
            low_ret_per_dist[r["distributor_id"]] = low_ret_per_dist.get(r["distributor_id"], 0) + 1

    out = []
    for d in distributors:
        low, total = low_dist.get(d["id"], (0, 0))
        out.append({
            "id": f"dist:{d['id']}",
            "ref_id": d["id"],
            "parent_id": f"state:{mfg_id}:{region}:{state}",
            "name": d["name"],
            "type": "distributor",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "total_retailers": retailers_by_dist.get(d["id"], 0),
                "low_stock_retailers": low_ret_per_dist.get(d["id"], 0),
                "shipment_activity": activity.get(d["id"], 0),
                "region": d.get("region", ""),
                "city": d.get("city", ""),
            },
            "has_children": retailers_by_dist.get(d["id"], 0) > 0,
        })
    out.sort(key=lambda x: x["name"])
    return out


@router.get("/hierarchy/retailers/{distributor_id}")
async def hierarchy_retailers(distributor_id: str):
    retailers = await db.retailers.find({"distributor_id": distributor_id}, {"_id": 0}).to_list(5000)
    low_retail = await _low_stock_by_owner("retailer")
    out = []
    for r in retailers:
        low, total = low_retail.get(r["id"], (0, 0))
        out.append({
            "id": f"ret:{r['id']}",
            "ref_id": r["id"],
            "parent_id": f"dist:{distributor_id}",
            "name": r["name"],
            "type": "retailer",
            "status": _health_from_low_stock(low, total),
            "alerts": low,
            "summary": {
                "region": r.get("region", ""),
                "city": r.get("city", ""),
                "address": r.get("address", ""),
                "low_stock_skus": low,
            },
            "has_children": False,
        })
    out.sort(key=lambda x: x["name"])
    return out
