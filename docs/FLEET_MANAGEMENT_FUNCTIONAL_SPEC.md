# Fleet Management Foundations — Functional Specification (Phase B)

**Version**: 1.0
**Status**: 🟡 DRAFT — pending approval
**Last updated**: 2026-06-20
**Phase A status**: ✅ Approved (Logistics Foundation + OTP PoD shipped)
**Owner**: TradeKonekt Backend / Logistics
**Scope**: Driver Registry · Vehicle Registry · Shipment Assignment Console · Command Centre Integration

---

## 0. Executive summary

Phase A delivered the **transactional rails**: an 8-state shipment lifecycle, first-class `Driver` and `Vehicle` entities, and OTP-based Proof of Delivery. Phase B turns those rails into a **product** — a Fleet Management surface usable by manufacturer/distributor/wholesaler dispatchers, plus a refreshed Command Centre that reads the new entities (not the legacy simulator).

The audit below shows **the backend is ~70% there**: CRUD, status transitions, and reassign endpoints exist. The remaining work is **(a) closing six concrete API gaps**, **(b) unifying the simulator + Track A vehicle data model**, and **(c) building the dispatcher-facing UI** (which currently has zero coverage of Track A entities).

---

## 1. Discovery & Validation Audit

### 1.1 Backend endpoint inventory

#### Driver Registry (`/api/drivers/*` and `/api/driver/*`)

| Method | Path | Coverage | Status |
|---|---|---|---|
| `GET`    | `/api/drivers` | List drivers (filter by status, employer_org_id) | ✅ Live |
| `POST`   | `/api/drivers` | Create driver (invites parallel User; idempotent on employee_number) | ✅ Live |
| `GET`    | `/api/drivers/{id}` | Driver profile | ✅ Live |
| `PATCH`  | `/api/drivers/{id}` | Update profile (name, phone, licence, home wh) | ✅ Live |
| `POST`   | `/api/drivers/{id}/deactivate` | Soft-deactivate (cannot login, hidden from roster) | ✅ Live |
| `POST`   | `/api/drivers/{id}/reactivate` | Reverse deactivate | ✅ Live |
| `GET`    | `/api/drivers/{id}/shipments` | Past + current shipments for driver | ✅ Live |
| `GET`    | `/api/driver/me` | Self profile (driver token) | ✅ Live |
| `PATCH`  | `/api/driver/me` | Self profile update | ✅ Live |
| `POST`   | `/api/driver/me/online` / `offline` | Presence | ✅ Live |
| `POST`   | `/api/driver/me/location` | Heartbeat lat/lng | ✅ Live |
| `GET`    | `/api/driver/shipments` / `/api/driver/shipments/{id}` | Driver-scoped queue | ✅ Live |
| `POST`   | `/api/driver/shipments/{id}/accept` / `reject` | Driver disposition | ✅ Live |

#### Vehicle Registry (`/api/vehicles/*`)

| Method | Path | Coverage | Status |
|---|---|---|---|
| `GET`    | `/api/vehicles` | List (filter by status, owner_org_id) | ✅ Live |
| `POST`   | `/api/vehicles` | Create | ✅ Live |
| `GET`    | `/api/vehicles/{id}` | Detail | ✅ Live |
| `PATCH`  | `/api/vehicles/{id}` | Edit (make/model/capacity/insurance/etc.) | ✅ Live |
| `POST`   | `/api/vehicles/{id}/set-maintenance` | Status → `maintenance` | ✅ Live |
| `POST`   | `/api/vehicles/{id}/complete-service` | Maintenance → `available` (logs km, service_date) | ✅ Live |
| `POST`   | `/api/vehicles/{id}/set-offline` / `set-online` | Out-of-service toggle | ✅ Live |
| `POST`   | `/api/vehicles/{id}/decommission` | Hard retire (is_active=false) | ✅ Live |
| `GET`    | `/api/vehicles/{id}/history` | Trip log | ✅ Live |
| `GET`    | `/api/vehicles/{id}/utilization` | KPI (units carried, distance, idle %) | ✅ Live |

#### Shipment Assignment (`/api/shipments/*`)

