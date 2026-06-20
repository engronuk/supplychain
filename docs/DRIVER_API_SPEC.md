# Driver API Spec — Track A2 + A6

**Design date:** 2026-06-20  
**Status:** DRAFT for sign-off (no code written)  
**Parent doc:** `LOGISTICS_FOUNDATION_DESIGN.md`  
**Scope:** Driver entity, auth, CRUD, operations endpoints — everything a Driver mobile app will eventually need.

---

## 0. Locked decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Driver tenancy | **Manufacturer + Distributor + Wholesaler** can each employ drivers |
| 2 | Driver auth | JWT, separate role `"driver"` added to `VALID_ROLES` |
| 3 | Driver invitation flow | Re-uses the existing `/auth/invite` machinery (admin creates → driver gets token → claims with a password) |
| 4 | Driver mobile session | Refresh-token pattern, identical to other roles |
| 5 | Multi-employer driver | **Not supported in Track A.** A driver belongs to exactly one `employer_org_id`. |

---

## 1. Driver entity

### 1.1 Pydantic model (new — `/app/backend/models.py`)

```python
DriverStatus = Literal["available", "assigned", "on_trip", "offline"]

class Driver(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # identity
    id:               str = Field(default_factory=new_id)
    employee_number:  str                                  # human-readable, unique per employer
    first_name:       str
    last_name:        str
    full_name:        str = ""                              # auto-set on save (denorm)
    phone:            str
    email:            EmailStr
    licence_number:   Optional[str] = None
    licence_class:    Optional[str] = None                  # B|C|D|E (Nigerian standard)
    licence_expiry:   Optional[str] = None                  # ISO date

    # tenancy
    employer_org_id:    str                                  # tenant key
    employer_org_type:  Literal["manufacturer","distributor","wholesaler"]
    home_warehouse_id:  Optional[str] = None                # default depot

    # state
    status:               DriverStatus = "offline"
    assigned_vehicle_id:  Optional[str] = None              # 0..1 active vehicle
    assigned_shipment_id: Optional[str] = None              # 0..1 active shipment (the one currently in_transit)

    # user-account link
    user_id:          Optional[str] = None                  # = users.id (the auth account)
    invited_at:       Optional[str] = None
    claimed_at:       Optional[str] = None
    last_login_at:    Optional[str] = None

    # ops health
    deliveries_30d:   int = 0
    on_time_pct_30d:  Optional[float] = None
    avg_pod_time_min: Optional[float] = None
    last_seen_at:     Optional[str] = None                  # last GPS ping or login

    # lifecycle
    is_active:        bool = True
    deactivated_at:   Optional[str] = None
    deactivation_reason: Optional[str] = None
    created_at:       str = Field(default_factory=now_iso)
    updated_at:       str = Field(default_factory=now_iso)
    schema_version:   int = 1
```

### 1.2 Mongo collection

`db.drivers` — unique index on `(employer_org_id, employee_number)`, plus `(user_id)`, `(status, employer_org_id)`.

### 1.3 Driver state machine

```
         hired
   ─►  offline
            │ login   (driver opens app, signs in)
            ▼
        available
            │ assign  (dispatcher → POST /shipments/{id}/assign)
            ▼
         assigned
            │ start-trip
            ▼
         on_trip
            │ deliver | cancel | reassign
            ▼
        available   (auto-return after delivery / cancellation)

   offline can be reached from any state via /driver/me/offline (manual) or 30-min idle timeout.
```

| From → To | Trigger |
|---|---|
| (none) → offline | driver created via `POST /api/drivers` |
| offline → available | driver login |
| available → assigned | shipment assignment to this driver |
| assigned → on_trip | shipment start-trip |
| on_trip → available | shipment delivered or cancelled OR reassigned-off |
| any → offline | manual `POST /api/driver/me/offline` OR 30-min idle |

> A driver can be **`assigned`** to only one shipment at a time, but **`on_trip`** is also limited to one. The dispatcher UI enforces this on assign.

---

## 2. Driver auth

### 2.1 `"driver"` added to `VALID_ROLES`

```python
# services/auth.py
VALID_ROLES = ["super_admin", "manufacturer", "distributor", "retailer", "driver"]
```

