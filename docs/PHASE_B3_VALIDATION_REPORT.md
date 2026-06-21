# Phase B3 — Validation Report

**Scope**: Driver KPI job · Vehicle KPI job · Compliance service · Unified `compliance` object on `/api/fleet/overview`
**Environment**: Preview (`https://supply-chain-hub-189.preview.emergentagent.com`)
**Status**: ✅ READY FOR PRODUCTION DEPLOY — awaiting approval for B4

---

## 1. Endpoint validation report

| Endpoint | Result | Notes |
|---|---|---|
| `GET /api/fleet/overview` | ✅ 200 | Now returns the **unified `compliance` object** (critical · warning · expiring_30d · expired · counts) merged with the legacy "due 30d" counters for back-compat. |
| `GET /api/drivers/workload` | ✅ 200 | Live counters unchanged in shape; `deliveries_30d` and `on_time_pct_30d` are now populated from the persisted KPI fields (instead of computed on-the-fly). |
| `GET /api/vehicles/utilization` | ✅ 200 | Unchanged shape. Vehicle KPI fields (`trips_30d`, `utilization_pct`, etc.) are now persisted; future revisions can read from there. |
| All B2 endpoints (assignment-history, default-driver pairing, etc.) | ✅ 200 | No regression. |

No new routes were added in B3. The job outputs are surfaced through the existing endpoints + persisted fields on `drivers` / `vehicles` documents.

---

## 2. Scheduler validation report

### 2.1 Registered jobs

| ID | Type | Cadence | First run after boot | Status |
|---|---|---|---|---|
| `fleet_driver_kpis` | Interval | 15 min | T + 4 min | ✅ Registered |
| `fleet_vehicle_kpis` | Interval | 15 min | T + 5 min | ✅ Registered |
| `fleet_compliance` | Cron | Daily @ 03:00 UTC (+ T+2 min initial pass) | T + 2 min | ✅ Registered |

All jobs are wrapped in `_wrap()` — exceptions are logged and the scheduler does not die. `max_instances=1` and `coalesce=True` prevent run pile-up if a previous run is still in flight.

### 2.2 First scheduled run observed

```
2026-06-21 06:57:05,025 - INFO - [fleet_compliance] {
  drivers_scanned: 8, drivers_updated: 8,
  vehicles_scanned: 8, vehicles_updated: 8,
  notifications_emitted: 0, transitions_logged: 0
}
```

`notifications_emitted: 0` is correct on the 2nd pass — severity already matches `prev_severity`, so no fanout. The earlier manual run emitted **3 transitions × 19 dispatcher users = 57 notifications**.

### 2.3 No crash regression

- `services/control_tower_sim.py::tick()` still firing every 2 min, **zero `tick failed` / `KeyError`** since the Phase B sim guard landed.
- No `[fleet_*] job failed` lines in supervisor logs.

---

## 3. Sample KPI outputs

### 3.1 Driver KPI snapshot — `DRV-W0-11542` (Adaeze Ibe)

```json
{
  "employee_number": "DRV-W0-11542",
  "deliveries_30d": 2,
  "on_time_pct_30d": 0.0,
  "avg_pod_time_min": 0.0,
  "failed_delivery_count": 0,
  "active_trip_count": 2,
  "kpis_updated_at": "2026-06-21T06:54:58.278323+00:00"
}
```

### 3.2 Vehicle KPI snapshot — `TK-W0-V001`

```json
{
  "vehicle_code": "TK-W0-V001",
  "trips_30d": 2,
  "utilization_pct": 0.0,
  "idle_pct": 100.0,
  "distance_km_30d": 0.0,
  "on_time_delivery_pct": null,
  "kpis_updated_at": "2026-06-21T06:55:04.025525+00:00"
}
```

