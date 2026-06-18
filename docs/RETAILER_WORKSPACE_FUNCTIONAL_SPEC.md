# Retailer Workspace — Functional Specification

**Audit date:** 2026-06-18  
**Scope:** TradeKonekt Retailer Web Workspace (production + preview)  
**Purpose:** Source-of-truth inventory of every feature a Retailer can use today on the web — to be used as the input brief for the Retailer Mobile App design.

> **Rule:** The Retailer Mobile App must be a faithful mobile-first port of what is documented here. No net-new functionality is to be designed at this stage.

---

## 1. Navigation Structure

### 1.1 Sidebar (primary nav)

The retailer sidebar (`Layout.jsx → navForRole("retailer")`) exposes exactly 7 destinations:

| # | Label         | Route          | Icon         | Renders                                        |
|---|---------------|----------------|--------------|------------------------------------------------|
| 1 | Dashboard     | `/dashboard`   | LayoutDash   | `RetailerDashboardV2`                          |
| 2 | Inventory     | `/inventory`   | Boxes        | `RetailerInventoryCommand`                     |
| 3 | Intelligence  | `/intel`       | BrainCircuit | `IntelligenceCenter` (retailer-scoped)         |
| 4 | Sales Book    | `/sales`       | Receipt      | `SalesBookView` (retailer-only route)          |
| 5 | Procurement   | `/procurement` | ShoppingCart | `RetailerProcurement`                          |
| 6 | Analytics     | `/analytics`   | BarChart3    | `AnalyticsView → NetworkAnalytics` (retailer)  |
| 7 | Reports       | `/reports`     | FileText     | `ReportsView`                                  |

### 1.2 Top-bar elements (always visible)

| Element                       | Where      | Behaviour                                    |
|-------------------------------|------------|----------------------------------------------|
| Mobile drawer toggle          | top-left   | Opens sidebar on small screens               |
| Entity label                  | top-left   | `{role} workspace` + `{name · region, city}` |
| Notifications popover         | top-right  | Bell icon + unread badge (see §6.3)          |
| Sidebar collapse toggle       | bottom-left| Persisted in `localStorage` (desktop)        |
| **Sign out / Switch account** | sidebar foot | Calls `signOut()`                          |
| **Sabi Copilot bubble**       | floating bottom-right (retailer only) | See §6.1   |

### 1.3 Sub-pages reachable from retailer surfaces

| Route                          | Triggered from                  | View                       |
|--------------------------------|---------------------------------|----------------------------|
| `/inventory/product/:productId`| Inventory rows · Low-stock card | `RetailerProductDetail`    |
| `/shipments` → redirects to `/procurement?tab=shipments` | Dashboard "Reorder previous" action |  |
| `/requests` → redirects to `/procurement` | Legacy URL                |  |

There are **no other deeper sub-pages** for the retailer persona today.

---

## 2. Dashboard (`/dashboard`) — `RetailerDashboardV2`

### 2.1 Page anatomy (top → bottom)

1. **Offline / cached-data indicator** (pill) — visible only when offline or showing cached data.
2. **AI Executive Brief** card (`IntelExecSummaryCard`) — Gemini-generated summary for the retailer.
3. **Hero card** — greeting, **Today's Sales** in ₦, units sold, embedded 7-day sparkline, `Refresh` button.
4. **KPI grid (2×2)** — see §2.2.
5. **Quick Action tiles (3)** — Restock my store · Voice order · Reorder previous.
6. **AI Insights** list — `RetailerAIInsights`, each insight may carry an action (open Smart Reorder).
7. **Near Stockout card** — list of SKUs with `days_remaining` close to zero + per-row Reorder button.
8. **Top Selling card** — leaderboard from `top_selling` + `fast_moving`.
9. **Incoming Shipments** (1–3 cards) — when at least one shipment is `!== "received"`.
10. **7-day Sales Trend chart** (recharts AreaChart) + cumulative revenue, turnover ×, reorder count.
11. **Activity Feed** (`RetailerActivityFeed`) — recent sales / shipments / reorders.

