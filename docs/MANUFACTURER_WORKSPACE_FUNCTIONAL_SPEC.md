# Manufacturer Workspace — Functional Specification

**Audit date:** 2026-06-19  
**Scope:** TradeKonekt Manufacturer Web Workspace (production + preview)  
**Purpose:** Source-of-truth inventory of every feature a Manufacturer can use today on the web — input brief for the Manufacturer Mobile App (W0 discovery).

> **Rule:** Do not introduce new functionality at this stage. Mobile must be a faithful port of what already exists.

---

## 1. Navigation Audit

Manufacturer sidebar (`Layout.jsx → navForRole("manufacturer")`) — **8 destinations**, the densest persona in the platform:

| # | Label                | Route                              | Component rendered                  | Purpose                                                | Key actions                                                          |
|---|----------------------|------------------------------------|-------------------------------------|--------------------------------------------------------|----------------------------------------------------------------------|
| 1 | Dashboard            | `/dashboard`                       | `ManufacturerDashboard`             | Executive command center (KPIs, revenue, network)      | Refresh · Open Network Pulse · Open subviews                         |
| 2 | Logistics Center     | `/manufacturer/logistics-center`   | `LogisticsCommandCenter`            | Live control tower: trucks, routes, events             | Pan/zoom map · Filter leg-types · Ack events · Bulk-ack · Archive    |
| 3 | Procurement          | `/procurement`                     | `ProcurementWorkspace` (outbound)   | Outbound POs (manufacturer fulfills downstream POs)     | Approve · Process · Ship · Deliver · Reject · Cancel · Duplicate · **Allocate** |
| 4 | Product Intelligence | `/product-intelligence`            | `ManufacturerNetworkIntelligence`   | Per-SKU network telemetry (in-network units, velocity) | Open product detail · Create product                                 |
| 5 | Intelligence         | `/intel`                           | `IntelligenceCenter`                | Exec brief + forecasts + recommendations               | Regenerate brief · Acknowledge recommendations · Copilot chat        |
| 6 | Network Map          | `/network-map`                     | `ManufacturerNetworkView`           | 5-tier hierarchy visualisation                         | Zoom · Drill into tier · Open detail                                 |
| 7 | Distributors         | `/network`                         | `ManufacturerNetworkView` (filter)  | Distributor roster                                     | Search · Open distributor detail                                     |
| 8 | Warehouses           | `/manufacturer/warehouses`         | `ManufacturerWarehouses`            | Warehouse roster + KPIs                                | Open warehouse detail                                                |

### 1.1 Sub-pages

| Route                                              | Triggered from              | View                          |
|----------------------------------------------------|-----------------------------|-------------------------------|
| `/manufacturer/warehouses/:id`                     | Warehouse row               | `ManufacturerWarehouseDetail` |
| `/manufacturer/warehouses/:id/distributor-network` | Warehouse detail            | distributor-network sub-tab   |
| `/manufacturer/allocation`                         | Procurement tab redirect    | `/procurement?tab=allocation` |
| `/manufacturer/command-center`                     | Direct URL only             | `CommandCenter` (legacy/super-admin) |
| `/distributors/:distributorId`                     | Distributor row             | `ManufacturerDistributorDetail` |
| `/products/:productId/legacy`                      | Legacy fallback             | `ManufacturerProductDetail`   |
| `/inventory/product/:productId`                    | Product Intelligence row    | shared `RetailerProductDetail` (read-only for mfr) |
| `/reports`                                         | Direct URL only             | `ReportsView`                 |

### 1.2 Always-visible chrome

| Element                       | Where         | Behaviour                                              |
|-------------------------------|---------------|--------------------------------------------------------|
| Notifications bell            | top-right     | Wholesaler-style popover (see §10)                     |
| Sign out / Switch account     | sidebar foot  | `signOut()`                                             |
| Sabi Copilot bubble           | —             | **NOT enabled for manufacturers today**                |

---

## 2. Dashboard Audit (`/dashboard` — `ManufacturerDashboard`)

### 2.1 KPI strip (5 cards)