| Method | Path | Coverage | Status |
|---|---|---|---|
| `POST` | `/api/shipments/{id}/assign` | Assign driver+vehicle → status `assigned` | ✅ Live |
| `POST` | `/api/shipments/{id}/reassign-driver` | Swap driver mid-trip | ✅ Live |
| `POST` | `/api/shipments/{id}/reassign-vehicle` | Swap vehicle mid-trip | ✅ Live |
| `GET`  | `/api/shipments?status=…&driver_id=…&vehicle_id=…` | Filtered list (dispatch board) | ✅ Live |
| `GET`  | `/api/shipments/{id}/timeline` | Per-shipment audit trail | ✅ Live |

#### Logistics Command Centre (`/api/logistics/*`)

| Method | Path | Coverage | Status |
|---|---|---|---|
| `GET` | `/api/logistics/overview` | Aggregated KPI panel | ✅ Live (legacy schema) |
| `GET` | `/api/logistics/control-tower` | Map + fleet feed | ⚠️ **Reads legacy `simulator` vehicles only** |
| `GET` | `/api/logistics/trucks` | Active trucks listing | ⚠️ Same |
| `GET` | `/api/logistics/events` | Live event stream | ✅ Live |
| `GET` | `/api/logistics/geofences` | Geofence registry | ✅ Live |
| `GET` | `/api/logistics/shipment-timeline/{id}` | Per-shipment events | ✅ Live |

### 1.2 Data-model audit

#### Driver (`models.py:208-244`) — solid

```py
DriverStatus = Literal["available", "assigned", "on_trip", "offline"]
Driver: {
  id, employee_number, first_name, last_name, full_name, phone, email,
  licence_number, licence_class, licence_expiry,
  employer_org_id, employer_org_type ∈ {manufacturer|distributor|wholesaler},
  home_warehouse_id,
  status, assigned_vehicle_id, assigned_shipment_id,
  user_id, invited_at, claimed_at, last_login_at,
  deliveries_30d, on_time_pct_30d, avg_pod_time_min, last_seen_at,
  is_active, deactivated_at, deactivation_reason,
  created_at, updated_at, schema_version
}
```

#### Vehicle (`models.py:271-310`) — solid but **status drift risk**

```py
VehicleStatus = Literal["available", "loading", "in_transit", "maintenance", "offline"]
VehicleType   = Literal["truck", "van", "pickup", "trailer", "motorcycle"]
Vehicle: {
  id, vehicle_code, registration_number, vehicle_type,
  make, model, year, colour,
  capacity_units, capacity_weight_kg,
  owner_org_id, owner_org_type, home_warehouse_id,
  status, current_driver_id, current_shipment_id, current_route_id,
  odometer_km, fuel_pct, last_lat, last_lng, last_position_at,
  last_service_at, next_service_due_km,
  insurance_expiry, roadworthiness_expiry,
  is_active, decommissioned_at, source ∈ {manual|simulator}, …
}
```

**🔴 Schism**: the same `db.vehicles` collection contains TWO populations:
- **Legacy simulator** (`source: "simulator"`, n=4,132): uses `code` (not `vehicle_code`), carries `manufacturer_id` (not `owner_org_id` as PK lookup), supports non-enum statuses (`arrived`, `stopped`, `breakdown`, `archived`).
- **Track A entities** (`source: "manual"|"seed"`, n=8): canonical Track A model.

The control-tower simulator (`services/control_tower_sim.py`) mutates Track A vehicle rows too (we observed `TK-W0-V001` ending up in `status: "arrived"`, which is NOT in the Track A enum). This is the root cause of the `KeyError: 'code'` crash loop fixed earlier today.

---

## 2. Identified Gaps