> Note on `utilization_pct = 0` / `distance_km_30d = 0`: the test shipments don't yet carry `transit_minutes` / `route_distance_km` (those are computed during the simulator's road-following pass, not the Track A lifecycle). The aggregator handles missing fields gracefully via `$ifNull → 0`. As soon as the lifecycle adds those fields (deferred), the KPIs will populate without code changes.

---

## 4. Sample compliance outputs

### 4.1 Per-entity compliance blob — Driver

```json
{
  "compliance": {
    "severity": "critical",
    "checks": [
      {
        "kind": "driver_licence",
        "field": "licence_expiry",
        "expires_at": "2026-06-24",
        "days_remaining": 3,
        "severity": "critical"
      }
    ],
    "counts": {"expired": 0, "critical": 1, "high": 0, "warning": 0, "info": 0, "ok": 0},
    "evaluated_at": "2026-06-21T06:55:32.183030+00:00"
  },
  "compliance_severity": "critical"
}
```

### 4.2 Per-entity compliance blob — Vehicle (worst-case demo, `TK-W0-V001`)

```json
{
  "compliance": {
    "severity": "expired",
    "checks": [
      { "kind": "vehicle_insurance",      "expires_at": "2026-06-16", "days_remaining":  -5, "severity": "expired" },
      { "kind": "vehicle_roadworthiness", "expires_at": "2026-07-03", "days_remaining":  12, "severity": "high"    },
      { "kind": "vehicle_registration",   "expires_at": "2026-08-05", "days_remaining":  45, "severity": "info"    }
    ],
    "counts": {"expired": 1, "critical": 0, "high": 1, "warning": 0, "info": 1, "ok": 0},
    "evaluated_at": "2026-06-21T06:55:32.183030+00:00"
  },
  "compliance_severity": "expired"
}
```

### 4.3 Tenant-level `compliance` object on `/api/fleet/overview`

```json
{
  "tenant_id": "b21c1dbe-1a6f-4c33-b036-f416579455d0",
  "compliance": {
    "critical": 2,              // critical + expired entities
    "warning": 0,               // high + warning entities
    "expiring_30d": 1,          // critical + high + warning (excl. expired & info)
    "expired": 1,               // entities already past expiry
    "counts": {                 // granular per-severity counts
      "expired": 1,
      "critical": 1,
      "high": 0,
      "warning": 0,
      "info": 0,
      "ok": 7
    },
    "licences_due_30d": 1,      // legacy granular counters retained
    "insurance_due_30d": 0,
    "roadworthiness_due_30d": 1
  },
  ...
}
```

### 4.4 Notification fanout sample (in-app)

```json
{
  "type": "fleet_compliance",
  "severity": "critical",
  "title": "Compliance critical (≤7 days)",
  "message": "Driver Adaeze Ibe: driver_licence (3d)",
  "data": {
    "tenant_id": "b21c1dbe-1a6f-4c33-b036-f416579455d0",
    "entity_type": "driver",
    "entity_id": "0f40671e-6081-421f-99fe-36fe5da57dc7",
    "severity": "critical",
    "prev_severity": "ok",
    "checks": [ ...full check list... ]
  },
  "read": false,
  "created_at": "2026-06-21T06:55:34.342425+00:00"
}
```

Fanned out to **all dispatcher-role users in the tenant** (manufacturer + distributor + wholesaler + super_admin). 57 notifications written on the first pass.

### 4.5 Severity transition audit log — `db.fleet_compliance_log`

```json
{
  "entity_type": "driver",
  "entity_id": "0f40671e-...",
  "tenant_id": "b21c1dbe-...",
  "from_severity": "ok",
  "to_severity": "critical",
  "checks": [ ... ],
  "created_at": "2026-06-21T06:55:32.183030+00:00"
}
```

3 transitions logged on the demo pass (1 driver → critical, 1 vehicle → expired, 1 vehicle → warning).

---

## 5. Production deployment checklist