### 2.2 JWT claims for drivers

```json
{
  "sub": "<user_id>",
  "role": "driver",
  "driver_id": "<drivers.id>",                  // NEW
  "entity_id": "<drivers.id>",                  // mirrors driver_id for compat with other roles
  "employer_org_id": "<drivers.employer_org_id>", // NEW
  "employer_org_type": "manufacturer",          // NEW
  "iat": 1718848800,
  "exp": 1718935200
}
```

### 2.3 Auth endpoints

| Verb + Endpoint | Body | Notes |
|---|---|---|
| `POST /api/auth/driver/login` | `{email, password}` | Same as `/auth/login` but enforces role=="driver" |
| `POST /api/auth/login` | `{email, password}` | Existing endpoint — also returns driver JWT if user is a driver (single endpoint preferred) |
| `POST /api/auth/refresh` | `{refresh_token}` | Existing — works for drivers |
| `POST /api/auth/logout` | — | Existing |

> **Decision:** we extend the existing `/auth/login` to issue driver JWTs when the user's role is `driver`. We do **not** create a separate driver login endpoint. The optional `/auth/driver/login` exists only to set a friendly front-door for the Driver mobile app — internally it forwards to `/auth/login`.

### 2.4 Invitation flow (admin-driven)

1. Dispatcher (manufacturer/distributor/wholesaler admin) hits **`POST /api/drivers`** with the driver's profile.
2. Backend creates the `Driver` doc **and** a parallel `User` doc with role=`driver`, then calls the existing `/auth/invite` machinery to issue a one-use claim token.
3. Token sent to the driver's email (re-uses existing console-logged reset link until SMTP is configured).
4. Driver clicks the link in their email → web claim page → sets a password → can now log in via the Driver mobile app.

---

## 3. Admin / Dispatcher driver endpoints

> Scope: only the driver's `employer_org_id` (and super_admin) can use these.

| Verb + Endpoint | Body | Notes |
|---|---|---|
| `GET    /api/drivers?status=&employer_org_id=` | — | scoped to JWT tenant; super_admin can pass any employer |
| `POST   /api/drivers` | `{employee_number, first_name, last_name, phone, email, licence_number?, licence_class?, licence_expiry?, home_warehouse_id?}` | creates Driver + User + invitation |
| `GET    /api/drivers/{driver_id}` | — | full profile |
| `PATCH  /api/drivers/{driver_id}` | partial profile (no status changes here) | |
| `POST   /api/drivers/{driver_id}/deactivate` | `{reason}` | soft-delete; clears assignments; status → offline |
| `POST   /api/drivers/{driver_id}/reactivate` | — | clears `deactivated_at` |
| `POST   /api/drivers/{driver_id}/resend-invite` | — | re-issues claim token |
| `GET    /api/drivers/{driver_id}/shipments?status=` | — | dispatcher view of a driver's shipments (active + history) |
| `GET    /api/drivers/{driver_id}/performance?days=30` | — | KPI snapshot (deliveries, on-time, avg pod time) |

---

## 4. Driver-self endpoints (mobile app)

> Scope: JWT must be `role="driver"`; all actions implicitly scoped to `jwt.driver_id`.

### 4.1 Profile & status

| Verb + Endpoint | Body | Notes |
|---|---|---|
| `GET    /api/driver/me` | — | full profile (no other driver visible) |
| `POST   /api/driver/me/online` | — | sets `status="available"` |
| `POST   /api/driver/me/offline` | — | sets `status="offline"` |
| `PATCH  /api/driver/me` | `{phone?, email?}` (limited) | self-edit; profile-only, no tenancy / status changes |
| `POST   /api/driver/me/location` | `{lat, lng, accuracy_m?, heading?, speed_kmh?, ts}` | GPS heartbeat — stamps `last_seen_at` + writes to `db.driver_locations` (P2 — see §7) |

### 4.2 Shipments — assigned to me

