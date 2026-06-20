# TradeKonekt Logistics & Delivery — Validation Audit

**Audit date:** 2026-06-20  
**Auditor:** Main agent (read-only — no code was written for this audit)  
**Scope:** Backend (FastAPI), Web Platform (React), Mobile Platforms (build briefs / handoff documents)  
**Reference target:** *shipment-centric* lifecycle: Manufacturer → Warehouse → Distributor → Wholesaler, with **drivers, vehicles, routes, warehouses, and deliveries attached to shipments**.

> **Rule observed:** NO new functionality was built. This document only validates what exists today and itemises every gap.

---

## 0. Executive verdict

| Pillar | State today | Verdict |
|---|---|---|
| **Shipment** | First-class entity with persistence, listing, basic lifecycle, command-center aggregator, geofence/event audit trail. | **Partial — 4 of 8 target statuses present; lifecycle is collapsed and PO-driven, not standalone.** |
| **Driver** | Driver is a *denormalized string* on `vehicles` (`driver_name` + `driver_phone`). There is **no driver entity, no driver state machine, no driver login, no driver mobile flow**. | **Missing entirely.** |
| **Vehicle** | Vehicles exist as a Mongo collection populated by the control-tower simulator. They have rich tracking fields (position, speed, fuel, route polyline, ETA). There is **no public CRUD API and no admin UI to register / edit / decommission a vehicle**. | **Partial — read-only via control-tower; no registry-of-record; missing statuses.** |
| **Route** | Multi-stop route planner exists (`planned_routes` collection, Google Routes API integration, optimize-waypoints). | **Present but manufacturer-only.** |
| **Warehouse** | Modelled as an `organization` (`organization_type=warehouse`) under a manufacturer. | **Present.** |
| **Driver Mobile App** | Does not exist. No build brief, no UX plan, no functional spec. | **Missing entirely.** |

**Bottom line:** TradeKonekt today is a **PO-centric supply-chain platform** with a **simulated** control tower painted on top. To meet the target operating model you need a **driver entity, a vehicle registry, an authenticated driver session, a shipment-centric REST API independent of the procurement state machine, and a Driver mobile app.**

---

## 1. SHIPMENT — Validation

### 1.1 Entity & persistence

| Capability | State | Evidence |
|---|---|---|
| Shipment entity (Pydantic model) | ✅ Present | `/app/backend/models.py:92` — `class Shipment(BaseModel)` |
| Shipment Mongo collection | ✅ Present | `db.shipments` — 1,761 docs on the live preview pod for Unilever |
| Auto-generated shipment ID | ✅ Present | `id: str = Field(default_factory=new_id)` (`uuid4`) |
| Human-readable tracking code | ✅ Present | `tracking_code: SHP-<8-hex>` auto-generated; also `shipment_number` denormalised |
| Status field | ✅ Present | `status: ShipmentStatus = "pending"` |
| Lifecycle timestamps | 🟡 Partial | Only `dispatched_at` + `received_at` exist; no `loaded_at`, `arrived_at`, `assigned_at` on the canonical model (the simulator stamps these on `vehicles`, not on `shipments`) |
| From/To party (5-tier-aware) | ✅ Present | `from_role + from_id`, `to_role + to_id`, plus denormalised `manufacturer_id / distributor_id / retailer_id / organization_id` |
| Items (lines) | ✅ Present | `items: List[ShipmentLine]` with `product_id + quantity`. Simulator also stamps `unit_price/gross_value/discount/net_value` per line. |
| Notes / metadata | ✅ Present | `notes` plus `request_id` link to upstream stock-request |
| **Shipment status enum** | ❌ **Only 3 values** | `core.py:42` → `ShipmentStatus = Literal["pending", "in_transit", "received"]` |
| Status history audit trail | 🟡 Partial | NOT on shipment doc itself. Lives in `db.logistics_events` (separate collection) and is queryable via `GET /api/logistics/shipment-timeline/{shipment_id}`. Procurement POs have a richer `status_history` array, shipments do not. |