| Step | Action | Required? |
|---|---|---|
| 1 | Click **Deploy** on the Emergent UI | ✅ Yes |
| 2 | Verify `/api/fleet/overview` returns the new `compliance` object on production | ✅ Yes |
| 3 | Confirm scheduler started — check production logs for `[fleet_compliance]` line within 5 min of boot | ✅ Yes |
| 4 | Run the migration script on production once (idempotent) to backfill `assigned_driver_id` + clean any drifted Track A vehicles: `PYTHONPATH=/app/backend python /app/backend/scripts/migrate_logistics_v2.py` | ✅ Yes (per your instruction: keep manual) |
| 5 | Manually trigger one compliance pass on prod (optional): `python -c "import asyncio; from services.fleet_compliance import job_compliance_check; print(asyncio.run(job_compliance_check()))"` | ⚪ Optional — scheduler will fire it at 03:00 UTC + T+2 min on boot anyway |
| 6 | (Optional) Seed realistic expiry data on a small slice of production drivers/vehicles to surface the compliance banner before real expiries arrive | ⚪ Optional |
| 7 | Do NOT add `POST /api/_admin/run-migration` yet — per your instruction migrations remain manual until Fleet hits production stability | ✅ Confirmed |

### Environment variables — none added in B3
Existing controls remain in place:
- `INTEL_SCHEDULER_ENABLED=true` (default) — set to `false` as emergency kill-switch.
- No new env vars introduced.

---

## 6. Files touched in B3

| File | Change | LOC |
|---|---|---|
| `backend/services/fleet_compliance.py` | NEW — compliance service + 3 jobs + tenant summary | +445 |
| `backend/services/intel/scheduler.py` | +3 jobs registered, `_wrap()` helper added | +35 |
| `backend/routes/fleet.py` | `tenant_compliance_summary()` integrated into `fleet/overview` payload | +6 |

Lint clean across all three.

---

## 7. Acceptance gate (B3 only)

- [x] Driver KPI job recomputes 5 metrics (`deliveries_30d`, `on_time_pct_30d`, `avg_pod_time_min`, `failed_delivery_count`, `active_trip_count`)
- [x] Vehicle KPI job recomputes 5 metrics (`trips_30d`, `utilization_pct`, `idle_pct`, `distance_km_30d`, `on_time_delivery_pct`)
- [x] Compliance job tracks 4 expiry fields (`licence_expiry`, `insurance_expiry`, `roadworthiness_expiry`, `registration_expiry`)
- [x] 5 severity buckets (expired / critical / high / warning / info / ok) with the spec'd day thresholds
- [x] In-app notifications fan out on severity worsening; recipients = dispatcher users of the tenant
- [x] Email notifications **not** built (P1 — deferred to a later phase)
- [x] `fleet/overview` returns the requested 4-bucket `compliance` object (`critical`, `warning`, `expiring_30d`, `expired`) plus granular `counts` and back-compat legacy counters
- [x] Severity transitions audited in `db.fleet_compliance_log`
- [x] All jobs idempotent (2nd run = 0 notifications, 0 transitions)
- [x] Scheduler does not die on a single job exception (`_wrap()` guard)

---

## 8. STOP — awaiting B4 approval

Per your instruction, **no UI work has started**. Next planned phases (each will go through its own validation gate):

- **B4** — Driver Roster UI (`/fleet/drivers`)
- **B5** — Vehicle Roster UI (`/fleet/vehicles`)
- **B6** — Dispatch Console (`/fleet/dispatch`)
- **B7** — Command Centre v2 (unified data feed, severity banner, super-admin global toggle)

You also said you want to **review the Fleet architecture before approving B4–B7**. The full picture is now visible across these three docs:

1. `/api/public-docs/fleet-functional-spec` — original Phase B spec
2. `/api/public-docs/phase-b-b1-b2-validation` — B1 + B2 sign-off
3. `/api/public-docs/phase-b3-validation` — this report

Reply with **"approve B4"** (or a wider go-ahead) once you've reviewed. I'll pause here.
