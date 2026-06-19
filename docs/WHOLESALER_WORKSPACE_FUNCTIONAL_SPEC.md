# Wholesaler Workspace — Functional Specification

**Audit date:** 2026-06-18  
**Scope:** TradeKonekt Wholesaler Web Workspace (production + preview)  
**Purpose:** Source-of-truth inventory of every feature a Wholesaler can use today on the web — used as input brief for the Wholesaler Mobile App design (W0 discovery).

> **Rule:** Do not introduce new functionality at this stage. This document describes only what already exists in production code.

---

## 1. Navigation Audit

Wholesaler sidebar (`Layout.jsx → navForRole("wholesaler")`) — **7 destinations**:

| # | Label              | Route                       | Component rendered            | Purpose                                                       | Key actions                                                  |
|---|--------------------|-----------------------------|-------------------------------|---------------------------------------------------------------|--------------------------------------------------------------|
| 1 | Dashboard          | `/dashboard`                | `WholesalerDashboard`         | Command center: KPIs, inventory health, AI insights, stockout risks | Refresh (data-pull only)                              |
| 2 | Inventory          | `/inventory`                | `WholesalerInventory`         | Manage SKUs, available/reserved/damaged/in-transit            | **Receive Stock** · **Adjust** · **Cycle Count** · Search · Health filter |
| 3 | Procurement        | `/procurement`              | `WholesalerProcurement`       | Place upstream POs to distributors (your suppliers)           | **Create PO** · transition (submit/approve/reject/allocate/ship/deliver/cancel) |
| 4 | Retailer Network   | `/network`                  | `WholesalerDistributors`* (legacy filename, retailer-tier scope after P0 sprint) | Customer base: retailers served | Search · Open detail              |
| 5 | Customer Orders    | `/wholesaler/orders`        | `WholesalerOrders`            | Inbound orders from retailers + fulfillment lifecycle         | **Approve · Reject · Modify · Cancel** · Start Picking · Complete Picking · Report Shortage · Start Packing · Complete Packing · Ready Dispatch · Dispatch |
| 6 | Shipments          | `/wholesaler/shipments`     | `WholesalerShipments`         | Outbound shipments (post-dispatch tracking)                   | Filter status · **Delay** · **Cancel** · Open detail         |
| 7 | Analytics          | `/analytics`                | `WholesalerAnalytics`         | 7-tab analytics workspace                                     | Switch tabs · Filter periods (built-in)                      |
| 8 | Intelligence Center| `/wholesaler/intelligence`  | `WholesalerIntelligenceCenter`| Rule-based briefings, opportunities, risks, actions           | Read-only (no acknowledge yet)                               |

### 1.1 Sub-pages / extra routes

| Route                                              | Triggered from              | View                          | Purpose                                            |
|----------------------------------------------------|-----------------------------|-------------------------------|----------------------------------------------------|
| `/wholesaler/fulfillment`                          | (orphan, also `Customer Orders` opens detail) | `WholesalerFulfillment` | Standalone fulfillment-pipeline workspace |
| `/wholesaler/distributors/:distributorId`          | Retailer Network row click  | `WholesalerDistributorDetail` | Per-customer detail (90-day rev, recent POs, SKUs) |
| `/reports`                                         | (no sidebar entry today)    | `ReportsView`                 | CSV exports — shipments + inventory                |
| `/intel`                                           | (no sidebar entry — falls back to `/wholesaler/intelligence`) | `IntelligenceCenter` | Generic intel page (does **not** support wholesaler role) |

### 1.2 Always-visible chrome

| Element                       | Where         | Behaviour                                                 |
|-------------------------------|---------------|-----------------------------------------------------------|
| Mobile drawer toggle          | top-left      | Opens sidebar on small screens                            |
| Entity label                  | top-left      | `Wholesaler workspace` + `{name · region, city}`          |
| Notifications popover         | top-right     | Bell icon + unread badge (see §10)                        |
| Sidebar collapse toggle       | bottom-left   | Persisted in `localStorage` (desktop)                     |
| **Sign out / Switch account** | sidebar foot  | Calls `signOut()`                                         |
| Sabi Copilot bubble           | —             | **NOT enabled for wholesalers today** (retailer-only)     |

---

## 2. Dashboard Audit (`/dashboard` — `WholesalerDashboard`)

