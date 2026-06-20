# Driver Workspace — Functional Specification

**Audit date:** 2026-06-20  
**Scope:** TradeKonekt Driver persona (mobile-only — no web workspace by design)  
**Purpose:** Source-of-truth functional inventory for the Driver Mobile App.

> The Driver has **no web workspace**. This document describes the driver's
> role, state machine, responsibilities, and the API surface they consume —
> all from the existing backend shipped by Track A.

---

## 1. Role & ownership model

| Aspect | Value |
|---|---|
| Role string in `VALID_ROLES` | `driver` |
| Employer types allowed | `manufacturer`, `distributor`, `wholesaler` |
| One driver per JWT | yes — `entity_id = driver_id` |
| Multi-employer driver | **not supported in Track A** (one `employer_org_id` per driver) |
| Driver-only data | the driver sees ONLY their own profile + shipments where `driver_id == jwt.driver_id` |

### 1.1 Driver state machine

```
   (hired) ─► offline ─login─► available ─assign─► assigned ─start-trip─► on_trip
                  ▲                ▲                  ▲              │
                  └────────────────┴──────────────────┴──────────────┘
                                  (deliver / cancel / reject → available)
```

| State | Description |
|---|---|
| **offline** | Not on shift. Driver has not logged in OR has hit `/me/offline`. |
| **available** | Logged in, no active assignment, eligible for new dispatch. |
| **assigned** | Has a shipment assigned but truck is still at the depot. |
| **on_trip** | Truck has left — shipment is `in_transit` or `arrived`. |

> Drivers cannot go offline mid-trip (returns 409 `Cannot go offline mid-trip`).

---

## 2. What the driver does (job-to-be-done)

> A driver session is short, high-stakes, and one-handed.

| Rank | Task | Frequency | One-handed? |
|---|---|---|---|
| 1 | Glance at "today's trips" list | every shift start | yes |
| 2 | Open active shipment & view delivery point | each trip | yes |
| 3 | Mark **loaded** at depot | each trip | yes (1 tap) |
| 4 | Mark **start trip** when leaving | each trip | yes (1 tap) |
| 5 | Mark **arrived** at receiver | each trip | yes (1 tap) |
| 6 | Enter the 4-digit OTP from receiver → **deliver** | each trip | yes (4 taps) |
| 7 | Toggle online/offline | shift boundary | yes (1 tap) |
| 8 | Reject an assignment | rare | yes (with reason) |
| 9 | View today's deliveries / earnings (P1) | shift end | yes |
| 10 | Update contact info | rare | yes |

> The driver does **NOT**: place orders, edit inventory, see other drivers, see other shipments, see KPI dashboards, see network maps.

---

## 3. API surface consumed by the Driver Mobile App

### 3.1 Auth (shared)

| Endpoint | Notes |
|---|---|
| `POST /api/auth/login` | Returns JWT with `role="driver"`, `entity_id=<driver_id>`, plus standard refresh_token. |
| `POST /api/auth/refresh` | Same as other roles. |
| `POST /api/auth/logout` | Same as other roles. |
| `GET /api/auth/me` | Returns the user account (not the driver profile — use `/driver/me` for profile). |

### 3.2 Profile & status

| Endpoint | Body | Behaviour |
|---|---|---|
| `GET /api/driver/me` | — | Full Driver profile (status, assigned_shipment_id, assigned_vehicle_id, employer_org_id, deliveries_30d, etc.) |
| `POST /api/driver/me/online` | `{}` | Sets `status="available"` if currently `offline`; no-op otherwise. |
| `POST /api/driver/me/offline` | `{}` | Sets `status="offline"`. Returns 409 if driver is mid-trip. |
| `PATCH /api/driver/me` | `{phone?, email?}` | Self-service profile edit. Restricted to phone + email only. |
| `POST /api/driver/me/location` | `{lat, lng, accuracy_m?, heading?, speed_kmh?, ts?}` | GPS heartbeat — writes to `db.driver_locations`, stamps `last_seen_at` + `last_lat/last_lng` on driver doc. |

### 3.3 Shipments — read

