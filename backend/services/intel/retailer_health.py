"""Retailer health & churn-risk scoring (RFM-style, deterministic).

Output → db.intel_retailer_health, one row per retailer per tenant.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict

from core import db, now_iso


async def score_retailers(tenant_id: str) -> dict:
    """Score every retailer under the tenant's distributors."""
    distributors = await db.distributors.find(
        {"manufacturer_id": tenant_id}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors]
    dist_name = {d["id"]: d["name"] for d in distributors}
    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}},
        {"_id": 0, "id": 1, "name": 1, "distributor_id": 1, "region": 1, "city": 1},
    ).to_list(20000)
    if not retailers:
        return {"scored": 0}
    rids = [r["id"] for r in retailers]

    today = datetime.now(timezone.utc).date()
    last_30_start = (today - timedelta(days=30)).isoformat()

    # Recency — most recent received shipment or sale
    last_activity: Dict[str, str] = {}
    async for s in db.shipments.find(
        {"to_role": "retailer", "to_id": {"$in": rids}},
        {"_id": 0, "to_id": 1, "received_at": 1, "created_at": 1},
    ):
        ts = s.get("received_at") or s.get("created_at") or ""
        rid = s["to_id"]
        if ts > last_activity.get(rid, ""):
            last_activity[rid] = ts
    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": rids}, "date": {"$gte": last_30_start}},
        {"_id": 0, "retailer_id": 1, "date": 1},
    ):
        rid = s["retailer_id"]
        if s["date"] > last_activity.get(rid, ""):
            last_activity[rid] = s["date"]

    # Monetary — sum of last 30d sales revenue
    monetary: Dict[str, float] = {}
    frequency: Dict[str, int] = {}
    async for s in db.daily_sales.find(
        {"retailer_id": {"$in": rids}, "date": {"$gte": last_30_start}},
        {"_id": 0, "retailer_id": 1, "revenue": 1},
    ):
        rid = s["retailer_id"]
        monetary[rid] = monetary.get(rid, 0.0) + float(s.get("revenue", 0))
        frequency[rid] = frequency.get(rid, 0) + 1

    # Low-stock ratio
    low_ratio: Dict[str, float] = {}
    pipeline = [
        {"$match": {"owner_type": "retailer", "owner_id": {"$in": rids}}},
        {"$group": {
            "_id": "$owner_id",
            "total": {"$sum": 1},
            "low": {"$sum": {"$cond": [
                {"$or": [{"$eq": ["$quantity", 0]},
                         {"$lte": ["$quantity", "$reorder_level"]}]}, 1, 0]}},
        }},
    ]
    async for row in db.inventory.aggregate(pipeline):
        if row["total"]:
            low_ratio[row["_id"]] = row["low"] / row["total"]

    # Compose score 0..100 + churn flag
    docs = []
    now_str = now_iso()
    today_iso = today.isoformat()
    for r in retailers:
        rid = r["id"]
        last = last_activity.get(rid, "")
        days_inactive = 99
        if last:
            try:
                last_date = last[:10]
                days_inactive = (today - datetime.fromisoformat(last_date).date()).days
            except Exception:
                pass
        mon = monetary.get(rid, 0)
        freq = frequency.get(rid, 0)
        low = low_ratio.get(rid, 0)

        recency_score = 100 if days_inactive <= 3 else 70 if days_inactive <= 7 \
            else 40 if days_inactive <= 14 else 15 if days_inactive <= 30 else 0
        # Normalize monetary against tenant 95th percentile (rough — cap at 200k NGN/month)
        mon_score = min(100, int(mon / 2000)) if mon > 0 else 0
        freq_score = min(100, freq * 4)
        health_score = round(recency_score * 0.4 + mon_score * 0.35 + freq_score * 0.25)
        # Penalize for low-stock
        health_score = max(0, health_score - int(low * 20))

        if days_inactive >= 14:
            churn_risk = "high"
        elif days_inactive >= 7 or health_score < 30:
            churn_risk = "medium"
        else:
            churn_risk = "low"

        docs.append({
            "id": rid,  # one-per-retailer
            "tenant_id": tenant_id,
            "retailer_id": rid,
            "retailer_name": r.get("name", ""),
            "distributor_id": r.get("distributor_id", ""),
            "distributor_name": dist_name.get(r.get("distributor_id", ""), ""),
            "region": r.get("region", ""),
            "city": r.get("city", ""),
            "health_score": health_score,
            "churn_risk": churn_risk,
            "days_inactive": days_inactive,
            "revenue_30d": round(mon, 2),
            "active_days_30d": freq,
            "low_stock_ratio": round(low, 2),
            "as_of": today_iso,
            "updated_at": now_str,
        })

    if docs:
        # Upsert one-by-one is slow; replace strategy: wipe + insert
        await db.intel_retailer_health.delete_many({"tenant_id": tenant_id})
        for i in range(0, len(docs), 5000):
            await db.intel_retailer_health.insert_many(docs[i:i + 5000], ordered=False)

    # Generate churn-risk alerts (high only)
    await db.intel_alerts.delete_many({"tenant_id": tenant_id, "category": "churn"})
    churn_docs = [d for d in docs if d["churn_risk"] == "high"][:30]
    if churn_docs:
        await db.intel_alerts.insert_many([{
            "id": "alert-" + d["id"],
            "tenant_id": tenant_id,
            "category": "churn",
            "kind": "churn_risk",
            "severity": "warning",
            "scope_role": "retailer",
            "scope_id": d["retailer_id"],
            "distributor_id": d.get("distributor_id", ""),
            "retailer_id": d["retailer_id"],
            "retailer_name": d["retailer_name"],
            "region": d.get("region", ""),
            "title": f"Churn risk: {d['retailer_name']}",
            "detail": f"No activity for {d['days_inactive']} days. Health score {d['health_score']}/100.",
            "metric": d["days_inactive"],
            "baseline": 0,
            "created_at": now_str,
        } for d in churn_docs])

    return {"scored": len(docs), "high_risk": sum(1 for d in docs if d["churn_risk"] == "high")}