### 1.2 Fields (canonical Shipment doc — live sample)

```
id, manufacturer_id, from_role, from_id, to_role, to_id,
distributor_id, distributor_name, retailer_id, organization_id,
shipment_number, tracking_code,
status, items, total_units, origin_city, destination_city,
eta_minutes, generated_by,
created_at, dispatched_at, received_at, request_id,
notes, source                    (some docs only)
```

> The simulator also adds: `from_party`, `to_party`, `distributor`, `retailer` (joined objects, denormalised on read in `/api/shipments`).

### 1.3 Shipment APIs

| Verb + Endpoint | Status | Notes |
|---|---|---|
| `GET /api/shipments` | ✅ | filters by `distributor_id / retailer_id / manufacturer_id / party_role + party_id`; no pagination |
| `POST /api/shipments` | ✅ | creates with `status="pending"`, generates `tracking_code` |
| `PATCH /api/shipments/{id}/status` | 🟡 | only allows `pending → in_transit → received` |
| `GET /api/shipments/{id}` (detail) | ❌ **MISSING** | no single-record getter; clients must filter the list endpoint |
| `POST /api/shipments/{id}/assign` (driver / vehicle) | ❌ **MISSING** | |
| `POST /api/shipments/{id}/load` | ❌ **MISSING** | |
| `POST /api/shipments/{id}/arrive` | ❌ **MISSING** | |
| `POST /api/shipments/{id}/deliver` | ❌ **MISSING** | (delivery is `received`-via-`/status` PATCH only) |
| `POST /api/shipments/{id}/cancel` | ❌ **MISSING** | |
| `GET /api/manufacturer/{id}/shipment-command-center` | ✅ | aggregator (KPIs, ai_brief, pipeline, regional, distributor_performance, exceptions, shipments[]) |
| `GET /api/manufacturer/{id}/shipment-intelligence/{shipment_id}` | ✅ | per-shipment intelligence drill-down |
| `GET /api/logistics/shipment-timeline/{shipment_id}` | ✅ | event audit trail |

### 1.4 Web UI screens (shipment-centric)

| Page | Path | Role | Status | Mutations exposed |
|---|---|---|---|---|
| **Shipment Command Center** | `/shipment-command-center` | Manufacturer | ✅ | "New shipment" button is **UI-only — no working endpoint**. Export CSV works. |
| **Logistics Command Center** | `/logistics` | Manufacturer | ✅ | Read-only — events ack only |
| **Control Tower (map + feed + panels)** | `/logistics?tab=tower` | Manufacturer | ✅ | Ack events, bulk-ack, archive arrived vehicles |
| **Route Planning Center** | `/logistics?tab=route-planning` | Manufacturer | ✅ | Preview & Dispatch (Google Routes API) |
| **Logistics AI / Demand-Delivery / Predictions** | sub-tabs of `/logistics` | Manufacturer | ✅ | Recompute, dismiss, execute action |
| **Shipment Tracker (legacy)** | various | Manufacturer / Distributor / Wholesaler | ✅ | Read-only |
| Distributor `Procurement → Shipments` tab | `/procurement` | Distributor | ✅ | Read-only, derived from PO payload |
| Wholesaler `Logistics` tab | inside `/wholesaler` | Wholesaler | ✅ | Read-only |

### 1.5 Expected vs Actual statuses

