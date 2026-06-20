# Driver Mobile UX Plan

**Plan date:** 2026-06-20  
**Inputs:** `DRIVER_WORKSPACE_FUNCTIONAL_SPEC.md` · `driver_api_validation.md` · `OTP_POD_ARCHITECTURE.md`  
**Stop point:** This document is an IA plan only. **Do NOT build UI yet.**

---

## 1. Why this app is fundamentally different from the others

| Aspect | Manufacturer | Distributor | Wholesaler | Retailer | **Driver (this app)** |
|---|---|---|---|---|---|
| Persona | Executive / ops mgr | Ops manager | Warehouse manager | Counter clerk | **On-the-road individual** |
| Hands free? | seated, both hands | depot floor, hands often busy | warehouse floor | counter, both hands | **steering wheel, sun glare, gloves** |
| Session length | minutes | minutes | quick check-ins | continuous | **30-second bursts at depot / arrival / handover** |
| Network reliability | good (office wifi) | mixed | mixed | counter wifi | **flaky — 3G/4G, dead zones** |
| Decisions per session | many | many | few | very few | **literally 1: "tap to mark step done"** |
| Mistakes cost | wrong analytics | wrong dispatch | wrong inventory | wrong POS | **wrong inventory + delivery + driver state** |
| Onboarding | minutes | minutes | minutes | seconds | **must work the day the truck is handed over** |

**Implication:** the Driver app is **the simplest of the four** — a sequence of giant buttons, big text, optimistic UI, and aggressive offline tolerance. No tabs. No dashboards. No KPIs that need explanation.

---

## 2. Information Architecture

### 2.1 No bottom tabs

```
┌─────────────────────────────────────┐
│  Adaeze Ibe                  online │  ← top bar: name + online/offline pill
├─────────────────────────────────────┤
│                                     │
│       ACTIVE TRIP CARD              │  ← the ONE big thing
│   ┌─────────────────────────┐       │
│   │ SHP-AB12CD34            │       │
│   │ → Apex Distributors      │       │
│   │   (Apapa, Lagos)         │       │
│   │ 240 units · 3 SKUs       │       │
│   │ [   START LOADING   ]    │       │  ← step-aware mega-button
│   └─────────────────────────┘       │
│                                     │
│  Today's other trips                 │
│  ─ SHP-XY-… → Royal Trading   queued│
│  ─ SHP-ZW-… → KingsWay         queued│
│                                     │
│                       ⓘ Profile     │
└─────────────────────────────────────┘
```

> Single screen ("Today"). All actions are on it. No nav drawer for MVP.

### 2.2 Screens (5 total)

| # | Screen | Trigger |
|---|---|---|
| 1 | **Login** | first launch / signed out |
| 2 | **Today** | post-login home |
| 3 | **Active Trip** | tap on the active trip card |
| 4 | **OTP Entry** | tap "Mark Delivered" |
| 5 | **Profile / Settings** | tap "Profile" link |

That's it. **5 screens. No more.**

---

## 3. Screen-by-screen IA

### 3.1 Login

| Element | data-testid | Behaviour |
|---|---|---|
| Email input | `driver-login-email` | autofocus, keyboardType=email |
| Password input | `driver-login-password` | secureTextEntry |
| Submit | `driver-login-submit` | `POST /api/auth/login` |
| Error banner | `driver-login-error` | 401/422 from server |

Reject any user whose returned `role != "driver"` with a friendly "This app is for drivers. Please use the main TradeKonekt app."

### 3.2 Today (home)

**Layout (top → bottom):**

```
[Top bar]  Driver name + status pill (Available / Assigned / On Trip / Offline)
           Right side: 3-dot menu (Profile, Sign out)

[Hero card]  if driver.assigned_shipment_id:
               ACTIVE TRIP CARD — see §3.2.a
             else:
               EMPTY STATE — "You don't have a trip yet. Sit tight."

[Section]   "Today's deliveries"  — completed trips today, max 5

[Section]   "Earlier this week"  — completed trips last 7 days, max 3 (P1)

[Bottom]    Profile link
```

#### 3.2.a Active Trip card (the centrepiece)

**Always shows:**
- Tracking code (large, bold)
- Destination org name + city (2 lines)
- Items summary: `240 units · 3 SKUs`
- ETA chip if `shipment.eta_minutes` is set

**Bottom of card — a single status-aware mega-button:**

