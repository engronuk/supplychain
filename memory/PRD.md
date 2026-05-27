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

## Updates (2026-05-27 — Premium Auth Gateway + Light-Theme Landing)
### JWT Authentication (bcrypt + HS256, no public registration)
- **`/api/auth/*` routes**: login, logout, refresh, me, forgot/reset password,
  invitation create/get/claim, list-users (super_admin + manufacturer admin),
  impersonate (super_admin only), demo-accounts (public).
- **Services** (`services/auth.py`): bcrypt password hashing, JWT access (30 min)
  + refresh (30 day) tokens with HS256, get_current_user reads
  `Authorization: Bearer` first then `access_token` cookie, `require_role()`
  factory for RBAC, 5-attempt lockout with 15-min auto-clear window,
  `resolve_user_tenant()` derives `manufacturer_id` for any role.
- **HttpOnly cookies + Bearer tokens**: backend sets cookies on login but
  frontend prefers Bearer header (stored in `localStorage.tk.access_token`)
  so multi-domain rollouts work without CORS cookie pain.
- **Idempotent demo seed** (`services/seed_demo_users.py`, runs on every boot):
  creates 1 super-admin + 1 manufacturer admin + 3 distributor admins
  (Lagos / Abuja / Port Harcourt) + 5 retailer admins under primary
  distributor. All share password from `DEMO_PASSWORD` env (`TradeKonekt2026!`).
  Skips accounts that already exist.
- **Super-admin impersonation** (`/api/auth/impersonate/{user_id}`):
  super_admin only, returns access token for any active user. Frontend stashes
  the admin's own token in `localStorage.tk.original_token` and shows a
  "Return to admin" button in the Layout topbar.
- **5 new user indexes** (uniq id, uniq email, by_role_status, by_manufacturer,
  sparse invitation_token + reset_token).
- **22 new pytest tests** in `test_auth.py`: 93/93 total green.

### Frontend auth integration
- **`SessionContext.jsx`** rewritten as a real auth context: bootstraps from
  `localStorage.tk.access_token` -> calls `/auth/me` -> hydrates entity from
  /manufacturers|/distributors|/retailers. Exposes `signIn`, `signOut`,
  `impersonate`, `stopImpersonating`, `refreshMe`, `bootstrapping`.
- **`api.js`** Bearer interceptor: attaches `Authorization: Bearer` from the
  in-memory token, on 401 → `window.location.replace("/login?expired=1")`.
- **`LoginPage.jsx`** (`/login`): split-screen, ink-on-paper. Left rail =
  dark brand canvas with display serif + live stats. Right = email/password
  form, demo-account roster with one-tap autofill, password show/hide,
  session-expired banner.
- **`SuperAdminConsole.jsx`** (`/dashboard` for super_admin): roster of demo
  accounts grouped by role with "Sign in as" impersonate buttons.
- **`Layout.jsx`** updates: handles super_admin (minimal nav), shows
  "Return to admin" button when impersonating, NotificationsPopover guarded
  for super_admin.
- **Routing** (`App.js`): `/` public landing, `/login`, protected `/dashboard/*`
  family. `<BootGate>` shows a connecting splash while `/auth/me` resolves.

### Premium Light-Theme Landing Page (`/`)
- **Generic TradeKonekt brand** (not Unilever-specific) per user choice.
- **Design system** (`tailwind.config.js` + `index.css`):
  - Warm paper background `#FAFAF7`, ink `#0A0A0A`, graphite `#525252`.
  - Accents: burnt amber `#D97706`, moss `#0F766E`, deep indigo `#1E1B4B`.
  - Display: Instrument Serif (italic-accent treatment).
  - Body: Inter. Mono: JetBrains Mono.
  - Custom keyframes: ticker-up, pulse-dot, fade-rise, marquee.
- **Sections** (`components/LandingPage.jsx`):
  - Sticky topnav with Sign-in / Request-demo CTAs.
  - Asymmetric hero: serif headline "Orchestrate national distribution
    with intelligence built in." + live signal feed card (rotating ticker:
    stockout risk · velocity spike · weather pressure · lane delay) + sparkline
    + floating Sabi chip ("3 recommendations awaiting review").
  - Trust strip with marquee animation.
  - 3 platform pillars (Intelligence · Orchestration · Retail Workflows).
  - Dark "Intelligence Center" dashboard preview with hand-rolled multi-series
    SVG velocity chart + mocked KPI cards + Sabi executive narration block.
  - "Sense. Predict. Recommend. Act." 4-step loop with arrow connectors.
  - 12-module capability matrix grid.
  - Final CTA card in ink panel with amber button.

