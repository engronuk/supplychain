# Logistics Foundation Design — Track A

**Design date:** 2026-06-20  
**Status:** DRAFT for sign-off (no code written)  
**Inputs:** `LOGISTICS_VALIDATION_AUDIT.md` + locked decisions (see §0)  
**Scope:** Shipment lifecycle redesign + audit trail + tenant security. Driver/Vehicle/OTP/Dispatch covered in companion specs.

---

## 0. Locked design decisions (from the user)

| # | Topic | Decision |
|---|---|---|
| 1 | Driver tenancy | **Manufacturer + Distributor + Wholesaler can each employ drivers** |
| 2 | OTP delivery channel | **In-app notification only** (SMS deferred to P2) |
| 3 | Existing data | **Backfill migration** — every existing shipment/vehicle gets the new schema |
| 4 | Simulator | **Keep running** — simulator-created shipments flagged `source="simulator"` and excluded from the real Dispatch UI |

---

## 1. Scope & non-goals

**In scope (Track A1 + A4 + A7):**
- Replacing `ShipmentStatus = Literal["pending","in_transit","received"]` with the **8-state machine**.
- Adding `status_history[]`, `assigned_at`, `loaded_at`, `arrived_at`, `delivered_at`, `cancelled_at` to the Shipment model.
- Adding `driver_id`, `vehicle_id`, `route_id`, `dispatched_by_user_id`, `source` to the Shipment model.
- A new **transition guard** layer that enforces the state machine.
- A new audit collection `shipment_status_history` (event-sourced view) used by the Shipment Timeline API.
- Tenant-scoped guards on `/api/shipments`, `/api/shipments/{id}`, `/api/logistics/trucks` (closes the JWT/query-string-trust gap surfaced in the audit).
- A backfill migration script that re-stamps the 1,761 existing shipment docs and 100 vehicle docs.

**Out of scope** (covered in companion specs):
- Driver entity & APIs → `DRIVER_API_SPEC.md`
- Vehicle entity & APIs → `FLEET_MANAGEMENT_SPEC.md`
- OTP delivery code flow → `OTP_POD_ARCHITECTURE.md`

---

## 2. New canonical Shipment model

```python
# /app/backend/models.py — replaces the current minimal Shipment

ShipmentStatus = Literal[
    "created",
    "ready_for_dispatch",
    "assigned",
    "loaded",
    "in_transit",
    "arrived",
    "delivered",
    "cancelled",
]

class ShipmentLine(BaseModel):
    product_id: str
    quantity: int
    unit_price: Optional[float] = None
    gross_value: Optional[float] = None
    discount: Optional[float] = None
    net_value: Optional[float] = None
    product_name: Optional[str] = None    # denorm
    sku: Optional[str] = None             # denorm

class ShipmentTransition(BaseModel):
    from_status: Optional[ShipmentStatus] = None
    to_status: ShipmentStatus
    at: str                               # ISO-8601 UTC
    by_user_id: Optional[str] = None
    by_role: Optional[str] = None         # manufacturer | distributor | wholesaler | driver | system
    reason: Optional[str] = None
    notes: Optional[str] = None

class Shipment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # identity
    id: str = Field(default_factory=new_id)
    tracking_code: str = Field(default_factory=lambda: "SHP-" + uuid.uuid4().hex[:8].upper())
    shipment_number: Optional[str] = None       # human-readable, sequential per tenant

    # parties (5-tier aware)
    from_role: PartyRole
    from_id:   str
    to_role:   PartyRole
    to_id:     str
    manufacturer_id:  str = ""    # denorm
    distributor_id:   str = ""
    retailer_id:      str = ""
    wholesaler_id:    str = ""
    organization_id:  str = ""    # dispatcher org (for tenant scoping)

    # tenant scope (always the org that *owns the truck*)
    owner_org_id:     str            # NEW — primary tenant key for security guards
    owner_org_type:   PartyRole      # NEW — manufacturer | distributor | wholesaler

    # items
    items:            List[ShipmentLine]
    total_units:      Optional[int] = None         # denorm
    total_value:      Optional[float] = None       # denorm

    # state
    status:           ShipmentStatus = "created"
    status_history:   List[ShipmentTransition] = []     # append-only

    # lifecycle timestamps (mirror the latest entry in status_history)
    created_at:        str = Field(default_factory=now_iso)
    ready_at:          Optional[str] = None
    assigned_at:       Optional[str] = None
    loaded_at:         Optional[str] = None
    dispatched_at:     Optional[str] = None             # transition into in_transit
    arrived_at:        Optional[str] = None
    delivered_at:      Optional[str] = None
    cancelled_at:      Optional[str] = None
    cancelled_reason:  Optional[str] = None

    # dispatch attachments
    driver_id:         Optional[str] = None
    vehicle_id:        Optional[str] = None
    route_id:          Optional[str] = None
    dispatched_by_user_id: Optional[str] = None

    # delivery verification (OTP fields documented in OTP_POD_ARCHITECTURE.md)
    delivery_code:                Optional[str] = None    # hashed
    delivery_code_generated_at:   Optional[str] = None
    delivery_code_verified_at:    Optional[str] = None
    delivery_code_attempts:       int = 0
    delivered_by:                 Optional[str] = None    # driver_id who completed it

    # geo / ETA
    origin_city:      Optional[str] = None
    destination_city: Optional[str] = None
    eta_minutes:      Optional[int] = None

    # provenance
    source:           Literal["manual","simulator","route_planner","procurement","mobile"] = "manual"
    request_id:       Optional[str] = None            # link to upstream stock request / PO
    po_id:            Optional[str] = None            # link to procurement PO if applicable
    notes:            Optional[str] = None

    updated_at:       str = Field(default_factory=now_iso)
```