| # | Gap | Impact | Severity |
|---|---|---|---|
| **G1** | `GET /api/logistics/control-tower` filters by `manufacturer_id` — invisible to Track A vehicles which use `owner_org_id`. | Live map shows zero Track A trucks. | **P0** |
| **G2** | `services/control_tower_sim.py` overwrites Track A vehicles' `status` with non-enum values (`arrived`, `stopped`). | Pydantic 422 if the row is rehydrated through the Vehicle model; data integrity. | **P0** |
| **G3** | No `GET /api/drivers/{id}/assignment-history` returning a unified history (assigns + reassigns + status changes). Currently only the driver's shipments are exposed; reassign events are buried inside each shipment's embedded `status_history`. | Roster UI cannot show "driver was on Truck A, swapped to Truck B at 14:02". | **P1** |
| **G4** | No `GET /api/vehicles/{id}/assignment-history` (same as above, vehicle side). | Same. | **P1** |
| **G5** | No dispatcher aggregation endpoint — `GET /api/fleet/dashboard` or `GET /api/drivers/workload` returning per-driver counters (active trips, pending acceptance, hours-on-shift, deliveries-today, on-time %). | Roster cannot rank/triage drivers. | **P1** |
| **G6** | `POST /api/shipments/{id}/assign` doesn't optionally bind the driver to the vehicle for **off-trip rest periods** (the driver/vehicle relationship is created only at assignment time and cleared at delivery). | Dispatchers cannot "permanently" pair a driver to a vehicle for the day. | **P2** |
| **G7** | `Vehicle` model has no `assigned_driver_id` (only `current_driver_id` which is shipment-scoped). | Cannot answer "who's the default driver of TK-005?" | **P2** |
| **G8** | Frontend has **zero views** that consume the Track A driver/vehicle endpoints. All existing logistics views (`ControlTowerView`, `LogisticsOperations`) read legacy sim trucks. | Phase B has no user-facing surface. | **P0** |
| **G9** | `db.shipment_status_history` only mirrors lifecycle state changes; reassign events (which keep `status` constant) are written to the **embedded** `status_history` array but NOT to the dedicated audit collection. | Audit reports miss reassign rows. | **P2** |
| **G10** | No background job to recompute `deliveries_30d`, `on_time_pct_30d`, `avg_pod_time_min` on the `drivers` collection. Fields exist but stay at default 0/None. | "Workload metrics" requirement cannot be satisfied. | **P1** |

---

## 3. Phase B Functional Requirements

### 3.1 Driver Registry — Manufacturer/Distributor/Wholesaler Dispatcher UX

**Roster page**: `/[tenant]/fleet/drivers`

- **Table columns**: avatar+name, employee_number, phone, status badge (color-coded by `DriverStatus`), current vehicle, current shipment, last seen, 30-day deliveries, on-time %, action menu (`Edit | Deactivate | View history | Invite again`).
- **Filters**: status, is_active, employer_org_id (super_admin only), home_warehouse_id.
- **Bulk actions**: bulk-deactivate (audit-logged), bulk export CSV.
- **Create flow**: drawer with `DriverCreate` fields; on submit, system POSTs `/api/drivers` then renders the invite link + copy button. Invite email/SMS fan-out is async (already wired via `services/notifications.py`).
- **Detail drawer**: profile + tabs `Overview · Assignments · Activity · KPIs`.
  - `Assignments` tab → `GET /api/drivers/{id}/assignment-history` (**NEW** endpoint, see §3.5)
  - `KPIs` tab → embeds the new `GET /api/drivers/workload` row.

### 3.2 Vehicle Registry — same pattern

**Roster page**: `/[tenant]/fleet/vehicles`

- Columns: thumbnail (vehicle_type icon), `vehicle_code`, `registration_number`, make/model, capacity (units + kg), status, current driver, current shipment, next service due, insurance expiry, action menu (`Edit · Set maintenance · Set offline · Decommission · History · Utilization`).
- Filters: status, type, owner_org_id, home_warehouse_id, capacity tier, expiry windows (insurance/roadworthiness in 30 days).
- **Detail drawer**: tabs `Overview · Assignments · Service log · Utilization · Compliance`.
  - `Service log` → `GET /api/vehicles/{id}/history?event=service`
  - `Utilization` → `GET /api/vehicles/{id}/utilization` (already live)
  - `Compliance` → derived from insurance / roadworthiness expiry fields; surfaces a warning banner if either is < 30 days away.

### 3.3 Shipment Assignment Console — `/[tenant]/fleet/dispatch`

Single-page workspace with two panes:

