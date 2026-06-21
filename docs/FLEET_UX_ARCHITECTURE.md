# Fleet UX Architecture Review

**Version**: 1.0 (DRAFT — pending Track A team approval)
**Date**: 2026-06-20
**Scope**: B4–B7 UI architecture (Driver Roster · Vehicle Roster · Dispatch Console · Command Centre v2)
**Prereqs**: ✅ Phase A (8-state lifecycle + OTP PoD), ✅ B1 (sim guard + schema), ✅ B2 (aggregation endpoints), ✅ B3 (KPI jobs + compliance service)
**Out of scope**: zero React, zero Figma, zero component work in this document

---

## 0. Executive summary

Phase B's backend is now **operationally complete** — the 8-state lifecycle, fleet registries, aggregation endpoints, KPI rollups and compliance service all exist and are wired together. What's missing is the **product surface** that lets a dispatcher use it.

This document locks the **information architecture and user journeys** before any UI begins. The headline decision is to introduce a **shared, tenant-scoped `/fleet/*` workspace** that replaces the three role-siloed logistics pages (currently `/manufacturer/logistics-center`, `/wholesaler/shipments`, etc.) with a single canonical surface that every dispatcher role lands on. Super_admin gets the same workspace plus a tenant switcher.

We also draw a hard line between **Dispatch Console** (B6 — outbound, planning, assignment, exceptions) and **Command Centre v2** (B7 — live observation, monitoring, alerting). They consume the same data but optimise for different jobs-to-be-done.

---

## 1. Fleet Navigation Architecture

### 1.1 Where Fleet lives in each workspace

The user's brief mandates **shared `/fleet/*` routing**. We honour that by treating `/fleet` as a top-level workspace gated by JWT role + tenant scope, not by a per-role URL prefix.