| Endpoint | Behaviour |
|---|---|
| `GET /api/driver/shipments?status=` | Only shipments where `driver_id == jwt.driver_id`. Sorted by `created_at` desc. Returns up to 50. Filter optional: `assigned`, `loaded`, `in_transit`, `arrived`, `delivered`, `cancelled`. |
| `GET /api/driver/shipments/{id}` | One shipment if `driver_id` matches the caller. Includes full `status_history`, items, lifecycle timestamps, and OTP metadata (but NOT the delivery_code hash). |

### 3.4 Shipment lifecycle — mutations

> Driver can call ONLY these — not `/ready` / `/assign` / `/cancel` / `/reassign-*`.

| Endpoint | Body | Allowed when status is | Effect |
|---|---|---|---|
| `POST /api/driver/shipments/{id}/accept` | `{}` | `assigned` | Records "accepted" in `status_history`; no status change. |
| `POST /api/driver/shipments/{id}/reject` | `{reason?, notes?}` | `assigned` | Unsets `driver_id` + `vehicle_id`; rolls shipment back to `ready_for_dispatch`; dispatcher must reassign. |
| `POST /api/shipments/{id}/load` | `{notes?}` | `assigned` | Status → `loaded`; **inventory debited from-side**. |
| `POST /api/shipments/{id}/start-trip` | `{eta_minutes?, notes?}` | `loaded` | Status → `in_transit`; vehicle → `in_transit`; driver → `on_trip`. |
| `POST /api/shipments/{id}/arrive` | `{lat?, lng?, notes?}` | `in_transit` | Status → `arrived`. Notifies receiver. |
| `POST /api/shipments/{id}/deliver` | `{delivery_code: "XXXX"}` | `arrived` | OTP-verified — see §4. Status → `delivered`; inventory credited to-side; driver+vehicle return to `available`. |

### 3.5 Out of scope for the driver

| Endpoint | Why excluded |
|---|---|
| `POST /api/shipments/{id}/ready` | Dispatcher-only |
| `POST /api/shipments/{id}/assign` | Dispatcher-only |
| `POST /api/shipments/{id}/cancel` | Dispatcher-only |
| `POST /api/shipments/{id}/reassign-driver` | Dispatcher-only |
| `POST /api/shipments/{id}/reassign-vehicle` | Dispatcher-only |
| `POST /api/shipments/{id}/generate-delivery-code` | Dispatcher / system |
| `GET /api/drivers` | Admin-only |
| `GET /api/vehicles` | Driver gets 200 but the list is filtered to vehicles where they are `current_driver_id` |
| `GET /api/notifications` | Receivers (distributor/wholesaler/etc.) — driver cannot see OTP codes |

---

## 4. OTP delivery flow (driver's role)

```
Receiver's inbox (their notification)        Driver's mobile app
══════════════════════════════════           ════════════════════════
                                              POST /shipments/{id}/arrive
                                              ─► status = arrived
                                              ─► receiver gets "Driver arrived"

Receiver reads notification with             Driver asks receiver for code
4-digit code  (e.g. "4729")        ────►     Receiver says "4729"
                                              Driver taps 4 digits:
                                              POST /shipments/{id}/deliver
                                              { "delivery_code": "4729" }

                                              ✅ Match → status=delivered, both go available
                                              ❌ Mismatch → 401 + attempts_remaining
                                              5 wrong → 423 LOCKED 10 min
                                              Code expired (7 days) → 410
```

### 4.1 Failure modes the mobile app must handle

| Server response | UX |
|---|---|
| `200 {status:"delivered"}` | success toast → close shipment screen → back to list |
| `400 {code:"MALFORMED_CODE"}` | inline field error: "Code must be 4 digits" |
| `401 {code:"INVALID_CODE", attempts_remaining: N}` | inline error: "Wrong code. {N} tries left." |
| `401 {code:"INVALID_CODE", locked:true}` | warning sheet: "Too many wrong codes. Try again at {unlock_at}." |
| `423 {code:"LOCKED", unlock_at}` | banner: "Locked until {unlock_at}. Contact dispatcher." |
| `410 "Delivery code expired"` | banner: "Code expired — ask dispatcher to regenerate." |
| `409 "Shipment already delivered"` | banner: "Already delivered." (UI should refresh and pop back) |
| `403 "Not the assigned driver"` | hard error — log out, force re-login |

---

## 5. Shipment payload shape (live sample)

Returned by `GET /api/driver/shipments/{id}` (sensitive fields omitted):