### 2.1 Why `owner_org_id`?

Today's audit found that `/api/shipments` accepts `manufacturer_id` / `distributor_id` / `retailer_id` as query filters but does **not** re-scope against the caller's JWT. With drivers now in the picture (and distributors/wholesalers running their own fleets), we need ONE authoritative tenant column to enforce row-level access. Rules:

- `owner_org_id` = the org dispatching the truck (manufacturer warehouse, distributor depot, or wholesaler hub).
- Every shipment query is automatically scoped: `WHERE owner_org_id = <jwt.entity_id>` unless the caller is a `super_admin`.
- The 5-tier denorm columns (`manufacturer_id`, etc.) are kept for analytics joins **only** — they no longer serve as security boundaries.

---

## 3. Shipment status state machine

### 3.1 Canonical transitions

```
                ┌──────────┐
   create  ─►   │ created  │
                └────┬─────┘
                     │ ready
                     ▼
            ┌────────────────────┐
            │ ready_for_dispatch │
            └──────────┬─────────┘
                       │ assign (driver + vehicle)
                       ▼
                ┌──────────┐
                │ assigned │
                └────┬─────┘
                     │ load
                     ▼
                ┌──────────┐
                │  loaded  │
                └────┬─────┘
                     │ start-trip
                     ▼
                ┌────────────┐
                │ in_transit │
                └─────┬──────┘
                      │ arrive
                      ▼
                ┌──────────┐
                │ arrived  │
                └────┬─────┘
                     │ deliver (OTP verified)
                     ▼
                ┌──────────┐
                │ delivered│  (TERMINAL)
                └──────────┘

   *Any non-terminal state* ──cancel──► ┌──────────┐
                                        │cancelled │  (TERMINAL)
                                        └──────────┘
```

### 3.2 Transition guard matrix

| From → To              | Trigger / API                                                                  | Allowed roles                                       |
|------------------------|--------------------------------------------------------------------------------|-----------------------------------------------------|
| (none) → `created`     | `POST /api/shipments` (auto)                                                   | manufacturer, distributor, wholesaler, super_admin  |
| `created` → `ready_for_dispatch` | `POST /api/shipments/{id}/ready`                                     | dispatcher of `owner_org_id`                        |
| `ready_for_dispatch` → `assigned` | `POST /api/shipments/{id}/assign` body `{driver_id, vehicle_id, route_id?}` | dispatcher of `owner_org_id`         |
| `assigned` → `loaded`  | `POST /api/shipments/{id}/load`                                                | dispatcher, **or** driver (their own assignment)    |
| `loaded` → `in_transit`| `POST /api/shipments/{id}/start-trip`                                          | driver (their own assignment) **or** dispatcher     |
| `in_transit` → `arrived` | `POST /api/shipments/{id}/arrive`                                            | driver (their own assignment) **or** dispatcher     |
| `arrived` → `delivered`| `POST /api/shipments/{id}/deliver` body `{delivery_code}` (OTP-verified)       | driver (their own assignment)                       |
| any non-terminal → `cancelled` | `POST /api/shipments/{id}/cancel` body `{reason}`                      | dispatcher of `owner_org_id`, super_admin           |