| Shipment status | Button label | API |
|---|---|---|
| `assigned` | **TAP TO LOAD** | `POST /shipments/{id}/load` |
| `loaded` | **TAP TO START TRIP** | `POST /shipments/{id}/start-trip` |
| `in_transit` | **TAP WHEN ARRIVED** | `POST /shipments/{id}/arrive` |
| `arrived` | **ENTER DELIVERY CODE** | → opens OTP Entry screen |

**Secondary action (small text link below):**
- when `assigned`: **"Decline this trip"** → `/reject` flow
- when `loaded` / `in_transit`: **"Issue / help"** → opens contact dispatcher (P1: in-app chat, P0: `tel:` link to dispatcher_phone if available)

> **One button. One job. Always.** No tabs, no toggles, no extra screens until OTP entry.

### 3.3 Active Trip detail screen

Triggered by tapping the Active Trip card. Provides the "more info" view that the home card cannot afford:

- Full items table (product · qty · unit_price)
- Pickup point (from_role org name + address if available)
- Drop-off point (to_role org name + address)
- ETA + map preview (P1 — uses platform map widget with a single pin)
- Status history timeline (rendered from `status_history[]`)
- Same mega-button at the bottom (mirror of home card)

### 3.4 OTP Entry screen

```
┌─────────────────────────────────────┐
│  ←      DELIVERY VERIFICATION       │
├─────────────────────────────────────┤
│                                     │
│  Ask the receiver for their         │
│  4-digit delivery code              │
│                                     │
│        ┌─┐ ┌─┐ ┌─┐ ┌─┐              │  ← 4 big numeric boxes
│        │_│ │_│ │_│ │_│              │
│                                     │
│   3 attempts remaining               │  ← only shown after first wrong code
│                                     │
│   [       VERIFY & DELIVER     ]    │  ← disabled until 4 digits entered
│                                     │
│                                     │
│  ⓘ Code expires in 6 days, 22 hours  │
└─────────────────────────────────────┘
```

- 4 separate numeric inputs; auto-advance focus.
- Verify button enabled only when 4 digits typed.
- On 401: shake the inputs, clear them, show `attempts_remaining` count.
- On 423 (locked): show "Locked until {unlock_at} — please contact dispatcher" banner with a `tel:` button.
- On 200: full-screen success animation → return to Today.

### 3.5 Profile / Settings

Lightweight:

- Display name + employee number
- Phone (editable via `PATCH /driver/me`)
- Email (editable)
- Online/Offline toggle (`/me/online` / `/me/offline`)
- Last 30 days summary (`deliveries_30d`, `on_time_pct_30d`, `avg_pod_time_min`) — show "—" if null
- Sign out
- Version footer

---

## 4. Interaction patterns

### 4.1 Big buttons, big touch targets

- All primary buttons: full-width, 64dp min-height.
- Status pill in top bar: also a button (taps toggle online/offline if allowed).
- OTP digit inputs: 56dp × 64dp each.

### 4.2 Optimistic UI everywhere

- Tap "TAP TO LOAD" → button flips to "TAP TO START TRIP" immediately. If server returns 4xx → toast + revert.
- Tap "Decline" → trip card vanishes immediately. If server says no → toast + restore.

### 4.3 Offline tolerance

- Cache last `GET /driver/me` and `GET /driver/shipments` to disk.
- On reconnect, retry queued mutations in order. If any mutation conflicts with a fresh server state (e.g. dispatcher cancelled while driver was offline) → show "Shipment was cancelled while you were offline" and refresh.
- **OTP verification is online-only.** Show a banner if no network: "Get online to verify the code."

### 4.4 GPS background pings (P1, optional)

- When `driver.status == "on_trip"`, poll `/driver/me/location` every 60s.
- When `available` / `offline` → no pings.
- Permission UX: ask once with a clear explainer ("So dispatcher can see where the truck is").

### 4.5 Big-button safety: tap-and-hold for terminal actions

- "TAP TO START TRIP" and "ENTER DELIVERY CODE" buttons require a 250ms long-press (not a tap) — prevents accidental triggers when phone is in a cradle bouncing on the dashboard.

### 4.6 Reject-shipment flow

Triggered by "Decline this trip" small link on the Active Trip card while status is `assigned`:

```
┌─────────────────────────────────────┐
│  DECLINE TRIP                       │
├─────────────────────────────────────┤
│ Why are you declining?              │
│  ◯ Vehicle issue                    │
│  ◯ Personal emergency               │
│  ◯ Already on another trip          │
│  ◯ Other                            │
│ [Note (optional)]                   │
│                                     │
│         [CANCEL]   [DECLINE]        │
└─────────────────────────────────────┘
```

