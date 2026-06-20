# TradeKonekt Manufacturer Mobile App — Build Brief for Mobile Agent

> One self-contained document. Paste this entire file to the mobile agent.  
> Source-of-truth specs: `MANUFACTURER_WORKSPACE_FUNCTIONAL_SPEC.md`, `MANUFACTURER_MOBILE_UX_PLAN.md`, `manufacturer_api_validation.md`.

---

## 0. TL;DR for the mobile agent

You are building the **TradeKonekt Manufacturer mobile app** — a native (or React-Native / Flutter) mobile experience for an existing live backend. **Do not invent new backend functionality.** Every screen below is driven by an endpoint that already returns 200.

- Primary persona: **Manufacturer ops/executive** (Unilever-level network owner) — approves distributor POs, allocates inventory, monitors network-wide trucks and stockout risk, regenerates AI briefs.
- 5 bottom tabs · 24 P0 features for MVP.
- Sabi Copilot is **not** available for manufacturers yet — don't show a Sabi UI.
- Push notifications are **not** wired yet — use in-app bell only.
- Driver / Vehicle CRUD does **not** exist — vehicle codes are typed at dispatch only.

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
Email:    unilever@tradekonekt.io
Password: TradeKonekt2026!
Manufacturer entity_id: b21c1dbe-1a6f-4c33-b036-f416579455d0
```

### 1.2 Public docs API (for the mobile agent — no auth)

The mobile agent can `curl` the build/UX docs at any time:

```
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs/manufacturer-mobile-brief
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs/manufacturer-mobile-ux
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs/manufacturer-functional
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs/manufacturer-api-validation
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
    "role": "manufacturer",
    "entity_id": "b21c1dbe-1a6f-4c33-b036-f416579455d0",
    "name": "...",
    "last_login_at": "2026-06-19T...Z"
  }
}
```

### 2.2 Read self

`GET /api/auth/me` → returns the same `user` shape as above.

### 2.3 Refresh token

`POST /api/auth/refresh` — Body `{ "refresh_token": "..." }` → new `access_token`.  
**Pattern:** axios interceptor — on 401 once, call refresh, retry original request. If refresh fails → force re-login.

### 2.4 Sign out

`POST /api/auth/logout` — Header `Authorization: Bearer <access_token>`.

### 2.5 Forgot / reset password

- `POST /api/auth/forgot-password` — Body `{ "email": "..." }`
- `POST /api/auth/reset-password` — Body `{ "token": "...", "new_password": "..." }`

---

## 3. The 5 bottom tabs

| # | Tab | Icon | Primary endpoint(s) |
|---|---|---|---|
| 1 | **Home** | LayoutDashboard | `/manufacturer/{mid}/overview`, `/manufacturer/{mid}/activity-pulse`, `/manufacturer/{mid}/network-pulse`, `/intel/exec-summary?role=manufacturer&entity_id={mid}` |
| 2 | **Orders** | ClipboardList | `/procurement/purchase-orders?manufacturer_id={mid}`, `/allocation/summary?manufacturer_id={mid}`, `/allocation/kpis?manufacturer_id={mid}` |
| 3 | **Logistics** | Truck | `/logistics/control-tower?manufacturer_id={mid}`, `/logistics/events?manufacturer_id={mid}` |
| 4 | **Products** | Package | `/manufacturer/{mid}/product-intelligence` |
| 5 | **More** | Menu | navigates to: Warehouses, Distributors, Network Map, Intelligence, Reports, Notifications, Profile |

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

On success: persist `access_token` + `refresh_token` securely (Keychain / EncryptedSharedPreferences) and `user.entity_id` (= `mid`). Navigate to Home.

---

### 4.2 Screen — **Home (Executive Dashboard)**

**Primary endpoint:** `GET /api/manufacturer/{mid}/overview`

**Response (live sample, abbreviated):**
```json
{
  "manufacturer": { "name": "Unilever Nigeria", "region": "Lagos" },
  "kpis": {
    "network_revenue":     { "value": 1213000000.0, "delta_pct": 4.2 },
    "warehouses":          { "value": 5, "active": 5 },
    "active_retailers":    { "value": 84 },
    "active_distributors": { "value": 12 },
    "network_health":      { "value": 96.0 }
  },
  "revenue_trend":    { "spark": [ /* 12 monthly values */ ] },
  "stockout_risk":    [ { "product_id":"...", "product_name":"...", "severity":"critical", "days_remaining":1 } ],
  "top_products":     [ { "product_id":"...", "name":"...", "units_90d":12345, "revenue_90d":12345678 } ],
  "pipeline":         { "submitted": 5, "approved": 12, "in_transit": 8, "delivered": 41 },
  "alerts":           [ { "title":"...", "body":"...", "severity":"warning" } ],
  "regional":         [ /* used on Intelligence screen, not Home */ ],
  "categories":       [ /* used on Intelligence screen */ ],
  "as_of":            "2026-06-19T15:24:00Z"
}
```

**Companion endpoints (live polling):**
- `GET /api/manufacturer/{mid}/activity-pulse` — 60s polling, returns throughput by event type.
- `GET /api/manufacturer/{mid}/network-pulse?limit=10&since_iso={cursor}` — 15s polling, returns last N cross-tier inventory movements; advance `since_iso` to the latest `created_at` after each tick.
- `GET /api/intel/exec-summary?role=manufacturer&entity_id={mid}` — AI brief; `POST /api/intel/exec-summary/regenerate` to refresh.

**Layout (above the fold):**

1. Top app-bar: `Unilever · Network Command Center` + bell badge + Live ● dot.
2. **AI Exec Brief card** — 2-3 line summary + Regenerate button (`POST /api/intel/exec-summary/regenerate` body `{role:"manufacturer", entity_id:mid}`).
3. **Hero row** — 3 stat tiles:
   - Network Revenue 30D `fmtCurrency(kpis.network_revenue.value)` + `delta_pct` chip
   - Active Retailers `kpis.active_retailers.value`
   - Network Health `${kpis.network_health.value} / 100`
4. **Network Pulse ticker** — horizontal scroll of last 3-5 cross-tier movements (e.g. *"WH-LA-001 → DST-IKE: 240 units OMO 1kg"*). Tap → Logistics/Events filtered by `shipment_id`.

**Below the fold:**

5. **Full 5-KPI strip** — Network Revenue · Warehouses (active/total chip) · Active Retailers · Active Distributors · Network Health.
6. **Revenue Trend** — 12-mo area sparkline (`revenue_trend.spark[]`).
7. **Activity Pulse strip** — chip row of (event_type · count) — 60s polling.
8. **Stockout Risk card** — `stockout_risk[]` top 5, severity-tagged (`out`=red, `critical`=amber, `low`=yellow). "View all" → Products tab filtered.
9. **Top Products card** — `top_products[]` top 5 by `revenue_90d`. Tap row → Product Detail.
10. **Pipeline funnel** — horizontal chip bar `Submitted {N} · Approved {N} · In Transit {N} · Delivered {N}`. Source: `pipeline{}`. Tap chip → Orders/Inbox filtered.
11. **Alerts** — `alerts[]` top 3 rendered as ToneCards (`info`=slate, `warning`=amber, `critical`=rose).

**Pull-to-refresh:** re-fetch overview + exec-summary + activity-pulse.

---

### 4.3 Screen — **Orders (Inbox)**

Segmented control at the top: **`[ Inbox ]   [ Allocation ]`**.

#### 4.3.a Inbox tab content

**Endpoint:** `GET /api/procurement/purchase-orders?manufacturer_id={mid}`

**Response (flat list):**
```json
[
  {
    "id": "...",
    "po_number": "PO-2026-00021",
    "status": "submitted",
    "customer_type": "distributor",      // distributor | wholesaler
    "customer": {
      "id": "...", "name": "Apex Distributors (Apapa)",
      "region": "Lagos", "city": "Apapa", "type": "distributor"
    },
    "items": [
      { "product_id":"...", "quantity":500, "unit_cost":2200.0,
        "line_total":1100000.0, "product_name":"...", "sku":"..." }
    ],
    "total_amount": 1100000.0,
    "created_at": "...", "expected_delivery": "...",
    "priority": "normal"
  }
]
```

**UI:**
- Status filter chips: `All · Draft · Submitted · Approved · Processing · Shipped · In Transit · Delivered · Rejected/Cancelled`
- Search bar: matches `po_number`, `customer.name`, item product names (client-side)
- Each row card:
  - Top: `po_number` + status chip
  - Middle: customer name · city · `fmtCurrency(total_amount)`
  - Bottom: relative time + item count + priority chip
- **Swipe gestures:**
  - Right → **Approve** (`POST /api/procurement/purchase-orders/{po_id}/approve`)
  - Left → opens reject sheet with `reason` textarea (`POST .../reject` body `{reason}`)
- Tap row → PO Detail (see §4.3.c)

#### 4.3.b Allocation tab content

**Endpoints:**
- `GET /api/allocation/summary?manufacturer_id={mid}` — list view
- `GET /api/allocation/kpis?manufacturer_id={mid}` — header KPI strip
- `GET /api/allocation/back-orders?manufacturer_id={mid}` — back-order section (P1)

**Summary response:**
```json
{
  "manufacturer_id":"...",
  "orders": [
    { "order_id":"...", "po_number":"PO-2026-00021",
      "customer_name":"Apex Distributors",
      "status":"pending_allocation",   // pending_allocation|partially_allocated|allocated|back_ordered|rejected|acknowledged
      "total_units": 500, "allocated_units": 0,
      "warehouse_hint": "WH-LA-001",
      "priority":"normal" }
  ]
}
```

**UI:**
- KPI strip (top): `Pending · Partially Allocated · Allocated · Back-orders` (from `/kpis`)
- Filter chips: `All · Pending · Partial · Allocated · Back-ordered`
- Row card: po_number + status chip · customer name · `{allocated}/{total} units` bar · priority
- **Swipe right** → Auto-allocate (`POST /api/allocation/orders/{order_id}/auto-allocate`)
- **Swipe left** → reject sheet (`POST /api/allocation/orders/{order_id}/reject` body `{reason}`)
- Tap row → Allocation Detail (see §4.3.d)

> ⚠️ Never call `GET /api/allocation/pool` without `warehouse_id` — it returns 502. The pool drawer is a P1 manual-allocate feature.

#### 4.3.c PO Detail screen

**Endpoint:** `GET /api/procurement/purchase-orders/{po_id}`

**Sections:**
- Header: `po_number`, status chip, customer block, expected delivery, priority
- Items list table: product · qty · unit_cost · subtotal
- **Live truck ETA card** — when payload contains `shipment.current_position` / `shipment.eta`, render a tiny status line; tap → deep-link to Logistics/Map filtered to that shipment.
- Status history timeline
- Notes / instructions
- **Action bar (sticky bottom)** — buttons shown only when status allows:

| Status | Buttons shown |
|---|---|
| `draft` | Submit · Duplicate · Cancel |
| `submitted` | Approve · Reject · Duplicate · Cancel |
| `approved` | Process · Duplicate · Cancel |
| `processing` | Ship · Duplicate · Cancel |
| `shipped` / `in_transit` | Deliver · Duplicate |
| `delivered` / `rejected` / `cancelled` | Duplicate (read-only otherwise) |

All buttons hit `POST /api/procurement/purchase-orders/{po_id}/{action}`:

| Action | Endpoint | Body |
|---|---|---|
| submit | `POST .../submit` | `{}` |
| approve | `POST .../approve` | `{}` |
| reject | `POST .../reject` | `{"reason":"<text>"}` |
| process | `POST .../process` | `{}` |
| ship | `POST .../ship` | `{vehicle_code?, driver?, eta?, notes?}` |
| deliver | `POST .../deliver` | `{}` |
| cancel | `POST .../cancel` | `{"reason":"<text>"}` |
| duplicate | `POST .../duplicate` | `{}` |

#### 4.3.d Allocation Detail screen

**Endpoints:**
- `GET /api/allocation/orders/{order_id}` — order + current allocation state
- `GET /api/allocation/orders/{order_id}/recommendation` — system suggestion

**Sections:**
- Header: linked `po_number`, current allocation status, customer
- **Recommendation card** (from `/recommendation`) — list of `{warehouse_id, warehouse_name, product_id, qty}` rows with a "Use this" button → triggers auto-allocate
- Line items table: product · qty requested · qty allocated · qty on back-order
- Status history timeline
- **Action bar (sticky bottom)** — one row of pill buttons:

| Button | Endpoint | Body |
|---|---|---|
| Auto-allocate | `POST /api/allocation/orders/{order_id}/auto-allocate` | `{}` |
| Manual-allocate (P1) | `POST /api/allocation/orders/{order_id}/manual-allocate` | `{"lines":[{warehouse_id, product_id, quantity}]}` |
| Back-order | `POST /api/allocation/orders/{order_id}/back-order` | `{}` |
| Reject | `POST /api/allocation/orders/{order_id}/reject` | `{"reason":"<text>"}` |
| Acknowledge | `POST /api/allocation/orders/{order_id}/acknowledge` | `{}` |

---

### 4.4 Screen — **Logistics**

Top tabs: **`[ Events ]   [ Map ]`**.

**Header KPI strip (always visible):** `In Transit · Delayed · Deviations · Unacked Critical · On-Time %` — sourced from `GET /api/logistics/control-tower?manufacturer_id={mid}` `kpis{}`.

#### 4.4.a Events tab

**Endpoint:** `GET /api/logistics/events?manufacturer_id={mid}&limit=50`

```json
[
  {
    "id":"...","created_at":"...",
    "event_type":"delay|deviation|breakdown|geofence|unauthorized_stop|delivered|...",
    "severity":"info|warning|critical",
    "shipment_id":"...","tracking_code":"PO-2026-00021-SHP",
    "leg_type":"warehouse_to_distributor|distributor_to_wholesaler|wholesaler_to_retailer|distributor_to_retailer",
    "title":"Vehicle VAN-LA-001 deviating from route",
    "description":"...",
    "acked": false, "acked_by": null, "acked_at": null
  }
]
```

**UI:**
- Severity chips: `All · Critical · Warning · Info` (top row)
- Leg-type chips: `All · WH→DST · DST→WHO · WHO→RET · DST→RET` (second row)
- Row card: severity chip + title + relative time + tracking_code + leg-type chip
- **Swipe right** → Acknowledge (`POST /api/logistics/events/{event_id}/ack`)
- **Bulk-ack pill** appears when a severity filter is active: `"Ack all {count} {severity} events"` → `POST /api/logistics/events/bulk-ack` body `{severity: "critical"}` (or `{ids:[...]}`)
- Tap row → Event sheet (description, ack history, "Open shipment" link)

**FAB on Events tab** — `🗄 Archive arrived` → confirm dialog → `POST /api/logistics/vehicles/archive` body `{cutoff_hours: 12}`. Toast result count.

#### 4.4.b Map tab (live control tower)

**Endpoint:** `GET /api/logistics/control-tower?manufacturer_id={mid}` (poll every 15s)

```json
{
  "kpis": { /* see above */ },
  "vehicles": [
    {
      "vehicle_code":"VAN-LA-001",
      "tracking_code":"PO-2026-00021-SHP",
      "status":"in_transit|loaded|delivered|delayed|breakdown",
      "current_position": { "lat": 6.52, "lng": 3.38 },
      "destination":      { "lat": 6.65, "lng": 3.39, "name":"Apex Distributors (Apapa)" },
      "route_steps":      [ /* polyline */ ],
      "leg_type":"warehouse_to_distributor",
      "eta": "2026-06-19T18:30:00Z",
      "driver":"Tunde",
      "speed_kmh": 42
    }
  ],
  "as_of": "2026-06-19T15:24:00Z"
}
```

**UI:**
- Map with vehicle markers (cluster above 20 vehicles)
- Marker tap → bottom sheet: tracking_code · driver · ETA countdown · status chip · current speed · "Open shipment timeline" button → `GET /api/logistics/shipment-timeline/{shipment_id}`
- Filter chips above map: leg-type toggles (same 4 as Events)
- Phone-screen map is **read-only** — no draw-route gestures. Route Planning is P2.

---

### 4.5 Screen — **Products (Product Intelligence)**

**Endpoint:** `GET /api/manufacturer/{mid}/product-intelligence`

```json
{
  "manufacturer_id":"...",
  "products": [
    {
      "product_id":"...", "name":"OMO Detergent 1kg", "sku":"OMO-1KG",
      "category":"Home Care", "unit_price": 2200.0,
      "units_in_network": 12345,
      "distributor_count": 12, "retailer_count": 84,
      "revenue_90d": 12345678, "units_sold_90d": 5400,
      "sparkline_30d": [ /* daily values */ ],
      "trend_pct_7d": 4.2,
      "status": "healthy"        // healthy|low|stockout|excess
    }
  ],
  "summary": {
    "total_skus": 24, "total_units_in_network": 187654,
    "low_stock_skus": 2, "out_of_stock_skus": 0,
    "revenue_90d": 412345678
  },
  "as_of": "..."
}
```

**UI:**
- **KPI strip (top)** — 4 mini-tiles from `summary`:
  Total SKUs · In-Network Units · Low/Out SKUs · Revenue 90d
- **Search bar:** matches `name + sku`
- **Status filter chips:** `All · Healthy · Low · Stockout · Excess`
- **Row card:** product name + SKU · `units_in_network` units · trend arrow (`trend_pct_7d`) · status chip
- **Tap row** → Product Detail (see §4.5.a)
- **FAB (+)** → Create Product modal (P1)
- **Overflow menu** → "Refresh snapshot" (P1) → `POST /api/manufacturer/{mid}/product-intelligence/refresh`

#### 4.5.a Product Detail screen

**Endpoint:** `GET /api/manufacturer/{mid}/product/{product_id}`

**Sections:**
- Header: product name + SKU + status chip
- KPI row: in-network units · distributors · retailers · revenue 90d
- 30-day sparkline
- Top distributors list (by units / revenue)
- Top retailers list
- Edit Product (P1) — opens modal → `PATCH /api/products/{product_id}` body `{name?, unit_price?, category?, ...}`

#### 4.5.b Create Product modal (P1)

**Endpoint:** `POST /api/manufacturer/{mid}/products`

| Field | Required | Notes |
|---|---|---|
| Name | yes | text |
| SKU | yes | text, unique |
| Category | yes | dropdown |
| Unit price | yes | decimal |
| Reorder level | optional | int |
| Notes | optional | textarea |

**Body:** `{name, sku, category, unit_price, reorder_level?, notes?}`

---

### 4.6 Screen — **More menu**

Static list:
| Item | Navigates to |
|---|---|
| Warehouses | §4.7 |
| Distributors | §4.8 |
| Network Map | §4.9 (P2 on phone) |
| Intelligence Center | §4.10 (P1) |
| Reports | CSV downloads (P2) |
| Notifications | §4.11 |
| Profile | read-only entity card + Sign out button |

---

### 4.7 Screen — **Warehouses (More → Warehouses)**

**Endpoint:** `GET /api/manufacturer/{mid}/warehouse-network`

```json
{
  "manufacturer": { "id":"...", "name":"..." },
  "kpis": { "warehouses":5, "active":5, "inventory_units":123456, "low_stock_skus":3 },
  "warehouses": [
    { "id":"...", "name":"Lagos Central Warehouse", "code":"WH-LA-001",
      "region":"Lagos", "city":"Apapa", "state":"Lagos",
      "is_active": true,
      "distributors": 3, "wholesalers": 9, "retailers": 47,
      "active_retailers_30d": 42, "revenue_90d": 12345678,
      "inventory_units": 12345, "low_stock_skus": 2,
      "pending_orders": 5, "status": "healthy" }
  ]
}
```

**UI:**
- KPI strip from `kpis{}`
- Row card: name + code · region/city · `inventory_units` units · pending orders chip · status chip
- Tap row → Warehouse Detail

#### 4.7.a Warehouse Detail

**Endpoint:** `GET /api/warehouse/{warehouse_id}/distributor-network`

Sections: KPI strip · Distributor roster (sortable: name · region · revenue 90d · health · last activity) · "Open distributor" → §4.8.a.

> ❌ No "create warehouse" / "edit warehouse" actions — read-only on web and mobile.

---

### 4.8 Screen — **Distributors (More → Distributors)**

Source: `overview.distributor_table[]` from the dashboard payload (no separate list endpoint).

**Row card:** distributor name · region · active retailers · revenue 90d · health chip · last activity · tap → Distributor Detail.

#### 4.8.a Distributor Detail

**Endpoint:** `GET /api/manufacturer/{mid}/distributor/{distributor_id}`

Returns 90-day analytics, recent POs, inventory snapshot, retailer roster, health series. Render as: header KPIs · 30-day trend · Recent POs list · Retailer roster (P2 drilldown).

Edit (P1): `PATCH /api/distributors/{distributor_id}` — body `{name?, contact?, region?, ...}`.

---

### 4.9 Screen — **Network Map (More → Network Map)** — P2 on phone

Render 5-tier hierarchy tree from `overview.hierarchy.direct_children` + `downstream_visibility`. Phone is too small for the visualisation; **render a collapsible tree list instead** (Factory → Warehouses → Distributors → Wholesalers → Retailers).

---

### 4.10 Screen — **Intelligence Center (More → Intelligence)** — P1

**Primary endpoint:** `GET /api/intel/feed?role=manufacturer&entity_id={mid}&limit=20`

**Companion endpoints:**
- `GET /api/intel/recommendations?role=manufacturer&entity_id={mid}` — list of recommendations
- `PATCH /api/intel/recommendations/{rec_id}` — body `{"acknowledged": true}` — mark as ack
- `GET /api/intel/forecasts/stockout?role=manufacturer&entity_id={mid}` — stockout forecasts
- `GET /api/intel/alerts?role=manufacturer&entity_id={mid}` — alerts
- `GET /api/intel/external?role=manufacturer&entity_id={mid}` — weather / external signals
- `GET /api/intel/delivery-eta?role=manufacturer&entity_id={mid}` — ETA insights
- `GET /api/intel/retailer-health?role=manufacturer&entity_id={mid}` — retailer health peer roster
- `POST /api/intel/recompute` — body `{role:"manufacturer", entity_id:mid}` — force recompute

**Sections (collapsible):**
1. **Executive Brief** — `GET /api/intel/exec-summary?role=manufacturer&entity_id={mid}` (same as Home card, but full body) + Regenerate button.
2. **Live Feed** — `feed[]` rendered as ToneCards.
3. **Recommendations** — list with **Acknowledge** action per row (`PATCH /api/intel/recommendations/{rec_id}` body `{acknowledged:true}`).
4. **Stockout Forecasts** — `forecasts[]`: product · days remaining · severity.
5. **Alerts** — `alerts[]`.
6. **Delivery ETA Insights** — `delivery_eta[]`: shipment · predicted_delay · severity.
7. **Retailer Health peers** — `retailer_health[]`: retailer name · health score · trend.

> **No Logistics Copilot on mobile in MVP.** It's in-page chat only on web and slated for P2 on mobile.

---

### 4.11 Screen — **Notifications**

**List:** `GET /api/notifications?target_type=manufacturer&target_id={mid}&limit=20`

```json
[
  {
    "id":"...","target_type":"manufacturer","target_id":"...",
    "title":"PO-2026-00021 awaiting approval",
    "message":"Apex Distributors · 500 units OMO 1kg",
    "type":"delivery|order|stockout|delay|intel|network",
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
- Empty state: "All caught up"

---

### 4.12 Screen — **Reports (More → Reports)** — P2

Two CSV download buttons:

| Report | Endpoint |
|---|---|
| Shipments CSV | `GET /api/reports/shipments.csv?role=manufacturer&entity_id={mid}` |
| Inventory CSV | `GET /api/reports/inventory.csv?role=manufacturer&entity_id={mid}` |

Use the platform Share sheet to save / email the downloaded file.

---

## 5. State machines (for state-aware UI)

### Purchase Order (Outbound — manufacturer view)

```
draft ─submit→ submitted ─approve→ approved ─process→ processing ─ship→ shipped ─(auto)→ in_transit ─deliver→ delivered
   │                  │                                                                                            
   │                  ├─reject→ rejected (terminal)                                                                 
   ├─cancel→ cancelled (terminal; valid pre-shipped)                                                                
```

`duplicate` is available from any state and clones the PO back to `draft`.

### Allocation

```
pending_allocation ─auto-allocate→ allocated ─acknowledge→ acknowledged
                  ├─manual-allocate→ allocated|partially_allocated
                  ├─back-order→ back_ordered
                  └─reject→ rejected (terminal)
partially_allocated ─auto-allocate→ allocated
back_ordered ─auto-allocate (when stock arrives)→ allocated
```

### Logistics event

`unacked → acked` (one-shot, irreversible).

### Vehicle status

`loaded → in_transit → delivered`  
`in_transit ↳ delayed`  · `in_transit ↳ breakdown` · `any ↳ archived (after 12h+ at destination)`.

---

## 6. UX system (lift directly from the web)

- **Typography:** Inter (system fallback). H1 18 sp, H2 16, body 14, caption 12.
- **Colors (tones):**
  - positive `#16A34A` · warning `#D97706` · alert `#E11D48` · info `#64748B` · violet `#8B5CF6` · sky `#0EA5E9`.
- **Spacing:** 4-pt grid · cards 12-radius · screen padding 16.
- **Number formatters:**
  - `fmtCurrency(n)` → `₦` + grouped (e.g. `₦1,213,000,000`). For values ≥ 1e6 also offer a compact form `₦1.21B` for hero tiles.
  - `fmtNumber(n)` → grouped integer
  - Health chip: emerald/amber/rose pill, no border.
- **Skeleton loaders** (no spinners) — 3 placeholder rows per list.
- **Pull-to-refresh** on every list.
- **Offline:** show last cached body + grey "Showing cached data" pill at the top.
- **Live ●** dot indicator on Home + Logistics (driven by `as_of` recency < 60s).

---

## 7. Mandatory `data-testid` attributes

Every interactive element needs one — match the web naming where possible:

| Surface | testid |
|---|---|
| Login submit | `login-submit` |
| Home refresh | `home-refresh` |
| AI brief regenerate | `exec-brief-regenerate` |
| KPI card | `kpi-{name}` (e.g. `kpi-network-revenue`) |
| Network Pulse row | `pulse-row-{id}` |
| Stockout row | `stockout-row-{sku}` |
| Top product row | `top-product-{sku}` |
| Pipeline funnel chip | `pipeline-stage-{stage}` |
| Inbox PO row | `po-row-{po_id}` |
| Inbox approve swipe | `po-approve-{po_id}` |
| Inbox reject swipe | `po-reject-{po_id}` |
| Allocation row | `alloc-row-{order_id}` |
| Allocation auto-allocate | `alloc-auto-{order_id}` |
| Logistics event row | `event-row-{event_id}` |
| Logistics event ack | `event-ack-{event_id}` |
| Logistics bulk-ack | `event-bulk-ack` |
| Logistics archive FAB | `vehicles-archive-fab` |
| Map vehicle marker | `vehicle-marker-{vehicle_code}` |
| Product row | `product-row-{sku}` |
| Product create FAB | `product-create-fab` |
| Warehouse row | `warehouse-row-{code}` |
| Distributor row | `distributor-row-{id}` |
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
| 500 / 502 | server error | toast "Something went wrong — try again" + retry button |

`detail` shape on 422:
```json
{ "detail": [ {"type":"missing","loc":["body","quantity"],"msg":"Field required"} ] }
```

### Manufacturer-specific landmines

| Symptom | Why | Fix |
|---|---|---|
| `502` on `/api/allocation/pool` | called without `warehouse_id` | never call from list view — only from manual-allocate flow with a chosen warehouse |
| `404` on `/api/manufacturer/{mid}/assistant` | Sabi not enabled for manufacturer | don't render a Sabi UI |
| Stale dashboard for >30 min | overview is `read_or_compute`d | call `POST /api/manufacturer/{mid}/overview/refresh` to force |
| Network Pulse keeps returning same rows | `since_iso` cursor not advancing | after each tick, advance `since_iso` to `max(created_at)` of returned rows |

---

## 9. P0 / P1 / P2 cut (mobile MVP)

### P0 — Ship in MVP (24)

Auth (5) · Home AI brief + 5 KPIs + Network Pulse + Activity Pulse + Stockout + Top Products + Pipeline (7) · PO Inbox + Detail + state-machine actions (3) · Allocation Inbox + Detail + auto-allocate/back-order/reject/acknowledge (3) · Logistics Events + Ack + Bulk-ack + Map (4) · Products list + Detail (2) · Distributors + Warehouses (under More) (2) · Notifications + Profile/Sign-out + Plumbing (offline/skeleton/pull-refresh) (2).

> See `MANUFACTURER_MOBILE_UX_PLAN.md` §8 for the full 24-item table.

### P1 — v1.1 (9)

Manual-allocate · Back-orders list · Wholesaler POs cross-tier · Create Product · Edit Product · Refresh PI snapshot · Archive arrived vehicles · Intelligence Center · Bulk-approve POs.

### P2 — Defer (7)

Network Map (5-tier tree) · Route Planning · Delay Predictions · Demand vs Delivery · Logistics Copilot chat · CSV reports · Inventory adjust at any owner.

### Out of scope completely (backend doesn't exist)

- Sabi Copilot for manufacturers (404)
- Push notifications + preferences
- Driver / Vehicle CRUD
- Payments / credit / invoicing
- Promotions authoring
- CRM / messaging

---

## 10. Quick sanity test (mobile agent should run before shipping)

```bash
BASE=https://supply-chain-hub-189.preview.emergentagent.com
EMAIL=unilever@tradekonekt.io
PASS=TradeKonekt2026!
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
MID=b21c1dbe-1a6f-4c33-b036-f416579455d0

# Each of these should return 200
for path in \
  "/api/manufacturer/$MID/overview" \
  "/api/manufacturer/$MID/activity-pulse" \
  "/api/manufacturer/$MID/network-pulse?limit=10" \
  "/api/manufacturer/$MID/product-intelligence" \
  "/api/manufacturer/$MID/warehouse-network" \
  "/api/procurement/purchase-orders?manufacturer_id=$MID" \
  "/api/allocation/summary?manufacturer_id=$MID" \
  "/api/allocation/kpis?manufacturer_id=$MID" \
  "/api/logistics/control-tower?manufacturer_id=$MID" \
  "/api/logistics/events?manufacturer_id=$MID&limit=20" \
  "/api/intel/exec-summary?role=manufacturer&entity_id=$MID" \
  "/api/intel/feed?role=manufacturer&entity_id=$MID&limit=10" \
  "/api/notifications?target_type=manufacturer&target_id=$MID"
do
  echo -n "$path  "
  curl -s -o /dev/null -w "%{http_code}\n" "$BASE$path" -H "Authorization: Bearer $TOKEN"
done
```

All thirteen should print `200`. If any prints something else, stop and contact the backend team.

---

## 11. Companion docs (read these too)

- `MANUFACTURER_WORKSPACE_FUNCTIONAL_SPEC.md` — full functional inventory (every page on web) → `/api/public-docs/manufacturer-functional`
- `MANUFACTURER_MOBILE_UX_PLAN.md` — IA reasoning, P0/P1/P2 categorisation, UX rationale → `/api/public-docs/manufacturer-mobile-ux`
- `manufacturer_api_validation.md` — every endpoint with verified/partial/missing status → `/api/public-docs/manufacturer-api-validation`

---

## 12. What to ask the user before starting

1. **Framework?** React Native + Expo? Flutter? Native iOS+Android? (Recommend Expo for speed and OTA updates.)
2. **Single signed-in entity or multi-tenant switcher?** (Web is single; recommend single for MVP.)
3. **Brand assets** — logo, splash, dark-mode preference?
4. **Map provider** — Google Maps SDK (Android key required) or MapLibre (free tile provider)?
5. **Beta channel** — TestFlight + Google Internal Track? Or Expo dev builds first?

After those answers, build P0 in the order:

```
Auth → Home → Orders/Inbox → Orders/Allocation → Logistics/Events
     → Logistics/Map → Products → Warehouses → Distributors
     → Notifications + Profile
```

---

*End of brief.*