| Verb + Endpoint | Body | Notes |
|---|---|---|
| `GET   /api/driver/shipments?status=` | — | shipments where `driver_id == jwt.driver_id`. Default: active (`assigned|loaded|in_transit|arrived`). |
| `GET   /api/driver/shipments/{shipment_id}` | — | scoped — can only read your own |
| `POST  /api/driver/shipments/{shipment_id}/accept` | — | optional; if `DRIVER_ACCEPT_REQUIRED=true`, blocks transition to `loaded` until accepted |
| `POST  /api/driver/shipments/{shipment_id}/reject` | `{reason}` | unsets `driver_id`; shipment returns to `ready_for_dispatch`; dispatcher notified |

### 4.3 Shipment lifecycle (driver-callable subset)

These re-use the canonical endpoints from `LOGISTICS_FOUNDATION_DESIGN.md` §4, but the driver-self version is the same URL — auth simply allows the driver to call it when they're the assigned driver.

| Verb + Endpoint | Body | Driver-side action |
|---|---|---|
| `POST  /api/shipments/{id}/load` | `{notes?}` | mark loaded |
| `POST  /api/shipments/{id}/start-trip` | `{eta_minutes?}` | mark in_transit |
| `POST  /api/shipments/{id}/arrive` | `{lat?, lng?}` | mark arrived |
| `POST  /api/shipments/{id}/deliver` | `{delivery_code}` | OTP verify & deliver |

> **`/cancel`, `/reassign-*`, `/ready`, `/assign`** are **dispatcher-only** — drivers cannot invoke them.

---

## 5. Validation rules

| Rule | Where |
|---|---|
| `employee_number` unique per `employer_org_id` | mongo unique index |
| `email` unique across the whole `users` collection | existing constraint |
| `phone` E.164 format (e.g. `+234803...`) | pydantic validator |
| `licence_class` ∈ `{A,B,C,D,E,F,G}` (Nigerian Federal Road Safety) | pydantic literal |
| Cannot deactivate a driver with `status ∈ {assigned, on_trip}` | service check; returns 409 |
| Cannot assign a shipment to a driver whose `status="offline"` | service check; returns 409 |
| Cannot assign a shipment to a driver whose `employer_org_id ≠ shipment.owner_org_id` | tenant guard; returns 403 |

---

## 6. Mobile app — endpoint readiness checklist

For the future Driver mobile app to be built, this spec must deliver these 14 endpoints with HTTP 200:

```
POST  /api/auth/login                            (existing — works for drivers)
POST  /api/auth/refresh                          (existing)
POST  /api/auth/logout                           (existing)
GET   /api/driver/me                             (new)
POST  /api/driver/me/online                      (new)
POST  /api/driver/me/offline                     (new)
PATCH /api/driver/me                             (new)
GET   /api/driver/shipments                      (new)
GET   /api/driver/shipments/{id}                 (new)
POST  /api/driver/shipments/{id}/accept          (new — optional, depends on env flag)
POST  /api/driver/shipments/{id}/reject          (new)
POST  /api/shipments/{id}/load                   (new from LOGISTICS_FOUNDATION_DESIGN.md)
POST  /api/shipments/{id}/start-trip             (new)
POST  /api/shipments/{id}/arrive                 (new)
POST  /api/shipments/{id}/deliver                (new — OTP-verified)
```

15 endpoints + auth. **A Driver mobile-app brief / UX plan will NOT be written until these all serve 200 on the live preview pod.**

---

## 7. P2 — Driver GPS ping (out of scope for Track A1)

The `/api/driver/me/location` endpoint is **stubbed in the spec** but its implementation is deferred:

- Track A delivers the endpoint that accepts and persists location pings to `db.driver_locations`.
- Map rendering, geofencing of driver position, and live driver-trail visualisation are P2.
- The control-tower simulator continues to drive vehicle motion for now.

When P2 lands, the driver-position channel will replace the simulator for `assigned` shipments.

---

## 8. Acceptance checklist (this spec)

- [ ] §1.1 — Driver model fields & enums
- [ ] §1.3 — Driver state machine (4 states)
- [ ] §2 — Auth integration (role added to `VALID_ROLES`, JWT claims)
- [ ] §3 — 9 dispatcher endpoints
- [ ] §4 — 12 driver-self endpoints
- [ ] §5 — Validation rules
- [ ] §6 — Endpoint readiness gate for Driver mobile app

---

*End of Driver API spec.*