| KPI                 | Source                          | Notes                                  |
|---------------------|---------------------------------|----------------------------------------|
| Network Revenue (30D) | `kpis.network_revenue.value`  | + delta vs prior                       |
| Warehouses          | `kpis.warehouses.value`         | + active/total chip                    |
| Active Retailers    | `kpis.active_retailers.value`   | from `_tenant_ids` resolution          |
| Active Distributors | `kpis.active_distributors.value`| —                                      |
| Network Health      | `kpis.network_health.value`     | 0–100 score (sparkline behind value)   |

### 2.2 Hero/structural elements (top→bottom)

1. **AI Executive Brief** — `IntelExecSummaryCard` driven by `/intel/exec-summary?role=manufacturer&entity_id={mid}`. Regenerate button.
2. **Refresh pill** — "Updated X ago" + click-to-recompute → `/manufacturer/{mid}/overview/refresh`.
3. **KPI strip** (5 cards above).
4. **Revenue Trend** — 12-month area chart from `revenue_trend.spark[]`.
5. **Activity Pulse strip** (`ActivityPulse`) — 60s polling, throughput by event type, source `/manufacturer/{mid}/activity-pulse`.
6. **Network Pulse widget** (`NetworkPulse`) — 15s polling ticker of last 10 cross-tier inventory movements, source `/manufacturer/{mid}/network-pulse?limit=10&since_iso=`.
7. **Regional performance table** — `regional[]` & `regional_summary{}`: city/region · revenue · health · distributor count.
8. **Coverage KPIs** — `coverage_kpis{}`: outlets reached · % active · gaps.
9. **Top Products** — `top_products[]`: SKU, units 90d, revenue 90d.
10. **Categories mix** — `categories[]`.
11. **Demand Forecast** — `demand_forecast[]`: 30-day SKU projection.
12. **Stockout Risk** — `stockout_risk[]` (severity-tagged rows).
13. **Distributor Table** — `distributor_table[]` with health scores.
14. **Pipeline funnel** — `pipeline{submitted, approved, in_transit, delivered}`.
15. **Alerts** — `alerts[]` (info/warning/critical).

### 2.3 Data sources

- Heavy snapshot: `GET /manufacturer/{mid}/overview` (with `read_or_compute` staleness pattern).
- Throughput strip: `GET /manufacturer/{mid}/activity-pulse`.
- Live ticker: `GET /manufacturer/{mid}/network-pulse?limit=10&since_iso=`.

---

## 3. Logistics Center Audit (`/manufacturer/logistics-center` — `LogisticsCommandCenter`)

### 3.1 KPI strip (8)

`active_shipments · delayed · deviations_active · unauthorized_stops · breakdowns_active · geofence_events_today · on_time_pct · unacked_critical`  
plus `fleet_active / fleet_total / fleet_archived · delivered_today · in_transit_units`.

### 3.2 Tabs

| Tab               | Component                       | Backend                                                 |
|-------------------|---------------------------------|---------------------------------------------------------|
| Live Map          | `ControlTowerMap`               | `GET /logistics/control-tower?manufacturer_id={mid}`    |
| Event Stream      | `EventStream` (right rail)      | `GET /logistics/events?manufacturer_id={mid}&limit=`    |
| Route Planning    | `RoutePlanning`                 | `GET /logistics/route-planning?manufacturer_id={mid}` · `POST .../preview` · `POST .../dispatch` |
| Delay Predictions | `LogisticsPredictions`          | `GET /logistics/predictions?manufacturer_id={mid}`      |
| Demand vs Delivery| `DemandDelivery`                | `GET /logistics/demand-delivery?manufacturer_id={mid}`  |
| Archived Vehicles | `ArchivedVehiclesList`          | `GET /logistics/vehicles/archived?manufacturer_id={mid}`|

### 3.3 Available actions

