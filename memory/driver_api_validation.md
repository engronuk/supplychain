# Driver API Validation

**Probe date:** 2026-06-20 (preview env)  
**Auth:** Driver test account created via `POST /api/drivers` — default password `TradeKonekt2026!`  
**Sample driver_id (preview):** `0f40671e-6081-421f-99fe-36fe5da57dc7` (Adaeze Ibe, Unilever)

**Legend**  
✅ **Verified** — 200 with expected payload  
🟡 **Partial** — works but with caveats  
❌ **Missing** — does not exist or rejects driver role

---

## A. Identity & Session

| Capability | Endpoint | Status |
|---|---|---|
| Driver login | `POST /api/auth/login` | ✅ Verified (JWT carries `role="driver"`, `entity_id=driver_id`) |
| Refresh token | `POST /api/auth/refresh` | ✅ Verified |
| Sign out | `POST /api/auth/logout` | ✅ Verified |
| Read self (user account) | `GET /api/auth/me` | ✅ Verified |

> The driver does NOT have a dedicated `/api/auth/driver/login` — the generic `/auth/login` issues the right JWT shape when the user's role is `driver`.

---

## B. Driver Profile (self)

| Capability | Endpoint | Status |
|---|---|---|
| Driver profile | `GET /api/driver/me` | ✅ Verified (876 bytes — full doc) |
| Go online | `POST /api/driver/me/online` | ✅ Verified |
| Go offline | `POST /api/driver/me/offline` | ✅ Verified (409 if mid-trip) |
| Edit phone / email | `PATCH /api/driver/me` | ✅ Verified |
| GPS heartbeat ping | `POST /api/driver/me/location` | ✅ Verified — writes to `db.driver_locations` |

---

## C. Driver Shipments

| Capability | Endpoint | Status |
|---|---|---|
| My shipments | `GET /api/driver/shipments?status=` | ✅ Verified |
| Shipment detail | `GET /api/driver/shipments/{id}` | ✅ Verified |
| Cross-driver access | `GET /api/driver/shipments/{other_driver_id_shipment}` | ✅ Returns 403 "Not your shipment" |
| Accept assignment | `POST /api/driver/shipments/{id}/accept` | ✅ Verified |
| Reject assignment | `POST /api/driver/shipments/{id}/reject` | ✅ Verified — unsets driver/vehicle, rolls back to `ready_for_dispatch` |

---

## D. Shipment Lifecycle — Driver-Callable

> The driver-side endpoints are the same canonical lifecycle paths — auth allows the driver only when they're the assigned driver.

| Capability | Endpoint | Status |
|---|---|---|
| Mark loaded | `POST /api/shipments/{id}/load` | ✅ Verified — debits from-side inventory |
| Start trip | `POST /api/shipments/{id}/start-trip` | ✅ Verified — flips vehicle to `in_transit`, driver to `on_trip` |
| Mark arrived | `POST /api/shipments/{id}/arrive` | ✅ Verified — emits "driver arrived" notification |
| Deliver (OTP) | `POST /api/shipments/{id}/deliver` body `{delivery_code}` | ✅ Verified — see §E |

---

## E. OTP Delivery Verification

| Capability | Endpoint | Status |
|---|---|---|
| Correct 4-digit code | `POST .../deliver {delivery_code:"7630"}` | ✅ Verified — 200, status=delivered |
| Wrong code | `POST .../deliver {delivery_code:"0000"}` | ✅ 401 `INVALID_CODE` with `attempts_remaining` |
| 5 wrong codes in a row | repeat /deliver | ✅ 5th attempt returns `locked=true`; subsequent calls return 423 LOCKED with `unlock_at` |
| Malformed code (3 digits) | `POST .../deliver {delivery_code:"123"}` | ✅ 400 `MALFORMED_CODE` |
| Expired code (7+ days) | — | 🟡 Untested live (TTL not yet elapsed in preview); logic verified by unit test |
| Code not yet generated | new shipment without /assign | ✅ 409 "No delivery code generated yet" |
| Cancelled shipment | deliver after /cancel | ✅ 410 "Shipment cancelled" |