### 2.1 KPI strip (8 cards)

| KPI                       | Test ID                | Source field                          | Tone gating                  |
|---------------------------|------------------------|---------------------------------------|------------------------------|
| Inventory Value           | `kpi-inventory-value`  | `kpis.inventory_value.value`          | —                            |
| Inventory Units           | `kpi-inventory-units`  | `kpis.inventory_units.value`          | —                            |
| Pending POs               | `kpi-pending-pos`      | `kpis.pending_pos.value`              | warning if >0                |
| Incoming Shipments        | `kpi-incoming-shipments`| `kpis.incoming_shipments.value`      | —                            |
| Outgoing Shipments        | `kpi-outgoing-shipments`| `kpis.outgoing_shipments.value`      | —                            |
| Active Retailers          | `kpi-active-retailers` | `kpis.active_retailers.value` (fallback `active_distributors`) | — |
| Inventory Turnover (90d)  | `kpi-inventory-turnover`| `kpis.inventory_turnover.value`      | —                            |
| Stockout Risks            | `kpi-stockout-risks`   | `kpis.stockout_risks.value`           | alert if >0 else positive    |

### 2.2 Widgets / Cards

| Section                  | Test ID                | Contents                                                                  |
|--------------------------|------------------------|---------------------------------------------------------------------------|
| Inventory Health         | `inventory-health-card`| Health bars: Healthy / Low Stock / Excess / Expiring · total SKUs counter |
| **AI Insights**          | `ai-insights-card`     | 1–4 rule-based `ToneCard`s (replenishment, customer base, expiry, turnover, etc.) |
| Stockout Risk Watchlist  | `stockout-risk-card`   | Table: product · SKU · on hand · reorder level · days left · severity (`out` / `critical` / `low`) |

### 2.3 Data source

Single endpoint: `GET /api/wholesaler/{wid}/overview`

---

## 3. Inventory Audit (`/inventory` — `WholesalerInventory`)

### 3.1 KPI strip (4 cards)

| KPI         | Source                              |
|-------------|-------------------------------------|
| Total SKUs  | `summary.total_skus`                |
| Total Value | `summary.total_value`               |
| Total Units | `summary.total_units`               |
| At Risk SKUs| `summary.low_stock + out_of_stock`  |

### 3.2 Tabs

| Tab               | Test ID         | Contents                                                                 |
|-------------------|-----------------|--------------------------------------------------------------------------|
| Stock Catalogue   | `tab-catalogue` | Full inventory table with **search**, **health filter** (all/healthy/low/out/excess), per-row actions |
| Movements         | `tab-movements` | Last 30 movements: kind (`po_receive`, `manual_adjust`, `cycle_count`, `customer_dispatch`, etc.) |

### 3.3 Filters & Search

- **Search box** — `inv-search` — matches `product_name` + `sku`
- **Health filter** — `inv-health-filter` — `all / healthy / low / out / excess`
- No category filter, no date filter (movements show "last 30" only)

### 3.4 Inventory row columns

`Product · SKU · Available · Reserved · Damaged · In Transit · Reorder Level · Value · Health · Actions`

### 3.5 Available Actions

| Action            | UI Trigger                    | Endpoint                                                            | Notes                                |
|-------------------|-------------------------------|---------------------------------------------------------------------|--------------------------------------|
| **Receive Stock** | Header `Receive Inventory` btn| `POST /wholesaler/{wid}/inventory/receive`                          | Body: `{product_id, quantity, source, reference, notes}` |
| **Adjust Stock**  | Row → Adjust                  | `POST /wholesaler/{wid}/inventory/{product_id}/adjust`              | Body: `{delta, reason, notes}`       |
| **Cycle Count**   | Row → Cycle Count             | `POST /wholesaler/{wid}/inventory/{product_id}/cycle-count`         | Body: `{counted, notes}`             |
| Refresh           | Header refresh button         | re-pulls `inventory` + `movements`                                  |                                      |
| Search / filter   | inline                        | client-side                                                         |                                      |

### 3.6 Movements ledger (read-only)

Columns: `When · Product · Kind · Delta · Reference`. From `GET /wholesaler/{wid}/inventory/movements?limit=30`.

