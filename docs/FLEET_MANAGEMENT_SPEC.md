# Fleet Management Spec — Track A3 + A4

**Design date:** 2026-06-20  
**Status:** DRAFT for sign-off (no code written)  
**Parent doc:** `LOGISTICS_FOUNDATION_DESIGN.md`  
**Scope:** Vehicle entity, fleet registry, dispatch assignment, reassignment.

---

## 0. Locked decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Vehicle ownership | Same as driver — **Manufacturer + Distributor + Wholesaler** can each own vehicles |
| 2 | Capacity model | Two-axis: `capacity_units` (count) + `capacity_weight_kg` (mass). UI surfaces whichever is more constraining for the route. |
| 3 | Telematics | Manual / dispatcher-driven for Track A. Real telematics integration (Cartrack, Samsara) deferred to P2. |
| 4 | Simulator | Simulator-spawned vehicles flagged `source="simulator"`; new typed status enum applied during the §7 migration. |

---

## 1. Vehicle entity

### 1.1 Pydantic model (new — `/app/backend/models.py`)

```python
VehicleStatus = Literal["available", "loading", "in_transit", "maintenance", "offline"]
VehicleType   = Literal["truck", "van", "pickup", "trailer", "motorcycle"]

class Vehicle(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # identity
    id:                  str = Field(default_factory=new_id)
    vehicle_code:        str                                # auto: TK-001, TK-002...
    registration_number: str                                # NG plate e.g. "LAG-203-XA"
    vehicle_type:        VehicleType = "truck"
    make:                Optional[str] = None
    model:               Optional[str] = None
    year:                Optional[int] = None
    colour:              Optional[str] = None

    # capacity
    capacity_units:       int                                # max items per trip
    capacity_weight_kg:   float                              # max payload mass

    # tenancy
    owner_org_id:        str                                 # tenant key
    owner_org_type:      Literal["manufacturer","distributor","wholesaler"]
    home_warehouse_id:   Optional[str] = None                # default depot

    # state
    status:              VehicleStatus = "available"
    current_driver_id:   Optional[str] = None                # 0..1 driver currently paired
    current_shipment_id: Optional[str] = None                # 0..1 shipment currently loaded/in_transit
    current_route_id:    Optional[str] = None

    # telemetry (manual entry in Track A, telematics in P2)
    odometer_km:         float = 0
    fuel_pct:            Optional[float] = None
    last_lat:            Optional[float] = None
    last_lng:            Optional[float] = None
    last_position_at:    Optional[str] = None
    last_service_at:     Optional[str] = None
    next_service_due_km: Optional[float] = None

    # docs & compliance
    insurance_expiry:    Optional[str] = None
    roadworthiness_expiry: Optional[str] = None

    # lifecycle
    is_active:           bool = True
    decommissioned_at:   Optional[str] = None
    source:              Literal["manual","simulator"] = "manual"
    created_at:          str = Field(default_factory=now_iso)
    updated_at:          str = Field(default_factory=now_iso)
    schema_version:      int = 1
```

### 1.2 Mongo collection

`db.vehicles` — already exists. Unique index on `(owner_org_id, registration_number)`, plus `(owner_org_id, status)` and `(current_driver_id)`.

### 1.3 Vehicle state machine

```
            ┌─────────┐
   create→  │available│  ←─── deliver / cancel / unassign / return-from-service
            └────┬────┘
                 │ assign-to-shipment
                 ▼
            ┌────────┐
            │loading │
            └────┬───┘
                 │ start-trip
                 ▼
            ┌──────────┐
            │in_transit│
            └─────┬────┘
                  │ delivered / cancelled
                  ▼
            available

      available ──set-maintenance──► maintenance ──complete-service──► available
      any non-trip ──set-offline──► offline ──set-online──► available
```

| From → To | Trigger |
|---|---|
| (none) → available | `POST /api/vehicles` |
| available → loading | shipment assigned to this vehicle |
| loading → in_transit | shipment start-trip |
| in_transit → available | shipment delivered or cancelled |
| available ↔ maintenance | manual via endpoint |
| any non-trip ↔ offline | manual via endpoint |

> Reassignment moves a vehicle from `loading` or `in_transit` back to `available` (with the new vehicle being assigned).

---

## 2. APIs — Fleet Registry (admin / dispatcher)