### 2.2 KPI cards (4)

| KPI label         | Source field                  | Tone gating                  |
|-------------------|-------------------------------|------------------------------|
| Pending Deliveries| `kpis.pending_deliveries`     | amber if >0 else slate       |
| Critical Stock    | `kpis.critical_count`         | rose if >0 else slate        |
| Inventory Units   | `kpis.inventory_units`        | slate                        |
| Stock Score       | `trend.stock_efficiency_score`| emerald (always)             |

### 2.3 Quick Actions (3)

| Tile                | Opens                                | Behaviour                          |
|---------------------|--------------------------------------|------------------------------------|
| Restock my store    | `SmartReorderPanel` (sheet)          | AI-suggested SKUs, qty pickers, submit → POs |
| Voice order         | `VoiceOrderModal`                    | Mic capture → `/assistant/transcribe` → cart |
| Reorder previous    | navigate to `/shipments` (procurement) | One-tap clone of past PO         |

### 2.4 Modals / sheets the dashboard owns

- `SmartReorderPanel` (sheet) — driven by `/retailer/{id}/reorder-suggestions`, submits via `quick-reorder`.
- `VoiceOrderModal` — capture audio → transcribe → propose items → confirm.

---

## 3. Inventory (`/inventory`) — `RetailerInventoryCommand`

### 3.1 KPI strip (7 cards)

`Inventory Value · Categories · SKUs Tracked · Inventory Units · Low Stock · Critical Stock · Aging Stock · Dead Stock`  
(Layout shows 7 — Aging + Dead Stock have tooltips explaining the rule.)

### 3.2 Cards & widgets

| Section                  | Test ID                       | Contents                                                       |
|--------------------------|-------------------------------|----------------------------------------------------------------|
| Stock Health donut       | `inv-cc-stock-health`         | Healthy / Low / Critical / Aging / Dead distribution           |
| AI Insights              | `inv-cc-ai-insights`          | Per-card actions: **Reorder** · **Transfer** · **Review**      |
| Low Stock Center         | `inv-cc-low-stock`            | Table of low/critical rows · per-row **Reorder** button        |
| Value by Category        | `inv-cc-value-by-category`    | Horizontal bars, % share, value                                |
| 30-day Trend             | `inv-cc-trend`                | Recharts trend (value over time)                               |
| Fast Movers              | `inv-cc-fast-movers`          | Top velocity items                                             |
| Slow Movers              | `inv-cc-slow-movers`          | Bottom velocity items                                          |
| **Full Inventory Table** | `inv-cc-full-table`           | Search + SKU · Product · Category · Qty · Reorder · Status     |

### 3.3 Actions

| Action                                  | Trigger                                       |
|-----------------------------------------|-----------------------------------------------|
| **Open Product Detail**                 | Click any inventory row → `/inventory/product/:productId` |
| **Search inventory**                    | `data-testid="inventory-search"` input        |
| **Reorder a low-stock SKU**             | Per-row CTA in Low Stock Center               |
| **Acknowledge AI insight**              | Inline insight CTA (reorder / transfer / review) |

### 3.4 Product Detail (`/inventory/product/:productId`) — `RetailerProductDetail`

Read-only top section: name · SKU · barcode · category · manufacturer · cost price · stock health chips.

**Editable fields (retailer-owned only):**
- Retail price (`unit_price`)
- Reorder level
- Notes (free text)
- Recomputes margin % live

**Other content on this page:**
- Sales performance: 30-day & 90-day revenue, units, avg basket
- 30-day daily trend chart
- Recent supply (latest POs for this SKU, with `POStatusBadge`)

---

## 4. Sales Book (`/sales`) — `SalesBookView`

Retailer-only route. Header CTA: **+ New Sale**. Also exposes a mobile FAB (`new-sale-fab`).

### 4.1 Tabs (3)