| Workspace / role | How Fleet is reached | Auth gate |
|---|---|---|
| **Manufacturer admin** | Sidebar entry **"Fleet"** (icon: Truck) — replaces today's "Logistics Center" link. | `role=manufacturer` + tenant = `manufacturer_id` |
| **Distributor admin** | Sidebar entry **"Fleet"** appears for any distributor that operates its own trucks (today: most major distributors). Auto-detect: show the entry iff `db.vehicles.count_documents({owner_org_id: <distributor_id>}) > 0` OR the distributor has the `fleet_enabled: true` flag (default `true`). | `role=distributor` |
| **Wholesaler admin** | Same auto-detect rule. Wholesalers without trucks see the legacy `/wholesaler/shipments` page only (read-only shipment list). | `role=wholesaler` |
| **Warehouse manager** (manufacturer's sub-role) | Reaches Fleet **inside** the existing Warehouse workspace under `/wms/fleet` (route alias of `/fleet?warehouse=<wh_id>`). Pre-filters every list/dashboard to that warehouse. | `role=manufacturer` + `entity_type=warehouse` (where applicable) |
| **Super admin** | Sidebar entry **"Fleet (Global)"**. Same workspace + a tenant switcher in the top bar that defaults to "All tenants" (cross-tenant read), and lets them pin into a specific tenant. | `role=super_admin` |
| **Driver** | No Fleet workspace. Drivers see their mobile app only. The `/fleet` URL returns a 403 banner with a "Switch account" CTA. | denied |
| **Retailer** | Denied. Same banner. | denied |

### 1.2 Why one workspace instead of three

- **One data model**: drivers + vehicles + shipments all live in the same Mongo collections with `owner_org_id` / `employer_org_id` for tenant separation. A shared UI keeps the experience consistent and avoids 3× component duplication.
- **One dispatcher mental model**: a distributor learning Fleet today should not have to re-learn it when they become a manufacturer's sub-tenant tomorrow.
- **One audit story**: super_admin can investigate any incident in any tenant from the same screens.

### 1.3 Shared vs tenant-specific screens

| Screen | Shared | Tenant-scoped behaviour |
|---|---|---|
| Driver Roster | ✅ Shared | List = scoped to caller's tenant; super_admin sees the tenant switcher. |
| Vehicle Roster | ✅ Shared | Same. |
| Dispatch Console | ✅ Shared | Same. **Plus** a warehouse filter when reached via `/wms/fleet`. |
| Command Centre v2 | ✅ Shared | Same. Super_admin can choose "All tenants" — markers are colour-tinted by tenant; legacy simulator markers are tagged. |
| Compliance Centre | ✅ Shared | Same. |
| Analytics | ✅ Shared | Same. |
| **Mobile Driver App** | Separate codebase | Driver-only. Not part of the `/fleet` workspace. |

### 1.4 Route map

```
/fleet                              → redirect to /fleet/dashboard
/fleet/dashboard                    → tenant cockpit (KPI tiles + compliance banner + top-5s)
/fleet/drivers                      → Driver Roster (list)
/fleet/drivers/:driverId            → Driver Detail drawer
/fleet/vehicles                     → Vehicle Roster (list)
/fleet/vehicles/:vehicleId          → Vehicle Detail drawer
/fleet/dispatch                     → Dispatch Console (planning + assignment)
/fleet/dispatch/:shipmentId         → Shipment drawer on top of console
/fleet/command-centre               → Command Centre v2 (live map + alerts)
/fleet/compliance                   → Compliance Centre (severity board)
/fleet/analytics                    → Fleet Analytics (KPI deep-dive)

# Aliases / embedded entries
/wms/fleet                          → /fleet?warehouse=<id>  (warehouse-scoped)
/manufacturer/logistics-center      → redirect to /fleet/dispatch (back-compat)
/wholesaler/shipments               → keep — read-only legacy list, deprecated banner pointing to /fleet
```

---

## 2. Fleet Information Architecture

```
Fleet (workspace)
├─ Dashboard           — tenant cockpit, KPI tiles, compliance banner
├─ Drivers             — registry
│  ├─ List
│  ├─ Detail
│  │  ├─ Overview
│  │  ├─ Assignments  (uses /api/drivers/{id}/assignment-history)
│  │  ├─ Performance  (uses /api/drivers/workload + driver KPI fields)
│  │  ├─ Compliance   (per-entity compliance blob)
│  │  └─ Activity     (location heartbeat + online/offline log)
│  └─ Create / Invite  (drawer)
├─ Vehicles            — registry
│  ├─ List
│  ├─ Detail
│  │  ├─ Overview
│  │  ├─ Assignments  (uses /api/vehicles/{id}/assignment-history)
│  │  ├─ Service log  (maintenance history)
│  │  ├─ Utilization  (existing /api/vehicles/{id}/utilization)
│  │  └─ Compliance
│  └─ Create / Decommission
├─ Dispatch            — planning + assignment console
│  ├─ Unassigned queue           (left pane)
│  ├─ Active trips               (lower pane)
│  ├─ Assignment form            (right pane)
│  └─ Shipment drawer            (deep link)
├─ Shipments           — read-only history list
│  ├─ List (filterable: status, driver, vehicle, date)
│  └─ Detail (timeline + audit + map snapshot)
├─ Compliance          — severity board
│  ├─ Driver licences
│  ├─ Vehicle insurance / roadworthiness / registration
│  └─ Transition audit (db.fleet_compliance_log)
├─ Command Centre      — live observation
│  ├─ Map
│  ├─ Active shipments stream
│  ├─ Fleet status panel
│  └─ Alert centre
└─ Analytics           — historical KPIs + trends
    ├─ Driver leaderboard
    ├─ Vehicle utilization
    ├─ On-time delivery
    └─ Compliance trend
```

### 2.1 Action ownership matrix

| Action | Screen that owns it | Why |
|---|---|---|
| Create driver | Drivers → Create | Registry concerns |
| Edit driver | Drivers → Detail | Registry concerns |
| Deactivate driver | Drivers → Detail (kebab menu) | Registry concerns |
| Pair default driver ↔ vehicle | Vehicles → Detail → Overview | Vehicle is the "owner" of the pairing field (`assigned_driver_id`) |
| Create vehicle | Vehicles → Create | Registry concerns |
| Set vehicle to maintenance | Vehicles → Detail | Operational, but rooted in registry |
| Assign a shipment | **Dispatch Console** | Dispatch is THE place for this |
| Reassign driver / vehicle | **Dispatch Console** → Active Trips row | Same surface, mid-trip |
| Generate delivery OTP | (currently) Shipment detail in **Dispatch Console** | Backend gate; dispatcher only |
| Cancel shipment | Shipment drawer (modal confirm) | Terminal |
| Acknowledge compliance alert | **Compliance Centre** (or notification inbox bell) | Single source for audit |
| Reroute / re-plan a stop | Command Centre → Shipment popover | Live operational decision |
| Force a driver offline | Drivers → Detail | Admin override |
| View live truck on map | **Command Centre** | Observation, not action |

> **The rule**: anything that **changes plan / state** lives in Dispatch. Anything that **observes / alerts / overrides in flight** lives in Command Centre. Anything that **owns master data** lives in the respective registry.

---

## 3. Driver Roster Architecture (B4)

### 3.1 List view (`/fleet/drivers`)

| Slot | Content |
|---|---|
| Header | "Drivers" title · CTA `+ Invite driver` · global filter chips · search by name/employee_number/phone |
| Filter rail (collapsible) | Status (multi), Active/Inactive toggle, Home warehouse, Compliance severity, Default vehicle assigned (yes/no), Last seen window |
| Table | Avatar+name · employee_number · Phone · Status badge · Current vehicle · Current shipment · `deliveries_30d` · `on_time_pct_30d` · Compliance badge · Last seen · ⋯ menu |
| Empty state | "No drivers in this tenant yet — invite your first driver." Inline `+ Invite driver` button. |
| Bulk actions | Select rows → bulk-deactivate (confirmation) · export CSV (tenant only) |
| Sort | default = busiest first (`active_shipments` desc, then `deliveries_30d` desc) |
| Pagination | 25 / 50 / 100 rows; offset-based |

Backend feed:
- `GET /api/drivers?employer_org_id=<tenant>&status=…&warehouse_id=…` (list)
- `GET /api/drivers/workload?employer_org_id=…&warehouse_id=…` (KPI overlay; joined client-side by `driver_id`)

### 3.2 Detail drawer (right-sheet, half-screen)

5 tabs: `Overview · Assignments · Performance · Compliance · Activity`.

#### 3.2.1 Overview
- Avatar, name, employee_number, status, phone, email
- Licence: number, class, expiry, severity badge
- Employer org + home warehouse
- Account: invited_at, claimed_at, last_login_at, user_id link
- Default vehicle: read-only card with link to vehicle detail (clearing happens from the vehicle side — see §4)
- Actions kebab: `Edit profile`, `Deactivate`, `Force offline`, `Resend invite`

#### 3.2.2 Assignments
- Table fed by `GET /api/drivers/{id}/assignment-history?limit=100`
- Columns: at, event_type (assign / reassign-in / reassign-out / load / in_transit / arrived / complete / cancel), shipment, vehicle, by_role, notes
- Empty state: "No assignments yet"

#### 3.2.3 Performance
- KPI tiles (sourced from persisted driver fields written by B3 `job_driver_kpis`):
  - `deliveries_30d`, `on_time_pct_30d`, `avg_pod_time_min`, `failed_delivery_count`, `active_trip_count`
- Sparkline: 30 day deliveries (computed from `shipment_status_history`)
- Last KPI recompute timestamp (`kpis_updated_at`)

#### 3.2.4 Compliance
- Block per check (driver_licence) with severity badge, days_remaining, expiry date
- "Update expiry" action → patches `licence_expiry` via `PATCH /api/drivers/{id}` (existing endpoint)
- Acknowledge button (writes to `db.fleet_compliance_log` with `acknowledged_at` — minor backend addition in B4 if approved)

#### 3.2.5 Activity
- Online/offline timeline (from notifications type=`driver_presence`, or computed from `last_login_at` / `last_seen_at`)
- Location heartbeat trail — last 50 points on a mini-map

### 3.3 Driver availability lifecycle (state machine)

```
            ┌────────────┐
            │  invited   │     (created via POST /api/drivers)
            └─────┬──────┘
                  │  claim invite (user sets password)
                  ▼
            ┌────────────┐
            │  available │ ◀────────────────────────┐
            └─────┬──────┘                          │
                  │  shipment.assigned (dispatcher) │
                  ▼                                 │
            ┌────────────┐                          │
            │  assigned  │ ── reject ──► available ─┘
            └─────┬──────┘
                  │  shipment.loaded
                  ▼
            ┌────────────┐
            │  on_trip   │  (during loaded/in_transit/arrived)
            └─────┬──────┘
                  │  shipment.delivered  / cancelled
                  ▼
            ┌────────────┐
            │  available │
            └────────────┘

  (orthogonal)  offline    — POST /api/driver/me/offline (driver) or
                              "Force offline" admin action (dispatcher)
  (orthogonal)  inactive   — POST /api/drivers/{id}/deactivate
```

Today's enum (`available · assigned · on_trip · offline`) is sufficient. Phase B does **not** introduce new driver statuses.

### 3.4 Default vehicle relationship

- Source of truth: `vehicles.assigned_driver_id`
- Driver Roster shows the default vehicle as a **read-only field** linking to the vehicle. The pairing is created/cleared from the **Vehicle** side because the vehicle owns the field. This avoids ambiguity ("which side wrote this?") and matches the API: `POST /api/vehicles/{id}/assign-default-driver`.
- A driver may be the default of **at most one** vehicle. Backend constraint: when assigning, the endpoint first clears any other vehicle whose `assigned_driver_id == driver_id`. (Small follow-up on B2 endpoint — flagged in §9 P1.)

---

## 4. Vehicle Roster Architecture (B5)

### 4.1 List view (`/fleet/vehicles`)

| Slot | Content |
|---|---|
| Header | "Vehicles" title · CTA `+ Add vehicle` · filter chips · search by vehicle_code / registration_number |
| Filters | Status, Type (truck/van/pickup/trailer/motorcycle), Owner org (super_admin only), Home warehouse, Compliance severity, Default driver assigned (yes/no), Service due ≤ 14 days |
| Table | Icon · vehicle_code · registration_number · Make+Model · Capacity (units + kg) · Status badge · Current driver · Current shipment · Insurance expiry severity · `trips_30d` · `utilization_pct` · ⋯ menu |
| Sort default | busiest first (`trips_30d` desc, then `utilization_pct` desc) |
| Bulk actions | bulk-set maintenance, bulk-set offline, export CSV |

### 4.2 Detail drawer

5 tabs: `Overview · Assignments · Service log · Utilization · Compliance`.

#### 4.2.1 Overview
- Identifiers, capacity, owner org, home warehouse, odometer, fuel %
- Last known position (read-only mini-map)
- **Default driver pairing widget**:
  - If unset → driver picker (`assigned_driver_id` write) limited to drivers of the same `owner_org_id`
  - If set → driver name + Clear button
- Actions kebab: `Edit`, `Set maintenance`, `Set offline`, `Decommission`

#### 4.2.2 Assignments
- Fed by `GET /api/vehicles/{id}/assignment-history?limit=100`
- Same columns as driver assignment, but driver-keyed

#### 4.2.3 Service log
- Filtered slice of `GET /api/vehicles/{id}/history?event=service`
- Form to log a new service: km, type, cost, notes — backed by existing `POST /vehicles/{id}/complete-service`

#### 4.2.4 Utilization
- KPI tiles from persisted vehicle fields (B3 `job_vehicle_kpis`): `trips_30d`, `utilization_pct`, `idle_pct`, `distance_km_30d`, `on_time_delivery_pct`
- 30-day trip sparkline (from shipments)
- Existing `/api/vehicles/{id}/utilization` enriches this with full historical aggregates

#### 4.2.5 Compliance
- Block per check (insurance, roadworthiness, registration) with severity badge, days_remaining, expiry date, "Update expiry" action

### 4.3 Vehicle status lifecycle (state machine)

```
            ┌────────────┐
            │  available │ ◀──────────────────────┐
            └─────┬──────┘                        │
                  │ shipment.assigned             │
                  ▼                               │
            ┌────────────┐                        │
            │  loading   │ ── unassign ──►        │
            └─────┬──────┘                        │
                  │ shipment.loaded               │
                  ▼                               │
            ┌────────────┐                        │
            │ in_transit │ ── shipment.delivered ─┘
            └─────┬──────┘
                  │ admin: Set maintenance / Set offline
                  ▼
            ┌────────────┐     complete-service
            │maintenance │ ──────────────────────► available
            └────────────┘
            ┌────────────┐     set-online
            │  offline   │ ──────────────────────► available
            └────────────┘

  (terminal)  decommissioned  — soft-deleted, is_active=false
```

### 4.4 Default driver relationship — write path

```
POST /api/vehicles/{id}/assign-default-driver  {driver_id}
  → server clears any other vehicle pairing for this driver (uniqueness)
  → server validates same-tenant + active on both sides
  → writes vehicles.assigned_driver_id
  → audit row in db.fleet_compliance_log? NO — different concept; goes to a
    new dedicated db.fleet_pairing_log collection (small B4 addition)
```

---

## 5. Dispatch Console Architecture (B6)

This is the operator's home base. Everything that **changes plan or state** happens here.

### 5.1 Layout

```
+──────────────────────────────────────────────────────────────────+
│ HEADER  Dispatch Console      ▾ tenant   ▾ warehouse   🔔 alerts │
+──────────────────────────────────────────────────────────────────+
│  LEFT (320 px)        │  CENTER (flex)         │  RIGHT (380 px) │
│  ━━━━━━━━━━━━━━━━━    │  ━━━━━━━━━━━━━━━━━     │  ━━━━━━━━━━━━━━ │
│  Unassigned queue     │  Active trips          │  Assignment     │
│  ┌─────────────────┐  │  ┌──────────────────┐  │  form           │
│  │ Shipment card   │  │  │ Trip row         │  │                 │
│  │ Shipment card   │  │  │ Trip row         │  │  ───────────    │
│  │ ...             │  │  │ ...              │  │  Driver picker  │
│  └─────────────────┘  │  └──────────────────┘  │  Vehicle picker │
│                       │                        │  Route (opt)    │
│  Drivers available    │                        │  Notes          │
│  ┌─────────────────┐  │                        │  ─────────────  │
│  │ Driver chip     │  │                        │  [ Assign ]     │
│  │ Driver chip     │  │                        │                 │
│  └─────────────────┘  │                        │                 │
│                       │                        │                 │
│  Vehicles available   │                        │                 │
│  ┌─────────────────┐  │                        │                 │
│  │ Vehicle chip    │  │                        │                 │
│  └─────────────────┘  │                        │                 │
+──────────────────────────────────────────────────────────────────+
```

- **Left rail** is a single scroll surface with 3 stacked panels: Unassigned queue → Drivers available → Vehicles available.
- **Centre** is the focus area — Active trips list (with reassign / cancel / drawer actions).
- **Right rail** is the assignment form. Empty state shows "Select a shipment from the left to begin".

### 5.2 Unassigned shipments queue

- Feed: `GET /api/shipments?status=ready_for_dispatch&owner_org_id=<tenant>`
- Card shows: destination short-name, total_units, weight, ETA window (if set), age in queue
- Click selects → right-rail form pre-fills `shipment_id`
- Empty state: "No shipments awaiting dispatch"

### 5.3 Driver availability panel

- Feed: `GET /api/drivers?employer_org_id=<tenant>&status=available`
- Each chip shows: avatar, name, employee_number, current vehicle (if any default), distance from origin (if pickup geocode known)
- Click in form mode → fills the driver picker
- Real-time refresh: every 30 s, or after any Assignment Console mutation

### 5.4 Vehicle availability panel

- Feed: `GET /api/vehicles?owner_org_id=<tenant>&status=available`
- Each chip: vehicle_code, capacity (units), default driver name (if any)
- Capacity validation: if `shipment.total_units > vehicle.capacity_units`, chip is greyed and shows a "Too small" tooltip
- Click → fills the vehicle picker

### 5.5 Assignment workflow

```
Dispatcher                Frontend                Backend
   │                          │                       │
   │ 1. Click shipment card   │                       │
   ├──────────────────────────►                       │
   │                          │ 2. Auto-fetch driver/ │
   │                          │    vehicle eligibility│
   │                          ├──────────────────────►│
   │                          │ ◄─────────────────────┤  GET /api/shipments/{id}
   │                          │                       │  GET /api/drivers (status=available)
   │                          │                       │  GET /api/vehicles (status=available, owner_org_id=...)
   │ 3. Pick driver           │                       │
   │ 4. Pick vehicle          │                       │
   │    (capacity validated   │                       │
   │     client-side)         │                       │
   │ 5. Click Assign          │                       │
   ├──────────────────────────►                       │
   │                          │ 6. POST /api/         │
   │                          │   shipments/{id}/     │
   │                          │   assign              │
   │                          ├──────────────────────►│
   │                          │                       │  - guard: shipment.status=ready_for_dispatch
   │                          │                       │  - guard: driver.status=available + same tenant
   │                          │                       │  - guard: vehicle.status=available + same tenant + capacity OK
   │                          │                       │  - writes shipment.driver_id, vehicle_id
   │                          │                       │  - writes shipment.status=assigned
   │                          │                       │  - writes driver.status=assigned, assigned_shipment_id
   │                          │                       │  - writes vehicle.status=loading, current_driver_id, current_shipment_id
   │                          │                       │  - inserts shipment_status_history row
   │                          │                       │  - emits in-app notification to driver
   │                          │ ◄─────────────────────┤
   │                          │ 7. Optimistic UI:     │
   │                          │    move card from     │
   │                          │    Unassigned to      │
   │                          │    Active trips       │
   │ 8. Toast "Dispatched"    │                       │
   │ ◄────────────────────────┤                       │
```

**Conflict handling**: any 409 from the backend (driver no longer available, vehicle taken, capacity changed) triggers a re-fetch of both panels and a toast "Driver/vehicle just became unavailable — refresh".

### 5.6 Reassignment workflow

Same diagram but two backend endpoints:

- `POST /api/shipments/{id}/reassign-driver  {new_driver_id, reason}`
- `POST /api/shipments/{id}/reassign-vehicle {new_vehicle_id, reason}`

Allowed from shipment statuses: `assigned | loaded | in_transit | arrived`.

UX:
- From the Active Trips row, kebab → `Reassign driver` / `Reassign vehicle`
- A confirmation drawer opens with the new picker + a **mandatory** "Reason" textarea (3-line min, audit-logged)
- Backend writes:
  - status_history row with `notes: "Reassigned driver: <reason>"`
  - old driver/vehicle → `status=available`, cleared assignment refs
  - new driver/vehicle → `status=assigned`/`loading`/`in_transit`, with appropriate refs
- Both drivers receive in-app notifications: "You have been removed from shipment X" / "You have been assigned shipment X"

### 5.7 Exception handling workflow

Five exception scenarios. All raise from outside Dispatch (sensor, simulator, driver action) and surface as **alert cards** at the top of the centre pane:

| Exception | Trigger | Dispatcher action |
|---|---|---|
| Driver unavailable | Driver `POST /api/driver/me/offline` while on a trip OR misses 3 location heartbeats in 5 min | Click alert → opens Reassign-driver drawer pre-filled. |
| Vehicle breakdown | Driver hits "Report breakdown" in mobile app (new endpoint, B6 scope) OR simulator emits breakdown event | Same as above but Reassign-vehicle. |
| Failed delivery (refused) | Driver hits "Mark refused" + reason (new endpoint, B6 scope). Shipment → `cancelled` with `cancellation_reason="refused"` | Alert card with options: `Re-attempt` (new shipment from the existing items) / `Return to origin` (creates a return shipment) / `Close out`. |
| Late delivery | `now > eta + 30 min` and status != `delivered` | Alert card with options: `Notify receiver` (writes notification to receiver), `Update ETA` (PATCH eta), `Reassign vehicle`. |
| Compliance breach | Driver attempts `POST /shipments/{id}/start-trip` but driver/vehicle compliance_severity = `expired` | Backend returns 409 with `code: COMPLIANCE_BLOCK`. Frontend banner with "Update expiry" deep-link to the compliance tab. |

(2 of the 5 exceptions require new mobile endpoints — out of B4-B7 scope but documented here.)

### 5.8 Sequence diagram — Reassignment under exception

```
Driver (mobile)        Dispatcher (web)        Backend
   │                          │                       │
   │ Reports breakdown        │                       │
   ├──────────────────────────────────────────────────►  POST /api/driver/me/breakdown (B-future)
   │                          │                       │   - writes vehicle.status=maintenance
   │                          │                       │   - shipment stays in_transit
   │                          │                       │   - fan-out notification + event
   │                          │ ◄─────────────────────┤
   │                          │ Alert card appears    │
   │                          │ in centre pane        │
   │                          │ Click "Reassign vehicle"
   │                          ├──────────────────────►│
   │                          │                       │  shows available vehicles for same tenant + capacity
   │                          │ Pick + reason         │
   │                          ├──────────────────────►│  POST /api/shipments/{id}/reassign-vehicle
   │                          │                       │   - vehicle swap, history row, notifications
   │                          │ ◄─────────────────────┤
   │ "New vehicle assigned"   │                       │
   │ ◄────────────────────────────────────────────────┤
```

---

## 6. Command Centre v2 Architecture (B7)

This is the **observation room**. No master-data CRUD, no shipment creation, no driver invites.

### 6.1 Layout

```
+──────────────────────────────────────────────────────────────────+
│ HEADER   Command Centre   ▾ tenant   ▾ source   🔔 alerts  ⏯ play│
+──────────────────────────────────────────────────────────────────+
│  LEFT (340 px)              │  MAP (flex)                       │
│  ━━━━━━━━━━━━━━━━━━━━━      │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │
│  Active shipments stream    │   ╔═════════════════════════════╗ │
│  (real-time list)           │   ║                             ║ │
│  ┌─────────────────────┐    │   ║       Live map              ║ │
│  │ Shipment row        │    │   ║   (Track A markers +        ║ │
│  │ Shipment row        │    │   ║    legacy simulator         ║ │
│  └─────────────────────┘    │   ║    markers, source-toggled) ║ │
│                             │   ║                             ║ │
│  Fleet status panel         │   ╚═════════════════════════════╝ │
│  ┌─────────────────────┐    │                                   │
│  │ Drivers by status   │    │  RIGHT (320 px)                  │
│  │ Vehicles by status  │    │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│  └─────────────────────┘    │  Alert centre                    │
│                             │  ┌────────────────────────────┐  │
│  Compliance banner          │  │ Compliance: 2 critical, …  │  │
│  ┌─────────────────────┐    │  │ Driver overdue PoD: 1      │  │
│  │ 2 critical, 1 expired│    │  │ Geofence breach: TK-005    │  │
│  └─────────────────────┘    │  └────────────────────────────┘  │
+──────────────────────────────────────────────────────────────────+
```

### 6.2 Live map (Track A-aware)

- Marker source: `GET /api/logistics/control-tower` rewritten to query `db.vehicles` with the Phase B v2 schema — `owner_org_id` filter (not `manufacturer_id`). Both sources unioned: `source ∈ {manual, seed, simulator}`. UI toggle in the header lets the user filter to `Track A only` / `Simulator only` / `All`.
- Marker colour:
  - **By tenant** when super_admin is in "All tenants" mode (12-tenant colour palette, legend in the bottom-left)
  - **By status** otherwise (green=available, blue=in_transit, orange=loading, red=breakdown/late)
- Marker popover: driver name + phone, vehicle code, shipment destination + ETA, `last_position_at` age badge
- Driver presence dot: green/blue/grey per `DriverStatus`

### 6.3 Shipment monitoring

- Left pane "Active shipments stream" — `GET /api/shipments?status=assigned|loaded|in_transit|arrived&owner_org_id=…` polled every 15 s
- Each row: destination, status badge, ETA delta (early/on-time/late), driver, vehicle
- Click row → centre map auto-pans + side popover with full timeline + audit history

### 6.4 Fleet monitoring panel

- Counters from `GET /api/fleet/overview`:
  - Drivers by status (`available`, `assigned`, `on_trip`, `offline`)
  - Vehicles by status (`available`, `loading`, `in_transit`, `maintenance`, `offline`)
- Refreshed every 30 s
- Click any number → opens a filtered list in a side drawer (read-only — go to Roster for actions)

### 6.5 Compliance monitoring

- Banner top-left, sourced from `fleet/overview.compliance` (the unified 4-bucket object built in B3)
- Click banner → opens **Compliance Centre** in a side drawer (severity board)
- Real-time: the in-app notification stream (type=`fleet_compliance`) is also surfaced in the alert centre

### 6.6 Alert management

- Right rail "Alert centre" — `GET /api/notifications?type=fleet_compliance,logistics_event` filtered to live (`read=false`)
- Each card: title, severity, body, entity link, age, "Acknowledge" button (PATCH `/api/notifications/{id}/read`)
- Bulk "Mark all read"
- Filter chips: All / Compliance / Geofence / Late / Breakdown

### 6.7 Multi-tenant visibility rules

| Caller | Default scope | Override |
|---|---|---|
| Manufacturer admin | Own tenant only | Cannot change |
| Distributor admin | Own tenant only | Cannot change |
| Wholesaler admin | Own tenant only | Cannot change |
| Super admin | All tenants (global) | Tenant switcher in header — pin to one |
| Warehouse manager | Own tenant, pre-filtered to `home_warehouse_id` | Can clear the warehouse filter (still tenant-scoped) |

### 6.8 Dispatch Console vs Command Centre — the line

| Concern | Dispatch | Command Centre |
|---|---|---|
| Create shipment | ✅ via `/api/_admin/seed-track-a-shipment` (test) or PO flow (prod) | ❌ |
| Assign driver/vehicle | ✅ | ❌ |
| Reassign mid-trip | ✅ | ❌ |
| Cancel shipment | ✅ | ❌ |
| View live map | ❌ (mini-preview only) | ✅ |
| Stream live events | ❌ | ✅ |
| Acknowledge alert | ✅ if related to a trip in your queue | ✅ (canonical) |
| Set vehicle maintenance | ❌ (use Vehicle Roster) | ❌ |
| Edit driver expiry | ❌ (use Driver Roster) | ❌ |
| Override geofence | ❌ | ✅ (B7 stretch) |

**One-liner**: Dispatch is **forward-looking** ("what should happen next?"). Command Centre is **now-looking** ("what is happening right now?"). They share the same data but never duplicate the same action.

---

## 7. User Journeys

### 7.1 Happy path — Full 8-state delivery

```
[Manufacturer admin]
  /fleet/dispatch
  └─ Click "Create shipment" (or POST flow from upstream)
       → backend creates shipment with status=ready_for_dispatch
  └─ Shipment appears in Unassigned queue
  └─ Click card → pick driver + vehicle in right rail → click Assign
       → POST /api/shipments/{id}/assign
       → shipment.status=assigned, driver.status=assigned, vehicle.status=loading
       → driver receives in-app notification

[Driver — mobile app]
  └─ Sees "New assignment" notification → opens shipment card
  └─ Tap "Accept" → POST /api/driver/shipments/{id}/accept
       → shipment stays "assigned" with accepted_at stamped
  └─ At warehouse — tap "Load" → POST /api/shipments/{id}/load
       → shipment.status=loaded, vehicle.status=loaded
  └─ Tap "Start trip" → POST /api/shipments/{id}/start-trip
       → shipment.status=in_transit, vehicle.status=in_transit
       → driver app starts heartbeat every 15s
  └─ Tap "Arrive" → POST /api/shipments/{id}/arrive
       → shipment.status=arrived

[Manufacturer admin OR distributor receiver]
  └─ /fleet/dispatch shows arrived row in Active Trips
  └─ Dispatcher clicks "Generate delivery code"
       → POST /api/shipments/{id}/generate-delivery-code
       → 4-digit OTP written to receiver's in-app inbox

[Driver]
  └─ Asks receiver for OTP → types into "Deliver" screen
  └─ POST /api/shipments/{id}/deliver  {delivery_code: "1234"}
       → backend verifies bcrypt hash
       → shipment.status=delivered
       → driver.status=available, vehicle.status=available
       → KPI fields update at next 15-min rollup
```

### 7.2 Exception — Driver unavailable mid-trip

```
[Driver]
  └─ /api/driver/me/offline (or 3 missed heartbeats → backend auto-flips)
       → driver.status=offline (was on_trip)
       → shipment stays in_transit (vehicle still has cargo)
       → alert event emitted to dispatcher channel

[Dispatcher in Command Centre]
  └─ Alert card "Driver Adaeze offline — TK-W0-V001 mid-trip"
  └─ Click → opens Dispatch Console with shipment pre-selected
  └─ Click "Reassign driver"
       → drawer with available drivers (same tenant) + mandatory reason
       → POST /api/shipments/{id}/reassign-driver  {new_driver_id, reason}
       → old driver removed from shipment; new driver assigned + notified
```

### 7.3 Exception — Vehicle breakdown

```
[Driver]
  └─ "Report breakdown" in mobile app (NEW endpoint, B6 scope)
       → vehicle.status=maintenance
       → shipment stays in_transit
       → alert fanout

[Dispatcher]
  └─ Alert card "Vehicle TK-W0-V001 broken down — Adaeze still on shipment X"
  └─ Click → Reassign vehicle drawer (same flow as §7.2 but vehicle-side)
  └─ Cargo transfer is manual / out-of-system (logged in notes)
```

### 7.4 Exception — Failed delivery (refused)

```
[Driver at receiver]
  └─ Receiver refuses goods → driver taps "Cannot deliver" + reason
       → POST /api/shipments/{id}/cancel  {reason: "refused"}
       → shipment.status=cancelled
       → driver + vehicle freed

[Dispatcher]
  └─ Alert "Shipment X refused — choose disposition"
  └─ Three actions:
     a) Re-attempt later  (creates a new ready_for_dispatch shipment from same items)
     b) Return to origin  (creates a reverse-direction shipment)
     c) Close out         (no further action — items written off / GR logged)
```

### 7.5 Exception — Reassignment with reason

(Covered above in §5.6 + §7.2/§7.3 — combined sequence.)

---

## 8. Mobile Integration

### 8.1 Driver App ↔ Dispatch Console

| Driver action | Dispatch Console effect |
|---|---|
| Login | Appears in Drivers panel of Dispatch (status=available) |
| Accept assignment | Active Trip row colour shifts from grey to blue |
| Reject assignment | Shipment returns to Unassigned queue; driver returns to available |
| Load | Status badge updates real-time |
| Start trip | Active Trip row gets pulsing dot |
| Arrive | Dispatcher gets a "Generate code" CTA on the row |
| Heartbeat | Map marker on Command Centre updates position |

### 8.2 Driver App ↔ Fleet Registry

| Driver action | Registry effect |
|---|---|
| Update profile (PATCH /api/driver/me) | Driver Roster shows new phone/licence |
| Update expiry from in-app reminder | Compliance check re-runs on next daily pass |
| Force offline by dispatcher | Driver app shows "Forced offline by dispatcher" banner; cannot re-online without a new claim |

### 8.3 Driver App ↔ Command Centre

| Driver action | Command Centre effect |
|---|---|
| Heartbeat / location | Marker moves on map; trail line extends |
| Go offline | Marker greys; presence dot grey |
| Report breakdown | Alert card appears in right rail; vehicle marker red |
| Mark delivered | Shipment row drops from Active stream; final dot drawn on map |

### 8.4 Webhook / push channel

No third-party push provider yet. The mobile app uses:
- 15 s polling of `GET /api/driver/shipments` for new assignments (when foreground)
- Server-sent events (SSE) at `GET /api/notifications/stream` — **deferred** to Phase C (currently 30 s polling)

---

## 9. Future Roadmap

### 9.1 P1 (after B7)

- **Email compliance alerts** — Resend integration (P0 was in-app only per Track A team direction). When `severity ∈ {critical, expired}`, email the dispatcher mailing list in addition to in-app fanout.
- **Driver scorecards** — quarterly performance review per driver with leaderboard view inside Fleet Analytics.
- **Fleet Analytics** — historical KPI trends (12-month rolling), tenant-wide on-time pct, utilization by vehicle type, compliance heat map.
- **Default-pairing uniqueness enforcement** — currently the backend lets two vehicles share an `assigned_driver_id`; harden the endpoint to clear any other vehicle's pairing first.
- **Notification "Acknowledge" with audit** — add `acknowledged_at` + `acknowledged_by` to `db.fleet_compliance_log` so the compliance tab shows who responded.

### 9.2 P2

- **Telematics integration** — pluggable adapter for GPS / OBD-II / fuel sensor providers. Spec'd as a new `services/telematics_adapter.py` interface that fans events into the same `db.logistics_events` stream.
- **GPS provider switchboard** — currently the map uses Google Maps JS; allow per-tenant choice of Mapbox / Here / OpenStreetMap.
- **Route optimisation** — `services/route_optimizer.py` already exists. Surface it as a "Suggest route" button in the Dispatch Console assignment form (multi-stop optimisation).
- **Server-sent events (SSE)** for driver app and Command Centre — replaces polling.
- **Workforce scheduling** — driver shift planning, overtime tracking, leave calendar.

### 9.3 P3 (long horizon)

- **Crew assignments** — multi-driver / co-driver shipments (regulation requires it for long-haul).
- **Trailer registry** — split tractor / trailer into separate entities.
- **Fuel logbook + cost analytics** — integrate fuel cards.
- **Driver-rating loop** — receiver rates the driver after delivery (1–5 stars + comments).

---

## 10. Architectural recommendations (decisions for Track A team)

| # | Decision | My recommendation |
|---|---|---|
| 1 | Should `/fleet` replace `/manufacturer/logistics-center` outright? | **Yes**, with a 30-day grace redirect. The siloed page duplicates effort and confuses dispatchers wearing multiple-tenant hats. |
| 2 | Should super_admin see all tenants on one map by default? | **Yes**, with a tenant switcher. Markers colour-tinted by tenant. Avoids context-switch friction during incident response. |
| 3 | Should the Compliance Centre be its own top-level page or a tab on Dashboard? | **Top-level page** (`/fleet/compliance`). It has audit, transition history, and update workflows that don't fit a single tile. |
| 4 | Default-driver pairing — single-vehicle constraint or many-to-many? | **Single-vehicle constraint** (one driver = at most one default vehicle). Mirrors physical reality. Backend hardening is a 10-line addition. |
| 5 | Distributor admin who has no trucks — show Fleet menu? | **No, auto-hide**. Reduces clutter; flips on automatically when they add their first vehicle. |
| 6 | Should "Generate delivery code" stay dispatcher-only? | **Yes, until driver-mobile UX is rewritten**. The spec-mismatch we surfaced last week is a UX decision, not a security one — keep current behaviour, document it explicitly in the Driver Mobile docs. |
| 7 | Should reassign require a free-text reason? | **Yes, mandatory ≥10 chars**. Cheap audit win; legal/SLA disputes require it. |
| 8 | Is the legacy simulator going away? | **No**, but it's clearly tagged. Phase C may move it to its own collection `vehicles_simulator` to fully decouple. |

If you approve §10 row-by-row (or just say "all approved"), I'll move into B4 with this architecture as the source of truth.

---

## 11. Stop gate

This document is the **single source of truth** for B4–B7 UX. Nothing in the next phases should contradict it without a written amendment to this file.

Reply **"approve architecture"** + any deltas on §10 → I start B4 (Driver Roster). Or reply with edits and we iterate this document first.
