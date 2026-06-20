# Distributor Workspace — Functional Specification

**Audit date:** 2026-06-19  
**Scope:** TradeKonekt Distributor Web Workspace (production + preview)  
**Purpose:** Source-of-truth inventory of every feature a Distributor can use today on the web — input brief for the Distributor Mobile App (W0 discovery).

> **Rule:** Do not introduce new functionality at this stage. Mobile must be a faithful port of what already exists.

---

## 1. Navigation Audit

Distributor sidebar (`Layout.jsx → navForRole("distributor")`) — **4 destinations** (Dashboard is implicit at `/dashboard`):

| # | Label                | Route                              | Component rendered                  | Purpose                                                | Key actions                                                          |
|---|----------------------|------------------------------------|-------------------------------------|--------------------------------------------------------|----------------------------------------------------------------------|
| 1 | Dashboard            | `/dashboard`                       | `DistributorDashboard`              | Operations Intelligence Center                         | Refresh OS · Drill into wholesaler / retailer / product              |
| 2 | Intelligence         | `/intel`                           | `IntelligenceCenter`                | Exec brief + forecasts + recommendations               | Regenerate brief · Acknowledge recommendations                       |
| 3 | Wholesalers          | `/network`                         | (`ManufacturerNetworkView` filter)  | Distributor's direct downstream wholesaler roster      | Search · Open wholesaler detail                                      |
| 4 | Procurement          | `/procurement`                     | `DistributorProcurementInbox`       | Place upstream POs + process retailer POs + RFQs       | Place Order · Approve/Reject retailer POs · Respond to RFQs          |
|   | Analytics (universal)| `/analytics`                       | `AnalyticsView`                     | Generic role analytics                                 | Read                                                                  |
|   | Reports (universal)  | `/reports`                         | `ReportsView`                       | CSV downloads                                          | Download                                                              |
|   | Organizations        | `/organizations`                   | `OrganizationManagement`            | View child orgs (wholesalers/retailers)                | Open detail                                                           |

### 1.1 Sub-pages

| Route                                                        | Triggered from              | View                                |
|--------------------------------------------------------------|-----------------------------|-------------------------------------|
| `/distributor/:distributorId/wholesaler/:wholesalerId`       | Dashboard wholesaler tile   | `DistributorWholesalerDetail`       |
| `/distributors/:distributorId/retailers/:retailerId`         | Wholesaler detail → retailer| `DistributorRetailerDetail`         |
| `/products/:productId/legacy`                                | Top product row             | `DistributorProductDetail`          |
| `/inventory/product/:productId`                              | Slow movers / stockout row  | shared retailer-style detail (RO)   |

### 1.2 Always-visible chrome

| Element                       | Where         | Behaviour                                              |
|-------------------------------|---------------|--------------------------------------------------------|
| Notifications bell            | top-right     | Wholesaler-style popover                               |
| Sign out / Switch account     | sidebar foot  | `signOut()`                                             |
| Sabi Copilot bubble           | —             | **NOT enabled for distributors today**                 |

---

## 2. Dashboard Audit (`/dashboard` — `DistributorDashboard`)

The distributor dashboard is the **Operations Intelligence Center** — fat aggregator served from snapshot cache.

### 2.1 KPI strip (6 cards)

| KPI                       | Source (operations-intelligence.kpis.*) | Notes                                  |
|---------------------------|-----------------------------------------|----------------------------------------|
| Network Revenue 90D       | `network_revenue_90d.value`             | + growth_pct, 12-pt spark              |
| Active Wholesalers        | `active_wholesalers.value`              | wholesalers with retailer activity 30d |
| Retail Orders Pending     | `retail_orders_pending.value`           | sum of pending requests + PO pipeline  |
| Dispatched (30D)          | `dispatched_30d.value`                  | + growth_pct                           |
| Inventory Units           | `inventory_units.value`                 | distributor-owned warehouse units      |
| Low Stock SKUs            | `low_stock_skus.value`                  | low + out together                     |

### 2.2 Hero/structural elements (top→bottom)

