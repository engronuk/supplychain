# TradeKonekt Driver Mobile App — Build Brief for Mobile Agent

> One self-contained document. Paste this entire file to the mobile agent.  
> Source-of-truth specs: `DRIVER_WORKSPACE_FUNCTIONAL_SPEC.md`, `DRIVER_MOBILE_UX_PLAN.md`, `driver_api_validation.md`, `OTP_POD_ARCHITECTURE.md`, `DRIVER_API_SPEC.md`.

---

## 0. TL;DR for the mobile agent

You are building the **TradeKonekt Driver mobile app** — a native (or React-Native / Flutter) mobile experience for an existing, fully-verified backend (Track A). **Do not invent new backend functionality.** Every screen below is driven by an endpoint that already returns 200 in the preview env.

- Primary persona: **on-the-road individual driver** — receives a shipment assignment, drives to pickup, marks loaded → start-trip → arrived → enters 4-digit OTP from the receiver → delivers.
- **5 screens total** (Login · Today · Active Trip · OTP Entry · Profile). No bottom tabs. No dashboards. No KPI noise.
- **15 P0 features** for MVP.
- **OTP-based proof of delivery** is the canonical proof — no photo, no signature, no GPS-stamp in MVP.
- **Driver gets at most one assigned shipment** at a time.
- **Driver cannot see other drivers, other shipments, the OTP code, or receiver's notifications.**

---

## 1. Environment & connection

| Item | Value |
|---|---|
| Production base URL | `https://www.app.tradekonekt.com` |
| Preview / dev base URL | `https://supply-chain-hub-189.preview.emergentagent.com` |
| API prefix | `/api` |
| Auth header | `Authorization: Bearer <access_token>` |
| Content type | `application/json` |
| CORS | wildcard `*` — no extra config |
| Token expiry | ~24 h; use refresh-on-401 pattern |

### 1.1 Test credentials (preview env)

```
Email:    adaeze.w0+26275@tradekonekt.io
Password: TradeKonekt2026!
Role:     driver
Driver entity_id: 0f40671e-6081-421f-99fe-36fe5da57dc7
Employer: Unilever Nigeria (manufacturer)
```

> To create more test drivers: POST /api/drivers with a manufacturer JWT (see `DRIVER_API_SPEC.md` §3). The response includes a one-shot `_initial_password` field (currently always `TradeKonekt2026!`).

### 1.2 Public docs API (for the mobile agent — no auth)

```
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs
GET .../api/public-docs/driver-mobile-brief
GET .../api/public-docs/driver-mobile-ux
GET .../api/public-docs/driver-functional
GET .../api/public-docs/driver-api-validation
GET .../api/public-docs/driver-api-spec
GET .../api/public-docs/otp-pod-architecture
GET .../api/public-docs/track-a-readiness
```

---

## 2. Authentication flow

### 2.1 Login