### 3.3 Disallowed transitions

Any combination not listed in §3.2 returns **HTTP 409 Conflict** with body:
```json
{ "detail": { "code": "INVALID_TRANSITION",
              "from_status": "<current>", "to_status": "<requested>",
              "allowed_next": ["<list>"] } }
```

### 3.4 Side effects per transition

| Transition | Inventory ledger | Vehicle status | Driver status | Notification |
|---|---|---|---|---|
| created | (none) | (none) | (none) | none |
| ready_for_dispatch | (none) | (none) | (none) | none |
| assigned | (none) | → `loading` | → `assigned` | driver: "New shipment assigned" |
| loaded | debit `from_id` inventory by `items[]` qty | → `loading` (stays) | → `assigned` (stays) | dispatcher: "Truck loaded" |
| in_transit | (none) | → `in_transit` | → `on_trip` | recipient (`to_id`): "Shipment in transit, your code is XXXX" |
| arrived | (none) | → `in_transit` (stays) | → `on_trip` (stays) | recipient: "Driver has arrived" |
| delivered | credit `to_id` inventory by `items[]` qty | → `available` (after archive cooldown) | → `available` | dispatcher + recipient: "Delivered" |
| cancelled | reverse-credit any inventory moved | → `available` | → `available` | dispatcher: "Cancelled" |

> Inventory moves are **idempotent** — a transition cannot move stock twice. Implemented by recording the `ref_id=<shipment_id>` + `transition=<from→to>` in `inventory_movements` and rejecting duplicate entries.

---

## 4. New API surface — Shipment lifecycle

| Verb + Endpoint | Body | Auth | New? |
|---|---|---|---|
| `POST   /api/shipments`                            | `{from_role,from_id,to_role,to_id,items[],notes?,po_id?}` | dispatcher | extends existing |
| `GET    /api/shipments`                            | filters: `owner_org_id` (auto from JWT) · `status` · `driver_id` · `vehicle_id` | any | extends existing |
| `GET    /api/shipments/{id}`                       | —                                                  | scoped     | **NEW**   |
| `POST   /api/shipments/{id}/ready`                 | `{notes?}`                                          | dispatcher | **NEW**   |
| `POST   /api/shipments/{id}/assign`                | `{driver_id, vehicle_id, route_id?}`               | dispatcher | **NEW**   |
| `POST   /api/shipments/{id}/load`                  | `{notes?}`                                          | dispatcher OR driver | **NEW** |
| `POST   /api/shipments/{id}/start-trip`            | `{eta_minutes?}`                                   | dispatcher OR driver | **NEW** |
| `POST   /api/shipments/{id}/arrive`                | `{lat?,lng?}`                                       | driver     | **NEW**   |
| `POST   /api/shipments/{id}/deliver`               | `{delivery_code}` (OTP)                            | driver     | **NEW**   |
| `POST   /api/shipments/{id}/cancel`                | `{reason}`                                          | dispatcher | **NEW**   |
| `GET    /api/shipments/{id}/timeline`              | —                                                  | scoped     | **NEW**   |
| `POST   /api/shipments/{id}/reassign-driver`       | `{driver_id, reason?}`                              | dispatcher | **NEW**   |
| `POST   /api/shipments/{id}/reassign-vehicle`      | `{vehicle_id, reason?}`                             | dispatcher | **NEW**   |
| `POST   /api/shipments/{id}/generate-delivery-code`| `{}`                                                | system / dispatcher | **NEW** (covered in `OTP_POD_ARCHITECTURE.md`) |
| `POST   /api/shipments/{id}/verify-delivery-code`  | `{delivery_code}`                                   | driver     | **NEW** (alias for `/deliver`; reserved) |

### 4.1 Deprecated endpoints (kept for 1 release)

- `PATCH /api/shipments/{id}/status` — **deprecated**, returns 410 Gone with header `X-Replacement-Endpoints: ready,assign,load,start-trip,arrive,deliver,cancel`.

---

## 5. Shipment timeline (audit trail)

### 5.1 Storage

- The **append-only** array on the Shipment doc itself: `status_history[ShipmentTransition]` (always queried first).
- **Mirror** to a global event collection `db.shipment_status_history` for cross-tenant analytics, indexed by `(owner_org_id, created_at desc)` + `(shipment_id, created_at asc)`.