1. **AI Operations Brief** — 4-5 deterministic insights (revenue trend, top region, top category, coverage, at-risk count).
2. **Refresh pill** — "Updated X ago" + tap → `POST /distributor/{did}/operations-intelligence/refresh`.
3. **KPI strip** (6 cards above).
4. **Network Health composite score** — 0-100 with band (critical/fair/good/excellent).
5. **Revenue Trend** — 30-day daily area chart from `revenue_trend[]`.
6. **Wholesaler Performance Matrix (BCG 2×2)** — `performance_matrix[]` plotted by revenue × growth_pct → quadrants `stars · cash_cows · growth_opps · at_risk`.
7. **Top Wholesalers** — `top_wholesalers[]` (5 rows).
8. **Attention Wholesalers** — `attention_wholesalers[]` (5 rows, growth < 0 or below median).
9. **Regional Coverage** — `regional_coverage[]` per-region revenue + retailer count (downstream visibility).
10. **Inventory Health donut** — `inventory_health.donut[]` (healthy/low/out segments).
11. **Top Products + Slow Movers** — from `top_products[]` / `slow_products[]` (legacy overview endpoint) OR `category_performance[]`.
12. **Stockout Risk** — `stockout_risk[]` (severity-tagged).
13. **AI Recommendations** — `ai_brief.recommended_actions[]` (3-4 actionable bullets w/ CTAs).
14. **Order Pipeline funnel** — `order_pipeline{pending, approved, dispatched, delivered_30d}`.
15. **Downstream Visibility tile** — `downstream_visibility{total_retailers, active_retailers_30d}`.

### 2.3 Data sources

- Heavy snapshot: `GET /distributor/{did}/operations-intelligence` (with `read_or_compute` staleness pattern).
- Force refresh: `POST /distributor/{did}/operations-intelligence/refresh`.
- Legacy overview (used by older widgets): `GET /distributor/{did}/overview` — **only works for distributors stored in `db.distributors` collection**; org-table distributors return 404 here. The mobile app should ignore this endpoint and use `/operations-intelligence` instead.

---

## 3. Wholesaler Network (`/network`)

> A distributor's **direct downstream tier is wholesalers**, not retailers. Retailers are visibility-only through their owning wholesaler.

### 3.1 List endpoint

`GET /distributor/{did}/wholesaler-network` → returns:

```json
{
  "distributor_id":"...",
  "kpis": {
    "total_wholesalers": 3,
    "active_wholesalers_30d": 3,
    "total_retailers_in_network": 12,
    "active_retailers_30d": 8,
    "revenue_90d": 12345678,
    "key_account_retailers": 2
  },
  "wholesalers": [
    { "id":"...", "name":"Royal Trading 1 (Lagos)", "code":"MFR-0001-WHO-0001",
      "region":"Lagos", "city":"Ikeja",
      "retailer_count": 4, "active_retailers_30d": 3,
      "revenue_90d": 4567890, "growth_pct": 12.4,
      "pending_orders": 2, "status":"healthy" }
  ],
  "top_wholesalers": [/* same shape */],
  "attention_wholesalers": [/* same shape */],
  "key_account_retailers": [
    { "id":"...", "name":"Shoprite Apapa", "region":"Lagos", "city":"Apapa",
      "brand":"Shoprite", "revenue_90d": 3456789 }
  ]
}
```

### 3.2 Wholesaler detail

`GET /distributor/{did}/wholesaler/{wholesaler_id}/detail` →

```json
{
  "wholesaler": { "id":"...", "name":"...", "code":"...", "region":"...", "city":"...",
                  "address":"...", "contact_email":"..." },
  "kpis": {
    "total_retailers": 4, "active_retailers_30d": 3,
    "revenue_90d": 4567890,
    "pending_orders_from_retailers": 2,
    "pending_procurement_to_distributor": 1
  },
  "retailers": [
    { "id":"...", "name":"...", "code":"...", "region":"...", "city":"...",
      "revenue_90d":1234567, "units_90d":5400, "last_sale_date":"2026-06-18",
      "status":"healthy|attention|critical" }
  ],
  "recent_retailer_orders": [/* WPOs into this wholesaler */],
  "wholesaler_purchase_orders_to_distributor": [/* upstream WPOs to me */]
}
```

### 3.3 Key-account retailer detail (direct relationship)

For retailers that the distributor serves direct (no wholesaler in between, e.g. Shoprite key accounts):
`GET /distributor/{did}/retailer/{retailer_id}` — returns the same retailer detail payload as the manufacturer surface.

---

## 4. Procurement (`/procurement` — `DistributorProcurementInbox`)

6 tabs (segmented by purpose):

| Tab               | Test ID                    | Purpose                                                                   |
|-------------------|----------------------------|---------------------------------------------------------------------------|
| Place Order       | `inbox-tab-place`          | Place new upstream PO with a chosen manufacturer (catalogue → cart → submit) |
| My Purchase Orders| `inbox-tab-my-orders`      | Track this distributor's outbound POs to the manufacturer                 |
| Retailer Orders   | `inbox-tab-orders`         | Inbound retailer POs — approve/reject/process/ship/deliver lifecycle      |
| Quote Requests    | `inbox-tab-quotes`         | RFQs the distributor was invited on — respond with price/MOQ/lead-time    |
| Shipments         | `inbox-tab-shipments`      | Outbound shipments via `ShipmentTrackerLegacy`                            |
| Wholesalers       | `inbox-tab-wholesalers`    | Cross-persona widget: wholesaler→distributor PO funnel (`DistributorWholesalerOrdersWidget`) |

