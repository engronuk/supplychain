# TradeKonekt Wholesaler Mobile App — Build Brief for Mobile Agent

> One self-contained document. Paste this entire file to the mobile agent.  
> Source-of-truth specs: `WHOLESALER_WORKSPACE_FUNCTIONAL_SPEC.md`, `WHOLESALER_MOBILE_UX_PLAN.md`, `wholesaler_api_validation.md`.

---

## 0. TL;DR for the mobile agent

You are building the **TradeKonekt Wholesaler mobile app** — a native (or React-Native / Flutter) mobile experience for an existing live backend. **Do not invent new backend functionality.** Every screen below is driven by an endpoint that already returns 200.

- Primary persona: **Wholesaler ops manager** (hub-level), who approves retailer orders, runs picking/packing/dispatch, and tracks outbound trucks.
- 5 bottom tabs · 22 P0 features for MVP.
- Sabi Copilot is **not** available for wholesalers yet — don't show a Sabi UI.
- Push notifications are **not** wired yet — use in-app bell only.

---

## 1. Environment & connection

| Item | Value |
|---|---|
| Production base URL | `https://www.app.tradekonekt.com` |
| Preview / dev base URL | `https://supply-chain-hub-189.preview.emergentagent.com` |
| API prefix | `/api` (e.g. `https://www.app.tradekonekt.com/api/auth/login`) |
| Auth header | `Authorization: Bearer <access_token>` |
| Content type | `application/json` |
| CORS | wildcard `*` — no extra config needed |
| Token expiry | ~24 h; use refresh-on-401 pattern |

### 1.1 Test credentials (use for QA only)

```
Email:    mfr-0001-who-0001@tradekonekt.io
Password: TradeKonekt2026!
Wholesaler entity_id: 6458308e-3b90-283c-f156-1a385cc22dd1
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
    "role": "wholesaler",
    "entity_id": "6458308e-3b90-283c-f156-1a385cc22dd1",
    "name": "...",
    "last_login_at": "2026-06-19T...Z"
  }
}
```

### 2.2 Read self

`GET /api/auth/me` → returns the same `user` shape as above.

### 2.3 Refresh token

`POST /api/auth/refresh` — Body `{ "refresh_token": "..." }` → new `access_token`.  
**Pattern:** axios interceptor — on 401 once, call refresh, retry original request.

### 2.4 Sign out

`POST /api/auth/logout` — Header `Authorization: Bearer <access_token>`.

### 2.5 Forgot / reset password

- `POST /api/auth/forgot-password` — Body `{ "email": "..." }`
- `POST /api/auth/reset-password` — Body `{ "token": "...", "new_password": "..." }`

---

## 3. The 5 bottom tabs

| # | Tab | Icon | Primary endpoint(s) |
|---|---|---|---|
| 1 | **Home** | LayoutDashboard | `/wholesaler/{wid}/overview` |
| 2 | **Orders** | ClipboardList | `/wholesaler/{wid}/orders/dashboard`, `/wholesaler/{wid}/customer-orders`, `/wholesaler/{wid}/fulfillments` |
| 3 | **Inventory** | Boxes | `/wholesaler/{wid}/inventory`, `/wholesaler/{wid}/inventory/movements` |
| 4 | **Shipments** | Truck | `/wholesaler/{wid}/shipments/dashboard`, `/wholesaler/{wid}/shipments` |
| 5 | **More** | Menu | navigates to: Procurement, Retailers, Analytics, Intelligence, Reports, Notifications, Profile |

A floating **bell icon** on every screen surfaces notifications.

---

## 4. Screen-by-screen build spec (P0)

### 4.1 Screen — **Login**

| Element | Behaviour |
|---|---|
| Email input | `data-testid="login-email"` · keyboardType email · autocapitalize off |
| Password input | `data-testid="login-password"` · secureTextEntry |
| Submit button | `data-testid="login-submit"` → `POST /api/auth/login` |
| Forgot password link | navigates to forgot-password screen |
| Error banner | Show on 401 / 422 with server `detail` |