### Pytest
- 71 → **93 passing** (+22 auth tests).
### Predictive, real-time intelligence overlay (additive, no rewrites)
- **12 new `/api/intel/*` endpoints** (`routes/intel.py`):
  exec-summary (+regenerate), feed, forecasts/stockout, alerts,
  recommendations (+PATCH ack), retailer-health, delivery-eta, external
  (weather+holidays), copilot, recompute.
- **6 background services** (`services/intel/`):
  forecasts (EWMA + DOW seasonality + external multiplier + Wilson confidence),
  anomalies (rolling z-score), retailer_health (RFM scoring + churn flag),
  delivery_risk (lane baseline + weather-adjusted ETA), recommendations
  (rule engine with urgency/confidence/impact), narrator (Gemini Flash feed
  + Sonnet 4.5 exec summary).
- **External signals**: Open-Meteo weather (free, no key) for 6 NG regions +
  hardcoded NG holiday calendar + salary-window detection. Refreshed every 6h.
- **APScheduler** in-process: anomalies @5min, forecasts @15min, health/logistics/
  recommendations/feed @60min, external @6h, daily exec summary + 30-day retention
  cleanup at 06:00 UTC. Initial pass runs in background on every startup so
  endpoints never return empty.
- **Tenant scoping**: every intel record carries `tenant_id` (= manufacturer_id).
  Role-aware filter in `scoping.py` — distributor sees only their retailers,
  retailer sees only themselves. Works seamlessly when additional FMCG
  manufacturers onboard.
- **Unified Sabi copilot** at `POST /api/intel/copilot` — role-aware
  (manufacturer/distributor/retailer), auto-routes simple queries to Gemini
  Flash and complex ones (procurement plan / forecasts / strategy / N-day) to
  Claude Sonnet 4.5. Read-only recommendations by design (POC safety).
- **Frontend** (`views/IntelligenceCenter.jsx`, `components/IntelExecSummaryCard.jsx`):
  Dark "command-center" page with hero, executive brief, live feed (30s polling),
  forecasts, recommendations (acknowledge button), retailer churn, logistics
  risk, external signals (weather + holidays), and a floating Sabi panel.
  AI Executive Brief widget embedded on all 3 role dashboards.
- **12 new indexes** for intel collections.
- **Tests**: 18 new pytest tests in `test_intel.py`, all green. 71/71 total
  pytest passing (45 supply-chain/sales/retailer + 18 intel + 8 assistant).
- **APScheduler 3.11.2** added to requirements.txt.
### Complete POS / Sales Module for Retailer Workspace
- **New sidebar entry** "Sales Book" (Receipt icon) — retailer-only.
- **Backend** (`routes/sales.py` — 6 endpoints, 482 lines):
  - `POST /api/retailer/{id}/sales` — atomic multi-product sale, conditional `$inc`
    deduction prevents over-sell under concurrency (4 parallel sales of 5 units
    each deducted exactly 20). On persist failure, inventory rolls back.
  - `GET  /api/retailer/{id}/sales` — filters (date_from, date_to, payment_method,
    payment_status, search), pagination, returns {total, limit, offset, rows}.
  - `GET  /api/retailer/{id}/sales/summary` — Today KPIs + best seller + 7d/WoW.
  - `GET  /api/retailer/{id}/sales/analytics` — daily/weekly/monthly trends,
    best/slow products, payment mix, peak hour & DOW, AI insights (Claude Haiku).
  - `PATCH /api/retailer/{id}/sales/{id}/mark-paid` — credit settlement.
  - `GET  /api/retailer/{id}/sales/export.csv` — streaming CSV.
- **Inventory sync** — sales write to both `sales` and `daily_sales` so existing
  analytics endpoints (retailer dashboard, distributor retailer-detail) reflect
  shop-floor activity automatically.
- **Models**: `SaleLineItem`, `SaleCreate`, `SaleMarkPaid` (in `models.py`).
- **Indexes**: 5 new sales indexes (by_retailer_recent, by_retailer_payment,
  by_retailer_status, by_tx_code, uniq_id).
- **Frontend** (`views/SalesBookView.jsx` — 940 lines): 3-tab layout
  (Today / Sales Book ledger / Analytics), POS-style multi-product entry dialog
  with product search, qty/price editing, payment method tiles (cash/transfer/
  pos/credit), customer/attendant/notes. Mobile FAB for one-tap new sale.
- **AI insights**: 3-5 contextual cards in Analytics tab via Claude Haiku
  through the existing `generate_ai_insights` service.
- **Pytest**: 9 new tests in `test_sales.py`, all 53 tests passing.
- **Seed meta**: primary distributor/retailer IDs now persisted to `seed_meta`
  collection so idempotent `/api/seed` calls always return canonical IDs.
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