---

## F. What the Driver CANNOT do (deliberate blocks)

| Capability | Endpoint | Status |
|---|---|---|
| Mark shipment ready | `POST /api/shipments/{id}/ready` | ✅ 403 `FORBIDDEN_ROLE` |
| Assign self to a shipment | `POST /api/shipments/{id}/assign` | ✅ 403 `FORBIDDEN_ROLE` |
| Cancel a shipment | `POST /api/shipments/{id}/cancel` | ✅ 403 `FORBIDDEN_ROLE` |
| Reassign driver/vehicle | `POST .../reassign-*` | ✅ 403 `FORBIDDEN_ROLE` |
| Generate delivery code | `POST .../generate-delivery-code` | ✅ 403 (dispatcher only) |
| List other drivers | `GET /api/drivers` | 🟡 Returns 200 but empty list (driver's employer scope filters them out — by design they can't enumerate peers) |
| Read OTP codes in notifications inbox | `GET /api/notifications` | ✅ 403 "Drivers cannot list org notifications" |
| Cross-tenant shipment read | `GET /api/shipments/{other_org_shipment}` | ✅ 403 |

---

## G. Side-effect verification (automated by transition guard)

| Trigger | Driver doc effect | Vehicle doc effect | Inventory effect |
|---|---|---|---|
| `POST /assign` (dispatcher) | `status=assigned`, `assigned_shipment_id` set, `assigned_vehicle_id` set | `status=loading`, `current_shipment_id` set, `current_driver_id` set | none |
| `POST /load` (driver) | unchanged | unchanged | from-side debited (idempotent — kind=`shipment_load_{id}`) |
| `POST /start-trip` (driver) | `status=on_trip` | `status=in_transit` | none |
| `POST /arrive` (driver) | unchanged | unchanged | none |
| `POST /deliver` (driver, OTP-verified) | `status=available`, assignments cleared | `status=available`, assignments cleared | to-side credited (idempotent — kind=`shipment_deliver_{id}`) |
| `POST /cancel` (dispatcher) | `status=available`, assignments cleared | `status=available`, assignments cleared | reverse load if loaded (idempotent) |
| `POST /reject` (driver) | `status=available`, assignments cleared | `status=available`, assignments cleared | none (shipment hadn't moved stock yet) |

All ✅ verified in iteration_31.

---

## H. Performance KPI fields on Driver doc

| Field | Status |
|---|---|
| `deliveries_30d` | 🟡 Schema present; server-side aggregator NOT yet wired (defaults to 0) — recommend adding a cron in Track B |
| `on_time_pct_30d` | 🟡 Schema present; aggregator NOT yet wired |
| `avg_pod_time_min` | 🟡 Schema present; aggregator NOT yet wired |
| `last_seen_at` | ✅ Updated by `/location` ping |
| `last_lat`/`last_lng` | ✅ Updated by `/location` ping |

> Mobile app should render these as "—" when null. The KPI back-end fill is a P1 task post-MVP.

---

## I. Notifications channel

| Capability | Endpoint | Status |
|---|---|---|
| Driver receives in-app notifications | `GET /api/notifications` (with their target_user_id) | ❌ Currently locked out (`Drivers cannot list org notifications`) — this is correct for OTP isolation but **also blocks legitimate driver-facing notifications**. Mobile MVP works without it; revisit in P1 with a dedicated `/api/driver/notifications` scoped to `target_user_id == jwt.id`. |

---

## Summary

| Verified | Partial | Missing |
|---|---|---|
| **17 endpoints** | 4 (KPI fields not yet populated) | 1 (driver-scoped notifications inbox — P1) |

**Gaps mobile MVP can ignore:** server-side KPI rollups (defaults to 0/null); driver in-app notifications (driver gets work via `GET /driver/shipments` polling).  
**Gaps mobile MVP must NOT advertise:** "earnings" tab (no payments backend), "photo POD" (OTP is the only proof), Sabi voice copilot.