On success: persist `access_token` + `refresh_token` securely (Keychain / EncryptedSharedPreferences) and `user.entity_id` (= `wid`). Navigate to Home.

---

### 4.2 Screen — **Home (Dashboard)**

**Endpoint:** `GET /api/wholesaler/{wid}/overview`

**Response shape (live sample):**
```json
{
  "wholesaler": { "name": "...", "region": "...", "city": "..." },
  "kpis": {
    "inventory_value":    { "value": 39389850.0 },
    "inventory_units":    { "value": 15276 },
    "pending_pos":        { "value": 0 },
    "incoming_shipments": { "value": 0 },
    "outgoing_shipments": { "value": 3 },
    "active_distributors":{ "value": 4 },
    "active_retailers":   { "value": 4 },
    "inventory_turnover": { "value": 0.15 },
    "stockout_risks":     { "value": 0 }
  },
  "inventory_health": {
    "in_stock": 10, "low_stock": 0, "excess_stock": 6,
    "expiring": 0, "total_skus": 10, "health_score": 100.0
  },
  "ai_insights": [
    { "type":"inventory","title":"Inventory rebalance","body":"...","tone":"warning" }
  ],
  "stockout_risks": [
    { "product_id":"...", "product_name":"...", "sku":"...",
      "on_hand": 12, "reorder_level": 50, "days_remaining": 1,
      "severity": "critical" }
  ],
  "as_of": "2026-06-19T15:24:00Z"
}
```

**Layout (above the fold):**

1. Top app-bar: `Royal Trade Partners · Port Harcourt` + bell badge.
2. **Hero row** — 3 stat tiles:
   - Inventory Value `fmtCurrency(kpis.inventory_value.value)`
   - Active Retailers `kpis.active_retailers.value` (fallback `active_distributors`)
   - Turnover `${kpis.inventory_turnover.value}×`
3. **Action chip** — "{kpis.pending_pos.value} orders awaiting approval" → tap deep-links to Orders tab with status=submitted (only show if value > 0).
4. **Quick action row** — two pill buttons:
   - **Receive Stock** → opens Receive Stock modal (see §4.5)
   - **Dispatch Truck** → opens Orders tab segmented to Pipeline filtered `status=ready_for_dispatch`

**Below the fold:**

5. **Stockout Watchlist card** (`stockout_risks[]`, first 5). Row: product name · `on_hand` left · severity chip (`out`=red, `critical`=amber, `low`=yellow). Tap → Inventory tab filtered to that SKU.
6. **Today's Pipeline** — horizontal scroll of stage chips: `Submitted N · Approved N · Picking N · Packing N · Dispatched N · Delivered N`. Source: `/wholesaler/{wid}/orders/dashboard.funnel`. Tap a chip → Orders tab Pipeline filtered to that stage.
7. **Incoming + Outgoing shipments** — two small cards: `kpis.incoming_shipments.value` and `kpis.outgoing_shipments.value`. Tap → Shipments tab.
8. **AI Insights** — up to 3 `ai_insights[]` rendered as colour-coded ToneCards (tone: `positive` emerald, `warning` amber, `alert` rose, `info` slate).

**Pull-to-refresh:** re-fetch overview.

---

### 4.3 Screen — **Orders (Inbox)**

Segmented control at the top: **`[ Inbox ]   [ Pipeline ]`**.

#### 4.3.a Inbox tab content

**Endpoint:** `GET /api/wholesaler/{wid}/customer-orders`

**Response (flat list):**
```json
[
  {
    "id": "14879f88-ad82-4aa5-bba7-587750a46c79",
    "source": "purchase_orders",
    "order_number": "PO-2026-00004",
    "status": "submitted",            // submitted|approved|allocated|picking|...|delivered|rejected|cancelled
    "customer_type": "retailer",
    "customer": {
      "id": "...", "name": "Family Shop 1",
      "region": "Lagos", "city": "Ikeja", "type": "retailer"
    },
    "items": [
      { "product_id":"...", "quantity":5, "unit_cost":2200.0,
        "line_total":11000.0, "product_name":"...", "sku":"..." }
    ],
    "total_amount": 11000.0,
    "created_at": "...", "expected_delivery": "...",
    "priority": "normal"
  }
]
```

