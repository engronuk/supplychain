# Supply Chain Hub — PRD

## Original problem statement
Use the connected GitHub repository as the existing application codebase.
Preserve: React architecture, existing views, inventory workflows, shipment lifecycle,
distributor/retailer relationships.
Existing modules: DistributorDashboard, DistributorInventoryView, RetailerInventoryView,
ShipmentTracker, RequestsView. Workflow: Pending → In Transit → Received.
Do not rebuild existing modules unnecessarily. Extend the existing architecture only.

Iteration 2: add Manufacturer (Unilever) using uploaded CSVs. Populate products,
manufacturer, distributors, retailers. One use case for Distributor and Retailer.
Manufacturer can see all 91 distributors; Distributor sees all its retailers.

## Architecture
- Frontend: React 19 + react-router-dom + shadcn-ui + Recharts + Tailwind
- Backend: FastAPI + Motor (async MongoDB)
- Storage: MongoDB collections — manufacturers, distributors, retailers, products,
  inventory, shipments, requests, notifications
- Auth: simple role-switcher (no password), persisted in localStorage

## User personas
- **Manufacturer (Unilever)** — sees all 91 distributors, ships products to them,
  manages master inventory, owns analytics/reports for production-to-distribution
- **Distributor** — sees its retailers, receives shipments from manufacturer,
  fulfills retailer requests by creating shipments
- **Retailer** — places stock requests, receives shipments, manages shelf inventory

## Core requirements
- Three-tier supply chain: Manufacturer → Distributor → Retailer
- Generic Shipment with from_role/from_id/to_role/to_id supports both flows
- Shipment lifecycle: Pending → In Transit → Received (server-enforced transitions)
- Inventory automatically adjusted on dispatch and receipt
- Retailer → Distributor stock requests with approve/reject; approval auto-creates a shipment
- Notifications fired on every state change
- Per-role Analytics dashboard (KPIs, 14-day timeline, status breakdown, top products)
- CSV exports (shipments, inventory)

## What's been implemented (2026-05-16)
- Full backend with 8 collections + auto-seed from CSVs in /app/backend/data
- 91 Unilever distributors, 91 retailers, 15 products with barcodes, 2,745 inventory rows
- Manufacturer / Distributor / Retailer dashboards
- Manufacturer Distributor-directory and Distributor Retailer-directory (/network)
- ShipmentTracker (role-aware sender/receiver actions, visual pipeline, from→to display)
- RequestsView (retailer creates, distributor approves/rejects → auto shipment)
- InventoryView (per role, low-stock badges, search)
- AnalyticsView (Recharts area + pie + bar) and ReportsView (CSV download)
- NotificationsPopover with unread badge + mark-all-read
- Pytest suite at /app/backend/tests/test_supply_chain.py (24/24 green)
- Frontend e2e flows verified by testing agent

## Updates (2026-05-17 – Phase 1 + 2)
### Distributor Retailer Intelligence
- **Enhanced Retailer List** (`/network` for distributors): sortable table with Status, Stock Health %, Revenue, Last Order, Contact (name/phone/email), inline action icons (View Details / Inventory / Transactions / Send Restock), search + active/inactive + health filters, summary KPI strip, CSV export
- **Retailer Detail Page** (`/network/retailer/:id`) with 5 tabs:
  - **Overview** — profile, contact, KPI grid (revenue, stock health, active orders, pending requests, last delivery/order), 30-day revenue sparkline, inventory snapshot
  - **Deliveries** — delivery history table with status filter, total value/cost/margin summary, value & margin columns
  - **Stock Requests** — categorized requests with priority badges, line-item breakdown, search & status filters
  - **Analytics** — 30-day daily revenue chart, WoW + MoM growth, top selling products bar chart, sales by category donut, margin trend
  - **Transactions** — invoice list with order value, payment status, method, items count
- **AI Insights** ribbon — rule-based deterministic insights (revenue trend, stock alerts, pending requests, top sellers) shown across the detail page
- **Order Financials** — unit_price × quantity at line level, summed for delivery/request order values across all surfaces

## Updates (2026-05-17)
### Retailer dataset expansion
- Replaced `/app/backend/data/distributors.csv` with `generated_retailers.csv` (3,100 rows)
- DB now seeds **3,080 retailers** (up from 99) across the same 91 distributors
- `Retailer` model now has optional `store_code`, `phone`, `latitude`, `longitude`
- Inventory rows: 47,580 (manufacturer 15 + distributor 1365 + retailer 46,200)
- `to_list` limits bumped to 20000 on retailer queries

### Context Intelligence Modes (Manufacturer Network View)
- Added segmented context switcher with 5 modes:
  - **Health** — green/amber/red status + pulse on critical
  - **Retailer Density** — indigo intensity + size boost + count pill badge
  - **Fulfillment Risk** — red intensity proportional to low_stock_retailers ratio + pulse on high risk
  - **Shipment Activity** — cyan intensity + animated dashed route trails
  - **Sales Velocity** — yellow→red demand heat
- Modes update node fill/halo/radius/badge without recomputing layout
- Sliding-indicator animated tab with per-mode accent color
- Mode-aware legend & per-mode contextual metric inside tooltip
- Pulse animation for at-risk nodes; lineDashOffset animation for shipment edges

### Overlap fix (RadialHierarchyCanvas)
- Children orbital radius now hard-capped at `min_sibling_distance / 2 - childR - 8`
  so a parent's micro-network never bleeds into an adjacent sibling's territory
- Child fan width clamped to parent's angular slot (`a1 - a0 * 0.92`)
  with orbit auto-expanded to preserve tangential spacing

## Updates (2026-05-17 — Backend Refactor P2)
### Modular routers
- `server.py` reduced from **2,969 → 68 lines** (slim entrypoint that just wires routers + lifecycle hooks).
- Split into `core.py` (db client + utils + type literals), `models.py` (all Pydantic), `services/` (helpers, ai_insights, retailer, seed) and `routes/` (entities, inventory, shipments, stock_requests, notifications, analytics, reports, hierarchy, geo, distributor, retailer_os, assistant, seed).
- All `/api/*` paths unchanged — frontend untouched.
- pytest suite: **44/44 passing** post-refactor (was 24; assistant + retailer ops suites already added by previous work).
- Stale seed-count assertions (legacy 91 retailers) updated to reflect 3,080-retailer dataset.

## Prioritized backlog
- P1 — Multi-manufacturer scoping: `retailers_count` in /api/analytics for manufacturer
  currently counts all retailers; should be scoped to that manufacturer's distributors
- P1 — Validate inventory ≥ requested at pending→in_transit instead of clamping at 0
- P2 — Server-side guard on Shipment.from_role/to_role pairs (only mfg→dist or dist→ret)
- P2 — Silence Recharts width(-1) console warnings with explicit chart min-heights
- P3 — Multi-manufacturer support (currently single)
- P3 — Email/SMS notifications integration
- P3 — Real ServiceWorker offline support for Retailer OS

## Next tasks
- Address any feedback from user