`POST /api/auth/login`  
**Body:** `{ "email": "...", "password": "..." }`  
**200:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "user": {
    "id": "...",
    "email": "...",
    "role": "driver",
    "entity_id": "0f40671e-...",
    "name": "Adaeze Ibe",
    "last_login_at": "..."
  }
}
```

**Reject any user whose `role != "driver"`** with a friendly "This app is for drivers."

### 2.2 Other auth endpoints

| Verb + Endpoint | Body | Notes |
|---|---|---|
| `POST /api/auth/refresh` | `{refresh_token}` | standard; use 401-interceptor pattern |
| `POST /api/auth/logout` | — | invalidates the session |
| `GET /api/auth/me` | — | returns the User account (not the Driver profile) |

> Use the existing `/api/auth/login` — there is **no** dedicated `/api/auth/driver/login` endpoint in Track A.

---

## 3. The 5 screens

| # | Screen | Primary endpoint(s) |
|---|---|---|
| 1 | Login | `POST /api/auth/login` |
| 2 | Today (home) | `GET /api/driver/me`, `GET /api/driver/shipments?status=delivered`, `GET /api/driver/shipments` |
| 3 | Active Trip | `GET /api/driver/shipments/{id}`, lifecycle POSTs |
| 4 | OTP Entry | `POST /api/shipments/{id}/deliver` |
| 5 | Profile / Settings | `GET /api/driver/me`, `PATCH /api/driver/me`, `/online`, `/offline` |

---

## 4. Screen-by-screen build spec

### 4.1 Screen — Login

| Element | data-testid | Behaviour |
|---|---|---|
| Email input | `driver-login-email` | autocapitalize off, keyboardType email |
| Password input | `driver-login-password` | secureTextEntry |
| Submit | `driver-login-submit` | POST /api/auth/login |
| Error banner | `driver-login-error` | render `detail` on 401/422 |

On success: persist tokens securely (Keychain / EncryptedSharedPreferences) and `user.entity_id` (= `driver_id`). Navigate to Today.

---

### 4.2 Screen — Today (home)

**Primary fetch on mount + on pull-to-refresh:**

1. `GET /api/driver/me`
2. `GET /api/driver/shipments?status=delivered` → today's completed (filter client-side: `delivered_at >= today_start`)
3. `GET /api/driver/shipments` (no filter) → upcoming + active

**Driver-me payload (live sample, abbreviated):**
```json
{
  "id": "0f40671e-...",
  "employee_number": "DRV-W0-26275",
  "first_name": "Adaeze", "last_name": "Ibe", "full_name": "Adaeze Ibe",
  "phone": "+2348039876543", "email": "adaeze.w0+...@tradekonekt.io",
  "licence_number": "FRSC-W0-001", "licence_class": "E",
  "employer_org_id": "b21c1dbe-...", "employer_org_type": "manufacturer",
  "home_warehouse_id": null,
  "status": "assigned",
  "assigned_vehicle_id": "324a2a7d-...",
  "assigned_shipment_id": "68607697-...",
  "user_id": "...",
  "invited_at": "...", "claimed_at": null, "last_login_at": "...",
  "deliveries_30d": 0, "on_time_pct_30d": null, "avg_pod_time_min": null,
  "last_seen_at": "...", "last_lat": 6.5244, "last_lng": 3.3792,
  "is_active": true,
  "created_at": "...", "updated_at": "...", "schema_version": 1
}
```

**Layout:**

```
┌─────────────────────────────────────┐
│ Adaeze Ibe          ● Assigned   ⋮  │  ← name + status pill + 3-dot menu
├─────────────────────────────────────┤
│                                     │
│ ┌─────────────── Active trip ────┐  │
│ │ SHP-AB12CD34                   │  │
│ │ → Apex Distributors (Apapa)    │  │
│ │ 240 units · 3 SKUs             │  │
│ │ ┌──────────────────────────┐   │  │
│ │ │   TAP TO LOAD            │   │  │  ← step-aware mega-button
│ │ └──────────────────────────┘   │  │
│ │ Decline this trip              │  │  ← small link (only on `assigned`)
│ └────────────────────────────────┘  │
│                                     │
│ Today's deliveries                  │
│ ─ SHP-XY-...  ✓ Delivered 11:42 AM  │
│ ─ SHP-ZW-...  ✓ Delivered  9:18 AM  │
│                                     │
└─────────────────────────────────────┘
```

#### 4.2.a Empty state (no `assigned_shipment_id`)

Card shows: "You don't have a trip yet. Sit tight." + last refresh time. Online/Offline pill remains tappable.

#### 4.2.b Status pill (top bar)

| `driver.status` | Pill colour | Pill text | Tappable? |
|---|---|---|---|
| `offline` | slate | Offline | yes → goes online (calls `POST /api/driver/me/online`) |
| `available` | emerald | Available | yes → confirms going offline |
| `assigned` | sky | Assigned | no (mid-trip — 409 if forced offline) |
| `on_trip` | amber | On trip | no (mid-trip) |

#### 4.2.c Step-aware mega-button

The same single button changes label + colour + endpoint based on `shipment.status`:

| Shipment status | Button label | Endpoint | Confirmation |
|---|---|---|---|
| `assigned` | **TAP TO LOAD** | `POST /api/shipments/{id}/load` | none (tap to confirm) |
| `loaded` | **TAP TO START TRIP** | `POST /api/shipments/{id}/start-trip` | **long-press (250ms)** to confirm |
| `in_transit` | **TAP WHEN ARRIVED** | `POST /api/shipments/{id}/arrive` | none |
| `arrived` | **ENTER DELIVERY CODE** | navigate to OTP Entry screen | none |

> Long-press required on start-trip + deliver to prevent accidental triggers when the phone is in a cradle.

---

### 4.3 Screen — Active Trip detail

Triggered by tapping the Active Trip card. Provides the "more info" view.

**Primary endpoint:** `GET /api/driver/shipments/{shipment_id}`

**Shipment payload (live sample, abbreviated; full keys in `DRIVER_WORKSPACE_FUNCTIONAL_SPEC.md` §5):**
```json
{
  "id": "68607697-...",
  "tracking_code": "SHP-AB12CD34",
  "from_role": "manufacturer", "from_id": "b21c1dbe-...",
  "to_role": "distributor", "to_id": "f9dfaf08-...",
  "items": [
    { "product_id": "...", "quantity": 25, "product_name": null, "sku": null }
  ],
  "total_units": 25, "total_value": null,
  "status": "assigned",
  "status_history": [
    { "from_status": null, "to_status": "created",            "at": "...", "by_role": "manufacturer" },
    { "from_status": "created", "to_status": "ready_for_dispatch", "at": "...", "by_role": "manufacturer" },
    { "from_status": "ready_for_dispatch", "to_status": "assigned",  "at": "...", "by_role": "manufacturer" }
  ],
  "ready_at": "...", "assigned_at": "...", "loaded_at": null,
  "dispatched_at": null, "arrived_at": null, "delivered_at": null,
  "delivery_code_expires_at": "...", "delivery_code_attempts": 0,
  "driver_id": "0f40671e-...", "vehicle_id": "324a2a7d-...",
  "origin_city": null, "destination_city": null,
  "eta_minutes": null, "notes": null
}
```

> ⚠️ `delivery_code` (bcrypt hash) is **never** returned to drivers. Only the receiver sees the clear-text 4-digit code, in their in-app notification.

**Sections (top → bottom):**
1. Header: tracking_code (large bold) + status chip
2. Counterparties: from_role org card + to_role org card (use `organizations` lookup or display ID truncated if name unavailable)
3. Items table (product_name or product_id · qty · unit_price)
4. ETA / lifecycle timestamps (ready_at, assigned_at, loaded_at, dispatched_at, arrived_at, delivered_at — show only ones that are set)
5. **Map preview** (P1) — single destination pin
6. Status timeline (rendered from `status_history[]`)
7. Sticky bottom mega-button (mirror of home card)
8. "Decline this trip" small link if status == `assigned`
9. "Issue / help" link → opens `tel:` to dispatcher phone (P1)

---

### 4.4 Screen — OTP Entry

Triggered when status is `arrived` and the user taps the mega-button.

**Layout:**
```
┌─────────────────────────────────────┐
│  ← DELIVERY VERIFICATION            │
├─────────────────────────────────────┤
│                                     │
│  Ask the receiver for their         │
│  4-digit delivery code              │
│                                     │
│        ┌─┐ ┌─┐ ┌─┐ ┌─┐              │
│        │_│ │_│ │_│ │_│              │
│                                     │
│  3 attempts remaining               │  ← only after first wrong code
│                                     │
│  [   VERIFY & DELIVER (long-press) ] │
│                                     │
│  ⓘ Code expires in 6 days, 22 hours  │  ← P1: countdown
└─────────────────────────────────────┘
```

**Behaviour:**
- 4 separate numeric inputs, 56×64dp, auto-advance focus on entry.
- Verify & Deliver button: disabled until 4 digits typed.
- Long-press (250ms) on the verify button before firing the API call.

**Endpoint:** `POST /api/shipments/{shipment_id}/deliver`  
**Body:** `{ "delivery_code": "4729" }`

**Server response handling:**

| Server response | UX action |
|---|---|
| `200 {status:"delivered"}` | full-screen success animation + haptic → return to Today (refresh) |
| `400 {code:"MALFORMED_CODE"}` | inline: "Code must be 4 digits" |
| `401 {code:"INVALID_CODE", attempts_remaining: N}` | shake inputs, clear, show "Wrong code. {N} tries left." |
| `401 {code:"INVALID_CODE", locked:true}` | banner: "Too many wrong codes. Locked until {unlock_at}." disable inputs |
| `423 {code:"LOCKED", unlock_at}` | banner: "Locked until {unlock_at}. Contact dispatcher." + `tel:` button |
| `410 "Delivery code expired"` | banner: "Code expired — ask dispatcher to regenerate." |
| `409 "Shipment already delivered"` | banner: "Already delivered." → refresh + pop back |
| `403 "Not the assigned driver"` | hard error — sign out, force re-login |

---

### 4.5 Screen — Profile / Settings

Reachable from the 3-dot menu in the top bar.

**Sections:**

1. Read-only identity:
   - Display name (full_name)
   - Employee number
   - Employer org name (lookup or "Your employer")
   - Licence class / number

2. Editable (one tap to edit):
   - Phone → `PATCH /api/driver/me` body `{phone}`
   - Email → `PATCH /api/driver/me` body `{email}`

3. Status toggle:
   - Online ↔ Offline → `POST /api/driver/me/online` / `POST /api/driver/me/offline`
   - 409 ("Cannot go offline mid-trip") → banner: "You're on a trip. Finish it first."

4. **Last 30 days summary (P1):**
   - Deliveries: `deliveries_30d` (currently always 0 — server aggregator P1; render as "—")
   - On-time %: `on_time_pct_30d`
   - Avg POD time: `avg_pod_time_min`

5. Sign out (calls `/api/auth/logout`, clears tokens, navigates to Login).
6. Version footer (e.g. "TradeKonekt Driver v0.1.0").

---

## 5. State machines

### 5.1 Driver state

```
offline ─login→ available ─assigned-to-shipment→ assigned ─start-trip→ on_trip
                  ▲                                                       │
                  └──────────────────deliver / cancel / reject────────────┘