**UI:**
- Status filter chips: `All · Submitted · Approved · In Fulfillment · Shipped · Delivered · Rejected/Cancelled`
- Search bar: matches `order_number`, `customer.name`, item product names (client-side)
- Each row card:
  - Top: `order_number` + status chip
  - Middle: customer name · city · `fmtCurrency(total_amount)`
  - Bottom: relative time + item count
- **Swipe gestures:**
  - Right → **Approve** (`POST .../orders/{id}/approve`)
  - Left → opens reject sheet with `reason` textarea (`POST .../orders/{id}/reject` body `{reason}`)
- Tap row → Order Detail (see §4.3.c)
- FAB (multi-select mode) — P1.

#### 4.3.b Pipeline tab content

**Endpoint:** `GET /api/wholesaler/{wid}/fulfillments`

**Stages (in order):** `allocated → picking → picked → packing → packed → ready_for_dispatch → dispatched → delivered`

**UI:**
- Stage filter chips (all 8 stages + All)
- Group rows by current stage; section headers
- Row: `order_number` · customer · stage chip · item count
- Tap row → Fulfillment Detail (see §4.3.d)

#### 4.3.c Order Detail screen

**Endpoint:** `GET /api/wholesaler/{wid}/orders/{order_id}`

**Sections:**
- Header: order_number, status, customer block, expected delivery
- Items list table: product · qty · unit_price · subtotal
- Status history timeline
- Notes / instructions
- **Action bar (sticky bottom)** — buttons shown only when status allows:

| Status | Buttons shown |
|---|---|
| `submitted` | Approve · Reject · Modify · Cancel |
| `approved` | Modify · Cancel |
| `allocated` | Cancel |
| `picking`/`picked`/`packing`/`packed`/`ready_for_dispatch` | (read-only — use Pipeline detail) |
| `shipped` | (read-only) |

All buttons hit `POST /api/wholesaler/{wid}/orders/{order_id}/{action}`:

| Action | Endpoint | Body |
|---|---|---|
| approve | `POST .../approve` | `{}` |
| reject  | `POST .../reject`  | `{"reason":"<text>"}` |
| modify  | `POST .../modify`  | `{"items":[{product_id, quantity, unit_price?}]}` |
| cancel  | `POST .../cancel`  | `{"reason":"<text>"}` |

#### 4.3.d Fulfillment Detail screen

**Endpoint:** `GET /api/wholesaler/{wid}/fulfillments/{ful_id}`

**Sections:**
- Header: linked order_number, current stage, customer
- Pick list table: product · qty requested · qty picked
- Pack list (when picked)
- Status history timeline
- **Action bar (sticky bottom)** — single-button "advance to next stage", label changes by current stage:

| Current stage | Action button | Endpoint |
|---|---|---|
| `allocated` | "Start Picking" | `POST .../start-picking` |
| `picking` | "Complete Picking" | `POST .../complete-picking` |
| `picked` | "Start Packing" | `POST .../start-packing` |
| `packing` | "Complete Packing" | `POST .../complete-packing` |
| `packed` | "Ready for Dispatch" | `POST .../ready-dispatch` |
| `ready_for_dispatch` | "Dispatch Truck" | opens Dispatch sheet (see below) |
| `dispatched` / `delivered` | (none — read-only) | |

**Dispatch sheet (modal):**
- Vehicle code (text, optional)
- Driver name (text, optional)
- ETA (datetime picker, optional)
- Notes (textarea)
- Submit → `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/dispatch` body `{vehicle_code?, driver?, eta?, notes?}`

**Report Shortage (P1):** secondary action when status is `picking`/`picked` → opens sheet, item-by-item delta input → `POST .../report-shortage` body `{items:[{product_id, missing_qty}], notes}`.