> ❌ No "Transfer" action between locations (single hub model today).  
> ❌ No "Allocate" action from inventory (allocation happens implicitly when an order is approved → §4).  
> ❌ No "Reorder" action from inventory — replenishment goes through Procurement (§5).

---

## 4. Order Management Audit (`/wholesaler/orders` — `WholesalerOrders`)

The biggest module. Inbound retailer orders + the entire fulfillment pipeline.

### 4.1 Order States (canonical)

```
submitted → approved → allocated → picking → picked → packing → packed
→ ready_for_dispatch → shipped → delivered
                ↳ rejected · cancelled · backordered
```

State machine source: `WholesalerOrders.jsx` (`FUNNEL_STEPS`, `STATUS_TONE`) + `wholesaler_orders.py`.

### 4.2 Dashboard widgets

| Widget                    | Source                                              |
|---------------------------|-----------------------------------------------------|
| KPI funnel (7 stages)     | `GET /wholesaler/{wid}/orders/dashboard.kpi.funnel` |
| Open Orders count         | dashboard.kpi.open_orders                           |
| Stockouts (today)         | dashboard.kpi.stockouts_today                       |
| Avg time-to-approve       | dashboard.kpi.avg_time_to_approve                   |
| Avg time-to-ship          | dashboard.kpi.avg_time_to_ship                     |
| AI insights               | dashboard.ai_insights (rule-based)                  |
| Filter chips (status)     | client                                              |
| Search box                | client (matches po_number, retailer name, items)    |

### 4.3 Available Actions (full lifecycle)

| Phase           | Action               | Endpoint                                                                      | Valid from status                |
|-----------------|----------------------|-------------------------------------------------------------------------------|----------------------------------|
| Intake          | List orders          | `GET /wholesaler/{wid}/orders` / `…/customer-orders`                          | —                                |
| Intake          | Order detail         | `GET /wholesaler/{wid}/orders/{order_id}`                                     | —                                |
| Intake          | **Create order** (manual entry) | `POST /wholesaler/{wid}/orders`                                    | —                                |
| Triage          | **Approve**          | `POST .../orders/{id}/approve`                                                | `submitted`                      |
| Triage          | **Reject**           | `POST .../orders/{id}/reject` (`{reason}`)                                    | `submitted`                      |
| Triage          | **Modify**           | `POST .../orders/{id}/modify` (line edits, qty/price)                         | `submitted` · `approved`         |
| Triage          | **Cancel**           | `POST .../orders/{id}/cancel`                                                 | any pre-shipped                  |
| Fulfilment      | List fulfillments    | `GET /wholesaler/{wid}/fulfillments`                                          | —                                |
| Fulfilment      | Fulfilment detail    | `GET /wholesaler/{wid}/fulfillments/{ful_id}`                                 | —                                |
| Fulfilment      | **Start Picking**    | `POST .../fulfillments/{ful_id}/start-picking`                                | `allocated`                      |
| Fulfilment      | **Complete Picking** | `POST .../fulfillments/{ful_id}/complete-picking`                             | `picking`                        |
| Fulfilment      | **Report Shortage**  | `POST .../fulfillments/{ful_id}/report-shortage` (`{items[], notes}`)         | `picking` · `picked`             |
| Fulfilment      | **Start Packing**    | `POST .../fulfillments/{ful_id}/start-packing`                                | `picked`                         |
| Fulfilment      | **Complete Packing** | `POST .../fulfillments/{ful_id}/complete-packing`                             | `packing`                        |
| Fulfilment      | **Ready Dispatch**   | `POST .../fulfillments/{ful_id}/ready-dispatch`                               | `packed`                         |
| Fulfilment      | **Dispatch** (truck)  | `POST .../fulfillments/{ful_id}/dispatch` (`{vehicle_code?, driver?, eta?}`) | `ready_for_dispatch`             |

### 4.4 Allocation

Allocation happens **server-side automatically** on `approve`. The endpoint reserves inventory and emits a `fulfillment` record in `allocated` state. There is no separate "Allocate Inventory" UI button.

### 4.5 Order detail dialog

Shows: header (status + priority chip), items table (product · qty · unit_price · subtotal), notes/instructions, status history, available actions for the current state.

---

## 5. Retailer Management Audit (`/network` — `WholesalerDistributors`)