### 4.1 Place Order (upstream)

| Action            | Endpoint                                      |
|-------------------|-----------------------------------------------|
| List manufacturers| `GET /distributor/{did}/manufacturers` — ⚠️ **404 for org-table distributors**; fall back to `GET /manufacturers` |
| List products     | `GET /products`                               |
| Submit PO         | `POST /distributor/{did}/orders` body `{manufacturer_id, items[], note?}` |

### 4.2 My Purchase Orders (state machine)

States for `distributor_orders`: `pending → approved → dispatched → delivered`  
Decline path: `pending → rejected`

| Action     | Endpoint                                                                  |
|------------|---------------------------------------------------------------------------|
| List mine  | `GET /distributor/{did}/orders`                                           |
| (mfr-side) | `POST /manufacturer/{mid}/distributor-orders/{order_id}/approve`         |
| (mfr-side) | `POST /manufacturer/{mid}/distributor-orders/{order_id}/reject`          |
| (mfr-side) | `POST /manufacturer/{mid}/distributor-orders/{order_id}/dispatch`        |

> The distributor only *creates* and *reads* these orders on mobile. Approve / Reject / Dispatch belong to the manufacturer side.

### 4.3 Retailer Orders (inbound POs from retailers)

`GET /procurement/purchase-orders?distributor_id={did}` returns POs where `supplier_type = "distributor"`.

States: `draft → submitted → approved → processing → shipped → in_transit → delivered`  
Terminal: `cancelled · rejected`

| Action     | Endpoint                                                          |
|------------|-------------------------------------------------------------------|
| PO detail  | `GET /procurement/purchase-orders/{po_id}`                        |
| Approve    | `POST /procurement/purchase-orders/{po_id}/approve`               |
| Reject     | `POST /procurement/purchase-orders/{po_id}/reject` body `{reason}`|
| Process    | `POST /procurement/purchase-orders/{po_id}/process`               |
| Ship       | `POST /procurement/purchase-orders/{po_id}/ship`                  |
| Deliver    | `POST /procurement/purchase-orders/{po_id}/deliver`               |
| Cancel     | `POST /procurement/purchase-orders/{po_id}/cancel`                |

### 4.4 Quote Requests (RFQs)

| Action          | Endpoint                                                     |
|-----------------|--------------------------------------------------------------|
| List RFQs       | `GET /procurement/quotes?distributor_id={did}`               |
| Quote detail    | `GET /procurement/quotes/{quote_id}`                          |
| Respond         | `POST /procurement/quotes/{quote_id}/respond` body `{unit_price, lead_time_days, moq, valid_until, notes?}` |
| Close (creator) | `POST /procurement/quotes/{quote_id}/close`                  |

### 4.5 Cross-tier visibility (Wholesalers tab)

`GET /distributor/{did}/incoming-wholesaler-pos` — shows wholesaler→distributor POs (read-only funnel for monitoring).

---

## 5. Intelligence Audit (`/intel` — shared `IntelligenceCenter`)

Distributor is a **first-class role** on the generic intel routes.

| Section                  | Endpoint                                                                  | Status     |
|--------------------------|---------------------------------------------------------------------------|------------|
| Executive Brief          | `GET /intel/exec-summary?role=distributor&entity_id={did}`                | ✅ Verified|
| Regenerate brief         | `POST /intel/exec-summary/regenerate`                                     | ✅ Verified|
| Live Intel Feed          | `GET /intel/feed?role=distributor&entity_id={did}&limit=`                 | 🟡 500 today |
| Stockout Forecasts       | `GET /intel/forecasts/stockout?role=distributor&entity_id={did}`          | ✅ Verified|
| Recommendations          | `GET /intel/recommendations?role=distributor&entity_id={did}`             | ✅ Verified|
| Acknowledge recommendation| `PATCH /intel/recommendations/{rec_id}`                                  | ✅ Verified|
| Alerts                   | `GET /intel/alerts?role=distributor&entity_id={did}`                      | ✅ Verified (empty array today) |
| External signals (weather)| `GET /intel/external?role=distributor&entity_id={did}`                   | ✅ Verified|
| Delivery ETA insights    | `GET /intel/delivery-eta?role=distributor&entity_id={did}`                | ✅ Verified|
| Retailer Health peers    | `GET /intel/retailer-health?role=distributor&entity_id={did}`             | ✅ Verified|
| Trigger recompute        | `POST /intel/recompute`                                                   | ✅ Verified|
| Inline Copilot chat      | `POST /intel/copilot`                                                     | ✅ Verified|