---

### 4.4 Screen — **Inventory (Catalogue)**

**Endpoint:** `GET /api/wholesaler/{wid}/inventory`

**Response:**
```json
{
  "wholesaler_id": "...",
  "rows": [
    {
      "product_id":"...", "product_name":"...", "sku":"...",
      "available": 1200, "reserved": 100, "damaged": 0, "in_transit": 500,
      "reorder_level": 200, "unit_value": 250.0, "total_value": 300000.0,
      "health": "healthy"
    }
  ],
  "summary": {
    "total_skus": 10, "total_value": 39389850.0,
    "total_units": 15276, "low_stock": 0, "out_of_stock": 0, "excess": 6
  }
}
```

> ⚠️ Note: the API returns `rows`, not `items` — important.

**UI:**

- **KPI strip (top)** — 4 mini-tiles from `summary`:
  Total SKUs · Total Value · Total Units · At-Risk (`low_stock + out_of_stock`)
- **Tab switcher:** `[ Catalogue ]   [ Movements ]`
- **Search bar:** matches `product_name + sku`
- **Health filter chips:** `All · Healthy · Low · Out · Excess`
- **Row card:** product name + SKU · `available` units · health chip (`healthy` emerald, `low` amber, `out` rose, `excess` slate)
- **Row swipe right** → opens Adjust modal (see §4.5)
- **Tap row** → opens a bottom sheet with two big buttons: **Adjust Stock** · **Cycle Count**
- **FAB (+)** → **Receive Stock** modal

**Movements tab content:**

**Endpoint:** `GET /api/wholesaler/{wid}/inventory/movements?limit=30`

```json
[
  { "id":"...", "created_at":"...", "product_name":"...",
    "kind":"po_receive|manual_adjust|cycle_count|customer_dispatch|...",
    "delta": 200, "reference":"WPO-2026-00001", "notes":"..." }
]
```

UI: vertical list, no actions; kind shown as a colour pill.

---

### 4.5 Modals — Inventory mutations

#### Receive Stock modal

**Endpoint:** `POST /api/wholesaler/{wid}/inventory/receive`

**Fields:**
| Field | Required | Notes |
|---|---|---|
| Product picker | yes | searchable list of SKUs |
| Quantity | yes | positive int |
| Source | yes | dropdown: `purchase_order · return · transfer · other` |
| Reference | optional | PO number / waybill code |
| Notes | optional | textarea |

**Body:** `{ product_id, quantity, source, reference, notes }`

#### Adjust Stock modal

**Endpoint:** `POST /api/wholesaler/{wid}/inventory/{product_id}/adjust`

**Fields:**
- Delta (signed integer with +/− toggle) — required
- Reason (dropdown: `damage · loss · expiry · correction · other`) — required
- Notes — optional

**Body:** `{ delta, reason, notes }`

#### Cycle Count modal (P1)

`POST /api/wholesaler/{wid}/inventory/{product_id}/cycle-count` — body `{ counted, notes }`.

All three modals should show optimistic UI (close instantly, toast on success, rollback on error).

---

### 4.6 Screen — **Shipments**

#### List

**Endpoint:** `GET /api/wholesaler/{wid}/shipments/dashboard`

```json
{
  "kpis": {
    "active_shipments": 5,
    "delivered_today": 2,
    "delayed_shipments": 1,
    "pending_dispatch": 3,
    "avg_delivery_hours": 14.2
  },
  "as_of": "..."
}
```

**Endpoint:** `GET /api/wholesaler/{wid}/shipments?status=&limit=`

Each row:
```json
{
  "id":"...", "tracking_code":"WPO-2026-00003-SHP",
  "status":"in_transit",        // created|loaded|in_transit|delivered|delayed|cancelled|failed
  "order_number":"WPO-2026-00003",
  "retailer": { "id":"...", "name":"...", "city":"..." },
  "vehicle": { "code":"VAN-LA-001", "driver":"Tunde" },
  "eta": "2026-06-19T18:30:00Z",
  "current_position": { "lat": 6.52, "lng": 3.38 },
  "created_at":"..."
}
```