| Tab        | Test ID              | Contents                                                            |
|------------|----------------------|---------------------------------------------------------------------|
| Today      | `sales-tab-dashboard`| 6-card KPI strip + recent sales list + AI insights                  |
| Sales Book | `sales-tab-ledger`   | Full paged ledger with search, date range, payment filter, export   |
| Analytics  | `sales-tab-analytics`| 30-day revenue chart, top products, payment-method donut, basket analysis |

### 4.2 KPI strip (6)

`Sales Today (units) · Revenue Today (₦) · Transactions · Avg. Basket · Pending Credit · Top Seller`

### 4.3 New Sale dialog (`SaleEntryDialog`)

- Add line items (product picker, qty, override price)
- Pick payment method: **Cash · Transfer · POS · Credit**
- Optional customer name / phone for credit sales
- Submits → `POST /retailer/{id}/sales` → inventory auto-decremented

### 4.4 Ledger actions

| Action            | Endpoint                                                | Notes                                 |
|-------------------|---------------------------------------------------------|---------------------------------------|
| List sales        | `GET /retailer/{id}/sales?limit&date_from&date_to&payment_method` | Server-side filters         |
| **Mark Paid**     | `PATCH /retailer/{id}/sales/{sale_id}/mark-paid` body `{payment_method}` | Closes a credit sale  |
| Export to CSV     | `GET /retailer/{id}/sales/export.csv?date_from&date_to` | Download                              |
| Search            | Client-side text filter                                 | By product name / customer            |

### 4.5 Analytics tab content

Revenue trend (Area), units trend (Bar), payment-mix (Pie), top 10 products by revenue, weekday-of-week heat, AI insights from server.

---

## 5. Procurement (`/procurement`) — `RetailerProcurement`

5-tab workspace + always-visible AI Procurement Assistant rail.

### 5.1 Tabs

| Tab                | Test ID         | Component               | Badge          |
|--------------------|-----------------|-------------------------|----------------|
| Cart               | `tab-cart`      | `CartTab`               | unique SKUs    |
| Purchase Orders    | `tab-orders`    | `PurchaseOrdersTab`     | open POs       |
| Order History      | `tab-history`   | `OrderHistoryTab`       | —              |
| Supplier Quotes    | `tab-quotes`    | `SupplierQuotesTab`     | open + responded quotes |
| Shipments          | `tab-shipments` | `ShipmentTrackerLegacy` | —              |

### 5.2 Cart actions

| Action          | Endpoint                                                                |
|-----------------|-------------------------------------------------------------------------|
| Read cart       | `GET /procurement/cart/{retailer_id}`                                   |
| Add item        | `POST /procurement/cart/{retailer_id}/items`                            |
| Update qty      | `PATCH /procurement/cart/{retailer_id}/items/{product_id}?distributor_id` |
| Remove item     | `DELETE /procurement/cart/{retailer_id}/items/{product_id}?distributor_id` |
| Clear cart      | `DELETE /procurement/cart/{retailer_id}`                                |
| Submit → PO     | `POST /procurement/cart/{retailer_id}/submit`                           |

### 5.3 Purchase Orders — statuses & actions

**Status set:** `draft · submitted · approved · processing · shipped · in_transit · delivered · cancelled · rejected`

| Action     | Endpoint                                              | Available in status…                 |
|------------|-------------------------------------------------------|--------------------------------------|
| List POs   | `GET /procurement/purchase-orders?retailer_id&statuses`| any                                  |
| PO detail  | `GET /procurement/purchase-orders/{po_id}`             | any (includes live shipment + vehicle) |
| Submit     | `POST .../submit`                                      | `draft`                              |
| Approve    | `POST .../approve`                                     | `submitted`                          |
| Reject     | `POST .../reject`                                      | `submitted`                          |
| Process    | `POST .../process`                                     | `approved`                           |
| Ship       | `POST .../ship`                                        | `processing`                         |
| Deliver    | `POST .../deliver`                                     | `shipped/in_transit` (auto by sim)   |
| Cancel     | `POST .../cancel`                                      | any pre-shipped                      |
| Duplicate  | `POST .../duplicate`                                   | any (clones into a new draft)        |