```

| Transition | What triggers it | Returns driver to |
|---|---|---|
| offline → available | `POST /api/driver/me/online` | available |
| available → assigned | dispatcher `/assign` (driver doesn't initiate) | assigned |
| assigned → on_trip | `POST /api/shipments/{id}/start-trip` | on_trip |
| on_trip → available | `POST /api/shipments/{id}/deliver` (OTP-verified) OR dispatcher `/cancel` | available |
| assigned → available | `POST /api/driver/shipments/{id}/reject` | available |
| available → offline | `POST /api/driver/me/offline` | offline |

### 5.2 Shipment lifecycle (driver-facing only)

```
assigned ─load→ loaded ─start-trip→ in_transit ─arrive→ arrived ─deliver→ delivered
```

Cancellations are driven by the dispatcher and arrive as **server state changes** the mobile app discovers on the next poll. Show a banner: "This shipment was cancelled by your dispatcher."

---

## 6. UX system

- **Type:** Inter or system default. Tap-target text 18 sp. Mega-button text 22 sp **bold**.
- **Colors:** status pill — emerald (available) · sky (assigned) · amber (on_trip) · slate (offline). Mega-button rotates by step: sky → amber → emerald. Alert rose.
- **Density:** **looser than the other apps**. 24dp padding everywhere, not 16dp. Buttons ≥ 64dp tall.
- **Haptics:** medium on mega-button press, success haptic on OTP verify.
- **Pull-to-refresh** on Today + Active Trip.
- **Skeletons** (no spinners) for the first render.
- **Offline:** cache last `/driver/me` + `/driver/shipments` to disk. Show grey "Offline — last sync 2 min ago" pill at the top. OTP verification is online-only — show "Get online to verify the code."

---

## 7. Mandatory `data-testid` attributes

| Surface | testid |
|---|---|
| Login submit | `driver-login-submit` |
| Login email | `driver-login-email` |
| Login password | `driver-login-password` |
| Login error | `driver-login-error` |
| Top bar status pill | `driver-status-pill` |
| Top bar 3-dot menu | `driver-topbar-menu` |
| Active trip card | `driver-active-trip-card` |
| Mega-button (step-aware) | `driver-mega-button` (suffix step: `-load`, `-start`, `-arrive`, `-deliver`) |
| Decline trip link | `driver-decline-link` |
| Today's deliveries row | `driver-today-row-{shipment_id}` |
| OTP input box 0..3 | `driver-otp-digit-{0..3}` |
| OTP verify button | `driver-otp-verify` |
| OTP error banner | `driver-otp-error` |
| Profile open | `driver-profile-open` |
| Profile phone edit | `driver-profile-phone` |
| Profile email edit | `driver-profile-email` |
| Sign out button | `driver-sign-out` |

---

## 8. Error handling

| Code | Meaning | UX |
|---|---|---|
| 200 | OK | render |
| 401 | token expired | run refresh, retry; if refresh fails → force re-login |
| 403 (FORBIDDEN_ROLE) | wrong role tried a forbidden action | hard error — should never happen for a driver-only client |
| 403 (Not your shipment) | driver clicked stale link | refresh shipment list, pop back |
| 404 | shipment not found | refresh, show "This trip no longer exists" |
| 409 | wrong status / state | refresh to discover the new state and reflect it |
| 410 | OTP expired / shipment cancelled | banner + refresh |
| 422 | bad payload | inline validation from `detail[]` |
| 423 | OTP locked | lock the entry inputs, show unlock_at |
| 500/502 | server error | toast "Something went wrong — try again" + retry |

### 8.1 Driver-specific landmines

| Symptom | Why | Fix |
|---|---|---|
| Empty `GET /api/driver/shipments` | driver has never been assigned yet | show empty state — not an error |
| `GET /api/notifications` returns 403 | drivers are deliberately blocked from the notifications inbox (OTP isolation) | don't call it from the Driver app |
| `delivery_code` field missing from `GET /api/driver/shipments/{id}` | designed — only the receiver gets the clear-text code | render OTP-input UI without the code; the driver must ask the receiver |
| Driver tries to `/me/offline` mid-trip | 409 | show "Finish your current trip first" |
| Long-press not triggering on Android | RN GestureDetector quirk | use `onLongPress` with `delayLongPress={250}` |

---

## 9. P0 / P1 / P2 cut

### P0 — Ship in MVP (15)

Auth (2) · Today home (active trip card + today's deliveries) (2) · Active Trip detail screen (1) · Mega-button lifecycle (load/start/arrive/deliver) (4) · OTP Entry screen (1) · Decline-trip flow (1) · Profile + edit + sign-out (1) · Online/Offline toggle (1) · Long-press safety on terminal mutations (1) · Offline cache + pull-to-refresh (1).

### P1 — v1.1 (6)

GPS ping every 60s while on_trip · Map preview on Active Trip detail · 30-day KPIs on Profile · "Earlier this week" history · `tel:` to dispatcher · OTP expiry countdown.

### P2 — Defer / future (5)

Driver Notifications inbox · Photo POD · In-app chat · Earnings/tips · Multi-employer switcher.

### Out of scope completely

- Sabi Copilot, push notifications, photo / signature POD, payments / wallet, acceptance gating env flag.

---

## 10. Quick sanity test (run before shipping)

```bash
BASE=https://supply-chain-hub-189.preview.emergentagent.com
EMAIL=adaeze.w0+26275@tradekonekt.io
PASS=TradeKonekt2026!
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Each of these should return 200
for path in \
  "/api/auth/me" \
  "/api/driver/me" \
  "/api/driver/shipments"