| Action                  | Endpoint                                                                            |
|-------------------------|-------------------------------------------------------------------------------------|
| Acknowledge event       | `POST /logistics/events/{event_id}/ack`                                            |
| Bulk-ack events         | `POST /logistics/events/bulk-ack` body `{ids?, severity?, all_unacked?}`           |
| Archive vehicles (12h+) | `POST /logistics/vehicles/archive` body `{cutoff_hours?}`                          |
| Preview a route plan    | `POST /logistics/route-planning/preview` body `{stops[], constraints}`             |
| Dispatch a route plan   | `POST /logistics/route-planning/dispatch` body `{route_id, vehicle?, driver?}`     |
| Shipment timeline       | `GET /logistics/shipment-timeline/{shipment_id}`                                   |
| Geofences               | `GET /logistics/geofences` (read-only)                                             |
| Logistics Copilot chat  | `POST /logistics/copilot/chat`                                                     |
| Execute Copilot action  | `POST /logistics/copilot/actions/{action_id}/execute`                              |
| Dismiss Copilot action  | `POST /logistics/copilot/actions/{action_id}/dismiss`                              |

### 3.4 Filters (live map)

Leg-type toggles: `warehouse→distributor` · `distributor→wholesaler` · `wholesaler→retailer` · `distributor→retailer` (key-account direct).

---

## 4. Procurement / Outbound Fulfillment (`/procurement` — `ProcurementWorkspace`)

For manufacturers this surface is **outbound fulfillment** (responding to wholesaler/distributor POs), NOT inbound purchasing.

### 4.1 Tabs

| Tab                | Test ID            | Purpose                                                             |
|--------------------|--------------------|---------------------------------------------------------------------|
| Purchase Orders    | `tab-orders`       | Incoming POs from distributors/wholesalers — full lifecycle         |
| Order Allocation   | `tab-allocation`   | Bulk inventory allocation across pending POs (`AllocationCenter`)   |
| Wholesaler POs     | `tab-wholesaler-pos`| Cross-tier visibility into wholesaler→distributor POs              |
| Order History      | `tab-history`      | Past completed POs                                                  |
| Shipments          | `tab-shipments`    | Outbound shipments via `ShipmentTrackerLegacy`                      |

### 4.2 Purchase Orders — actions (state machine)

States: `draft → submitted → approved → processing → shipped → in_transit → delivered`  
Terminal: `cancelled · rejected`

| Action     | Endpoint                                                  | Valid from              |
|------------|-----------------------------------------------------------|-------------------------|
| List POs   | `GET /procurement/purchase-orders?manufacturer_id`        | any                     |
| PO detail  | `GET /procurement/purchase-orders/{po_id}`                | any (live ETA inside)   |
| Submit     | `POST .../submit`                                         | `draft`                 |
| Approve    | `POST .../approve`                                        | `submitted`             |
| Reject     | `POST .../reject`                                         | `submitted`             |
| Process    | `POST .../process`                                        | `approved`              |
| Ship       | `POST .../ship`                                           | `processing`            |
| Deliver    | `POST .../deliver`                                        | `shipped`/`in_transit`  |
| Cancel     | `POST .../cancel`                                         | any pre-shipped         |
| Duplicate  | `POST .../duplicate`                                      | any                     |

### 4.3 Allocation Center

| Action                        | Endpoint                                                                    |
|-------------------------------|-----------------------------------------------------------------------------|
| Read pool                     | `GET /allocation/pool` (warehouse-scoped, needs `warehouse_id`)             |
| Summary                       | `GET /allocation/summary?manufacturer_id={mid}`                             |
| KPIs                          | `GET /allocation/kpis?manufacturer_id={mid}`                                |
| Recommendation for an order   | `GET /allocation/orders/{order_id}/recommendation`                          |
| **Auto-allocate** an order    | `POST /allocation/orders/{order_id}/auto-allocate`                          |
| **Manual-allocate** an order  | `POST /allocation/orders/{order_id}/manual-allocate` body `{lines[]}`       |
| **Back-order**                | `POST /allocation/orders/{order_id}/back-order`                             |
| **Reject**                    | `POST /allocation/orders/{order_id}/reject`                                 |
| **Acknowledge**               | `POST /allocation/orders/{order_id}/acknowledge`                            |
| List back-orders              | `GET /allocation/back-orders?manufacturer_id={mid}`                         |
| Order detail                  | `GET /allocation/orders/{order_id}`                                         |