The PO Detail drawer (`PODetailDrawer`) shows: items, supplier, dates, **live truck ETA + vehicle code + destination** (in transit), status history.

### 5.4 Supplier Quotes (RFQ)

| Action          | Endpoint                                            |
|-----------------|-----------------------------------------------------|
| List quotes     | `GET /procurement/quotes?retailer_id&status`        |
| Create quote    | `POST /procurement/quotes`                          |
| Distributor responds | `POST /procurement/quotes/{quote_id}/respond`  |
| Close quote     | `POST /procurement/quotes/{quote_id}/close`         |
| Accept → PO     | `POST /procurement/purchase-orders` (via UI button) |

### 5.5 AI Procurement Assistant (right rail)

Component `AIProcurementAssistant`. Chat-style copilot; exposes server-driven actions like "add to cart", "create draft PO", "ask for quote". Same endpoints as §6.1.

### 5.6 Shipments tab (`ShipmentTrackerLegacy`)

Inbound shipments ledger filtered to the retailer (`from-distributor → retailer` flow). Tracking code + status + delivery ETA.

---

## 6. Account · Notifications · Assistant

### 6.1 Sabi Copilot (floating bubble — retailer-only)

`RetailerAssistantBubble.tsx`. Endpoints:

| Endpoint                                                     | Use                            |
|--------------------------------------------------------------|--------------------------------|
| `POST /retailer/{id}/assistant`                              | Text chat message              |
| `POST /retailer/{id}/assistant/transcribe`                   | Voice → text (audio upload)    |
| `POST /retailer/{id}/assistant/execute`                      | Execute a server-returned action (e.g. create PO) |

UI actions handled by the bubble:
- `open_smart_reorder` / `show_low_stock` → navigate `/dashboard` and dispatch `retailer:open-smart-reorder`
- `open_voice_order` → navigate `/dashboard` and dispatch `retailer:open-voice-order`
- `refresh-dashboard` → dispatch `retailer:refresh-dashboard`

### 6.2 Account / Profile

**Today there is no dedicated `/profile` or `/settings` page for retailers.** The only account-level surfaces are:

| Action          | Surface                                  | Endpoint              |
|-----------------|------------------------------------------|-----------------------|
| Read self       | Implicit on login                        | `GET /auth/me`        |
| Login           | `/login`                                 | `POST /auth/login`    |
| Refresh token   | axios interceptor                        | `POST /auth/refresh`  |
| Sign out        | Sidebar foot **"Switch account"** button | `POST /auth/logout`   |
| Forgot password | `/login` link                            | `POST /auth/forgot-password` → `POST /auth/reset-password` |

> Editable retailer profile / store settings (logo, business hours, address) **do not yet exist** on the web. The mobile app should mirror that gap — do not introduce them now.

### 6.3 Notifications

`NotificationsPopover` (top-bar bell).

| Action               | Endpoint                                  |
|----------------------|-------------------------------------------|
| List notifications   | `GET /notifications`                      |
| Mark one as read     | `PATCH /notifications/{notif_id}/read`    |
| Mark all as read     | `PATCH /notifications/read-all`           |

---

## 7. Analytics (`/analytics`) — `AnalyticsView → NetworkAnalytics`

For the retailer persona the page shows their **shipment, request & inventory pulse**:

| Block                                | Source                                   |
|--------------------------------------|------------------------------------------|
| KPI strip (4)                        | `kpis.total_shipments · pending+in_transit · inventory_total · open_requests` |
| Shipment Pipeline tile (3)           | Pending · In Transit · Received          |
| Shipments — last 14 days (Area)      | `timeline`                               |
| Status Mix (Pie)                     | `status_breakdown`                       |
| Top Products by Units Shipped (Bar)  | `top_products`                           |

Endpoint: `GET /analytics?role=retailer&entity_id={id}` (mapped to `Api.analytics`).

---

## 8. Intelligence (`/intel`) — `IntelligenceCenter`

Dark "command-center" view, scoped to the retailer entity.