> The component file is still named `WholesalerDistributors.jsx` (pre-rename), but after the P0 sprint the **data and labels reflect retailers**. The backend endpoint `/distributors` is now serving the retailer roster downstream of this wholesaler.

### 5.1 Visible per customer

| Capability                                | Visible? | Source                          |
|-------------------------------------------|----------|---------------------------------|
| Retailer directory (list + search)        | ✅       | `GET /wholesaler/{wid}/distributors` |
| Retailer summary KPIs (count, active 90d) | ✅       | same                            |
| Retailer purchase history (90 days)       | ✅       | `GET /wholesaler/{wid}/distributors/{distributor_id}/detail` (legacy URL) |
| Retailer performance score                | ✅       | `health_score`, `purchase_frequency_90d` |
| Retailer growth trend                     | ✅       | revenue 90d trend chart on detail page |
| **Retailer credit exposure**              | ❌       | Not modelled — no credit layer  |
| **Retailer geography (map view)**         | ❌       | Map exists for shipments only (§6) |

### 5.2 Available actions

| Action           | Trigger                  | Endpoint                                                            |
|------------------|--------------------------|---------------------------------------------------------------------|
| Search retailers | inline search             | client-side                                                         |
| Open detail page | row click                 | navigate `/wholesaler/distributors/:id`                              |
| (no create / suspend / edit retailer actions today)                                                                            |

---

## 6. Logistics Audit (`/wholesaler/shipments` — `WholesalerShipments`)

### 6.1 Shipments

| State set           | Source                                                  |
|---------------------|---------------------------------------------------------|
| `created · loaded · in_transit · delivered · delayed · cancelled · failed` | `SHIP_STAGES` + `SHIP_TONE` |

### 6.2 Dashboard widgets (`/wholesaler/{wid}/shipments/dashboard`)

| Widget                | Source field        |
|-----------------------|---------------------|
| Shipments in transit  | `kpis.in_transit`   |
| Delivered (7d)        | `kpis.delivered_7d` |
| On-time %             | `kpis.on_time_pct`  |
| Avg delivery hours    | `kpis.avg_delivery_hours` |
| Delayed today         | `kpis.delayed_today`|

### 6.3 Shipment row columns

`Tracking · Order # · Retailer · Vehicle · Status · ETA · Actions`

### 6.4 Actions

| Action               | Endpoint                                                  | Notes                                |
|----------------------|-----------------------------------------------------------|--------------------------------------|
| List shipments       | `GET /wholesaler/{wid}/shipments?status=&limit=`         | Filter chips by status               |
| Shipment detail      | `GET /wholesaler/{wid}/shipments/{ship_id}`               | Includes timeline, vehicle, route    |
| **Delay**            | `POST /wholesaler/{wid}/shipments/{ship_id}/delay` (`{reason, new_eta}`) | Adds delay event           |
| **Cancel**           | `POST /wholesaler/{wid}/shipments/{ship_id}/cancel`       | Returns reserved stock               |

### 6.5 Vehicles / Drivers / Routes

- **Vehicles:** read-only — vehicle_code attached at dispatch. No vehicle management UI.
- **Drivers:** captured only as a string field on the dispatch payload. No driver directory.
- **Live tracking map:** `/wholesaler/{wid}/control-tower/map` endpoint exists and is consumed by the Analytics → **Control Tower** tab (`WholesalerControlTowerMap` component). Live truck markers with leg-type filtering (wholesaler→retailer).
- **Route visibility / ETA:** read directly from the shipment detail (`route_steps`, `current_position`, `eta_minutes`). Same control-tower data model as manufacturer.
- **Dispatch queue:** the `ready_for_dispatch` filter inside Customer Orders / Fulfillment view is the de-facto queue.

---

## 7. Analytics Audit (`/analytics` — `WholesalerAnalytics`)

A 7-tab workspace powered by **a single fat endpoint:** `GET /api/wholesaler/{wid}/analytics`.