### 4.4 Wholesaler POs (read-only cross-tier visibility)

`GET /manufacturer/{mid}/wholesaler-pos` — for executive monitoring of distributor↔wholesaler trade.

---

## 5. Product Intelligence (`/product-intelligence` — `ManufacturerNetworkIntelligence`)

### 5.1 Data

`GET /manufacturer/{mid}/product-intelligence` → returns products with network telemetry:
- `units_in_network` (sum across warehouse + distributor + wholesaler + retailer)
- `distributor_count`, `retailer_count`
- `revenue_90d`, `units_sold_90d`
- `sparkline_30d`, `trend_pct_7d`
- `status`: `healthy · low · stockout · excess`

### 5.2 Actions

| Action              | Endpoint                                                            |
|---------------------|---------------------------------------------------------------------|
| Read intelligence   | `GET /manufacturer/{mid}/product-intelligence`                      |
| Refresh snapshot    | `POST /manufacturer/{mid}/product-intelligence/refresh`             |
| Read product detail | `GET /manufacturer/{mid}/product/{product_id}`                      |
| **Create product**  | `POST /manufacturer/{mid}/products`                                 |
| **Edit product**    | `PATCH /products/{product_id}`                                      |
| **Adjust inventory** | `POST /inventory/adjust` body `{owner_type, owner_id, product_id, delta, reason}` |

### 5.3 UI

- Search box
- Filters: category, status
- Table: SKU · Name · Category · Units in network · Distributors · Retailers · 90d Revenue · Trend · Status
- Click row → product detail (drawer or page)
- Create Product modal (multi-field: name, sku, category, unit_price, etc.)

---

## 6. Intelligence Audit (`/intel` — shared `IntelligenceCenter`)

Manufacturer is a **first-class role** on the generic intel routes (unlike wholesaler).

| Section                  | Endpoint                                                                  | Status     |
|--------------------------|---------------------------------------------------------------------------|------------|
| Executive Brief          | `GET /intel/exec-summary?role=manufacturer&entity_id={mid}`               | ✅ Verified|
| Regenerate brief         | `POST /intel/exec-summary/regenerate`                                     | ✅ Verified|
| Live Intel Feed          | `GET /intel/feed?role=manufacturer&entity_id={mid}&limit=`                | ✅ Verified|
| Stockout Forecasts       | `GET /intel/forecasts/stockout?role=manufacturer&entity_id={mid}`         | ✅ Verified|
| Recommendations          | `GET /intel/recommendations?role=manufacturer&entity_id={mid}`            | ✅ Verified|
| Acknowledge recommendation| `PATCH /intel/recommendations/{rec_id}`                                  | ✅ Verified|
| Alerts                   | `GET /intel/alerts?role=manufacturer&entity_id={mid}`                     | ✅ Verified|
| External signals (weather)| `GET /intel/external?role=manufacturer&entity_id={mid}`                  | ✅ Verified|
| Delivery ETA insights    | `GET /intel/delivery-eta?role=manufacturer&entity_id={mid}`               | ✅ Verified|
| Retailer Health peers    | `GET /intel/retailer-health?role=manufacturer&entity_id={mid}`            | ✅ Verified|
| Trigger recompute        | `POST /intel/recompute`                                                   | ✅ Verified|
| Inline Copilot chat      | `POST /intel/copilot`                                                     | ✅ Verified|

---

## 7. Network Map & Distributors (`/network-map`, `/network`)

### 7.1 Network Map (`ManufacturerNetworkView`)

5-tier hierarchy visualisation: Factory → Warehouses → Distributors → Wholesalers → Retailers, sourced from `overview.hierarchy.direct_children` + `downstream_visibility`. Pan/zoom; tap node → detail page.

### 7.2 Distributors list

`overview.distributor_table[]` rendered as a sortable table:
- Name · Region · Active retailers · Revenue 90d · Health · Last activity
- Click row → `/distributors/:distributorId` (`ManufacturerDistributorDetail`)

### 7.3 Distributor detail endpoint

`GET /manufacturer/{mid}/distributor/{distributor_id}` — returns 90-day analytics, recent POs, inventory snapshot, retailer roster, health series.