| Card                       | Endpoint                                        |
|----------------------------|-------------------------------------------------|
| Executive Brief            | `GET /intel/exec-summary?role&entity_id` + regenerate POST |
| Live Feed                  | `GET /intel/feed?role&entity_id&limit`          |
| Stockout Forecasts         | `GET /intel/forecasts/stockout`                 |
| Recommendations + ACK      | `GET /intel/recommendations` · `PATCH /intel/recommendations/{id}` |
| External Signals (weather) | `GET /intel/external`                           |
| Retailer Health (peers)    | `GET /intel/retailer-health`                    |
| Logistics (delivery ETAs)  | `GET /intel/delivery-eta`                       |
| Sabi Copilot inline chat   | `POST /intel/copilot`                           |
| Alerts                     | `GET /intel/alerts`                             |

---

## 9. Reports (`/reports`) — `ReportsView`

Just two CSV downloads:

| Report     | Endpoint                                                                   |
|------------|----------------------------------------------------------------------------|
| Shipments  | `GET /reports/shipments.csv?role=retailer&entity_id={id}` (Api.reportShipmentsCsv) |
| Inventory  | `GET /reports/inventory.csv?role=retailer&entity_id={id}` (Api.reportInventoryCsv) |

No filters / no preview / no scheduling.

---

## 10. Master Capability Matrix

> Mobile Priority: **P0** = must ship in mobile MVP · **P1** = ship in v1.1 · **P2** = defer / web-only acceptable