| Pane | Source | Behaviour |
|---|---|---|
| **Left — unassigned queue** | `GET /api/shipments?status=ready_for_dispatch` | Card per shipment with destination, total units, weight, ETA goal. Click → focus pane |
| **Right — assignment form** | Posts to `POST /api/shipments/{id}/assign` | Driver picker (filtered to `status=available` + matching `employer_org_id`), Vehicle picker (filtered to `status=available` + capacity ≥ shipment.total_units + matching `owner_org_id`), optional route picker, optional notes. CTA `Assign & dispatch`. |

Below: **Active trips list** — table of shipments where `status ∈ {assigned, loaded, in_transit, arrived}`. Each row has:
- driver, vehicle, destination, status, ETA, age-in-status badge
- inline actions: `Reassign driver` / `Reassign vehicle` (both prompt for reason, then call the respective endpoint)
- `Cancel shipment` (terminal state, only pre-`loaded`)

**Acceptance criteria**:
- A new shipment must move from `ready_for_dispatch → assigned` in one click after both pickers are filled.
- Driver picker must show real-time count of "X drivers available" with a refresh button.
- Capacity validation must run **client-side** before allowing assign (block submit + error toast).
- 409 from server must trigger a re-fetch and a toast: "Driver/vehicle just became unavailable — refresh".

### 3.4 Command Centre Integration — `/[tenant]/logistics/control-tower`

Rewrite the existing Control Tower data feed to be **Track A-aware**:

- Map markers come from `db.vehicles` filtered by `owner_org_id` (NOT `manufacturer_id`) AND `status ∈ {loading, in_transit, maintenance}`.
- Each marker exposes: vehicle_code, current_driver_id (joined → driver name/phone), current_shipment_id (joined → destination/eta), `last_position_at`.
- Driver presence dot: `DriverStatus = "available"` (green) / `assigned`/`on_trip` (blue) / `offline` (grey).
- Side panel KPIs:
  - Active drivers (status `assigned + on_trip`)
  - Active vehicles (status `loading + in_transit`)
  - Active shipments (status `assigned + loaded + in_transit + arrived`)
  - Average driver workload = active shipments / active drivers
  - Delayed shipments = shipments where `now > eta` (assumes `eta` populated on assign — already true via Phase A simulator).

**This pane MUST coexist with the legacy simulator data** for the existing tenants that rely on it. Strategy: union query, with `source` tag on each marker so the UI can toggle (`Track A only` / `Simulator only` / `All`).