### 5.2 `GET /api/shipments/{id}/timeline` response

```json
{
  "shipment_id": "...",
  "current_status": "in_transit",
  "tracking_code": "SHP-AB12CD34",
  "timeline": [
    { "from_status": null,                 "to_status": "created",            "at": "2026-06-20T10:01:00Z", "by_role": "manufacturer", "by_user_id": "...", "notes": null },
    { "from_status": "created",            "to_status": "ready_for_dispatch", "at": "2026-06-20T10:05:00Z", "by_role": "manufacturer", "by_user_id": "...", "notes": null },
    { "from_status": "ready_for_dispatch", "to_status": "assigned",           "at": "2026-06-20T10:12:00Z", "by_role": "manufacturer", "by_user_id": "...", "driver_id": "...", "vehicle_id": "..." },
    { "from_status": "assigned",           "to_status": "loaded",             "at": "2026-06-20T10:35:00Z", "by_role": "driver",       "by_user_id": "..." },
    { "from_status": "loaded",             "to_status": "in_transit",         "at": "2026-06-20T10:40:00Z", "by_role": "driver",       "by_user_id": "..." }
  ],
  "logistics_events": [ /* attached events from db.logistics_events (deviation, geofence breach, etc.) */ ]
}
```

### 5.3 Existing `/api/logistics/shipment-timeline/{id}` endpoint

Kept and extended to merge `status_history` + `logistics_events` into the same response. The dedicated `/timeline` endpoint above is the **forward** endpoint; the existing one continues to serve manufacturer Control Tower for back-compat.

---

## 6. Tenant security (A7)

### 6.1 Rule

> Every shipment / vehicle / driver endpoint that accepts a tenant-id filter as a query param MUST verify the caller's JWT `entity_id` and `role` match — or that the caller is `super_admin`.

### 6.2 New helper

```python
# services/auth.py
async def require_owner_org(user: dict, org_id: str, *, allow_super_admin: bool = True) -> None:
    if user["role"] == "super_admin" and allow_super_admin:
        return
    if user.get("entity_id") != org_id:
        raise HTTPException(403, "Forbidden — not your tenant")
```

### 6.3 Endpoints to retrofit (with audit traceback)

| Endpoint | Today's behaviour | Fix |
|---|---|---|
| `GET /api/shipments?manufacturer_id=...` | accepts arbitrary id | scope to `owner_org_id` derived from JWT; if super_admin, accept the query param |
| `GET /api/shipments/{id}` | (new) | look up shipment → assert `shipment.owner_org_id == jwt.entity_id` |
| `GET /api/logistics/trucks?manufacturer_id=...` | accepts arbitrary id | same pattern |
| `GET /api/logistics/control-tower?manufacturer_id=...` | already scoped via `_scope_manufacturer` | extend `_scope_manufacturer` → `_scope_owner_org` to work for distributor + wholesaler too |
| `POST /api/shipments` body `{from_id,...}` | accepts arbitrary from_id | derive `owner_org_id` from JWT and reject if `from_id` is not under `owner_org_id` |
| `POST /api/inventory/adjust` | already scoped per row | (no change) |

### 6.4 Driver-specific scope

A driver's JWT contains `{role:"driver", driver_id:"...", employer_org_id:"...", employer_org_type:"manufacturer|distributor|wholesaler"}`. Drivers can ONLY:
- `GET /api/driver/shipments` → returns shipments where `driver_id == jwt.driver_id`
- `POST /api/shipments/{id}/<load|start-trip|arrive|deliver>` → only if `shipment.driver_id == jwt.driver_id`

Drivers cannot read other drivers' shipments, list vehicles, or invoke `/assign`.

---

## 7. Backfill migration (A1 — handles existing 1,761 shipments + 100 vehicles)

### 7.1 Script: `/app/backend/scripts/migrate_logistics_v2.py`

**Idempotent** — re-running it does nothing on already-migrated docs. Driven by a `schema_version` field stamped on each row.

**Steps per shipment:**
1. Skip if `schema_version >= 2`.
2. Map old status:
   - `"pending"` → `"created"`
   - `"in_transit"` → `"in_transit"` (no change)
   - `"received"` → `"delivered"` (terminal)
   - **drift values** `"shipped"` → `"in_transit"`, `"delivered"` → `"delivered"` (no-op)
