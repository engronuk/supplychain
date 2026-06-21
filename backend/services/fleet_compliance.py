"""Fleet Compliance Service — Phase B3.

Three background workers + a unified compliance accessor used by the
``/api/fleet/overview`` aggregator:

* :func:`job_driver_kpis` — every 15 min, recompute driver counters.
* :func:`job_vehicle_kpis` — every 15 min, recompute vehicle counters.
* :func:`job_compliance_check` — daily 03:00 UTC, classify expiries into
  five severity buckets and fan out in-app notifications to dispatchers
  for the newly-tripped severity transitions.

All jobs are tenant-fan-out (iterate over manufacturers) and idempotent.
Writes are limited to:

* ``db.drivers``   — KPI fields + ``compliance_severity`` + ``compliance``
* ``db.vehicles``  — KPI fields + ``compliance_severity`` + ``compliance``
* ``db.notifications`` — in-app fanout
* ``db.fleet_compliance_log`` — audit trail of severity transitions

Severity thresholds (calendar days remaining):

    expired:  days_remaining <  0
    critical: 0  <= days_remaining <=  7
    high:     8  <= days_remaining <= 14
    warning:  15 <= days_remaining <= 30
    info:     31 <= days_remaining <= 90
    ok:       days_remaining >  90  or  no expiry tracked

The ``compliance`` block returned by ``/api/fleet/overview`` follows the
exact shape the user requested:

::

    "compliance": {
        "critical":     <int>,       # critical + expired count
        "warning":      <int>,       # high + warning
        "expiring_30d": <int>,       # critical + high + warning + info
        "expired":      <int>,       # already past expiry
    }

The narrower per-severity counts live on each driver / vehicle's
``compliance.checks`` array so the UI can render badges and drawers.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from core import db, logger, new_id, now_iso

# ---------------------------------------------------------------------------
# Severity thresholds
# ---------------------------------------------------------------------------
SEVERITY_ORDER = ("expired", "critical", "high", "warning", "info", "ok")
SEVERITY_RANK = {s: i for i, s in enumerate(SEVERITY_ORDER)}

# How many calendar days each tracked field expires in
THRESHOLDS = (
    (-1, "expired"),
    (7, "critical"),
    (14, "high"),
    (30, "warning"),
    (90, "info"),
)


def classify_days_remaining(days_remaining: Optional[int]) -> str:
    """Return severity string for an expiry that's ``days_remaining`` days
    away. ``None`` means there is no expiry tracked → ``ok``.
    """
    if days_remaining is None:
        return "ok"
    if days_remaining < 0:
        return "expired"
    for limit, label in THRESHOLDS[1:]:  # skip the negative gate
        if days_remaining <= limit:
            return label
    return "ok"


def _days_remaining(expiry_iso: Optional[str], today: Optional[date] = None) -> Optional[int]:
    """Calendar-day delta until ``expiry_iso``. Returns ``None`` if missing
    or unparseable. Negative numbers mean already expired."""
    if not expiry_iso:
        return None
    try:
        # accept either YYYY-MM-DD or full ISO timestamp
        if "T" in expiry_iso:
            dt = datetime.fromisoformat(expiry_iso.replace("Z", "+00:00")).date()
        else:
            dt = date.fromisoformat(expiry_iso[:10])
    except ValueError:
        return None
    today = today or datetime.now(timezone.utc).date()
    return (dt - today).days


def _worst(*severities: str) -> str:
    """Return the worst (lowest index in SEVERITY_ORDER) severity."""
    return min(severities, key=lambda s: SEVERITY_RANK.get(s, 99))


# ---------------------------------------------------------------------------
# Compliance computation
# ---------------------------------------------------------------------------
def _driver_checks(drv: Dict[str, Any]) -> List[Dict[str, Any]]:
    days = _days_remaining(drv.get("licence_expiry"))
    return [{
        "kind": "driver_licence",
        "field": "licence_expiry",
        "expires_at": drv.get("licence_expiry"),
        "days_remaining": days,
        "severity": classify_days_remaining(days),
    }]


def _vehicle_checks(veh: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for kind, field in (
        ("vehicle_insurance",       "insurance_expiry"),
        ("vehicle_roadworthiness",  "roadworthiness_expiry"),
        ("vehicle_registration",    "registration_expiry"),
    ):
        days = _days_remaining(veh.get(field))
        out.append({
            "kind": kind,
            "field": field,
            "expires_at": veh.get(field),
            "days_remaining": days,
            "severity": classify_days_remaining(days),
        })
    return out


def _bucket(checks: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    buckets = {"expired": 0, "critical": 0, "high": 0, "warning": 0, "info": 0, "ok": 0}
    worst = "ok"
    for c in checks:
        sev = c["severity"]
        buckets[sev] = buckets.get(sev, 0) + 1
        worst = _worst(worst, sev)
    buckets["worst"] = worst  # type: ignore[assignment]
    return buckets


# ---------------------------------------------------------------------------
# KPI computation
# ---------------------------------------------------------------------------
async def _driver_kpis(driver_id: str, now: datetime) -> Dict[str, Any]:
    thirty_iso = (now - timedelta(days=30)).isoformat()
    # 30-day rollups
    delivered_pipeline = [
        {"$match": {"driver_id": driver_id,
                    "status": "delivered",
                    "delivered_at": {"$gte": thirty_iso}}},
        {"$group": {
            "_id": None,
            "n": {"$sum": 1},
            "on_time": {"$sum": {"$cond": [
                {"$or": [
                    {"$eq": ["$eta", None]},
                    {"$lte": ["$delivered_at", "$eta"]},
                ]}, 1, 0]}},
        }},
    ]
    n_delivered = 0
    n_on_time = 0
    async for r in db.shipments.aggregate(delivered_pipeline):
        n_delivered = r["n"]
        n_on_time = r["on_time"]

    failed = await db.shipments.count_documents({
        "driver_id": driver_id,
        "status": "cancelled",
        "updated_at": {"$gte": thirty_iso},
    })

    active = await db.shipments.count_documents({
        "driver_id": driver_id,
        "status": {"$in": ["assigned", "loaded", "in_transit", "arrived"]},
    })

    # average PoD time = arrived → delivered minutes
    pod_pipeline = [
        {"$match": {"driver_id": driver_id, "status": "delivered",
                    "delivered_at": {"$gte": thirty_iso},
                    "arrived_at": {"$ne": None}}},
        {"$project": {
            "diff_min": {"$divide": [
                {"$subtract": [
                    {"$dateFromString": {"dateString": "$delivered_at"}},
                    {"$dateFromString": {"dateString": "$arrived_at"}},
                ]},
                60000,
            ]}
        }},
        {"$group": {"_id": None, "avg": {"$avg": "$diff_min"}}},
    ]
    avg_pod = None
    async for r in db.shipments.aggregate(pod_pipeline):
        avg_pod = round(r["avg"], 1) if r.get("avg") is not None else None

    return {
        "deliveries_30d": n_delivered,
        "on_time_pct_30d": round(100 * n_on_time / n_delivered, 1) if n_delivered else None,
        "avg_pod_time_min": avg_pod,
        "failed_delivery_count": failed,
        "active_trip_count": active,
    }


async def _vehicle_kpis(vehicle_id: str, vehicle: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    thirty_iso = (now - timedelta(days=30)).isoformat()
    trip_pipeline = [
        {"$match": {"vehicle_id": vehicle_id,
                    "created_at": {"$gte": thirty_iso}}},
        {"$group": {
            "_id": None,
            "trips": {"$sum": 1},
            "delivered": {"$sum": {"$cond": [{"$eq": ["$status", "delivered"]}, 1, 0]}},
            "on_time": {"$sum": {"$cond": [
                {"$and": [
                    {"$eq": ["$status", "delivered"]},
                    {"$or": [
                        {"$eq": ["$eta", None]},
                        {"$lte": ["$delivered_at", "$eta"]},
                    ]}]}, 1, 0]}},
            "distance_km": {"$sum": {"$ifNull": ["$route_distance_km", 0]}},
            "in_transit_minutes": {"$sum": {"$ifNull": ["$transit_minutes", 0]}},
        }},
    ]
    trips = 0
    delivered = 0
    on_time = 0
    distance_km = 0.0
    transit_min = 0.0
    async for r in db.shipments.aggregate(trip_pipeline):
        trips = r.get("trips", 0)
        delivered = r.get("delivered", 0)
        on_time = r.get("on_time", 0)
        distance_km = float(r.get("distance_km") or 0)
        transit_min = float(r.get("in_transit_minutes") or 0)

    minutes_in_30d = 30 * 24 * 60
    utilisation_pct = round(100 * transit_min / minutes_in_30d, 1) if transit_min else 0.0
    idle_pct = round(max(0.0, 100.0 - utilisation_pct), 1)
    on_time_pct = round(100 * on_time / delivered, 1) if delivered else None

    return {
        "trips_30d": trips,
        "utilization_pct": utilisation_pct,
        "idle_pct": idle_pct,
        "distance_km_30d": round(distance_km, 1),
        "on_time_delivery_pct": on_time_pct,
    }


# ---------------------------------------------------------------------------
# Notification fanout
# ---------------------------------------------------------------------------
SEVERITY_TITLE = {
    "expired":  "Compliance EXPIRED",
    "critical": "Compliance critical (≤7 days)",
    "high":     "Compliance warning (≤14 days)",
    "warning":  "Compliance reminder (≤30 days)",
}


async def _emit_compliance_notifications(
    entity_type: str, entity: Dict[str, Any], checks: List[Dict[str, Any]],
    prev_severity: str, new_severity: str, tenant_id: str,
):
    """In-app notifications for severity transitions. Email is P1 — deferred."""
    if SEVERITY_RANK[new_severity] >= SEVERITY_RANK.get(prev_severity, 99):
        return  # severity did not get worse; no fanout

    # Find recipients: any user whose role is dispatcher + manufacturer_id = tenant.
    recipients = []
    async for u in db.users.find(
        {"role": {"$in": ["manufacturer", "distributor", "wholesaler", "super_admin"]},
         "$or": [{"manufacturer_id": tenant_id}, {"entity_id": tenant_id}],
         "status": "active"},
        {"_id": 0, "id": 1, "role": 1},
    ):
        recipients.append(u["id"])

    if not recipients:
        return

    label = (entity.get("full_name") or entity.get("vehicle_code")
             or entity.get("employee_number") or entity["id"])
    badges = ", ".join(
        f"{c['kind']} ({c['days_remaining']}d)"
        for c in checks if c["severity"] in ("expired", "critical", "high", "warning")
    )
    title = SEVERITY_TITLE.get(new_severity, "Compliance update")
    message = f"{entity_type.title()} {label}: {badges or new_severity}"

    now = now_iso()
    docs = [{
        "id": new_id(),
        "user_id": uid,
        "target_type": entity_type,
        "target_id": entity["id"],
        "type": "fleet_compliance",
        "severity": new_severity,
        "title": title,
        "message": message,
        "body": message,
        "data": {
            "tenant_id": tenant_id,
            "entity_type": entity_type,
            "entity_id": entity["id"],
            "severity": new_severity,
            "prev_severity": prev_severity,
            "checks": checks,
        },
        "read": False,
        "created_at": now,
    } for uid in recipients]
    if docs:
        await db.notifications.insert_many(docs)


# ---------------------------------------------------------------------------
# Background jobs (called by scheduler)
# ---------------------------------------------------------------------------
async def job_driver_kpis() -> Dict[str, int]:
    """Refresh per-driver KPI fields. Idempotent. Returns counters."""
    counter = {"scanned": 0, "updated": 0}
    now = datetime.now(timezone.utc)
    cursor = db.drivers.find(
        {"is_active": True},
        {"_id": 0, "id": 1},
    )
    async for d in cursor:
        counter["scanned"] += 1
        kpis = await _driver_kpis(d["id"], now)
        await db.drivers.update_one(
            {"id": d["id"]},
            {"$set": {**kpis, "kpis_updated_at": now.isoformat()}},
        )
        counter["updated"] += 1
    return counter


async def job_vehicle_kpis() -> Dict[str, int]:
    counter = {"scanned": 0, "updated": 0}
    now = datetime.now(timezone.utc)
    cursor = db.vehicles.find(
        {"is_active": True, "source": {"$in": ["manual", "seed"]}},
        {"_id": 0, "id": 1, "odometer_km": 1},
    )
    async for v in cursor:
        counter["scanned"] += 1
        kpis = await _vehicle_kpis(v["id"], v, now)
        await db.vehicles.update_one(
            {"id": v["id"]},
            {"$set": {**kpis, "kpis_updated_at": now.isoformat()}},
        )
        counter["updated"] += 1
    return counter


async def job_compliance_check() -> Dict[str, int]:
    """Daily — score compliance, persist per-entity ``compliance`` blob,
    fan out notifications when severity worsens."""
    counter = {
        "drivers_scanned": 0, "drivers_updated": 0,
        "vehicles_scanned": 0, "vehicles_updated": 0,
        "notifications_emitted": 0,
        "transitions_logged": 0,
    }
    now = now_iso()

    # ---- Drivers ----
    async for d in db.drivers.find({"is_active": True}, {"_id": 0}):
        counter["drivers_scanned"] += 1
        checks = _driver_checks(d)
        bucket = _bucket(checks)
        new_severity = bucket.pop("worst")  # type: ignore[arg-type]
        prev_severity = (d.get("compliance") or {}).get("severity", "ok")
        compliance = {
            "severity": new_severity,
            "checks": checks,
            "counts": bucket,
            "evaluated_at": now,
        }
        await db.drivers.update_one(
            {"id": d["id"]},
            {"$set": {"compliance": compliance,
                      "compliance_severity": new_severity}},
        )
        counter["drivers_updated"] += 1

        if SEVERITY_RANK[new_severity] < SEVERITY_RANK.get(prev_severity, 99):
            tenant_id = d.get("employer_org_id") or ""
            await _emit_compliance_notifications(
                "driver", d, checks, prev_severity, new_severity, tenant_id,
            )
            counter["notifications_emitted"] += 1
            await db.fleet_compliance_log.insert_one({
                "id": new_id(),
                "entity_type": "driver",
                "entity_id": d["id"],
                "tenant_id": tenant_id,
                "from_severity": prev_severity,
                "to_severity": new_severity,
                "checks": checks,
                "created_at": now,
            })
            counter["transitions_logged"] += 1

    # ---- Vehicles ----
    async for v in db.vehicles.find(
            {"is_active": True, "source": {"$in": ["manual", "seed"]}},
            {"_id": 0}):
        counter["vehicles_scanned"] += 1
        checks = _vehicle_checks(v)
        bucket = _bucket(checks)
        new_severity = bucket.pop("worst")  # type: ignore[arg-type]
        prev_severity = (v.get("compliance") or {}).get("severity", "ok")
        compliance = {
            "severity": new_severity,
            "checks": checks,
            "counts": bucket,
            "evaluated_at": now,
        }
        await db.vehicles.update_one(
            {"id": v["id"]},
            {"$set": {"compliance": compliance,
                      "compliance_severity": new_severity}},
        )
        counter["vehicles_updated"] += 1

        if SEVERITY_RANK[new_severity] < SEVERITY_RANK.get(prev_severity, 99):
            tenant_id = v.get("owner_org_id") or ""
            await _emit_compliance_notifications(
                "vehicle", v, checks, prev_severity, new_severity, tenant_id,
            )
            counter["notifications_emitted"] += 1
            await db.fleet_compliance_log.insert_one({
                "id": new_id(),
                "entity_type": "vehicle",
                "entity_id": v["id"],
                "tenant_id": tenant_id,
                "from_severity": prev_severity,
                "to_severity": new_severity,
                "checks": checks,
                "created_at": now,
            })
            counter["transitions_logged"] += 1

    return counter


# ---------------------------------------------------------------------------
# Compliance accessor used by /api/fleet/overview
# ---------------------------------------------------------------------------
async def tenant_compliance_summary(tenant_id: str) -> Dict[str, Any]:
    """Return the four-bucket summary AND per-severity counts.

    Output shape matches the user's spec:

        {
          "critical": <int>,       # expired + critical
          "warning":  <int>,       # high + warning
          "expiring_30d": <int>,   # info-or-worse-but-not-ok
          "expired":  <int>
        }

    Plus we include the granular `counts` for the UI badges.
    """
    drv_filter: Dict[str, Any] = {"is_active": True}
    veh_filter: Dict[str, Any] = {"is_active": True, "source": {"$in": ["manual", "seed"]}}
    if tenant_id:
        drv_filter["employer_org_id"] = tenant_id
        veh_filter["owner_org_id"] = tenant_id

    by_sev = {s: 0 for s in SEVERITY_ORDER}
    # we count an entity once at its worst severity
    async for d in db.drivers.find(drv_filter, {"_id": 0, "compliance_severity": 1}):
        sev = d.get("compliance_severity") or "ok"
        by_sev[sev] = by_sev.get(sev, 0) + 1
    async for v in db.vehicles.find(veh_filter, {"_id": 0, "compliance_severity": 1}):
        sev = v.get("compliance_severity") or "ok"
        by_sev[sev] = by_sev.get(sev, 0) + 1

    critical = by_sev["critical"] + by_sev["expired"]
    warning = by_sev["high"] + by_sev["warning"]
    expiring_30d = by_sev["critical"] + by_sev["high"] + by_sev["warning"]
    return {
        "critical": critical,
        "warning": warning,
        "expiring_30d": expiring_30d,
        "expired": by_sev["expired"],
        "counts": by_sev,
    }