### 3.5 New backend endpoints to ship

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/drivers/{id}/assignment-history?from=&to=&limit=` | List of `{ shipment_id, vehicle_id, from_status, to_status, event_type ∈ {assign, reassign-in, reassign-out, accept, reject, complete}, at, by_user_id, notes }` ordered desc. |
| `GET` | `/api/vehicles/{id}/assignment-history?…` | Same shape, vehicle-centric. |
| `GET` | `/api/drivers/workload?employer_org_id=&warehouse_id=` | Per-driver row: `{ driver_id, name, status, active_shipments, accepted_today, delivered_today, on_time_pct_7d, hours_on_shift, last_seen_at }` |
| `GET` | `/api/vehicles/utilization?owner_org_id=&from=&to=` | Aggregated: `{ vehicle_id, code, trips, distance_km, units_carried, idle_pct, breakdowns }` |
| `GET` | `/api/fleet/overview?org_id=&org_type=` | Single-call dispatcher dashboard cube (drivers by status, vehicles by status, shipments by status, due-soon compliance, top 5 active drivers, top 5 utilised vehicles). |
| `POST` | `/api/vehicles/{id}/assign-default-driver` | Persist a default `assigned_driver_id` on the vehicle (G7). Optional Phase B — push to Phase C if scope-cut. |

All new GETs scoped by tenant via existing `_assert_owner()` / `assert_tenant_access()` helpers.

### 3.6 Background jobs

| Job | Cadence | Computes |
|---|---|---|
| `job_driver_kpis` | every 15 min | Recompute `deliveries_30d`, `on_time_pct_30d`, `avg_pod_time_min` on each active driver. |
| `job_vehicle_kpis` | every 15 min | Recompute trip count, total km, idle pct on each active vehicle. |
| `job_compliance_check` | daily | Flag drivers/vehicles whose licence/insurance/roadworthiness expires in the next 30 days; emit notification + dashboard banner. |

Hosted alongside existing `apscheduler` jobs in `services/scheduler.py`.

### 3.7 Schema repair (one-time migration)

Extend `scripts/migrate_logistics_v2.py` (or add `scripts/migrate_fleet_unify.py`):

1. **Backfill `owner_org_id`** on legacy simulator vehicles (`source: simulator`) from their `manufacturer_id`. *Already done in v2 migration — verify.*
2. **Reject non-enum status values from being written to Track A rows** — gate the simulator with: `if v.get("source") in ("manual", "seed") and v.get("schema_version", 1) >= 2: skip`. This is a code change in `control_tower_sim.py:tick()`, not a data migration.
3. **Add `assigned_driver_id`** (nullable string) to `Vehicle` model + DB rows — only needed if G7 is in-scope.

---

## 4. Out of scope (Phase C and beyond)

- Driver mobile app feature parity (already P0-built in Phase A; further driver-app features are deferred per user instruction).
- Multi-stop route optimisation UI (engine already exists at `services/route_optimizer.py`; UI deferred).
- Real-time MQTT/SSE updates for the Command Centre (current model = polling every 30 s; fine for Phase B).
- IoT device integration (telematics, dashcam, fuel sensor).

---

## 5. Acceptance criteria (Phase B exit gate)

1. ✅ Dispatcher can browse, create, edit, deactivate, and view a full audit trail of every driver/vehicle from a web UI.
2. ✅ Dispatcher can assign + reassign driver/vehicle on any shipment in `ready_for_dispatch / assigned / loaded / in_transit / arrived` with proper guards.
3. ✅ Active trips view shows ≥ 1 Track A truck/driver on the Control Tower map within 10 s of `start-trip`.
4. ✅ Roster KPI columns (deliveries_30d, on-time %, hours on shift) populate within 15 min of any delivery (background job).
5. ✅ Reassign events appear in `shipment_status_history` AND in `assignment-history` per driver/vehicle.
6. ✅ Compliance banner fires when a licence or insurance expires within 30 days.
7. ✅ No `KeyError` / pydantic validation crashes in `job_vehicle_motion` after 24h of simulator + Track A coexistence.
8. ✅ Production deploy: `/api/_admin/seed-track-a-shipment` → entire flow visible on the new dispatch board within 5 s.

---

## 6. Implementation plan (proposed)

| Step | Deliverable | Effort |
|---|---|---|
| B1 | Migration + sim guard (G2 fix permanent), backfill verification | S |
| B2 | Backend: 5 new endpoints (assignment-history × 2, workload, utilization, fleet overview) | M |
| B3 | Backend: 3 background jobs (KPIs × 2, compliance) | M |
| B4 | Frontend: Driver Roster page + drawer | M |
| B5 | Frontend: Vehicle Roster page + drawer | M |
| B6 | Frontend: Dispatch Console page (left queue + right form + active trips) | L |
| B7 | Frontend: Control Tower v2 (unified data source, toggle, side KPIs) | M |
| B8 | E2E testing (`testing_agent_v3_fork`) + readiness report | M |
| B9 | Public-docs publish + mobile-agent handoff | S |

Total: **~10–14 working days** end-to-end; B1 + B2 are the critical path for unblocking everything else.

---

## 7. Open questions for the user

1. **Driver-vehicle default pairing (G6 + G7)** — in-scope for Phase B or punt to Phase C?
2. **Multi-tenant Control Tower** — should the toggle let super_admin see ALL tenants' fleet on one map, or always tenant-scoped?
3. **Driver self-onboarding** — keep the existing dispatcher-invite-only flow, or let candidates self-register and queue for approval?
4. **Compliance notifications** — email, in-app, or both? Use existing notifications collection or a new `fleet_alerts` queue?
5. **Frontend routing convention** — `/manufacturer/fleet/...` (tenant-prefixed) or `/fleet/...` (single shared workspace gated by JWT)?

Once these are settled I'll move into B1 → B2 (the audit-driven backend fixes) and start producing the Phase B build briefs.