Calls `POST /api/driver/shipments/{id}/reject {reason, notes}`.

---

## 5. Visual system

- **Type:** Inter or system default. Tap-target text 18 sp. Mega-button text 22 sp **bold**.
- **Color:**
  - status pill: emerald = available, sky = assigned, amber = on_trip, slate = offline
  - mega-button: rotates by step (sky → amber → emerald)
  - alerts (deviation, breakdown): rose
- **Density:** way looser than the other apps. 24dp padding everywhere, not 16dp.
- **Animations:**
  - mega-button "success" press → tactile haptic + 200ms scale-up + colour transition
  - card swap → 250ms slide
  - OTP success → confetti + success tone (only one in the entire app)

---

## 6. P0 / P1 / P2 cut

### P0 — Must ship in MVP (production-ready) — **15 items**

1. Login + sign-out (2)
2. Today home screen (active trip + today's deliveries) (2)
3. Active Trip card with state-aware mega-button (1)
4. Active Trip detail screen (1)
5. Mega-button → /load (1)
6. Mega-button → /start-trip (1)
7. Mega-button → /arrive (1)
8. OTP Entry screen + /deliver (1)
9. Decline trip flow (`/reject` with reason) (1)
10. Profile screen (read + edit phone/email) (1)
11. Online / Offline toggle (1)
12. Push-to-refresh + offline cache (1)
13. Sign out (already in #1 — counted there)
14. Tap-and-hold safety on terminal mega-buttons (1)
15. Reject-shipment reason picker (already in #9 — counted there)

### P1 — Ship in v1.1 — **6 items**

16. GPS ping every 60s while `on_trip` (`POST /driver/me/location`)
17. Map preview on Active Trip detail (single destination pin)
18. Last-30-days KPIs on Profile (`deliveries_30d`, `on_time_pct_30d`)
19. "Earlier this week" section on Today
20. Tel: link to dispatcher's phone (if `dispatched_by_user_id`'s phone is exposed)
21. Code-expiry countdown on OTP Entry screen

### P2 — Defer / future — **5 items**

22. Driver Notifications inbox (needs new `/api/driver/notifications` endpoint)
23. Photo POD (only if business adds it — OTP is the canonical proof)
24. In-app chat with dispatcher
25. Per-trip earnings + tip (needs payments backend)
26. Multi-employer switcher (one employer per driver in Track A)

### Out of scope completely (backend does not exist)

- Sabi Copilot for drivers (`/api/driver/{id}/assistant` 404)
- Push notifications + preferences
- Photo / signature POD
- Payments / driver wallet / tips
- Acceptance gating (`DRIVER_ACCEPT_REQUIRED=true`)

---

## 7. Answer to W0

> **What are the 12–15 P0 features required for a production-ready Driver mobile app?**

The **15 P0 items** above. They fall into 5 clusters:

| Cluster | P0 count |
|---|---|
| Auth & Session | 2 |
| Today + Active Trip | 5 |
| Lifecycle mutations (load / start / arrive) | 3 |
| OTP delivery | 2 |
| Profile + plumbing (offline / safety taps / reject) | 3 |

**Hard constraints that fall out of the audit:**

- **OTP is the only POD** — no photo / signature in MVP.
- **Single shipment at a time** — driver has at most one `assigned_shipment_id`.
- **No notifications inbox in MVP** — the driver pulls from `/driver/shipments`; the receiver is the one who gets the OTP notification.
- **No Sabi, no voice, no chat** — none of those endpoints exist for drivers.
- **GPS pings are P1 (optional)** — the simulator handles vehicle motion today; real telematics is post-MVP.

---

## 8. Stop point

Discovery is complete. **No UI built.** Next step: design review of this IA plan, followed by hi-fi mocks for the 5 screens (Login, Today, Active Trip, OTP, Profile).

**Sign-off needed on:**
1. **No-tab IA** (single "Today" home, screens as needed)
2. **Single state-aware mega-button** drives the entire lifecycle
3. **OTP entry as a dedicated screen** (not inline on Active Trip)
4. **Tap-and-hold safety** on terminal mega-buttons (start-trip, deliver)
5. **P0/P1/P2 cut** (15 / 6 / 5)
6. Out-of-scope confirmations (Sabi, push, photo POD, payments)

*End of plan.*