```json
{
  "id": "68607697-0257-48bd-a50b-e1005bc75e51",
  "tracking_code": "SHP-AB12CD34",
  "shipment_number": null,
  "from_role": "manufacturer",
  "from_id":   "b21c1dbe-1a6f-4c33-b036-f416579455d0",
  "to_role":   "distributor",
  "to_id":     "f9dfaf08-4ee2-3c64-e96b-983c385625b2",
  "owner_org_id": "b21c1dbe-...", "owner_org_type": "manufacturer",
  "manufacturer_id": "...", "distributor_id": "...", "retailer_id": "",
  "wholesaler_id": "", "organization_id": "",
  "items": [
    { "product_id": "...", "quantity": 25, "unit_price": null,
      "product_name": null, "sku": null }
  ],
  "total_units": 25, "total_value": null,
  "status": "assigned",
  "status_history": [
    { "from_status": null, "to_status": "created",
      "at": "2026-06-20T...Z", "by_role": "manufacturer" },
    { "from_status": "created", "to_status": "ready_for_dispatch",
      "at": "2026-06-20T...Z", "by_role": "manufacturer" },
    { "from_status": "ready_for_dispatch", "to_status": "assigned",
      "at": "2026-06-20T...Z", "by_role": "manufacturer",
      "driver_id": "...", "vehicle_id": "..." }
  ],
  "created_at": "...", "ready_at": "...", "assigned_at": "...",
  "loaded_at": null, "dispatched_at": null, "arrived_at": null,
  "delivered_at": null, "cancelled_at": null, "cancelled_reason": null,
  "driver_id": "0f40671e-...", "vehicle_id": "324a2a7d-...",
  "route_id": null, "dispatched_by_user_id": null,
  "delivery_code_generated_at": "...", "delivery_code_expires_at": "...",
  "delivery_code_attempts": 0, "delivery_code_locked_until": null,
  "delivery_code_verified_at": null, "delivered_by": null,
  "origin_city": null, "destination_city": null, "eta_minutes": null,
  "source": "manual", "request_id": null, "po_id": null, "notes": null,
  "received_at": null, "updated_at": "...", "schema_version": 2
}
```

> ⚠️ **`delivery_code` (bcrypt hash) is stripped from all driver responses.** Only the receiver sees the clear-text code, in their in-app notification.

---

## 6. Driver-specific KPIs (rendered in the mobile app)

Computed client-side from `GET /api/driver/me` + `GET /api/driver/shipments?status=delivered`:

| KPI | Source | Notes |
|---|---|---|
| Trips today | filter delivered shipments where `delivered_at >= today_start` | |
| Active shipment | `driver.assigned_shipment_id` | one at a time |
| On-time % (last 30d) | `driver.on_time_pct_30d` (server-computed) | nullable until first delivery |
| Avg POD time (last 30d) | `driver.avg_pod_time_min` | nullable until first delivery |
| Deliveries (last 30d) | `driver.deliveries_30d` | server-computed |

---

## 7. What's intentionally OUT of scope for the Driver Mobile App

- ❌ Order placement (drivers don't buy/sell)
- ❌ Inventory views (drivers don't adjust stock)
- ❌ Network maps, KPI dashboards (no exec/manager surfaces)
- ❌ Other drivers' rosters / fleet management
- ❌ Photo capture / signature (deferred to P2 — OTP is the sole POD method)
- ❌ Driver acceptance gating (`DRIVER_ACCEPT_REQUIRED=true` is a P2 feature)
- ❌ Push notifications (in-app only for MVP)
- ❌ Multi-employer switcher (one employer per driver)
- ❌ Sabi Copilot (no `/driver/{id}/assistant` endpoint)

---

## 8. Endpoint readiness summary

| Cluster | Endpoints | Verified |
|---|---|---|
| Auth (login, refresh, logout, me) | 4 | ✅ 4/4 |
| Profile (`/driver/me*`) | 5 | ✅ 5/5 |
| Shipments — read | 2 | ✅ 2/2 |
| Shipment lifecycle — driver-callable | 6 | ✅ 6/6 |

**Total: 17/17 endpoints return 200 in the preview env.**

Two extras (`accept`, `reject`) are bonus — bringing the **`DRIVER_API_SPEC.md` §6 promise of 15 to actual delivery of 17.**

---

*End of spec.*