**UI:**
- 4-tile KPI strip from `kpis`
- Status filter chips `All · Created · Loaded · In Transit · Delivered · Delayed · Cancelled`
- Row card: tracking_code + status chip · retailer name + city · ETA relative · vehicle code
- Tap row → Shipment Detail
- FAB → search by tracking code (jump to detail)

#### Shipment Detail

**Endpoint:** `GET /api/wholesaler/{wid}/shipments/{ship_id}`

**Sections:**
- Header: tracking_code, status chip, ETA countdown
- Retailer block
- Vehicle card: code, driver, current speed (if provided)
- **Map (only on this screen)**: render `current_position` and `route_steps[]` if present. Use any free tile provider; this is the only map in the MVP.
- Items list
- Status history timeline
- **Actions (sticky bottom):**
  - `Delay` (P1) → sheet: `reason` textarea + `new_eta` picker → `POST .../shipments/{ship_id}/delay`
  - `Cancel` (P1) → confirm dialog → `POST .../shipments/{ship_id}/cancel`

---

### 4.7 Screen — **Retailers (More → Retailers)**

**Endpoint:** `GET /api/wholesaler/{wid}/distributors`

**Response (legacy `distributors` key — payload is retailer-tier):**
```json
{
  "wholesaler_id":"...", "region":"Lagos",
  "totals": { "distributor_count":2, "active_distributors":2, "total_revenue_90d":0.0 },
  "distributors": [
    { "id":"...", "name":"Apex Distributors (Apapa)",
      "code":"MFR-0001-DST-0001", "region":"Lagos", "city":"Ikeja",
      "inventory_health":100.0, "inventory_skus":11,
      "purchase_frequency_90d":205, "revenue_90d":0.0 }
  ]
}
```

> Map this key in your mobile model to `retailers[]`; the array is the retailer roster — the field name is just legacy.

**UI:**
- KPI strip: Retailers count · Active (90d) · Total Revenue 90d
- Search bar (matches name + code + city)
- Row card: retailer name · code · city · `purchase_frequency_90d` orders / 90d · health chip
- Tap → Retailer Detail

**Retailer Detail endpoint:** `GET /api/wholesaler/{wid}/distributors/{retailer_id}/detail`  
Shows 90-day KPIs, trend line, recent orders.

---

### 4.8 Screen — **More menu**

Static list:
| Item | Navigates to |
|---|---|
| Procurement | `/procurement` (P1) |
| Retailers | §4.7 |
| Analytics | §4.9 (P1) |
| Intelligence Center | §4.10 (P1) |
| Reports | CSV downloads (P2) |
| Notifications | §4.11 |
| Profile | read-only entity card + Sign out button |

---

### 4.9 Screen — **Analytics (More → Analytics)** — P1

**Single fat endpoint:** `GET /api/wholesaler/{wid}/analytics`

The web has 7 tabs. On mobile, render **4 collapsible sections** instead:
1. **Overview** — 4 KPIs (Revenue 30d · Fill Rate · Turnover · Active Retailers) + 90-day order Area trend.
2. **Inventory** — Days of Supply tile + Top-Value SKUs list + Slow Movers list.
3. **Retailers** — Top by revenue + Churn risk list.
4. **Demand Forecast** — list of SKUs with forecast_30d_units + suggested reorder.

**Do NOT** render the Control Tower map tab on mobile — keep on web (P2).

---

### 4.10 Screen — **Intelligence Center (More → Intelligence)** — P1

**Endpoint:** `GET /api/wholesaler/{wid}/analytics` → read `intelligence.*`

```json
{
  "intelligence": {
    "snapshot": {
      "total_revenue_90d": 0,
      "projected_revenue_30d": 0,
      "urgent_replenishments": 0,
      "high_churn": 0
    },
    "headlines": [ "Replenishment in motion: 2 purchase orders inbound..." ],
    "opportunities": [ { "title":"...","body":"...","tone":"positive" } ],
    "risks": [ { "title":"...","body":"...","tone":"warning" } ],
    "actions": [ { "title":"...","body":"...","tone":"info" } ]
  }
}
```