> The distributor-specific drill-down `GET /manufacturer/{mid}/distributor-intelligence/{did}` is a **manufacturer-side** view of one distributor and is **not** consumed by the distributor app itself.

---

## 6. Analytics & Reports

| Endpoint                                                                | Status     | Notes                                |
|-------------------------------------------------------------------------|------------|--------------------------------------|
| `GET /distributor/{did}/analytics/executive`                            | ✅ Verified| Distributor-specific exec analytics  |
| `GET /analytics?role=distributor&entity_id={did}`                       | ✅ Verified| Generic role analytics                |
| `GET /reports/shipments.csv?role=distributor&entity_id={did}`           | ✅ Verified| CSV download                          |
| `GET /reports/inventory.csv?role=distributor&entity_id={did}`           | ✅ Verified| CSV download                          |

---

## 7. Inventory (warehouse-owned at the distributor)

| Endpoint                                                                  | Status     |
|---------------------------------------------------------------------------|------------|
| List inventory rows                                                       | `GET /inventory?owner_type=distributor&owner_id={did}` ✅ |
| Adjust inventory                                                          | `POST /inventory/adjust` body `{owner_type:"distributor", owner_id, product_id, delta, reason}` ✅ |

> ❌ There is **no** `/distributor/{did}/inventory` endpoint — the generic `/inventory?owner_type=...&owner_id=...` is the canonical one.

---

## 8. Notifications

| Action            | Endpoint                                                                    |
|-------------------|-----------------------------------------------------------------------------|
| List              | `GET /notifications?target_type=distributor&target_id={did}&limit=`         |
| Mark one read     | `PATCH /notifications/{notif_id}/read`                                       |
| Mark all read     | `PATCH /notifications/read-all`                                              |

Types observed: `order` · `shipment` · `delivery` · `stockout` · `intel`.

---

## 9. Sabi Integration Opportunities (NOT IN MVP)

- `POST /distributor/{did}/assistant` → **does not exist** (404).
- Sabi bubble = retailer-only on the platform today.

---

## 10. Master Capability Matrix