---

## 8. Warehouses (`/manufacturer/warehouses` — `ManufacturerWarehouses`)

### 8.1 List endpoint

`GET /manufacturer/{mid}/warehouse-network` →
```json
{
  "manufacturer": {...},
  "kpis": {...},
  "warehouses": [
    { "id":"...", "name":"...", "code":"...",
      "region":"...", "city":"...", "state":"...",
      "is_active": true,
      "distributors": 3, "wholesalers": 9, "retailers": 47,
      "active_retailers_30d": 42, "revenue_90d": 12345678,
      "inventory_units": 12345, "low_stock_skus": 2,
      "pending_orders": 5, "status": "healthy" }
  ]
}
```

### 8.2 Detail endpoint

`GET /warehouse/{warehouse_id}/distributor-network` — the warehouse's downstream distributor roster + KPIs.

### 8.3 Actions

| Action            | UI                            | Endpoint                        |
|-------------------|-------------------------------|---------------------------------|
| List warehouses   | grid card or table            | `…/warehouse-network`           |
| Open detail       | tap row                       | `WarehouseDetail` route         |
| Drill distributors| in detail page                | `…/distributor-network`         |

> ❌ No "create warehouse" / "edit warehouse" actions on the web today — read-only.

---

## 9. Reports Audit

`/reports` is **not in the manufacturer sidebar**. Direct URL only.

| Report         | Endpoint                                                                  | Status     |
|----------------|---------------------------------------------------------------------------|------------|
| Shipments CSV  | `GET /reports/shipments.csv?role=manufacturer&entity_id={mid}`            | ✅ Verified|
| Inventory CSV  | `GET /reports/inventory.csv?role=manufacturer&entity_id={mid}`            | ✅ Verified|
| Other formats  | —                                                                          | ❌ Missing |

---

## 10. Notifications Audit

`NotificationsPopover` in the top-bar.

| Action            | Endpoint                                                                    |
|-------------------|-----------------------------------------------------------------------------|
| List              | `GET /notifications?target_type=manufacturer&target_id={mid}&limit=`         |
| Mark one read     | `PATCH /notifications/{notif_id}/read`                                       |
| Mark all read     | `PATCH /notifications/read-all`                                              |

Notification types observed: `delivery` · `order` · `stockout` · `delay` · `intel` · `network` (system).

---

## 11. Sabi Integration Opportunities (NOT IN MVP)

### 11.1 Today

- `POST /manufacturer/{mid}/assistant` → **does not exist** (404).
- Sabi bubble = retailer-only.
- A separate **Logistics Copilot** exists at `/logistics/copilot/chat` — currently surfaced only inside the Logistics Center, not as a global bubble.

### 11.2 High-value future use-cases (do not design now)

| Use case                                  | Endpoint to wire                            |
|-------------------------------------------|---------------------------------------------|
| "Allocate today's pending POs"            | `/allocation/orders/{id}/auto-allocate` × N |
| "Approve all distributor POs for Apex"    | bulk approve handler                        |
| "Re-plan dispatch from Lagos warehouse"   | `/logistics/route-planning/preview`+`/dispatch` |
| "What's my Q3 stockout risk?"             | feed into exec-summary                      |

---

## 12. Master Capability Matrix

