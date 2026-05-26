"""Anomaly detection — rolling z-score over per-retailer daily sales totals.

Catches: unusual buying spikes, sudden inactivity, sustained drop-offs.
Output → db.intel_alerts collection (also surfaces in the ecosystem feed).
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from core import db, new_id, now_iso


def _zscore(value: float, series: List[float]) -> float:
    if len(series) < 3:
        return 0.0
    mean = sum(series) / len(series)
    var = sum((x - mean) ** 2 for x in series) / max(len(series) - 1, 1)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    return (value - mean) / std


async def detect_anomalies(tenant_id: str) -> dict:
    """Compute anomalies for every retailer in the tenant. Idempotent — replaces."""
    retailer_ids: List[str] = []
    distributors = await db.distributors.find(
        {"manufacturer_id": tenant_id}, {"_id": 0, "id": 1},
    ).to_list(5000)
    dist_ids = [d["id"] for d in distributors]
    retailers = await db.retailers.find(
        {"distributor_id": {"$in": dist_ids}},
        {"_id": 0, "id": 1, "name": 1, "distributor_id": 1, "region": 1},
    ).to_list(20000)
    retailer_by_id = {r["id"]: r for r in retailers}
    retailer_ids = list(retailer_by_id.keys())
    if not retailer_ids:
        return {"alerts": 0}

    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=20)).isoformat()
    rows = await db.daily_sales.find(
        {"retailer_id": {"$in": retailer_ids}, "date": {"$gte": start}},
        {"_id": 0},
    ).to_list(300_000)

    # Per-retailer per-day units
    daily: Dict[str, Dict[str, float]] = {}
    for s in rows:
        m = daily.setdefault(s["retailer_id"], {})
        m[s["date"]] = m.get(s["date"], 0.0) + float(s.get("units", 0))

    # Build per-retailer 21-day series, with today as the value-of-interest
    alerts: List[dict] = []
    now = now_iso()
    for rid, days_map in daily.items():
        series_21 = [days_map.get((today - timedelta(days=i)).isoformat(), 0.0)
                     for i in range(20, -1, -1)]
        today_val = series_21[-1]
        baseline = series_21[:-1]
        if sum(baseline) == 0 and today_val == 0:
            continue  # truly inactive — skip noise
        z = _zscore(today_val, baseline)
        r = retailer_by_id[rid]
        if z >= 2.5 and today_val > 0:
            alerts.append(_alert(
                tenant_id=tenant_id, rid=rid, r=r,
                kind="buying_spike", severity="info" if z < 3.5 else "warning",
                title=f"Buying spike at {r['name']}",
                detail=f"Today's units {int(today_val)} are {z:.1f}σ above 20-day average. Possible bulk purchase or seasonal pull.",
                metric=today_val, baseline=sum(baseline) / max(len(baseline), 1),
                now=now,
            ))
        elif z <= -2.0 and sum(baseline) > 0:
            alerts.append(_alert(
                tenant_id=tenant_id, rid=rid, r=r,
                kind="sales_dropoff", severity="warning",
                title=f"Sales dropped at {r['name']}",
                detail=f"Today's units {int(today_val)} are {abs(z):.1f}σ below average. Check for stockout or competitor activity.",
                metric=today_val, baseline=sum(baseline) / max(len(baseline), 1),
                now=now,
            ))
        # Inactivity: no sales in last 5 days but had sales before
        recent_5 = sum(series_21[-5:])
        prior_15 = sum(series_21[:-5])
        if recent_5 == 0 and prior_15 > 5:
            alerts.append(_alert(
                tenant_id=tenant_id, rid=rid, r=r,
                kind="inactivity", severity="critical",
                title=f"{r['name']} went silent",
                detail="Zero sales recorded for 5 consecutive days. Possible closure, system outage, or competitor migration.",
                metric=0, baseline=prior_15 / 15,
                now=now,
            ))

    # Replace old anomaly alerts for this tenant
    await db.intel_alerts.delete_many({"tenant_id": tenant_id, "category": "anomaly"})
    if alerts:
        await db.intel_alerts.insert_many(alerts)
    return {"alerts": len(alerts)}


def _alert(*, tenant_id, rid, r, kind, severity, title, detail, metric, baseline, now):
    return {
        "id": new_id(),
        "tenant_id": tenant_id,
        "category": "anomaly",
        "kind": kind,
        "severity": severity,
        "scope_role": "retailer",
        "scope_id": rid,
        "distributor_id": r.get("distributor_id", ""),
        "retailer_id": rid,
        "retailer_name": r.get("name", ""),
        "region": r.get("region", ""),
        "title": title,
        "detail": detail,
        "metric": round(float(metric), 2),
        "baseline": round(float(baseline), 2),
        "created_at": now,
    }