| Target status (per audit ask) | Present in code? | Where? | Gap |
|---|---|---|---|
| **Created** | ❌ | — | Model defaults to `pending` (creation = pending). No semantic `created` distinct from `pending`. |
| **Ready For Dispatch** | ❌ | — | Procurement uses `approved / processing` but shipment model has no such state. |
| **Assigned** | ❌ | — | No "assigned" state on shipments. (Vehicles get an implicit ref_id, but the shipment status doesn't change.) |
| **Loaded** | 🟡 | `vehicles.status = "loaded"` (transient), `shipments` never reach this status. PO state machine has `processing`. | The state is **on the truck, not on the shipment**. |
| **In Transit** | ✅ | `ShipmentStatus="in_transit"` | OK |
| **Arrived** | 🟡 | `vehicles.status = "arrived"` (transient pre-delivery). Shipments do not have it. | Same gap as Loaded. |
| **Delivered** | 🟡 | Shipments use `received`. The word "delivered" lives only on `vehicles.status` and on the *procurement PO* state machine. | Naming mismatch — `received` is the shipment's terminal state today. |
| **Cancelled** | ❌ | — | No `cancelled` state on shipments. PO cancellation does NOT cascade to the shipment doc. |

### 1.6 Missing shipment statuses summary

`created` · `ready_for_dispatch` · `assigned` · `loaded` · `arrived` · `cancelled` — **6 of the 8 target statuses are missing from the canonical Shipment model.**

---

## 2. DRIVER — Validation

### 2.1 Driver entity

| Capability | State | Evidence |
|---|---|---|
| Driver Pydantic model | ❌ **Missing** | no `class Driver` anywhere in `/app/backend/models.py` |
| Driver Mongo collection | ❌ **Missing** | no `db.drivers` anywhere in `/app/backend/` |
| Driver-as-User account | ❌ **Missing** | `services/auth.py:244` — `VALID_ROLES = ["super_admin", "manufacturer", "distributor", "retailer"]` — **no `driver` role** |
| Driver-as-attribute-on-vehicle | 🟡 Present as 2 free-text fields | `vehicles.driver_name` + `vehicles.driver_phone` populated from a static `DRIVER_POOL` list in `control_tower_sim.py:DRIVER_POOL` |
| Driver assignment to shipment | ❌ **Missing** | No FK from shipment → driver; the simulator spawns a *vehicle* with a random driver name and links the vehicle to the shipment |

### 2.2 Driver APIs

| Endpoint | Status |
|---|---|
| `GET  /api/drivers` | ❌ 404 |
| `GET  /api/drivers/{driver_id}` | ❌ 404 |
| `POST /api/drivers` | ❌ 404 |
| `PATCH /api/drivers/{driver_id}` | ❌ 404 |
| `GET  /api/manufacturer/{id}/drivers` | ❌ 404 |
| `GET  /api/logistics/drivers` | ❌ 404 |
| `POST /api/auth/driver/login` | ❌ 404 |
| `GET  /api/driver/me` | ❌ 404 |
| `GET  /api/driver/shipments` | ❌ 404 |
| `POST /api/driver/shipments/{id}/accept` | ❌ 404 |
| `POST /api/driver/shipments/{id}/start-trip` | ❌ 404 |
| `POST /api/driver/shipments/{id}/proof-of-delivery` | ❌ 404 |
| `POST /api/driver/location` (GPS ping) | ❌ 404 |

### 2.3 Driver UI screens

| Screen | Web | Mobile | Status |
|---|---|---|---|
| Driver roster (admin) | — | — | ❌ Missing |
| Driver profile | — | — | ❌ Missing |
| Driver mobile login | — | — | ❌ Missing |
| Driver Today / My Shipments | — | — | ❌ Missing |
| Driver "Mark loaded / in transit / arrived / delivered" | — | — | ❌ Missing |
| Driver Proof-of-delivery capture (photo / sig) | — | — | ❌ Missing |
| Driver GPS check-in | — | — | ❌ Missing |
| Driver leave / unavailable toggle | — | — | ❌ Missing |

### 2.4 Expected vs Actual driver states

| Target state | Present? | Gap |
|---|---|---|
| **Available** | ❌ | no driver state machine exists |
| **Assigned** | ❌ | as above |
| **On Trip** | ❌ | as above |
| **Offline** | ❌ | as above |

> Today's "driver activity" is **fully simulated** by `control_tower_sim.py`. No real human user has ever logged in as a driver on this platform.

---

## 3. VEHICLE — Validation

### 3.1 Vehicle entity

| Capability | State | Evidence |
|---|---|---|
| Vehicle Pydantic model | ❌ **Missing** | no `class Vehicle` in `models.py` — the schema is implicit, defined inline in `control_tower_sim.py:154` |
| Vehicle Mongo collection | ✅ Present | `db.vehicles` — 100 docs on the live preview pod (all `status=archived` after the most recent simulator sweep) |
| Vehicle code generator | ✅ Present | `db.counters` `_id=vehicle_seq` → `TK-001`, `TK-002`, …  (`control_tower_sim.py:152`) |
| Vehicle plate | ✅ Present | random Nigerian-style plate, e.g. `ENU-276-KR` |
| Vehicle tied to manufacturer | ✅ Present | `vehicles.manufacturer_id` |
| Vehicle capacity | ❌ **Missing** | only `units` (current load) — no `capacity_units / capacity_kg / capacity_m³` field |
| Vehicle tracking fields | ✅ Present | `lat, lng, route_progress, speed_kmh, fuel_pct, eta_minutes, route_polyline, route_km` |
| Vehicle deviation/exception | ✅ Present | `deviation, stopped_since, breakdown_since, exception_ticks, fences_inside` |
| Vehicle ↔ shipment link | ✅ Present | `ref_type="shipment", ref_id=<shipment_id>` |
| Vehicle ↔ route link | ✅ Present | `ref_type="route", ref_id=<route_id>` with `stops[]` array |
| Vehicle lifecycle timestamps | ✅ Present | `created_at, updated_at, arrived_at, delivered_at, archived_at` |

### 3.2 Vehicle APIs

| Verb + Endpoint | Status | Notes |
|---|---|---|
| `GET /api/logistics/trucks?manufacturer_id={mid}` | ✅ | list endpoint — returns up to 100 |
| `GET /api/vehicles` | ❌ 404 | no top-level vehicle resource |
| `GET /api/vehicles/{id}` | ❌ 404 | no single-vehicle getter |
| `POST /api/vehicles` | ❌ 404 | **no way for an admin to register a new vehicle via API** |
| `PATCH /api/vehicles/{id}` | ❌ 404 | no edit |
| `DELETE /api/vehicles/{id}` | ❌ 404 | no decommission (archive happens via simulator only) |
| `POST /api/logistics/vehicles/archive` | ✅ | bulk archive arrived vehicles (>= cutoff_hours since arrival) |
| `GET  /api/logistics/vehicles/archived` | ✅ | list archived |
| `GET  /api/logistics/control-tower` | ✅ | embeds live `vehicles[]` for the map |
| `GET  /api/manufacturer/{id}/network-pulse` | ✅ | live event ticker |

### 3.3 Vehicle UI screens

| Screen | Status |
|---|---|
| **Control Tower Map** | ✅ Present — live vehicle markers, sheet on tap |
| **Vehicle Twin Sheet** (`VehicleTwinSheet.jsx`) | ✅ Present — read-only — speed/fuel/ETA/route polyline |
| Vehicle Registry / Admin | ❌ Missing — no "Add new vehicle" page anywhere |
| Vehicle Maintenance form | ❌ Missing |
| Driver-to-vehicle pairing | ❌ Missing |

### 3.4 Expected vs Actual vehicle statuses

| Target status | Present? | Where? | Gap |
|---|---|---|---|
| **Available** | ❌ | — | Today's pool uses `"idle"` instead. Semantic mismatch. |
| **Loading** | ❌ | — | Vehicles spawn directly into `in_transit`. Loading is implicit. |
| **In Transit** | ✅ | `vehicles.status="in_transit"` | OK |
| **Maintenance** | ❌ | — | Closest analogue is `"breakdown"` (incident) — there is no scheduled maintenance state. |
| **Offline** | ❌ | — | Closest analogue is `"archived"` (terminal). No transient offline. |

### 3.5 Other vehicle statuses currently in use (not in target spec)

`idle` · `arrived` · `stopped` · `breakdown` · `delivered` · `archived` · `cancelled` · `created` · `completed` · `loaded` · `received` · `pending`.

> The vehicle status enum is **untyped** — it lives in code as string literals scattered across `control_tower_sim.py`, `control_tower.py`, `logistics.py`. There is no enum, no migration story, and no UI affordance to set most of these states by hand.

---

## 4. Cross-cutting findings

### 4.1 Data-model coupling

- **The shipment lifecycle is collapsed.** Procurement POs carry the rich state machine (`draft → submitted → approved → processing → shipped → in_transit → delivered`) and a `shipment_id` is derived from the PO row, not the other way around. Shipments are essentially **fulfillment receipts** of POs in the current design.
- **Drivers + Vehicles are simulator artefacts**, not first-class business entities. They have no audit, no tenant isolation enforced at the API layer for write operations (because there are no writes), and no UI affordances.

### 4.2 Tenant isolation

- Shipment endpoints accept `manufacturer_id / distributor_id / retailer_id / party_role+party_id` filters but **do not enforce the caller's tenant** at the layer of `/api/shipments`. (The aggregator command-centre endpoints DO enforce via `_scope_manufacturer`.)
- Vehicle endpoints (`/api/logistics/trucks`) similarly accept `manufacturer_id` as a query param without re-scoping against the JWT.

### 4.3 Mobile-app gap

- We currently have build briefs for **Retailer · Wholesaler · Manufacturer · Distributor** mobile apps — none of which has a driver surface.
- There is **no Driver mobile app spec**, no UX plan, no functional inventory, no API validation matrix.

### 4.4 Simulator vs production

- All vehicles, drivers, geofence triggers, breakdowns, deviations, and ETAs come from `services/control_tower_sim.py` via `services/vehicle_motion.py`. Disable the simulator and the entire logistics surface goes dark.
- There is **no inbound channel** for real telematics (no `/api/telematics`, no `/api/driver/location`, no MQTT bridge, no provider integration like Cartrack / Geotab / Samsara).

### 4.5 Wholesaler is missing from the route planner

- `route_planning.py` enumerates destinations as `distributors + wholesalers` (line 285-301) — **good** — but pending shipments are pulled with `from_role=manufacturer` warehouses only. The target ask says **Manufacturer → Warehouse → Distributor → Wholesaler**; the planner today does **not** plan the Distributor → Wholesaler leg.

### 4.6 Inventory ledger integration

- Shipment status transitions DO move inventory (`adjust_inventory` is called on `pending → in_transit` and `in_transit → received` in `routes/shipments.py:91-101`). This is the **only** logistics endpoint that mutates ledger.
- Route Planner dispatch also moves stock (`_move_stock_out` in `route_planning.py:197-217`). 

### 4.7 Notifications

- Push to mobile devices: ❌ Missing (no FCM / APNs registration endpoints).
- In-app notifications: ✅ via `/api/notifications` — already supports `target_type=distributor|retailer|wholesaler|manufacturer`. Driver target type does not exist.

---

## 5. Gap Inventory (consolidated)

### 5.1 Backend gaps (44 missing endpoints / entities)

**Models:**
- ❌ `class Driver` Pydantic model + `db.drivers` collection
- ❌ `class Vehicle` Pydantic model (replace inline dict in simulator)
- ❌ Typed enum `ShipmentStatus` with all 8 target values
- ❌ Typed enum `VehicleStatus` with `available|loading|in_transit|maintenance|offline`
- ❌ Typed enum `DriverStatus` with `available|assigned|on_trip|offline`
- ❌ Shipment ↔ Driver FK (`shipment.driver_id`)
- ❌ Shipment `status_history[]` array (today only on POs)

**Auth:**
- ❌ Add `"driver"` to `VALID_ROLES`
- ❌ Driver invitation / claim flow
- ❌ Driver-scoped JWT permissions (cannot list other drivers' shipments)

**Shipment APIs (8 missing):**
- ❌ `GET    /api/shipments/{id}`
- ❌ `POST   /api/shipments/{id}/ready` (move to `ready_for_dispatch`)
- ❌ `POST   /api/shipments/{id}/assign` (driver_id, vehicle_id)
- ❌ `POST   /api/shipments/{id}/load`
- ❌ `POST   /api/shipments/{id}/start-trip` (move to `in_transit`)
- ❌ `POST   /api/shipments/{id}/arrive`
- ❌ `POST   /api/shipments/{id}/deliver` (with POD payload)
- ❌ `POST   /api/shipments/{id}/cancel` (with reason)

**Driver APIs (10 missing):**
- ❌ `GET    /api/drivers` (admin list)
- ❌ `POST   /api/drivers` (create)
- ❌ `GET    /api/drivers/{id}` (admin detail)
- ❌ `PATCH  /api/drivers/{id}`
- ❌ `POST   /api/drivers/{id}/deactivate`
- ❌ `POST   /api/auth/driver/login`
- ❌ `GET    /api/driver/me`
- ❌ `GET    /api/driver/shipments` (my assigned shipments)
- ❌ `POST   /api/driver/shipments/{id}/proof-of-delivery` (photo + signature + notes)
- ❌ `POST   /api/driver/location` (GPS ping)

**Vehicle APIs (6 missing):**
- ❌ `GET    /api/vehicles`
- ❌ `POST   /api/vehicles`
- ❌ `GET    /api/vehicles/{id}`
- ❌ `PATCH  /api/vehicles/{id}`
- ❌ `POST   /api/vehicles/{id}/set-maintenance`
- ❌ `POST   /api/vehicles/{id}/set-offline`

**Telematics (3 missing, P2):**
- ❌ `POST   /api/telematics/ping` (driver device or 3rd-party provider)
- ❌ `GET    /api/telematics/vehicles/{id}/trail`
- ❌ Webhook intake for a real provider (Cartrack / Samsara / etc.)

### 5.2 Web platform gaps

- ❌ **Fleet Registry page** (admin CRUD for vehicles)
- ❌ **Driver Roster page** (admin CRUD for drivers)
- ❌ **Driver↔Vehicle pairing screen**
- ❌ **"Assign driver to shipment" sheet** inside the Shipment Command Center "New shipment" flow (currently the button is a no-op)
- ❌ **Distributor logistics surface** — distributors today have no logistics tab; they see shipment status inside PO detail only. The target ask explicitly includes Distributor → Wholesaler as a route-planner leg.
- ❌ **Wholesaler "Receive shipment" page** — today's wholesaler view confirms receipt via PO actions, not via a logistics step.

### 5.3 Mobile platform gaps

| App | Build brief | UX Plan | Functional spec | API validation | Status |
|---|---|---|---|---|---|
| Retailer | ✅ | — | ✅ | — | Partial (legacy) |
| Wholesaler | ✅ | ✅ | ✅ | ✅ | **Complete** |
| Manufacturer | ✅ | ✅ | ✅ | ✅ | **Complete** |
| Distributor | ✅ | ✅ | ✅ | ✅ | **Complete (just shipped)** |
| **Driver** | ❌ | ❌ | ❌ | ❌ | **All four missing.** |

### 5.4 Workflow gaps

- ❌ End-to-end "create shipment → assign driver → load → dispatch → arrive → deliver" cannot be executed by a human user via the UI today; it can only be triggered by the simulator.
- ❌ POD (proof of delivery) capture: no photo, no signature, no GPS-stamped delivery event.
- ❌ Driver acceptance flow (driver receives an assignment, can accept / decline).
- ❌ Out-of-network deliveries (the catalogue of `to_id` is constrained to organisations under the manufacturer — no public couriers / 3PLs).

---

## 6. Recommendations (sequencing, not implementation)

> Do **not** start building yet. Pick a sequence first.

### Track A — Backend foundations (must precede any UI work)

1. Add `Driver` Pydantic model + `db.drivers` collection (3 days).
2. Extend `ShipmentStatus` enum to 8 values and add typed `VehicleStatus` + `DriverStatus` enums (1 day).
3. Add `driver_id` + `vehicle_id` FKs to `Shipment`, plus `status_history[]`. Run a backfill migration on existing 1,761 shipment docs (2 days).
4. Add the 8 shipment lifecycle endpoints + 10 driver endpoints + 6 vehicle endpoints listed in §5.1 (10-12 days).
5. Add `"driver"` to `VALID_ROLES` + driver invitation flow (2 days).
6. Add tenant-scoped guards to `/api/shipments` + `/api/logistics/trucks` (1 day).

### Track B — Web platform

7. **Fleet Registry** + **Driver Roster** admin pages under Manufacturer's "Network" tab (4 days).
8. Wire up the Shipment Command Center's "New shipment" button to a real form (driver + vehicle + items + destination) (3 days).
9. Add a **Distributor logistics tab** (route to wholesalers) (3 days).
10. Add a **Wholesaler "Receive shipment" action** (2 days).

### Track C — Driver mobile app (new app)

11. Run the same audit cycle we did for Distributor / Wholesaler / Manufacturer: produce 4 docs (functional spec, API validation, UX plan, build brief) — **only after** Track A endpoints exist. Otherwise the brief documents nothing.
12. Wire the docs into `/api/public-docs/` for the external mobile agent.

### Track D — Telematics (P2)

13. Decide on real provider (Cartrack / Samsara / Geotab) vs continued simulator.
14. Build inbound `/api/telematics/ping` + webhook intake.

---

## 7. Auditor's confidence

| Area | Confidence | How verified |
|---|---|---|
| Shipment model | High | Read source file + queried live preview pod (1,761 docs) |
| Vehicle model | High | Read simulator file + queried live preview pod (100 docs) |
| Driver | High | Source-grep for `class Driver`, `db.drivers`, `driver_id` returns zero meaningful hits |
| Auth roles | High | `VALID_ROLES` is a hard-coded literal |
| Web UI surface | High | Read all `Logistics*`, `Shipment*`, `ControlTower*` JSX files + grepped data-testid attributes |
| Mobile gaps | High | Inventoried our own `/app/docs/` and `/app/memory/` mobile-app folders |

---

## 8. Appendix — Live evidence from the preview pod

### 8.1 Shipment status distribution (Unilever tenant, last 2000)

```
received   1,465 (83%)
delivered    206 (12%)   ← naming inconsistency: shipments use "delivered" here from a backfill, but the enum says "received"
shipped       64  (4%)   ← never in the enum, but stamped by procurement
in_transit    26  (1%)
```

> ⚠️ Live data contains shipment statuses (`delivered`, `shipped`) that are **not** in the canonical enum — schema drift.

### 8.2 Vehicle status distribution (Unilever tenant, all 100)

```
archived    100 (100%)
```

> All vehicles are archived in this preview state because the simulator runs in bursts; live vehicles only exist during ticks.

### 8.3 Endpoint probe (verified 2026-06-20)

```
404  /api/drivers
404  /api/vehicles
404  /api/fleet
404  /api/manufacturer/{mid}/drivers
404  /api/manufacturer/{mid}/vehicles
404  /api/manufacturer/{mid}/fleet
404  /api/auth/driver/login
404  /api/driver/me
404  /api/driver/shipments
404  /api/logistics/drivers
404  /api/logistics/vehicles
200  /api/logistics/trucks?manufacturer_id={mid}
200  /api/logistics/route-planning?manufacturer_id={mid}
200  /api/logistics/control-tower?manufacturer_id={mid}
200  /api/logistics/events
200  /api/shipments?manufacturer_id={mid}
```

---

*End of audit. No code was modified by this report.*