| Feature                            | Page                                | Actions                                                         | API Endpoint(s)                                                              | Mobile Priority |
|------------------------------------|-------------------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------------|-----------------|
| Login / Sign-out                   | `/login`                            | Email + password                                                | `/auth/*`                                                                    | **P0**          |
| Dashboard 6-KPI strip              | `/dashboard`                        | Read                                                            | `GET /distributor/{did}/operations-intelligence`                             | **P0**          |
| AI Operations Brief                | `/dashboard`                        | Read                                                             | same                                                                          | **P0**          |
| Refresh OS snapshot                | `/dashboard`                        | One-tap                                                          | `POST /distributor/{did}/operations-intelligence/refresh`                    | **P0**          |
| Revenue Trend (30d)                | `/dashboard`                        | Read                                                             | same OS payload                                                              | **P0**          |
| Performance Matrix (wholesalers)   | `/dashboard`                        | Read                                                             | same                                                                          | **P1**          |
| Top / Attention Wholesalers        | `/dashboard`                        | Open detail                                                      | same + `/distributor/{did}/wholesaler/{wid}/detail`                          | **P0**          |
| Regional Coverage                  | `/dashboard`                        | Read                                                             | same                                                                          | **P1**          |
| Inventory Health donut             | `/dashboard`                        | Read                                                             | same                                                                          | **P1**          |
| Stockout Risk                      | `/dashboard`                        | Open product                                                     | same + `/distributor/{did}/product/{pid}`                                    | **P0**          |
| AI Recommendations                 | `/dashboard`                        | Read (CTA deep-link)                                             | same                                                                          | **P0**          |
| Order Pipeline funnel              | `/dashboard`                        | Read                                                             | same                                                                          | **P0**          |
| Wholesalers list                   | `/network`                          | Search, open detail                                              | `GET /distributor/{did}/wholesaler-network`                                  | **P0**          |
| Wholesaler detail                  | `/distributor/:did/wholesaler/:wid` | Read                                                             | `GET /distributor/{did}/wholesaler/{wid}/detail`                             | **P0**          |
| Key-account retailers              | `/network`                          | Open detail                                                      | same wholesaler-network payload                                              | **P1**          |
| Retailer detail (under wholesaler) | `/distributors/:did/retailers/:rid` | Read                                                             | `GET /distributor/{did}/retailer/{rid}`                                      | **P1**          |
| Product detail                     | `/products/:pid/legacy`             | Read                                                             | `GET /distributor/{did}/product/{pid}`                                       | **P1**          |
| Place upstream PO                  | `/procurement` → Place              | Submit                                                           | `POST /distributor/{did}/orders`                                             | **P0**          |
| My POs list                        | `/procurement` → My                 | Filter, open                                                     | `GET /distributor/{did}/orders`                                              | **P0**          |
| Retailer POs list                  | `/procurement` → Retailer Orders    | Filter, open                                                     | `GET /procurement/purchase-orders?distributor_id={did}`                      | **P0**          |
| Retailer PO state machine          | retailer order detail               | approve/reject/process/ship/deliver/cancel                       | `POST /procurement/purchase-orders/{po_id}/{action}`                         | **P0**          |
| Quote Requests (RFQs)              | `/procurement` → Quotes             | Respond, close                                                   | `GET /procurement/quotes` · `POST .../respond` · `POST .../close`            | **P1**          |
| Outbound shipments tracker         | `/procurement` → Shipments          | Read                                                             | derived from `/procurement/purchase-orders` payload `shipment{}`             | **P1**          |
| Incoming wholesaler POs            | `/procurement` → Wholesalers        | Read                                                             | `GET /distributor/{did}/incoming-wholesaler-pos`                             | **P2**          |
| Intel Exec Brief                   | `/intel`                            | Read + regenerate                                                | `GET /intel/exec-summary?role=distributor` · `POST .../regenerate`           | **P0**          |
| Intel Recommendations              | `/intel`                            | Acknowledge                                                       | `GET /intel/recommendations` · `PATCH .../{rec_id}`                          | **P1**          |
| Intel Stockout Forecasts           | `/intel`                            | Read                                                              | `GET /intel/forecasts/stockout`                                                | **P1**          |
| Intel Delivery ETA                 | `/intel`                            | Read                                                              | `GET /intel/delivery-eta`                                                      | **P1**          |
| Intel Retailer Health              | `/intel`                            | Read                                                              | `GET /intel/retailer-health`                                                   | **P2**          |
| Intel Live Feed                    | `/intel`                            | Read                                                              | `GET /intel/feed` ⚠️ currently 500                                            | **P2** (until fixed) |
| Intel Copilot chat                 | `/intel`                            | Chat                                                              | `POST /intel/copilot`                                                          | **P2**          |
| Inventory rows                     | (no dedicated nav today)            | Adjust                                                            | `GET /inventory?owner_type=distributor` · `POST /inventory/adjust`            | **P1**          |
| Executive Analytics                | `/analytics`                        | Read                                                              | `GET /distributor/{did}/analytics/executive`                                  | **P1**          |
| Generic role analytics             | `/analytics`                        | Read                                                              | `GET /analytics?role=distributor`                                              | **P2**          |
| Reports — Shipments CSV            | `/reports`                          | Download                                                          | `GET /reports/shipments.csv?role=distributor`                                  | **P2**          |
| Reports — Inventory CSV            | `/reports`                          | Download                                                          | `GET /reports/inventory.csv?role=distributor`                                  | **P2**          |
| Organizations (child orgs)         | `/organizations`                    | Open                                                              | `GET /organizations?parent_organization_id={did}`                              | **P2**          |
| Notifications                      | top-bar                              | Read, mark read, mark all read                                    | `/notifications/*`                                                            | **P0**          |

---

## 11. Things NOT present (web parity rule for mobile)

- ❌ No dedicated **Profile / Settings** page.
- ❌ No **Push notifications** preferences.
- ❌ Sabi Copilot for distributors (404).
- ❌ **Driver / Vehicle CRUD** (shipments use codes typed at dispatch only).
- ❌ **Payments / credit / invoicing**.
- ❌ **Promotions** authoring.

---

## 12. Auth notes

- **Base URL (prod):** `https://www.app.tradekonekt.com`
- **Preview / dev:** `https://supply-chain-hub-189.preview.emergentagent.com`
- **API prefix:** `/api`
- **Distributor test account:** `mfr-0001-dst-0001@tradekonekt.io / TradeKonekt2026!`
- **Distributor entity_id (preview):** `f9dfaf08-4ee2-3c64-e96b-983c385625b2` (Apex Distributors — Apapa)
- Other distributor logins available: `unilever.distributor@tradekonekt.io`, `fmn.distributor@tradekonekt.io`.

---

*End of spec.*