| Tab             | Test ID                  | Contents                                                                                                                  |
|-----------------|--------------------------|---------------------------------------------------------------------------------------------------------------------------|
| Overview        | `tab-overview`           | 8 KPIs (inv value, inv units, rev 30d, fill rate, turnover, days of supply, active distributors, PO lead) + 90-day order trend AreaChart |
| Inventory       | `tab-inv`                | Inventory turnover, DoS, top-value SKUs, slow movers, excess stock value, ABC mix                                         |
| Distributors    | `tab-dist`               | Top retailers by revenue, frequency, recency · growth/decline · churn risk                                                |
| Orders          | `tab-orders-analytics`   | Funnel (submitted→delivered), avg approval & ship times, reject reasons, top products by order volume                     |
| Procurement     | `tab-procurement`        | Upstream PO performance: supplier on-time, lead time, fill rate, top suppliers, spend by supplier                          |
| Demand Forecast | `tab-forecast`           | 30-day product-level forecast bars + suggested reorder qtys (rule-based)                                                  |
| Control Tower   | `tab-control-tower`      | Live Mapbox/Leaflet map of outbound trucks with leg-type filter — uses `/wholesaler/{wid}/control-tower/map`              |

### 7.1 Charts inventory

Area, Bar, Pie (status mix), Heatmap (weekday × hour), horizontal bars (top retailers, top SKUs), KPI tiles, recharts everywhere.

### 7.2 Forecasts

Built rule-based on the 90-day order history (no LLM). Each SKU receives:
- `forecast_30d_units`
- `suggested_reorder_units`
- `confidence_pct`

> ⚠️ The generic `/api/analytics?role=wholesaler` endpoint returns **HTTP 400** — wholesaler is **not** a supported role on the shared retailer/manufacturer analytics route. All wholesaler analytics flow through `/api/wholesaler/{wid}/analytics` instead.

---

## 8. Intelligence Audit (`/wholesaler/intelligence` — `WholesalerIntelligenceCenter`)

Rule-based briefing surfaced from the `intelligence` block of `/wholesaler/{wid}/analytics`. **No LLM calls.**

### 8.1 KPI strip

| KPI                          | Source                                |
|------------------------------|---------------------------------------|
| Revenue (90d)                | `intelligence.snapshot.total_revenue_90d` |
| Projected Rev (30d)          | `intelligence.snapshot.projected_revenue_30d` |
| Urgent Replenishments        | `intelligence.snapshot.urgent_replenishments` |
| High Churn Risks             | `intelligence.snapshot.high_churn`    |

### 8.2 AI-powered widgets

| Widget                   | Source                              | Notes                                |
|--------------------------|-------------------------------------|--------------------------------------|
| Executive Briefing       | `intelligence.headlines[]`          | Bullet list of plain-English insights |
| Opportunities            | `intelligence.opportunities[]`      | Upsell / cross-sell / fast movers    |
| Risks                    | `intelligence.risks[]`              | Churn, expiry, deadstock, low turnover |
| Recommended Actions      | `intelligence.actions[]`            | Replenish, follow up retailer, adjust price |
| **Demand Forecasts**     | (Analytics tab → Demand Forecast)  | 30-day product-level                 |
| **Reorder Recommendations** | derived from forecast + on-hand  | Visible inside Analytics tab         |
| **Retailer Risk**         | `intelligence.snapshot.high_churn`  | + per-retailer detail page          |
| **Inventory Alerts**      | Dashboard Stockout Watchlist + Inventory health filter | (§2.2, §3) |
| **Opportunity Detection** | rule-based ✅                       |                                      |

> ❌ No retailer-style "Sabi Copilot" bubble · no acknowledge/dismiss action · no read/unread state on intel items today.  
> ❌ Generic `/api/intel/exec-summary?role=wholesaler` returns **400** — wholesaler is not a supported role on the shared intel route.

---

## 9. Reports Audit

### 9.1 Sidebar

No `/reports` entry in the wholesaler sidebar today. The route works but is **discoverable only via direct URL**.

### 9.2 Available reports

| Report           | Endpoint                                                                  | Format | Status      |
|------------------|---------------------------------------------------------------------------|--------|-------------|
| Shipments        | `GET /reports/shipments.csv?role=wholesaler&entity_id={wid}`              | CSV    | ✅ Verified |
| Inventory        | `GET /reports/inventory.csv?role=wholesaler&entity_id={wid}`              | CSV    | ✅ Verified |
| Orders           | (no dedicated CSV — must read JSON via `…/customer-orders`)               | JSON   | Partial     |
| Fulfillments     | (no dedicated CSV)                                                        | JSON   | Partial     |
| Analytics export | (no PDF / Excel)                                                          | —      | Missing     |
| Demand forecast  | (no CSV)                                                                  | —      | Missing     |