do
  echo -n "GET $path  "
  curl -s -o /dev/null -w "%{http_code}\n" "$BASE$path" -H "Authorization: Bearer $TOKEN"
done

# Each of these should also return 200
for path in \
  "/api/driver/me/online" \
  "/api/driver/me/offline"
do
  echo -n "POST $path  "
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE$path" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
done
```

All 5 should print 200. If any prints something else, contact the backend team.

---

## 11. Companion docs (also reachable via /api/public-docs)

- `DRIVER_WORKSPACE_FUNCTIONAL_SPEC.md` — full functional inventory → `/api/public-docs/driver-functional`
- `DRIVER_MOBILE_UX_PLAN.md` — IA reasoning, P0/P1/P2 → `/api/public-docs/driver-mobile-ux`
- `driver_api_validation.md` — endpoint validation matrix → `/api/public-docs/driver-api-validation`
- `DRIVER_API_SPEC.md` — full API spec from Track A → `/api/public-docs/driver-api-spec`
- `OTP_POD_ARCHITECTURE.md` — OTP design → `/api/public-docs/otp-pod-architecture`
- `TRACK_A_READINESS_REPORT.md` — backend readiness gate → `/api/public-docs/track-a-readiness`

---

## 12. What to ask the user before starting

1. **Framework?** React Native + Expo? Flutter? Native iOS+Android? (Recommend Expo — fast iteration, OTA updates land within hours.)
2. **Brand assets** — TradeKonekt logo, splash, dark mode? (Default to light; dark mode P2.)
3. **Map provider** for the P1 map preview — Google Maps SDK or MapLibre?
4. **Beta channel** — TestFlight + Google Internal Track? Or Expo dev builds first?
5. **Push notifications** — defer to P2 (no backend support yet) or fold in now via Expo Notifications?

After those answers, build P0 in this order:

```
Auth → Today (active card + today's deliveries) → Active Trip detail
     → Mega-button /load → Mega-button /start-trip → Mega-button /arrive
     → OTP Entry → Decline-trip flow → Profile + Online/Offline → Plumbing
```

---

*End of brief.*