| Feature                            | Page                                | Actions                                                         | API Endpoint(s)                                                              | Mobile Priority |
|------------------------------------|-------------------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------------|-----------------|
| Login / Sign-out                   | `/login`                            | Email + password                                                | `/auth/*`                                                                    | **P0**          |
| Dashboard 5-KPI strip              | `/dashboard`                        | Read                                                            | `GET /manufacturer/{mid}/overview`                                           | **P0**          |
| AI Executive Brief                 | `/dashboard`                        | Read + regenerate                                               | `GET/POST /intel/exec-summary`                                               | **P0**          |
| Revenue Trend (12-mo area)         | `/dashboard`                        | Read                                                             | same overview                                                                | **P0**          |
| **Network Pulse ticker**           | `/dashboard`                        | Live polling                                                    | `GET /manufacturer/{mid}/network-pulse?limit&since_iso`                      | **P0**          |
| Activity Pulse strip               | `/dashboard`                        | Read                                                             | `GET /manufacturer/{mid}/activity-pulse`                                     | **P1**          |
| Regional performance               | `/dashboard`                        | Read                                                             | same overview                                                                | **P1**          |
| Coverage KPIs                      | `/dashboard`                        | Read                                                             | same                                                                          | **P1**          |
| Top Products                       | `/dashboard`                        | Read                                                             | same                                                                          | **P0**          |
| Stockout Risk list                 | `/dashboard`                        | Read                                                             | same                                                                          | **P0**          |
| Distributor table                  | `/dashboard`                        | Sort, open detail                                                | same + `/manufacturer/{mid}/distributor/{did}`                               | **P0**          |
| Pipeline funnel                    | `/dashboard`                        | Read                                                             | same                                                                          | **P0**          |
| Alerts                             | `/dashboard`                        | Read                                                             | same                                                                          | **P1**          |
| Logistics Center map               | `/manufacturer/logistics-center`    | Pan/zoom, filter leg-types                                       | `GET /logistics/control-tower?manufacturer_id={mid}`                         | **P1**          |
| Logistics events list              | logistics center                    | Filter, acknowledge                                              | `GET /logistics/events` · `POST .../ack`                                      | **P0**          |
| Bulk-ack events                    | logistics center                    | One-tap                                                         | `POST /logistics/events/bulk-ack`                                            | **P0**          |
| Archive arrived vehicles           | logistics center                    | One-tap                                                         | `POST /logistics/vehicles/archive`                                           | **P1**          |
| Archived vehicles history          | logistics center                    | Read                                                             | `GET /logistics/vehicles/archived`                                           | **P2**          |
| Route Planning                     | logistics center                    | Preview, dispatch                                                | `…/route-planning` (3 endpoints)                                              | **P2**          |
| Delay predictions                  | logistics center                    | Read                                                             | `GET /logistics/predictions`                                                  | **P2**          |
| Demand vs Delivery                 | logistics center                    | Read                                                             | `GET /logistics/demand-delivery`                                              | **P2**          |
| Logistics Copilot                  | logistics center                    | Chat, execute, dismiss                                          | `/logistics/copilot/*`                                                        | **P2**          |
| Outbound PO list                   | `/procurement`                      | Filter by status                                                 | `GET /procurement/purchase-orders?manufacturer_id`                            | **P0**          |
| Outbound PO detail (live ETA)      | `/procurement`                      | Read                                                             | `GET /procurement/purchase-orders/{po_id}`                                   | **P0**          |
| PO state machine                   | `/procurement`                      | submit/approve/reject/process/ship/deliver/cancel/duplicate     | `POST .../{action}`                                                          | **P0**          |
| Allocation summary + KPIs          | `/procurement?tab=allocation`       | Read                                                             | `GET /allocation/summary` · `/allocation/kpis`                                | **P0**          |
| Auto-allocate order                | allocation tab                      | One-tap                                                         | `POST /allocation/orders/{id}/auto-allocate`                                  | **P0**          |
| Manual-allocate order              | allocation tab                      | Edit lines                                                       | `POST /allocation/orders/{id}/manual-allocate`                                | **P1**          |
| Back-order                         | allocation tab                      | One-tap                                                          | `POST /allocation/orders/{id}/back-order`                                     | **P1**          |
| Allocation reject                  | allocation tab                      | Reason                                                            | `POST /allocation/orders/{id}/reject`                                         | **P0**          |
| Allocation acknowledge             | allocation tab                      | One-tap                                                          | `POST /allocation/orders/{id}/acknowledge`                                    | **P1**          |
| Back-orders list                   | allocation tab                      | Read                                                             | `GET /allocation/back-orders`                                                 | **P1**          |
| Wholesaler POs cross-tier          | `/procurement?tab=wholesaler-pos`   | Read                                                             | `GET /manufacturer/{mid}/wholesaler-pos`                                     | **P2**          |
| Product Intelligence table         | `/product-intelligence`             | Search, filter, sort                                              | `GET /manufacturer/{mid}/product-intelligence`                                | **P0**          |
| Refresh PI snapshot                | PI                                  | One-tap                                                           | `POST /manufacturer/{mid}/product-intelligence/refresh`                       | **P1**          |
| Product detail                     | PI / dashboard / network            | Read                                                             | `GET /manufacturer/{mid}/product/{product_id}`                                | **P0**          |
| Create product                     | PI                                  | Modal form                                                        | `POST /manufacturer/{mid}/products`                                           | **P1**          |
| Edit product                       | product detail                      | Inline fields                                                     | `PATCH /products/{product_id}`                                                | **P1**          |
| Inventory adjust (any owner)       | PI / warehouse detail               | Form                                                              | `POST /inventory/adjust`                                                      | **P2**          |
| Intel Recommendations              | `/intel`                            | Acknowledge                                                        | `GET /intel/recommendations` · `PATCH /intel/recommendations/{id}`            | **P1**          |
| Intel Stockout Forecasts           | `/intel`                            | Read                                                              | `GET /intel/forecasts/stockout`                                                | **P1**          |
| Intel Alerts                       | `/intel`                            | Read                                                              | `GET /intel/alerts`                                                            | **P1**          |
| Intel External signals             | `/intel`                            | Read                                                              | `GET /intel/external`                                                          | **P2**          |
| Intel Delivery ETA                 | `/intel`                            | Read                                                              | `GET /intel/delivery-eta`                                                      | **P1**          |
| Intel Retailer Health              | `/intel`                            | Read                                                              | `GET /intel/retailer-health`                                                   | **P2**          |
| Intel Copilot chat                 | `/intel`                            | Chat                                                              | `POST /intel/copilot`                                                          | **P2**          |
| Intel recompute (force)            | `/intel`                            | One-tap                                                           | `POST /intel/recompute`                                                        | **P2**          |
| Network Map                         | `/network-map`                      | Pan/zoom · open detail                                            | `GET /manufacturer/{mid}/overview → hierarchy`                                 | **P2**          |
| Distributors list                  | `/network`                          | Sort, search, open detail                                         | overview.distributor_table[]                                                  | **P0**          |
| Distributor detail                 | `/distributors/:id`                 | Read                                                              | `GET /manufacturer/{mid}/distributor/{did}`                                   | **P1**          |
| Warehouses list                    | `/manufacturer/warehouses`          | Open detail                                                       | `GET /manufacturer/{mid}/warehouse-network`                                   | **P0**          |
| Warehouse detail                   | `/manufacturer/warehouses/:id`      | Read                                                              | `GET /warehouse/{wh_id}/distributor-network`                                  | **P1**          |
| Reports — Shipments CSV            | `/reports`                          | Download                                                          | `GET /reports/shipments.csv?role=manufacturer&entity_id={mid}`                | **P2**          |
| Reports — Inventory CSV            | `/reports`                          | Download                                                          | `GET /reports/inventory.csv?role=manufacturer&entity_id={mid}`                | **P2**          |
| Generic role analytics             | `/analytics`                        | Read                                                              | `GET /analytics?role=manufacturer&entity_id={mid}`                            | **P1**          |
| Notifications                      | top-bar                              | Read, mark read, mark all read                                    | `/notifications/*`                                                            | **P0**          |

---

## 13. Things NOT present (web parity rule for mobile)

- ❌ No dedicated **Profile / Settings** page.
- ❌ No **Push notifications** preferences.
- ❌ Sabi Copilot bubble (Logistics Copilot exists but is in-page only).
- ❌ **Driver / Vehicle CRUD** (vehicle code captured at dispatch only).
- ❌ **Payments / credit / invoicing**.
- ❌ **Promotions** authoring.
- ❌ **CRM / messaging** with downstream tiers.

---

## 14. Auth notes

- **Base URL (prod):** `https://www.app.tradekonekt.com`
- **API prefix:** `/api`
- **Manufacturer test account:** `unilever@tradekonekt.io / TradeKonekt2026!`
- **Manufacturer entity_id:** `b21c1dbe-1a6f-4c33-b036-f416579455d0`

---

*End of spec.*