**Sections:** 4 KPI cards + Executive Briefing (headlines bullets) + Opportunities list + Risks list + Recommended Actions list. **No acknowledge action** today — read-only.

---

### 4.11 Screen — **Notifications**

**List:** `GET /api/notifications?target_type=wholesaler&target_id={wid}&limit=20`

```json
[
  {
    "id":"...","target_type":"wholesaler","target_id":"...",
    "title":"Shipment WPO-2026-00003 delivered",
    "message":"1,129 units · shipment WPO-2026-00003",
    "type":"delivery|order|stockout|delay|intel",
    "severity":"info|warning|critical",
    "read":false,
    "created_at":"2026-06-15T15:31:03Z"
  }
]
```

**Mark one read:** `PATCH /api/notifications/{notif_id}/read`  
**Mark all read:** `PATCH /api/notifications/read-all`

**UI:**
- Top app-bar button "Mark all read"
- Row: type icon + title + message + relative time
- Swipe → mark read
- Long-press → no-op (no preferences yet)
- Empty state: "All caught up"

---

## 5. State machines (for state-aware UI)

### Customer Order

```
submitted ─approve→ approved ─(auto)→ allocated ─start-picking→ picking
        │                                  │                   ─complete-picking→ picked
        ├─reject→ rejected (terminal)      │                                       ─start-packing→ packing
        ├─cancel→ cancelled (terminal)     │                                                       ─complete-packing→ packed
                                                                                                                       ─ready-dispatch→ ready_for_dispatch
                                                                                                                                       ─dispatch→ shipped → delivered
```

### Shipment

```
created → loaded → in_transit → delivered
                            ↳ delayed
                            ↳ cancelled (any pre-delivered)
                            ↳ failed
```

### Inventory health buckets

`healthy` (available ≥ reorder_level × 2) · `low` (available < reorder_level) · `out` (available ≤ 0) · `excess` (available > reorder_level × 4) · `expiring` (server-flagged).

---

## 6. UX system (lift directly from the web)

- **Typography:** Inter (system fallback). H1 18 sp, H2 16, body 14, caption 12.
- **Colors (tones):**  
  - positive `#16A34A` · warning `#D97706` · alert `#E11D48` · info `#64748B` · violet `#8B5CF6` · sky `#0EA5E9`.
- **Spacing:** 4-pt grid · cards 12-radius · screen padding 16.
- **Number formatters:**
  - `fmtCurrency(n)` → `₦` + grouped (e.g. `₦39,389,850`)
  - `fmtNumber(n)` → grouped integer
  - Health chip: emerald/amber/rose pill, no border.
- **Skeleton loaders** (no spinners) — 3 placeholder rows per list.
- **Pull-to-refresh** on every list.
- **Offline:** show last cached body + grey "Showing cached data" pill at the top.

---

## 7. Mandatory `data-testid` attributes

Every interactive element needs one — match the web naming where possible:

| Surface | testid |
|---|---|
| Login submit | `login-submit` |
| Home refresh | `home-refresh` |
| KPI card | `kpi-{name}` (e.g. `kpi-inventory-value`) |
| Stockout row | `stockout-row-{sku}` |
| Pipeline stage chip | `pipeline-stage-{stage}` |
| Inbox row | `order-row-{order_id}` |
| Inbox approve | `order-approve-{order_id}` |
| Inbox reject | `order-reject-{order_id}` |
| Fulfillment row | `ful-row-{ful_id}` |
| Fulfillment advance btn | `ful-advance-{ful_id}` |
| Inventory row | `inv-row-{sku}` |
| Inventory adjust btn | `inv-adjust-{sku}` |
| Inventory receive FAB | `inv-receive-fab` |
| Shipments row | `ship-row-{tracking_code}` |
| Bell | `notif-bell` |
| Mark all read | `notif-mark-all` |