---

## 10. Notifications Audit

`NotificationsPopover` (top-bar bell) — wholesaler-compatible.

### 10.1 Endpoints

| Action             | Endpoint                                                                |
|--------------------|-------------------------------------------------------------------------|
| List               | `GET /notifications?target_type=wholesaler&target_id={wid}&limit=`      |
| Mark one as read   | `PATCH /notifications/{notif_id}/read`                                  |
| Mark all as read   | `PATCH /notifications/read-all?target_type=wholesaler&target_id={wid}`  |

### 10.2 Notification types (observed live)

| Type        | Severity   | Example                                                          |
|-------------|------------|------------------------------------------------------------------|
| `delivery`  | info       | "Shipment WPO-2026-00003 delivered — 1,129 units"                |
| `order`     | info/warn  | "New order from Royal Trading 1 — ₦487,200"                      |
| `stockout`  | critical   | "SKU MAGGI-50 below reorder level (12 units left)"               |
| `delay`     | warning    | "Truck FAC-AB12CD delayed — new ETA 14:30"                       |
| `intel`     | info       | "Urgent replenishment: 3 SKUs at high churn risk"                |

### 10.3 Actions

- ✅ Read
- ✅ Mark single as read
- ✅ Mark all as read
- ❌ No category filter
- ❌ No notification preferences page
- ❌ No tap-to-deep-link (just lists items)

---

## 11. Sabi Integration Opportunities

### 11.1 Today

- Backend endpoint `POST /api/wholesaler/{wid}/assistant` **does not exist** (404).
- Sabi bubble is **retailer-only** (`Layout.jsx`).
- No transcribe/execute endpoints for wholesalers.

### 11.2 High-value Sabi use-cases (recommended, do NOT design now)

| Use case                              | Backend lift                                | UX surface              |
|---------------------------------------|---------------------------------------------|-------------------------|
| "Approve all orders from Royal Trading"| chat → bulk-approve handler                | Floating bubble (Orders)|
| "Reorder 200 Maggi 50g from Apex"     | chat → wholesaler PO draft                  | Procurement             |
| "Which retailer is at biggest churn risk?" | chat → ground on `intelligence.risks`   | Intelligence Center     |
| "Mark shipment WPO-0003 delivered"    | chat → state transition                     | Shipments               |
| Voice picking confirmation            | mic → `/transcribe` → state transition      | Fulfillment             |
| Briefing on demand                     | chat → executive briefing                   | Dashboard               |

> ❗ Out of scope for W0. Documented here so mobile design can leave hooks.

---

## 12. Master Capability Matrix

> Mobile Priority — same scale as retailer:  
> **P0** = must ship in mobile MVP · **P1** = ship in v1.1 · **P2** = defer / web-only acceptable