| Feature                       | Page          | Actions Available                                              | API Endpoint(s)                                                       | Mobile Priority |
|-------------------------------|---------------|----------------------------------------------------------------|-----------------------------------------------------------------------|-----------------|
| Login / Sign-out              | `/login`      | Email + password · Forgot password                             | `POST /auth/login` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `POST /auth/logout` | **P0** |
| Read self                     | (boot)        | —                                                              | `GET /auth/me`                                                        | **P0**          |
| Refresh token                 | (silent)      | —                                                              | `POST /auth/refresh`                                                  | **P0**          |
| Dashboard hero + KPIs         | `/dashboard`  | View Today's sales, refresh, view 4 KPIs, view 7-day sparkline | `GET /retailer/{id}/dashboard` · `GET /retailer/{id}/sales-trend?days=7` | **P0**        |
| AI Executive Brief            | `/dashboard`  | Read summary                                                   | `GET /intel/exec-summary?role=retailer&entity_id={id}`                | **P0**          |
| AI Insights cards             | `/dashboard`  | Tap → opens Smart Reorder                                      | `GET /retailer/{id}/insights`                                         | **P0**          |
| Near Stockout list            | `/dashboard`  | Per-row Reorder                                                | from `/retailer/{id}/dashboard` (`near_stockout`)                     | **P0**          |
| Top Selling                   | `/dashboard`  | View                                                           | from `/retailer/{id}/dashboard` (`top_selling`/`fast_moving`)         | **P0**          |
| Incoming Shipments            | `/dashboard`  | View tracking, status                                          | from `/retailer/{id}/dashboard` (`recent_shipments`)                  | **P0**          |
| Activity Feed                 | `/dashboard`  | View                                                           | `GET /retailer/{id}/activity`                                         | **P1**          |
| Smart Reorder sheet           | `/dashboard`  | Select SKUs, qty, submit                                       | `GET /retailer/{id}/reorder-suggestions` · `POST /retailer/{id}/quick-reorder` | **P0** |
| Voice Order                   | `/dashboard`  | Capture audio, confirm                                         | `POST /retailer/{id}/assistant/transcribe` · `POST /retailer/{id}/assistant/execute` | **P1** |
| Inventory KPI strip (7)       | `/inventory`  | View                                                           | `GET /retailer/{id}/inventory-command-center`                         | **P0**          |
| Stock Health donut            | `/inventory`  | View                                                           | (same)                                                                | **P1**          |
| Low Stock Center              | `/inventory`  | Per-row Reorder                                                | (same) + `POST /procurement/cart/{id}/items` + `…/submit`             | **P0**          |
| Full Inventory table          | `/inventory`  | Search, open product detail                                    | (same)                                                                | **P0**          |
| Inventory AI insights         | `/inventory`  | Reorder · Transfer · Review                                    | (same)                                                                | **P1**          |
| Value by Category             | `/inventory`  | View                                                           | (same)                                                                | **P2**          |
| 30-day Trend                  | `/inventory`  | View                                                           | (same)                                                                | **P2**          |
| Fast/Slow movers              | `/inventory`  | View                                                           | (same)                                                                | **P1**          |
| Product Detail — view         | `/inventory/product/:id` | View all metadata, stock health, sales history, recent POs | `GET /retailer/{id}/product/{product_id}`                       | **P0**          |
| Product Detail — edit         | (same)        | Edit retail price · reorder level · notes                      | `PATCH /retailer/{id}/product/{product_id}/pricing`                   | **P0**          |
| Sales Book — Today tab        | `/sales`      | View 6 KPIs + recent sales                                     | `GET /retailer/{id}/sales/summary` · `GET /retailer/{id}/sales?limit=6` | **P0**       |
| New Sale dialog               | `/sales`      | Add lines, set payment, submit                                 | `POST /retailer/{id}/sales`                                           | **P0**          |
| Sales ledger                  | `/sales`      | List, filter by date / payment, search                         | `GET /retailer/{id}/sales?...`                                        | **P0**          |
| Mark Paid (credit sale)       | `/sales`      | One-tap status flip                                            | `PATCH /retailer/{id}/sales/{sale_id}/mark-paid`                      | **P0**          |
| Sales export                  | `/sales`      | CSV download                                                   | `GET /retailer/{id}/sales/export.csv?date_from&date_to`               | **P2**          |
| Sales analytics tab           | `/sales`      | View charts                                                    | `GET /retailer/{id}/sales/analytics?days=30`                          | **P1**          |
| Procurement — Cart            | `/procurement`| Add, update qty, remove, clear, submit                         | `GET/POST/PATCH/DELETE /procurement/cart/{id}/*`                      | **P0**          |
| Procurement — PO list         | `/procurement`| Filter by status                                               | `GET /procurement/purchase-orders?retailer_id&statuses`               | **P0**          |
| Procurement — PO detail       | `/procurement`| View timeline + live truck ETA / vehicle code / destination    | `GET /procurement/purchase-orders/{po_id}`                            | **P0**          |
| PO actions (state machine)    | `/procurement`| Submit · Approve · Reject · Process · Ship · Deliver · Cancel · Duplicate | `POST /procurement/purchase-orders/{id}/{action}`           | **P1**          |
| Order History                 | `/procurement`| View past POs                                                  | `GET /procurement/purchase-orders?retailer_id` (closed states)        | **P1**          |
| Supplier Quotes               | `/procurement`| Create RFQ · Accept · Close                                    | `GET/POST /procurement/quotes/*`                                      | **P1**          |
| Shipments tab                 | `/procurement`| View inbound shipments, tracking codes                         | `GET /shipments?retailer_id={id}` (via ShipmentTrackerLegacy)         | **P0**          |
| AI Procurement Assistant rail | `/procurement`| Chat with copilot, execute actions                             | `POST /retailer/{id}/assistant` · `…/execute`                         | **P1**          |
| Sabi Copilot bubble           | global        | Text + voice chat · trigger UI actions                         | `POST /retailer/{id}/assistant` · `…/transcribe` · `…/execute`        | **P1**          |
| Intelligence — Executive Brief| `/intel`      | View, regenerate                                               | `GET/POST /intel/exec-summary`                                        | **P1**          |
| Intelligence — Live Feed      | `/intel`      | View                                                           | `GET /intel/feed`                                                     | **P1**          |
| Intelligence — Stockout forecasts | `/intel`  | View                                                           | `GET /intel/forecasts/stockout`                                       | **P1**          |
| Intelligence — Recommendations| `/intel`      | Acknowledge                                                    | `GET /intel/recommendations` · `PATCH /intel/recommendations/{id}`    | **P1**          |
| Intelligence — Retailer Health| `/intel`      | View peer comparison                                           | `GET /intel/retailer-health`                                          | **P2**          |
| Intelligence — Delivery ETA   | `/intel`      | View                                                           | `GET /intel/delivery-eta`                                             | **P1**          |
| Intelligence — External signals| `/intel`     | Weather / holidays                                             | `GET /intel/external`                                                 | **P2**          |
| Intelligence — Copilot chat   | `/intel`      | Chat                                                           | `POST /intel/copilot`                                                 | **P2**          |
| Analytics                     | `/analytics`  | View shipment pipeline + 14-day chart + status mix + top products | `GET /analytics?role=retailer&entity_id={id}`                     | **P1**          |
| Reports — Shipments CSV       | `/reports`    | Download                                                       | `GET /reports/shipments.csv?role=retailer&entity_id={id}`             | **P2**          |
| Reports — Inventory CSV       | `/reports`    | Download                                                       | `GET /reports/inventory.csv?role=retailer&entity_id={id}`             | **P2**          |
| Notifications popover         | top-bar       | List · mark one read · mark all read                           | `GET /notifications` · `PATCH /notifications/{id}/read` · `PATCH /notifications/read-all` | **P0** |
| Offline awareness             | `/dashboard`  | Show "cached data" / "offline" pill, queue reorders            | `localStorage` cache via `retailerAnalyticsService`                   | **P0**          |