3. Derive `owner_org_id` + `owner_org_type` from `from_role/from_id`. For shipments where `from_role="warehouse"`, walk up via `organizations.parent_organization_id` to find the manufacturer; that becomes `owner_org_id` with `owner_org_type="manufacturer"`. Distributor/wholesaler dispatchers self-own.
4. Synthesise minimal `status_history[]`:
   ```
   [
     { from_status: null,         to_status: "created",    at: created_at,    by_role: "system", notes: "Backfilled" },
     # if dispatched_at exists:
     { from_status: "created",    to_status: "in_transit", at: dispatched_at, by_role: "system", notes: "Backfilled" },
     # if received_at exists (mapped to delivered):
     { from_status: "in_transit", to_status: "delivered",  at: received_at,   by_role: "system", notes: "Backfilled" }
   ]
   ```
5. Compute and stamp `delivered_at` = old `received_at`. Set `dispatched_at` if missing but `status="in_transit"`. Leave OTP / driver / vehicle fields null.
6. Set `source="simulator"` if doc has `generated_by` containing `"sim"`, else `"procurement"` if `po_id` present, else `"manual"`.
7. Stamp `schema_version=2`, `updated_at=now()`.

**Steps per vehicle:**
1. Skip if `schema_version >= 2`.
2. Map old status:
   - `"idle"`    → `"available"`
   - `"in_transit"`/`"stopped"`/`"breakdown"` → `"in_transit"` (kept as-is)
   - `"arrived"`/`"delivered"`/`"archived"` → `"offline"` (terminal-ish; control tower archives them anyway)
   - `"created"`/`"completed"`/`"cancelled"`/`"pending"`/`"received"`/`"loaded"` → bucket appropriately
3. Add `capacity_units`, `capacity_weight_kg` (default 1000 units, 1500 kg) — admin can later edit.
4. Set `vehicle_type` = default `"truck"`.
5. Set `current_driver_id = null` (drivers don't exist yet — the next migration writes them).
6. Stamp `schema_version=2`.

### 7.2 Acceptance test

After migration:
```
db.shipments.count_documents({"schema_version": {"$lt": 2}}) == 0
db.shipments.count_documents({"status": {"$in": ["pending","received","shipped"]}}) == 0
db.shipments.distinct("status")  ==  {"created","ready_for_dispatch","assigned","loaded","in_transit","arrived","delivered","cancelled"}  ⊆
db.vehicles.distinct("status")   ⊆  {"available","loading","in_transit","maintenance","offline"}
```

### 7.3 Rollback plan

Each row keeps `_legacy_status` and `_legacy_dispatched_at` (copied verbatim during migration). A rollback script restores those into `status` / `dispatched_at` / `received_at`.

---

## 8. Simulator co-existence

- `services/control_tower_sim.py` continues to spawn fake vehicles and shipments.
- Every shipment it creates gets `source="simulator"`.
- The new Dispatch UI filters `source != "simulator"` by default.
- The simulator tick auto-advances simulator shipments through the new state machine **respecting the same transition guards**, so `db.shipments.status` always stays inside the new enum.
- A new toggle `SIMULATOR_ENABLED=true|false` in `backend/.env` lets us turn it off per environment. Default: `true` in preview, `false` in production once Track A is live.

> The simulator is no longer source-of-truth — it's a load generator that exercises the same API surface as the real Dispatch UI.

---

## 9. Acceptance checklist (this design doc)

Before any code is written, the user must sign off on:

- [ ] §2 — New canonical Shipment model fields & types (esp. `owner_org_id`)
- [ ] §3.1 — Status state-machine diagram (8 states, terminal `delivered` / `cancelled`)
- [ ] §3.2 — Transition guard matrix (who can do what)
- [ ] §4 — New API surface (15 endpoints; PATCH `/status` deprecated)
- [ ] §5 — Timeline contract (`status_history` mirrored to `db.shipment_status_history`)
- [ ] §6 — Tenant scope rules (owner_org_id is the security boundary)
- [ ] §7 — Backfill migration approach (idempotent, reversible)
- [ ] §8 — Simulator co-existence (source flag + env toggle)

---

## 10. Companion docs

- **OTP / Proof of Delivery** → `OTP_POD_ARCHITECTURE.md`
- **Driver entity, auth, APIs** → `DRIVER_API_SPEC.md`
- **Vehicle entity, fleet APIs** → `FLEET_MANAGEMENT_SPEC.md`

---

*End of design.*
