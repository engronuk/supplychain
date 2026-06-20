# TradeKonekt Distributor Mobile App — Build Brief for Mobile Agent

> One self-contained document. Paste this entire file to the mobile agent.  
> Source-of-truth specs: `DISTRIBUTOR_WORKSPACE_FUNCTIONAL_SPEC.md`, `DISTRIBUTOR_MOBILE_UX_PLAN.md`, `distributor_api_validation.md`.

---

## 0. TL;DR for the mobile agent

You are building the **TradeKonekt Distributor mobile app** — a native (or React-Native / Flutter) mobile experience for an existing live backend. **Do not invent new backend functionality.** Every screen below is driven by an endpoint that already returns 200 (with the small list of caveats called out in §8).

- Primary persona: **Distributor ops manager** — approves incoming retailer/wholesaler POs, places upstream POs with the manufacturer, responds to RFQs, watches wholesaler health and warehouse stock.
- 5 bottom tabs · 23 P0 features for MVP.
- Sabi Copilot is **not** available for distributors yet — don't show a Sabi UI.
- Push notifications are **not** wired yet — use in-app bell only.
- Driver / Vehicle CRUD does **not** exist — vehicle codes are typed at dispatch only.
- Live control-tower **map is not exposed** to distributors — shipment status comes from PO detail's `shipment{}` block.

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
Email:    mfr-0001-dst-0001@tradekonekt.io
Password: TradeKonekt2026!
Distributor entity_id (preview): f9dfaf08-4ee2-3c64-e96b-983c385625b2
Name: Apex Distributors (Apapa)
```

Other distributor logins available: `unilever.distributor@tradekonekt.io`, `fmn.distributor@tradekonekt.io`.

### 1.2 Public docs API (for the mobile agent — no auth)

```
GET https://supply-chain-hub-189.preview.emergentagent.com/api/public-docs
GET .../api/public-docs/distributor-mobile-brief
GET .../api/public-docs/distributor-mobile-ux
GET .../api/public-docs/distributor-functional
GET .../api/public-docs/distributor-api-validation
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
    "role": "distributor",
    "entity_id": "f9dfaf08-4ee2-3c64-e96b-983c385625b2",
    "name": "...",
    "last_login_at": "2026-06-19T...Z"
  }
}
```

### 2.2 Read self / refresh / logout / forgot / reset

Same as the other apps:
- `GET /api/auth/me`
- `POST /api/auth/refresh` body `{ refresh_token }`
- `POST /api/auth/logout`
- `POST /api/auth/forgot-password` body `{ email }`
- `POST /api/auth/reset-password` body `{ token, new_password }`

Use an axios interceptor — on 401 once, refresh, retry. If refresh fails → force re-login.

---

## 3. The 5 bottom tabs

| # | Tab | Icon | Primary endpoint(s) |
|---|---|---|---|
| 1 | **Home** | LayoutDashboard | `/distributor/{did}/operations-intelligence` |
| 2 | **Orders** | ClipboardList | `/distributor/{did}/orders` (Buy), `/procurement/purchase-orders?distributor_id={did}` (Sell), `/distributor/{did}/incoming-wholesaler-pos` (Sell-WHO), `/procurement/quotes?distributor_id={did}` (RFQs) |
| 3 | **Wholesalers** | Network | `/distributor/{did}/wholesaler-network`, `/distributor/{did}/wholesaler/{wid}/detail` |
| 4 | **Inventory** | Boxes | `/inventory?owner_type=distributor&owner_id={did}` |
| 5 | **More** | Menu | navigates to: Intelligence, Reports, Notifications, Profile |

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

On success: persist `access_token` + `refresh_token` securely (Keychain / EncryptedSharedPreferences) and `user.entity_id` (= `did`). Navigate to Home.

---

### 4.2 Screen — **Home (Operations Intelligence)**

**Primary endpoint:** `GET /api/distributor/{did}/operations-intelligence`  
**Refresh:** `POST /api/distributor/{did}/operations-intelligence/refresh` (returns the fresh payload)

**Response (live sample, abbreviated):**
```json
{
  "as_of": "2026-06-19T15:24:00Z",
  "distributor": { "id":"...", "name":"Apex Distributors", "region":"Lagos", "city":"Apapa", "state":"Lagos" },
  "kpis": {
    "network_revenue_90d":  { "value": 12345678.0, "growth_pct": 4.2, "spark":[/*12 ints*/] },
    "active_wholesalers":   { "value": 3, "growth_pct": 0.0, "spark":[...] },
    "retail_orders_pending":{ "value": 5, "growth_pct": null, "spark":[...] },
    "dispatched_30d":       { "value": 12, "growth_pct": 10.0, "spark":[...] },
    "inventory_units":      { "value": 12345, "growth_pct": null, "spark":[...] },
    "low_stock_skus":       { "value": 2, "growth_pct": null, "spark":[...] }
  },
  "ai_brief": {
    "insights": [
      { "tone":"positive|warning|critical|info", "icon":"trending-up", "title":"...", "detail":"..." }
    ],
    "recommended_actions": [
      { "tone":"critical|warning|positive|info", "title":"Replenish 2 low-stock SKUs", "detail":"...", "cta":"Open Inventory" }
    ]
  },
  "revenue_trend": [{"date":"2026-05-21","revenue": 123456.0, "units": 540}, /* ...30 */],
  "performance_matrix": [ { "id":"...","name":"...","revenue_90d":..., "growth_pct":..., "quadrant":"stars|cash_cows|growth_opps|at_risk", ... } ],
  "quadrant_counts": { "stars":1, "cash_cows":1, "growth_opps":1, "at_risk":0 },
  "regional_coverage": [ { "region":"Lagos", "retailers": 8, "revenue": 7654321.0 } ],
  "inventory_health": {
    "healthy_skus": 8, "low_skus": 2, "out_skus": 0, "total_skus": 10, "total_units": 12345,
    "donut": [{"label":"Healthy","value":8,"color":"#10b981"}, {"label":"Low","value":2,"color":"#f59e0b"}, {"label":"Out","value":0,"color":"#ef4444"}]
  },
  "top_wholesalers": [ { "id":"...","name":"Royal Trading 1","revenue_90d":4567890,"growth_pct":12.4, "active_retailers_30d":3, "city":"Ikeja" } ],
  "attention_wholesalers": [ { "id":"...","name":"...","revenue_90d":..., "growth_pct":-15.0, ... } ],
  "category_performance": [ { "category":"Home Care","revenue":3456789,"units":1234 } ],
  "order_pipeline": { "pending":3, "approved":2, "dispatched":4, "delivered_30d":12 },
  "network_health": { "score": 82, "band":"good" },
  "totals": { "total_wholesalers": 3, "total_skus": 10 },
  "downstream_visibility": { "total_retailers": 12, "active_retailers_30d": 8 }
}
```

**Layout (above the fold):**

1. Top app-bar: `Apex Distributors · Apapa` + bell badge + Live ● dot.
2. **AI Brief card** — render `ai_brief.insights[0]` (title + 2-line detail + tone-coloured tile).
3. **Hero row** — 3 stat tiles:
   - Revenue 90D `fmtCurrency(kpis.network_revenue_90d.value)` + `growth_pct` chip
   - Active Wholesalers `kpis.active_wholesalers.value`
   - Retailers reach `downstream_visibility.total_retailers` (with `active_retailers_30d` as a chip)
4. **Action chip** — `kpis.retail_orders_pending.value > 0` → "{N} retailer POs await approval" → tap → Orders/Sell?status=submitted.

**Below the fold:**

5. **Full 6-KPI strip** — Revenue 90D · Active Wholesalers · Pending Orders · Dispatched 30d · Inventory Units · Low Stock SKUs (with growth chips and 12-pt sparklines).
6. **Network Health composite** — score 0-100 + band (`critical|fair|good|excellent`).
7. **Revenue Trend** — 30-day area sparkline.
8. **Top Wholesalers card** — `top_wholesalers[]` top 5. Tap row → Wholesaler Detail.
9. **Attention Wholesalers card** — `attention_wholesalers[]` top 5 (negative growth or below-median revenue). Tap row → Wholesaler Detail.
10. **Stockout Risk card** — derived from `inventory_health` (the `low_skus + out_skus` counts; for the detail rows you need to call inventory list — see §4.5).
11. **Order Pipeline funnel** — chip bar from `order_pipeline{}`. Tap chip → Orders/Sell filtered.
12. **AI Recommendations** — `ai_brief.recommended_actions[]` cards (max 4), tone-coloured, with the CTA labels.

**Pull-to-refresh:** call `POST .../operations-intelligence/refresh` then re-render.

---

### 4.3 Screen — **Orders**

Segmented control at the top: **`[ Buy (mine) ]   [ Sell (Retailer + WHO) ]   [ RFQs ]`**.

#### 4.3.a Buy tab (my upstream POs to manufacturer)

**Endpoint:** `GET /api/distributor/{did}/orders`

**Response:** flat array of distributor_orders. Status machine: `pending → approved → dispatched → delivered` (decline: `pending → rejected`). Each row has `id, manufacturer_id, items[], status, created_at, approved_at?, dispatched_at?, delivered_at?, shipment_id?, rejection_reason?, distributor_name (denorm), total_units, total_value`.

**UI:**
- Status filter chips: `All · Pending · Approved · Dispatched · Delivered · Rejected`
- Search bar: matches `id`, item product names (client-side)
- Row card: order id (short) + status chip · manufacturer name · `fmtCurrency(total_value)` · relative time
- Tap row → Buy PO Detail (read-only — approve/dispatch happen on the manufacturer side)
- **FAB (+)** → Place upstream PO modal (see §4.3.d)

#### 4.3.b Sell tab — combined retailer + wholesaler-inbound POs

**Endpoints (call both, merge client-side):**
- Retailer POs: `GET /api/procurement/purchase-orders?distributor_id={did}`
- Wholesaler POs into me: `GET /api/distributor/{did}/incoming-wholesaler-pos`

**Sell PO row payload (retailer):**
```json
{
  "id":"...","po_number":"PO-2026-00021","status":"submitted",
  "supplier_type":"distributor", "retailer_id":"...",
  "items":[{"product_id":"...","quantity":50,"unit_price":2200.0,"line_total":110000.0,"product_name":"...","sku":"..."}],
  "total_amount":110000.0,
  "retailer":{"id":"...","name":"...","city":"...","region":"..."},
  "shipment":{"id":"...","status":"in_transit","tracking_code":"...","eta":"..."} ,
  "created_at":"...", "submitted_at":"...", "shipped_at":null, "delivered_at":null,
  "status_history":[...]
}
```

States: `draft → submitted → approved → processing → shipped → in_transit → delivered`  
Terminal: `cancelled · rejected`

**UI:**
- Status filter chips: `All · Submitted · Approved · Processing · Shipped · In Transit · Delivered · Rejected/Cancelled`
- Source filter chip-row: `All · Retailer · Wholesaler` (filter by which collection)
- Search bar: matches `po_number`, `retailer.name` / `wholesaler.name`, product names
- Row card: po_number + status chip · counterparty name · city · `fmtCurrency(total_amount)` · relative time
- **Swipe gestures:**
  - Right → **Approve** (`POST /api/procurement/purchase-orders/{po_id}/approve`)
  - Left → reject sheet with `reason` textarea (`POST .../reject` body `{reason}`)
- Tap row → Sell PO Detail (see §4.3.c)

#### 4.3.c Sell PO Detail

**Endpoint:** `GET /api/procurement/purchase-orders/{po_id}`

**Sections:**
- Header: `po_number`, status chip, counterparty block, expected delivery
- Items list table: product · qty · unit_price · subtotal
- **Shipment block** (when payload contains `shipment{}`): tracking code · status · ETA · "Open shipment" expand
- Status history timeline
- Notes
- **Action bar (sticky bottom)** — buttons shown only when status allows:

| Status | Buttons shown |
|---|---|
| `draft` | Submit · Cancel |
| `submitted` | Approve · Reject · Cancel |
| `approved` | Process · Cancel |
| `processing` | Ship · Cancel |
| `shipped` / `in_transit` | Deliver |
| `delivered` / `rejected` / `cancelled` | (read-only) |

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

#### 4.3.d Place upstream PO (Buy FAB) modal

**Step 1 — pick manufacturer:**
- Primary: `GET /api/distributor/{did}/manufacturers` — ⚠️ returns 404 for org-table distributors.
- Fallback: `GET /api/manufacturers` (always 200).

**Step 2 — pick products + quantities:**
- `GET /api/products` → catalogue. Search bar + qty stepper per row.

**Step 3 — review & submit:**
- `POST /api/distributor/{did}/orders` body `{manufacturer_id, items:[{product_id, quantity}], note?}`
- 200 → toast + navigate to Buy PO Detail.

#### 4.3.e RFQ tab

**List:** `GET /api/procurement/quotes?distributor_id={did}`

**Row:** `quote_number` · created_by (retailer/wholesaler) · status (`open|responded|closed`) · items count · `valid_until`.

**Detail:** `GET /api/procurement/quotes/{quote_id}` → header + items + responses (from other distributors) + my response (if any).

**Respond sheet (Swipe right or button):**
- Endpoint: `POST /api/procurement/quotes/{quote_id}/respond`
- Body:
  ```json
  { "unit_price": 2200.0, "lead_time_days": 3, "moq": 100, "valid_until":"2026-06-30", "notes":"..." }
  ```

**Close (only the creator can close):** `POST /api/procurement/quotes/{quote_id}/close`.

---

### 4.4 Screen — **Wholesalers**

**Endpoint:** `GET /api/distributor/{did}/wholesaler-network`

**Response sample:**
```json
{
  "distributor_id":"...",
  "as_of":"...",
  "kpis": {
    "total_wholesalers":3, "active_wholesalers_30d":3,
    "total_retailers_in_network":12, "active_retailers_30d":8,
    "revenue_90d":12345678.0, "key_account_retailers":2
  },
  "wholesalers":[
    { "id":"...", "name":"Royal Trading 1 (Lagos)", "code":"MFR-0001-WHO-0001",
      "region":"Lagos","city":"Ikeja",
      "retailer_count":4, "active_retailers_30d":3,
      "revenue_90d":4567890.0, "growth_pct":12.4,
      "pending_orders":2, "status":"healthy|attention|critical" }
  ],
  "top_wholesalers":[...same shape...],
  "attention_wholesalers":[...],
  "key_account_retailers":[
    {"id":"...","name":"Shoprite Apapa","region":"Lagos","city":"Apapa","brand":"Shoprite","revenue_90d":3456789.0}
  ]
}
```

**UI:**
- **KPI strip (top)** — 4 mini-tiles from `kpis`:
  Total · Active 30d · Retailers Reach · Revenue 90d
- **Search bar:** matches `name + code + city`
- **Status filter chips:** `All · Healthy · Attention · Critical`
- **Row card:** name + code · region/city · `revenue_90d` · `growth_pct` arrow · retailer count chip · status chip
- **Swipe right** → open quick-call (`tel:` link from `contact_email`/phone; P1)
- **Tap row** → Wholesaler Detail
- **Key-account retailers section** (collapsible at bottom): direct-relationship retailers (no wholesaler in between) — tap → Key-Account Retailer Detail (P1)

#### 4.4.a Wholesaler Detail

**Endpoint:** `GET /api/distributor/{did}/wholesaler/{wid}/detail`

**Sections:**
- Header: wholesaler name + code + region + city + contact_email
- KPI strip: Retailers · Active 30d · Revenue 90D · Pending POs from retailers · Pending procurement to me
- **Retailers tab** (default): list of retailers under this wholesaler — name, code, revenue 90d, units 90d, last_sale_date, status chip. Tap → Retailer Detail (P1: `GET /api/distributor/{did}/retailer/{rid}`).
- **Recent retailer orders tab**: `recent_retailer_orders[]` — po_number · retailer · total · status · created_at.
- **Incoming wholesaler POs tab**: `wholesaler_purchase_orders_to_distributor[]` — WPOs into me from this wholesaler (read-only, status badge).

---

### 4.5 Screen — **Inventory**

**Endpoint:** `GET /api/inventory?owner_type=distributor&owner_id={did}`

**Response:** flat list of inventory rows
```json
[
  { "id":"...", "owner_type":"distributor", "owner_id":"...",
    "product_id":"...", "product_name":"OMO Detergent 1kg", "sku":"OMO-1KG",
    "quantity": 200, "reorder_level": 50, "unit_price": 2200.0,
    "category":"Home Care", "updated_at":"..." }
]
```

**Derived health:** `out` if `quantity == 0`, `low` if `quantity <= reorder_level`, `healthy` otherwise.

**UI:**
- **KPI strip (top)** — 4 mini-tiles computed client-side from the list:
  Total SKUs · Total Units · Low+Out SKUs · Total Value (`sum(quantity * unit_price)`)
- **Search bar:** matches `product_name + sku`
- **Health filter chips:** `All · Healthy · Low · Out`
- **Row card:** product name + SKU · `quantity` units · health chip · category badge
- **Swipe right** → Quick-Adjust modal (delta + reason)
- **Tap row** → bottom sheet: "Adjust Stock" button
- **FAB (✚ minus)** → Adjust modal (product picker first)

#### 4.5.a Adjust Stock modal

**Endpoint:** `POST /api/inventory/adjust`

**Body:**
```json
{ "owner_type":"distributor", "owner_id":"<did>",
  "product_id":"<pid>", "delta": -10, "reason":"damage|loss|expiry|correction|other", "notes":"..." }