---

## 11. Things explicitly NOT present on the retailer web today (so the mobile app should NOT have them either)

- ❌ Dedicated **Profile** or **Settings** page (no logo upload, business-hours editor, address change).
- ❌ **Push notifications / preferences** UI — only in-app bell list.
- ❌ **Multi-store switcher** (a retailer user maps to exactly one entity).
- ❌ **Wallet / Payments / Credit limit** dashboards.
- ❌ **In-app messaging** between retailer and supplier (only Sabi assistant chat).
- ❌ Promotions / coupons workspace.
- ❌ Customer CRM (customer name is captured only inside a credit sale).

---

## 12. Mobile MVP scope recommendation (derived from this audit)

**Must-have for MVP (P0):**

1. **Login** (+ token refresh, sign-out, forgot-password).
2. **Dashboard** — hero (Today's Sales), 4 KPIs, AI brief, AI insights, Near Stockout, Top Selling, Incoming Shipments.
3. **Smart Reorder** sheet (1-tap restock).
4. **Inventory** — 7 KPI strip, search, list, **Product Detail with editable price / reorder / notes**, low-stock reorder action.
5. **Sales Book** — Today KPIs + recent + **New Sale** + **Mark Paid** + paged ledger w/ filters.
6. **Procurement** — Cart + PO list + PO detail (live truck ETA) + Shipments inbound list.
7. **Notifications** (bell list + mark read).
8. **Offline cache** parity with the web (last-seen dashboard, queued reorders).

**v1.1 (P1):**

Voice ordering · Sales analytics tab · Procurement PO state actions · Supplier Quotes · Sabi Copilot bubble · Intelligence Center (Brief + Forecasts + Recommendations + Delivery ETA) · Fast/Slow movers · Activity feed · Network Analytics page.

**Defer (P2):**

CSV exports · External signals card · Retailer Health peer comparison · Inventory Value-by-Category & 30-day trend chart · Intel Copilot chat (separate from the bubble).

---

## 13. Auth & infra notes for the mobile agent

- **Base URL (prod):** `https://www.app.tradekonekt.com`
- **All API routes are prefixed `/api`.**
- **Auth header:** `Authorization: Bearer <access_token>`
- **CORS:** wildcard `*` (no extra config needed on mobile).
- **Universal demo password:** `TradeKonekt2026!` (full roster: `/app/memory/test_credentials.md`).
- **Retailer test account:** `mfr-0001-rtl-0001@tradekonekt.io` / `TradeKonekt2026!` (entity_id `49e47d4f-914a-733f-3aa6-37f716dfe766`).

---

*End of spec — proceed to mobile design only after this is signed off.*