> Scope: only the vehicle's `owner_org_id` (and super_admin) can use these.

| Verb + Endpoint | Body | Notes |
|---|---|---|
| `GET    /api/vehicles?status=&owner_org_id=&driver_id=` | — | scoped to JWT tenant; super_admin can pass `owner_org_id` |
| `POST   /api/vehicles` | `{registration_number, vehicle_type, make?, model?, year?, capacity_units, capacity_weight_kg, home_warehouse_id?}` | auto-generates `vehicle_code` (`TK-NNN` counter) |
| `GET    /api/vehicles/{vehicle_id}` | — | full profile + assignment state |
| `PATCH  /api/vehicles/{vehicle_id}` | partial profile (NOT status) | |
| `POST   /api/vehicles/{vehicle_id}/set-maintenance` | `{notes?, eta_back?}` | status → `maintenance`; clears `current_driver_id` + `current_shipment_id` if any |
| `POST   /api/vehicles/{vehicle_id}/complete-service` | `{odometer_km?, notes?}` | status → `available`, sets `last_service_at` |
| `POST   /api/vehicles/{vehicle_id}/set-offline` | `{reason?}` | status → `offline` |
| `POST   /api/vehicles/{vehicle_id}/set-online` | — | status → `available` |
| `POST   /api/vehicles/{vehicle_id}/decommission` | `{reason}` | soft-delete; `is_active=false`; not assignable |
| `GET    /api/vehicles/{vehicle_id}/history?days=30` | — | trip history (last N delivered shipments) |
| `GET    /api/vehicles/{vehicle_id}/utilization?days=30` | — | KPIs: trips, units delivered, km, avg speed, downtime % |

---

## 3. APIs — Dispatch Assignment (A4)

These are the **Shipment-side** endpoints that already appear in `LOGISTICS_FOUNDATION_DESIGN.md` §4, but their effect on vehicles + drivers is captured here.

| Endpoint | Effect on Vehicle | Effect on Driver |
|---|---|---|
| `POST /api/shipments/{id}/assign` body `{driver_id, vehicle_id, route_id?}` | vehicle.status → `loading`; vehicle.current_driver_id = driver_id; vehicle.current_shipment_id = shipment_id | driver.status → `assigned`; driver.assigned_vehicle_id = vehicle_id; driver.assigned_shipment_id = shipment_id |
| `POST /api/shipments/{id}/load` | (no vehicle change) | (no driver change) |
| `POST /api/shipments/{id}/start-trip` | vehicle.status → `in_transit` | driver.status → `on_trip` |
| `POST /api/shipments/{id}/arrive` | (no vehicle change) | (no driver change) |
| `POST /api/shipments/{id}/deliver` | vehicle.status → `available`; clear current_driver_id, current_shipment_id | driver.status → `available`; clear assigned_* |
| `POST /api/shipments/{id}/cancel` | vehicle.status → `available`; clear current_driver_id, current_shipment_id | driver.status → `available`; clear assigned_* |
| `POST /api/shipments/{id}/reassign-driver` body `{driver_id, reason?}` | (no change on vehicle) | OLD driver → `available`; NEW driver → matches current shipment status |
| `POST /api/shipments/{id}/reassign-vehicle` body `{vehicle_id, reason?}` | OLD vehicle → `available`; NEW vehicle → matches current shipment status | (no change on driver) |

### 3.1 Reassignment validation

| Rule | Behaviour |
|---|---|
| Cannot reassign-vehicle if old vehicle is `in_transit` and new vehicle is not at the same location | warning toast — manual override required |
| Cannot reassign-driver if new driver `employer_org_id ≠ shipment.owner_org_id` | hard 403 |
| Cannot reassign-driver if new driver is `on_trip` on a different shipment | hard 409 |
| Cannot assign a `maintenance`/`offline`/`decommissioned` vehicle | hard 409 |
| Cannot assign a `maintenance`/`offline`/`decommissioned` driver | hard 409 |
| Cannot assign a vehicle whose `current_shipment_id` is already set | hard 409 unless `force=true` (super_admin override) |

---

## 4. Route definition (light-weight in Track A)

Track A introduces only the minimum route concept needed to record "this shipment travelled this path":

### 4.1 Route doc (re-uses existing `db.planned_routes`)

Already exists. Extended with:

```python
# planned_routes already has: id, manufacturer_id, origin_id, stops[], polyline, distance_km, duration_min...
# add (via migration):
owner_org_id:    str                                       # tenant key (was implicit via manufacturer_id)
owner_org_type:  Literal["manufacturer","distributor","wholesaler"]
route_name:      Optional[str] = None                       # human-readable
schema_version:  int = 1
```

### 4.2 Route APIs (existing)

- `GET    /api/logistics/route-planning?owner_org_id=` (re-scoped from manufacturer_id)
- `POST   /api/logistics/route-planning/preview`
- `POST   /api/logistics/route-planning/dispatch`
- `GET    /api/logistics/route-planning/routes/{route_id}`

Track A change: existing endpoints accept `owner_org_id` (preferred) and `manufacturer_id` (legacy compat) — they map to the same scope. Distributor + Wholesaler can now use these endpoints to plan their own routes.

> The existing route planner already plans multi-stop optimised routes. Track A does NOT redesign it — it only allows distributors and wholesalers to call it.

---

## 5. Validation rules

| Rule | Where |
|---|---|
| `registration_number` unique per `owner_org_id` | mongo unique index |
| `vehicle_code` globally unique (counter-driven) | counter in `db.counters._id="vehicle_seq"` |
| `capacity_units > 0` AND `capacity_weight_kg > 0` | pydantic validator |
| `capacity_units` cannot be reduced below `current_shipment.total_units` if vehicle is `loading|in_transit` | service check |
| Cannot decommission an `in_transit` vehicle | service check; 409 |
| Cannot delete (no DELETE endpoint exists — only decommission) | enforced by absence of route |

---

## 6. Web UI deliverables (Track A — minimal admin)

| Page | Path | Role | Sections |
|---|---|---|---|
| **Fleet Registry** | `/fleet` | manufacturer / distributor / wholesaler admin | KPI strip (total / available / in_transit / maintenance) · search · add-vehicle modal · row → vehicle detail |
| **Vehicle Detail** | `/fleet/:vehicle_id` | same | Profile · capacity · current assignment card · trip history · utilization KPIs · maintenance log · "Set maintenance / offline / decommission" buttons |
| **Add Vehicle** modal | `/fleet` → FAB | same | reg_number, type, capacity, home warehouse, optional docs |
| **Dispatch Sheet** (inside Shipment Command Center) | extends `/shipment-command-center` | manufacturer | The currently-broken "New shipment" button gets wired to a real form: items + destination + driver dropdown + vehicle dropdown |

Distributor and wholesaler get an equivalent fleet page at their own `/logistics/fleet` route.

### 6.1 Component re-use

- `KPIStrip` (existing) — re-used for the 4 fleet KPIs.
- `DataTable` (existing) — re-used for the vehicle list.
- `AddVehicleModal` (new) — small form component.
- `VehicleStatusChip` (new) — colour-coded badge.

---

## 7. Backfill migration impact

Already covered in `LOGISTICS_FOUNDATION_DESIGN.md` §7.1 for vehicles. Recap:

- All 100 existing simulator vehicles get `schema_version=2`, `source="simulator"`, `owner_org_id=<manufacturer_id>`, `owner_org_type="manufacturer"`, `capacity_units=1000`, `capacity_weight_kg=1500`, `vehicle_type="truck"`.
- Status mapping (legacy → new):
  - `idle` → `available`
  - `in_transit` / `stopped` / `breakdown` → `in_transit`
  - `arrived` / `delivered` / `archived` / `completed` / `cancelled` → `offline`
  - `loaded` → `loading`
  - other legacy values (`pending`, `received`, `created`) → `available` (best-effort)

The migration is **idempotent** — re-running it is a no-op once `schema_version=2`.

---

## 8. Acceptance checklist (this spec)

- [ ] §1.1 — Vehicle model fields & enums
- [ ] §1.3 — Vehicle state machine (5 states)
- [ ] §2 — 11 fleet-registry endpoints
- [ ] §3 — Dispatch assignment effects on driver + vehicle
- [ ] §4 — Route doc extension + multi-tenant route planner
- [ ] §5 — Validation rules
- [ ] §6 — Web UI deliverables (Fleet Registry + Dispatch Sheet)
- [ ] §7 — Migration mapping for legacy 100 simulator vehicles

---

*End of fleet spec.*