---

## 8. Error handling

Every endpoint can return:

| Code | Meaning | UX |
|---|---|---|
| 200 | OK | render |
| 401 | token expired | run refresh, retry; if refresh fails, force re-login |
| 403 | wrong tenant | show "Not authorised" empty state |
| 404 | missing entity | "Not found" empty state |
| 422 | bad payload | show field-level validation from `detail[]` |
| 500 | server error | toast "Something went wrong — try again" + retry button |

`detail` shape on 422:
```json
{ "detail": [ {"type":"missing","loc":["body","quantity"],"msg":"Field required"} ] }
```

---

## 9. P0 / P1 / P2 cut (mobile MVP)

### P0 — Ship in MVP (22)

Auth (4) · Home dashboard with hero + watchlist + pipeline + AI insights (4) · Inventory list + search + filter + KPIs + Receive + Adjust + Movements (7) · Orders Inbox + Detail + Approve/Reject/Cancel + Fulfillment Pipeline + stage actions (6) · Shipments list + KPIs + detail + ETA (3) · Notifications + Profile/Sign-out (2) · Retailers basic directory (1).

> See `WHOLESALER_MOBILE_UX_PLAN.md` §8 for the full 22-item table.

### P1 — v1.1 (8)

Modify order · Report Shortage · Procurement list + create + transition + suppliers + catalog · Shipment Delay · Shipment Cancel · Analytics simplified · Intelligence Center · Mark-all-read.

### P2 — Defer (5)

Cycle Count · Bulk approve · Control-Tower map · CSV reports · Driver/Vehicle directory (backend gap).

### Out of scope completely (backend doesn't exist)

- Sabi Copilot for wholesalers
- Push notifications
- Retailer credit / payments
- Inter-hub transfer
- Intel acknowledge

---

## 10. Quick sanity test (mobile agent should run before shipping)

```bash
BASE=https://supply-chain-hub-189.preview.emergentagent.com
EMAIL=mfr-0001-who-0001@tradekonekt.io
PASS=TradeKonekt2026!
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
WID=6458308e-3b90-283c-f156-1a385cc22dd1

# Each of these should return 200
for path in \
  "/api/wholesaler/$WID/overview" \
  "/api/wholesaler/$WID/inventory" \
  "/api/wholesaler/$WID/inventory/movements" \
  "/api/wholesaler/$WID/orders/dashboard" \
  "/api/wholesaler/$WID/customer-orders" \
  "/api/wholesaler/$WID/fulfillments" \
  "/api/wholesaler/$WID/shipments/dashboard" \
  "/api/wholesaler/$WID/shipments" \
  "/api/wholesaler/$WID/distributors" \
  "/api/notifications?target_type=wholesaler&target_id=$WID"
do
  echo -n "$path  "
  curl -s -o /dev/null -w "%{http_code}\n" "$BASE$path" -H "Authorization: Bearer $TOKEN"
done
```

All ten should print `200`. If any prints something else, stop and contact the backend team.

---

## 11. Companion docs (read these too)

- `WHOLESALER_WORKSPACE_FUNCTIONAL_SPEC.md` — full functional inventory (every page on web)
- `WHOLESALER_MOBILE_UX_PLAN.md` — IA reasoning, P0/P1/P2 categorisation, UX rationale
- `wholesaler_api_validation.md` — 63 endpoints with verified/partial/missing status

---

## 12. What to ask the user before starting

1. **Framework?** React Native + Expo? Flutter? Native iOS+Android? (Recommend Expo for speed and OTA updates.)
2. **Single signed-in entity or multi-tenant switcher?** (Web is single; recommend single for MVP.)
3. **Brand assets** — logo, splash, dark-mode preference?
4. **Beta channel** — TestFlight + Google Internal Track? Or Expo dev builds first?

After those answers, build P0 in the order: Auth → Home → Orders (Inbox) → Orders (Pipeline) → Inventory → Shipments → Retailers → Notifications + Profile.

---

*End of brief.*