| Feature                          | Page                       | Actions Available                                                | API Endpoint(s)                                                              | Mobile Priority |
|----------------------------------|----------------------------|------------------------------------------------------------------|------------------------------------------------------------------------------|-----------------|
| Login / Sign-out                 | `/login`                   | Email + password · Forgot password                              | `POST /auth/login` · `POST /auth/forgot-password` · `POST /auth/reset-password` · `POST /auth/logout` | **P0** |
| Read self                        | (boot)                     | —                                                                | `GET /auth/me`                                                               | **P0**          |
| Refresh token                    | (silent)                   | —                                                                | `POST /auth/refresh`                                                         | **P0**          |
| Dashboard 8-KPI strip            | `/dashboard`               | View                                                             | `GET /wholesaler/{wid}/overview`                                             | **P0**          |
| Inventory Health card            | `/dashboard`               | View                                                             | same                                                                         | **P0**          |
| AI Insights cards                | `/dashboard`               | Read                                                             | same                                                                         | **P0**          |
| Stockout Risk Watchlist          | `/dashboard`               | Tap → Inventory                                                  | same                                                                         | **P0**          |
| Inventory list + search          | `/inventory`               | Search SKU/product, health filter                                | `GET /wholesaler/{wid}/inventory`                                            | **P0**          |
| Inventory KPI strip              | `/inventory`               | View                                                             | same                                                                         | **P0**          |
| Receive Stock                    | `/inventory`               | Form: product, qty, source, reference, notes                     | `POST /wholesaler/{wid}/inventory/receive`                                   | **P0**          |
| Adjust Stock                     | `/inventory`               | Form: delta, reason, notes                                       | `POST /wholesaler/{wid}/inventory/{product_id}/adjust`                       | **P0**          |
| Cycle Count                      | `/inventory`               | Form: counted qty, notes                                         | `POST /wholesaler/{wid}/inventory/{product_id}/cycle-count`                  | **P1**          |
| Inventory Movements feed         | `/inventory` (tab)         | View last 30                                                     | `GET /wholesaler/{wid}/inventory/movements?limit=`                           | **P1**          |
| Customer Orders dashboard        | `/wholesaler/orders`       | KPIs + funnel                                                    | `GET /wholesaler/{wid}/orders/dashboard`                                     | **P0**          |
| List customer orders             | `/wholesaler/orders`       | Status filter, search, open detail                               | `GET /wholesaler/{wid}/orders` · `…/customer-orders`                         | **P0**          |
| Order detail                     | `/wholesaler/orders`       | View items, history, retailer, AI hints                          | `GET /wholesaler/{wid}/orders/{order_id}`                                    | **P0**          |
| **Approve order**                | `/wholesaler/orders`       | One-tap                                                          | `POST .../orders/{id}/approve`                                               | **P0**          |
| **Reject order**                 | `/wholesaler/orders`       | With reason                                                       | `POST .../orders/{id}/reject`                                                | **P0**          |
| **Modify order**                 | `/wholesaler/orders`       | Edit qty/price                                                   | `POST .../orders/{id}/modify`                                                | **P1**          |
| **Cancel order**                 | `/wholesaler/orders`       |                                                                  | `POST .../orders/{id}/cancel`                                                | **P0**          |
| Create order (manual)            | `/wholesaler/orders`       | Form                                                             | `POST /wholesaler/{wid}/orders`                                              | **P2**          |
| Fulfillment list                 | `/wholesaler/fulfillment`  | Filter by stage                                                  | `GET /wholesaler/{wid}/fulfillments`                                         | **P0**          |
| Fulfillment detail               | `/wholesaler/fulfillment`  | View pick list, packing list                                     | `GET /wholesaler/{wid}/fulfillments/{ful_id}`                                | **P0**          |
| **Start Picking**                | fulfillment                | One-tap                                                          | `POST .../start-picking`                                                     | **P0**          |
| **Complete Picking**             | fulfillment                | One-tap                                                          | `POST .../complete-picking`                                                  | **P0**          |
| Report Shortage                  | fulfillment                | Items[] + notes                                                  | `POST .../report-shortage`                                                   | **P1**          |
| Start Packing / Complete Packing | fulfillment                | One-tap                                                          | `POST .../start-packing` · `…/complete-packing`                              | **P0**          |
| Ready Dispatch                   | fulfillment                | One-tap                                                          | `POST .../ready-dispatch`                                                    | **P0**          |
| **Dispatch (truck)**             | fulfillment                | Vehicle code, driver, ETA                                        | `POST .../dispatch`                                                          | **P0**          |
| Procurement — PO list            | `/procurement`             | Filter status                                                    | `GET /wholesaler/{wid}/procurement/orders`                                   | **P1**          |
| Procurement — Create PO          | `/procurement`             | Pick supplier, add items                                          | `POST /wholesaler/{wid}/procurement/orders`                                  | **P1**          |
| Procurement — PO transition      | `/procurement`             | submit/approve/reject/allocate/ship/deliver/cancel               | `POST /wholesaler/{wid}/procurement/orders/{po_id}/transition`               | **P1**          |
| Procurement — Suppliers          | `/procurement`             | View list                                                        | `GET /wholesaler/{wid}/procurement/suppliers`                                | **P1**          |
| Procurement — Catalog            | `/procurement`             | Browse SKUs available from suppliers                             | `GET /wholesaler/{wid}/procurement/catalog`                                  | **P1**          |
| Retailer directory               | `/network`                 | List, search                                                     | `GET /wholesaler/{wid}/distributors`                                         | **P0**          |
| Retailer detail (90d)            | `/wholesaler/distributors/:id` | KPIs, trend, recent orders                                  | `GET /wholesaler/{wid}/distributors/{distributor_id}/detail`                 | **P1**          |
| Shipments list + filter          | `/wholesaler/shipments`    | Status filter, open detail                                        | `GET /wholesaler/{wid}/shipments`                                            | **P0**          |
| Shipments dashboard              | `/wholesaler/shipments`    | KPIs                                                              | `GET /wholesaler/{wid}/shipments/dashboard`                                  | **P0**          |
| Shipment detail (live map+ETA)   | `/wholesaler/shipments`    | View timeline, vehicle                                           | `GET /wholesaler/{wid}/shipments/{ship_id}`                                  | **P0**          |
| Shipment Delay                   | shipments                  | Reason + new ETA                                                 | `POST .../shipments/{ship_id}/delay`                                         | **P1**          |
| Shipment Cancel                  | shipments                  |                                                                  | `POST .../shipments/{ship_id}/cancel`                                        | **P1**          |
| Control Tower live map           | `/analytics` (tab)         | Pan/zoom, filter leg type                                        | `GET /wholesaler/{wid}/control-tower/map`                                    | **P1**          |
| Analytics — Overview             | `/analytics`               | View                                                              | `GET /wholesaler/{wid}/analytics`                                            | **P1**          |
| Analytics — Inventory            | `/analytics`               | View                                                              | same                                                                          | **P1**          |
| Analytics — Distributors         | `/analytics`               | View                                                              | same                                                                          | **P1**          |
| Analytics — Orders               | `/analytics`               | View                                                              | same                                                                          | **P1**          |
| Analytics — Procurement          | `/analytics`               | View                                                              | same                                                                          | **P2**          |
| Analytics — Demand Forecast      | `/analytics`               | View per-SKU forecast                                            | same                                                                          | **P1**          |
| Intelligence — Executive Brief   | `/wholesaler/intelligence` | View headlines                                                   | `GET /wholesaler/{wid}/analytics → intelligence.*`                           | **P1**          |
| Intelligence — Opportunities     | `/wholesaler/intelligence` | View                                                              | same                                                                          | **P1**          |
| Intelligence — Risks             | `/wholesaler/intelligence` | View                                                              | same                                                                          | **P1**          |
| Intelligence — Recommended actions| `/wholesaler/intelligence`| View                                                              | same                                                                          | **P1**          |
| Reports — Shipments CSV          | `/reports` (no nav)        | Download                                                          | `GET /reports/shipments.csv?role=wholesaler&entity_id={wid}`                 | **P2**          |
| Reports — Inventory CSV          | `/reports` (no nav)        | Download                                                          | `GET /reports/inventory.csv?role=wholesaler&entity_id={wid}`                 | **P2**          |
| Notifications list               | top-bar                    | View                                                              | `GET /notifications?target_type=wholesaler&target_id={wid}`                  | **P0**          |
| Notification mark read           | top-bar                    | Tap                                                              | `PATCH /notifications/{id}/read`                                             | **P0**          |
| Notification mark-all-read       | top-bar                    | One tap                                                          | `PATCH /notifications/read-all`                                              | **P1**          |

---

## 13. Things explicitly NOT present (web parity rule for mobile)

- ❌ Dedicated **Profile** / **Settings** page.
- ❌ **Push notification preferences**.
- ❌ Multi-hub switcher.
- ❌ **Credit & payments** (no AR, no credit limits, no aging).
- ❌ **Sabi Copilot** for wholesalers (retailer-only today).
- ❌ Driver / vehicle directory (vehicle code is captured ad-hoc on dispatch).
- ❌ Acknowledge action on Intelligence items.
- ❌ Promotions, customer CRM, in-app chat.

---

## 14. Auth & infra notes

- **Base URL (prod):** `https://www.app.tradekonekt.com`
- **API prefix:** `/api`
- **Auth:** `Authorization: Bearer <access_token>`
- **Wholesaler test account:** `mfr-0001-who-0001@tradekonekt.io` / `TradeKonekt2026!`
- **Wholesaler entity_id:** `6458308e-3b90-283c-f156-1a385cc22dd1`

---

*End of spec — proceed to mobile UX planning only after this is signed off.*