```

**Fields:**
- Delta — signed integer with +/− toggle — required
- Reason — dropdown — required
- Notes — optional

Optimistic UI: close instantly, toast on success, rollback on error.

---

### 4.6 Screen — **More menu**

Static list:
| Item | Navigates to |
|---|---|
| Intelligence | §4.7 (P1) |
| Reports | CSV downloads (P2) |
| Notifications | §4.8 |
| Profile | read-only entity card + Sign out button |

---

### 4.7 Screen — **Intelligence Center (More → Intelligence)** — P1

**Endpoints:**
- Brief: `GET /api/intel/exec-summary?role=distributor&entity_id={did}` + `POST /api/intel/exec-summary/regenerate` body `{role:"distributor", entity_id:did}`
- Recommendations: `GET /api/intel/recommendations?role=distributor&entity_id={did}`
- Acknowledge: `PATCH /api/intel/recommendations/{rec_id}` body `{ "acknowledged": true }`
- Stockout forecasts: `GET /api/intel/forecasts/stockout?role=distributor&entity_id={did}`
- Alerts: `GET /api/intel/alerts?role=distributor&entity_id={did}` (returns `[]` today)
- External signals (weather): `GET /api/intel/external?role=distributor&entity_id={did}`
- Delivery ETA: `GET /api/intel/delivery-eta?role=distributor&entity_id={did}`
- Retailer health peers: `GET /api/intel/retailer-health?role=distributor&entity_id={did}`
- Force recompute: `POST /api/intel/recompute` body `{role:"distributor", entity_id:did}`

> ⚠️ **Do NOT** call `GET /api/intel/feed?role=distributor&entity_id={did}` — it currently returns 500 for distributors. Hide the Live Feed section until backend ships a fix.

**Sections (collapsible):**
1. **Executive Brief** + Regenerate.
2. **Recommendations** — list with **Acknowledge** action per row.
3. **Stockout Forecasts** — list of (product · days remaining · severity).
4. **Delivery ETA Insights** — shipment · predicted_delay · severity.
5. **Retailer Health peers** (P2) — peer roster.
6. **External signals** (P2) — weather / regional flags.

---

### 4.8 Screen — **Notifications**

**List:** `GET /api/notifications?target_type=distributor&target_id={did}&limit=20`

```json
[
  {
    "id":"...","target_type":"distributor","target_id":"...",
    "title":"PO-2026-00021 awaiting approval",
    "message":"Family Shop 1 · 50 units OMO 1kg",
    "type":"order|shipment|delivery|stockout|intel",
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

### 4.9 Screen — **Reports (More → Reports)** — P2

Two CSV download buttons:

| Report | Endpoint |
|---|---|
| Shipments CSV | `GET /api/reports/shipments.csv?role=distributor&entity_id={did}` |
| Inventory CSV | `GET /api/reports/inventory.csv?role=distributor&entity_id={did}` |

Use the platform Share sheet to save / email the downloaded file.

---

## 5. State machines (for state-aware UI)

### Distributor → Manufacturer order (Buy tab)

```
pending ─approve→ approved ─dispatch→ dispatched ─(auto on shipment received)→ delivered
       │
       └─reject→ rejected (terminal)
```

> The distributor *creates* and *reads* these; the manufacturer side hits `/approve` `/reject` `/dispatch`.

### Retailer/Wholesaler → Distributor PO (Sell tab)

```
draft ─submit→ submitted ─approve→ approved ─process→ processing ─ship→ shipped ─(auto)→ in_transit ─deliver→ delivered
   │                  │                                                                                            
   │                  ├─reject→ rejected (terminal)                                                                 
   ├─cancel→ cancelled (terminal; valid pre-shipped)                                                                
```

### Quote (RFQ)

```
open ─respond→ open|responded   (creator decides)
open ─close→ closed              (creator-only action)
```

### Wholesaler status (derived for UI)

`healthy` (active retailers 30d > 0 AND growth ≥ -10%) · `attention` (growth < -10%) · `critical` (active retailers 30d = 0 with retailers > 0).

### Inventory health buckets (client-derived)

`healthy` (quantity > reorder_level) · `low` (0 < quantity ≤ reorder_level) · `out` (quantity == 0).

---

## 6. UX system (lift directly from the web)

- **Typography:** Inter (system fallback). H1 18 sp, H2 16, body 14, caption 12.
- **Colors (tones):**
  - positive `#16A34A` · warning `#D97706` · alert `#E11D48` · info `#64748B` · violet `#8B5CF6` · sky `#0EA5E9`.
- **Spacing:** 4-pt grid · cards 12-radius · screen padding 16.
- **Number formatters:**
  - `fmtCurrency(n)` → `₦` + grouped (compact `₦12.3M` allowed for hero tiles).
  - `fmtNumber(n)` → grouped integer.
  - Status chip: emerald/amber/rose pill, no border.
- **Skeleton loaders** (no spinners) — 3 placeholder rows per list.
- **Pull-to-refresh** on every list.
- **Offline:** show last cached body + grey "Showing cached data" pill at the top.
- **Live ●** dot indicator on Home (driven by `as_of` recency < 60s).

---

## 7. Mandatory `data-testid` attributes

| Surface | testid |
|---|---|
| Login submit | `login-submit` |
| Home refresh | `home-refresh` |
| KPI card | `kpi-{name}` (e.g. `kpi-network-revenue-90d`) |
| Top wholesaler row | `top-wholesaler-{id}` |
| Attention wholesaler row | `attention-wholesaler-{id}` |
| Stockout row | `stockout-row-{sku}` |
| Pipeline funnel chip | `pipeline-stage-{stage}` |
| AI recommendation card | `ai-rec-{idx}` |
| Buy PO row | `buy-po-row-{order_id}` |
| Buy FAB place-order | `buy-place-order-fab` |
| Sell PO row | `sell-po-row-{po_id}` |
| Sell approve swipe | `sell-approve-{po_id}` |
| Sell reject swipe | `sell-reject-{po_id}` |
| RFQ row | `rfq-row-{quote_id}` |
| RFQ respond btn | `rfq-respond-{quote_id}` |
| Wholesaler row | `wholesaler-row-{wid}` |
| Wholesaler retailer row | `wh-retailer-row-{rid}` |
| Inventory row | `inv-row-{sku}` |
| Inventory adjust btn | `inv-adjust-{sku}` |
| Inventory adjust FAB | `inv-adjust-fab` |
| Bell | `notif-bell` |
| Mark all read | `notif-mark-all` |

---

## 8. Error handling

| Code | Meaning | UX |
|---|---|---|
| 200 | OK | render |
| 401 | token expired | run refresh, retry; if refresh fails, force re-login |
| 403 | wrong tenant | show "Not authorised" empty state |
| 404 | missing entity | "Not found" empty state |
| 422 | bad payload | show field-level validation from `detail[]` |
| 500 / 502 | server error | toast "Something went wrong — try again" + retry button |

### Distributor-specific landmines

| Symptom | Why | Fix |
|---|---|---|
| `404` on `/api/distributor/{did}/overview` | this route only works for legacy `db.distributors`-table entities, not org-table ones | use `/api/distributor/{did}/operations-intelligence` instead |
| `404` on `/api/distributor/{did}/manufacturers` | same — only works for legacy entities | fall back to `GET /api/manufacturers` |
| `500` on `/api/intel/feed?role=distributor` | backend bug pending fix | hide the Live Feed section in Intelligence Center until backend ships a fix |
| `404` on `/api/distributor/{did}/inventory` | route doesn't exist | use `GET /api/inventory?owner_type=distributor&owner_id={did}` |
| `404` on `/api/distributor/{did}/shipments` | route doesn't exist | read `shipment{}` block embedded in each Sell PO detail payload |
| `404` on `/api/distributor/{did}/assistant` | Sabi not enabled for distributor | don't render a Sabi UI |
| Stale dashboard for >30 min | OS payload is `read_or_compute`d | call `POST /api/distributor/{did}/operations-intelligence/refresh` to force |

---

## 9. P0 / P1 / P2 cut (mobile MVP)

### P0 — Ship in MVP (23)

Auth (5) · Home AI brief + 6 KPIs + Revenue Trend + Top/Attention wholesalers + Stockout + Pipeline + AI actions + Refresh OS (9) · Buy list + Place upstream PO modal (2) · Sell list (retailer+WHO) + Detail + state-machine actions (3) · Wholesalers list + Detail (2) · Inventory list + Adjust modal (2) · Notifications + Profile/Sign-out + Plumbing (offline/skeleton/pull-refresh) (2).

> See `DISTRIBUTOR_MOBILE_UX_PLAN.md` §8 for the full 23-item table.

### P1 — v1.1 (9)

Performance Matrix · Regional Coverage · Inventory Health donut · Wholesaler → Retailer drill-down · Key-account retailer detail · Product detail · RFQs list + Respond · Intelligence Center (Brief + Recs ack + Stockout + Delivery ETA) · Executive Analytics.

### P2 — Defer (6)

Incoming wholesaler POs cross-tier · Intel Retailer Health · Intel External signals · Intel Live Feed (blocked on backend 500) · Intel Copilot chat · CSV reports.

### Out of scope completely (backend doesn't exist)

- Sabi Copilot for distributors (404)
- Push notifications + preferences
- Driver / Vehicle CRUD
- Payments / credit / invoicing
- Promotions authoring
- CRM / messaging downstream
- Live control-tower map (distributor has no vehicle data exposed)

---

## 10. Quick sanity test (mobile agent should run before shipping)

```bash
BASE=https://supply-chain-hub-189.preview.emergentagent.com
EMAIL=mfr-0001-dst-0001@tradekonekt.io
PASS=TradeKonekt2026!
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
DID=f9dfaf08-4ee2-3c64-e96b-983c385625b2

# Each of these should return 200
for path in \
  "/api/distributor/$DID/operations-intelligence" \
  "/api/distributor/$DID/wholesaler-network" \
  "/api/distributor/$DID/retailers" \
  "/api/distributor/$DID/orders" \
  "/api/procurement/purchase-orders?distributor_id=$DID" \
  "/api/distributor/$DID/incoming-wholesaler-pos" \
  "/api/procurement/quotes?distributor_id=$DID" \
  "/api/inventory?owner_type=distributor&owner_id=$DID" \
  "/api/products" \
  "/api/manufacturers" \
  "/api/intel/exec-summary?role=distributor&entity_id=$DID" \
  "/api/intel/recommendations?role=distributor&entity_id=$DID" \
  "/api/intel/forecasts/stockout?role=distributor&entity_id=$DID" \
  "/api/notifications?target_type=distributor&target_id=$DID"
do
  echo -n "$path  "
  curl -s -o /dev/null -w "%{http_code}\n" "$BASE$path" -H "Authorization: Bearer $TOKEN"
done
```

All fourteen should print `200`. If any prints something else, stop and contact the backend team.

> ⚠️ Two endpoints are intentionally **excluded** from the smoke test because they're known-broken for this distributor tenant:
> - `/api/distributor/{did}/overview` → use `/operations-intelligence` instead.
> - `/api/distributor/{did}/manufacturers` → use `/api/manufacturers` instead.
> - `/api/intel/feed?role=distributor` → returns 500 today; don't surface in the UI.

---

## 11. Companion docs (read these too)

- `DISTRIBUTOR_WORKSPACE_FUNCTIONAL_SPEC.md` — full functional inventory (every page on web) → `/api/public-docs/distributor-functional`
- `DISTRIBUTOR_MOBILE_UX_PLAN.md` — IA reasoning, P0/P1/P2 categorisation, UX rationale → `/api/public-docs/distributor-mobile-ux`
- `distributor_api_validation.md` — every endpoint with verified/partial/missing status → `/api/public-docs/distributor-api-validation`

---

## 12. What to ask the user before starting

1. **Framework?** React Native + Expo? Flutter? Native iOS+Android? (Recommend Expo for speed and OTA updates.)
2. **Single signed-in entity or multi-tenant switcher?** (Web is single; recommend single for MVP.)
3. **Brand assets** — logo, splash, dark-mode preference?
4. **Beta channel** — TestFlight + Google Internal Track? Or Expo dev builds first?

After those answers, build P0 in the order:

```
Auth → Home → Orders/Sell → Orders/Buy → Place upstream PO
     → Wholesalers list → Wholesaler Detail → Inventory list
     → Inventory Adjust → Notifications + Profile
```

---

*End of brief.*
