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

## Updates (2026-06-04 — Product Command Center)
- **New backend route** `GET /api/manufacturer/{id}/product-detail/{product_id}`
  in `routes/product_detail.py` — single fat aggregator that returns
  product identification, health, 6 KPIs (with growth deltas), AI summary,
  inventory health (8 metrics), 90-day daily sales series, per-state
  geographic, batches, expiry risk buckets + nearest expiry, top
  distributors, AI recommendations, demand forecast (30/60/90), activity
  log, and performance rankings.
- **New page** `/products/:productId` at `views/ProductCommandCenter.jsx`
  — replaces the old basic product detail view. Header + 3-column
  identification strip + 6 KPI cards + 7 tabs. Overview tab has 3 rows:
  (1) Inventory Health · Sales Trend · Geographic Heatmap, (2) Batch
  Intelligence · Expiry Risk · Top Distributors, (3) AI Recommendations
  + Projected Growth gradient card. Other tabs (Batches / Expiry /
  Distribution / Forecast / Performance / Activity) consume the same
  payload. Old page kept at `/products/:productId/legacy`.
- Sales Trend uses bars (units) + smooth line (revenue) with dual y-axis,
  hover guideline + tooltip, and 30/60/90-day range selector.
- Deterministic QR-like SVG generated client-side for each SKU.

## Updates (2026-06-04 — Product Intelligence Center)
- **New backend route** `GET /api/manufacturer/{id}/product-intelligence`
  in `routes/product_intelligence.py` — single fat aggregator returning
  KPIs, AI brief, portfolio, performance matrix, batch health, expiry
  risk, category performance, geographic heatmap, stock risk, recent
  alerts. All values derived from real Mongo collections (no mocks).
- **New `batches` collection** + idempotent seeder
  (`services/seed_batches.py`). 3 batches per SKU = 45 batches total
  across the demo manufacturer's 15 products, distributed across healthy
  / near-expiry / expired states with deterministic batch numbers
  (e.g. `AX260616B`). Re-running the seed never duplicates.
- **New page** `/product-intelligence` (manufacturer role only) at
  `views/ProductIntelligenceCenter.jsx`. 6 KPI cards · gradient AI brief
  hero with Network Inventory Health Score donut · Product Portfolio
  table (tabs: All / Healthy / Watch / At Risk + search) · Product
  Performance Matrix (2×2 with leader-line labels) · Batch Health donut
  · Expiry Risk donut with nearest-expiry callout · Category Performance
  bars · Geographic Inventory Heatmap (real Nigeria state polygons) ·
  Stock Risk Center (top 5) · Recent Alerts strip.
- **Sidebar nav**: new `Product Intelligence` entry above
  `Intelligence` for manufacturers.
- **Pytest suite** at `backend/tests/test_product_intelligence.py` —
  23/23 passing including idempotency check.
- Score weighting: 50% risk + 30% expiry pressure + 20% growth (no
  more +10 fudge); units_in_network growth dropped to null until a real
  historical inventory snapshot exists.

## Updates (2026-06-03 — Premium Executive Command Center)
### Manufacturer dashboard visual upgrade (Stripe / HubSpot / Linear class)
- **Executive Hero** (gradient, glassmorphism, AI orb illustration with
  orbiting rings, animated confidence chip + AI Executive Brief badge,
  4 recommendation bullets in 2x2 with severity icons, three quick-action
  CTAs: Investigate Distributors / View Intelligence / Open Forecast).
- **KPI cards**: 34px tabular numerals, animated sparklines (smooth cardinal
  splines), trend chips, hover-lift shadows (`-translate-y-0.5`), comparison
  period footer.
- **Coverage strip**: 4 secondary KPIs in a separate row.
- **Revenue Trend**: smooth bezier curves, gradient fill, dashed forecast
  continuation clamped to chart bounds, hover guideline + tooltip,
  export/expand buttons, legend with forecast line.
- **Regional Performance (v2 — true choropleth)**:
  37 state polygons (Nigeria GADM-derived LGAs unioned per state, simplified
  to 0.025°, projected into a 600x540 viewBox) generated once into
  `src/lib/nigeriaStates.js`. States coloured by their parent geopolitical
  zone's health (Healthy / Watch / At Risk / No Data) with subtle per-state
  opacity variance for visual interest. Legend moved to header, AI summary
  line ("X contributes Y% of national revenue and is the healthiest zone")
  rendered from a new `regional_summary` field on the backend overview.
  Card now spans full width — 70% map / 30% zone leaderboard ordered
  exactly: SW, NW, SE, NC, NE, SS. Hover tooltip shows Revenue / Retailers /
  Inventory / Health Score per zone with bidirectional cross-highlight
  between map and leaderboard.
- **Product Intelligence**: rich rows with rank, gradient icon tile,
  product name + category, deterministic 12-bar mini gradient sparkline
  (green for growth, rose for decline), revenue, growth chip.
- **Distributor Intelligence**: 8-row table with sparklines per row,
  health-score progress bars, risk chips, and animated chevrons.
- **Supply Chain Pipeline**: horizontal animated flow
  (Manufacturer → Distributor → Retailer) with 4 stages, animated
  shipment-flow dots between bubbles, efficiency progress bar + SLA
  badges and direction tags.
- **Network Alerts**: severity-edge intelligence cards (impact / owner /
  due date / Take action button) in a responsive 2-column grid.
- New tailwind keyframes: `shipment-flow`, `shimmer-slow`, `float-y`,
  `orbit-spin`, `rise-in`.
- Cleanup: removed duplicated dashboard header (Layout topbar already
  shows workspace context).
- Backend: `_zone()` city→zone normaliser (Lagos→SW etc.), per-zone
  retailer/inventory rollups, health_score & revenue_share_pct in
  `regional`, new top-level `regional_summary` headline.

## Next tasks
- Address any feedback from user

## Updates (2026-06-04 — Distributor Intelligence Center)
- **Backend fat endpoint** `GET /api/manufacturer/{id}/distributor-intelligence/{distributor_id}` (new file `routes/distributor_intelligence.py`, ~430 lines): returns distributor, 6 KPIs (retail_revenue_90d · active_retailers · network_health_score · stockout_risk_retailers · avg_sell_through · retail_order_frequency), AI brief, BCG-style retail_performance_matrix, retail_coverage by city, top_retailers (top 5), attention_retailers (4), product_penetration, full retailer_table with composite health scores. Patched to use canonical `units` field on daily_sales with fallback to legacy `quantity_sold`.
- **Frontend rewrite** `views/ManufacturerDistributorDetail.jsx` (~1055 lines): Fortune-500 SaaS layout — breadcrumb, header (status chip · region · onboarded date · View Retailers / Retail Heatmap / Contact / Edit Distributor CTAs), 6 hero KPI cards with sparklines, gradient AI Executive Summary + semi-circle Network Health gauge, Retail Performance Matrix (BCG-style scatter, dots-only, hover tooltip, quadrant tints + count chips), Retail Coverage bubble map (sized by retailer count, colored by revenue band, sort by Revenue/Retailers), Top Retailers / Product Penetration / Attention triplet, full Retailer Intelligence table (search · health filter · CSV export · sortable columns).
- **Tested**: backend pytest 14/14, frontend e2e 26/26 testids, 100% critical paths. Report: `/app/test_reports/iteration_8.json`.

## Updates (2026-06-04 — Manufacturer Retailer Drill-Down)
- **Backend** new endpoint `GET /api/manufacturer/{id}/distributor/{distributor_id}/retailer/{retailer_id}` (`routes/distributor_intelligence.py`, ~20 lines). Validates the manufacturer→distributor chain then delegates to the existing `routes/distributor.py:distributor_retailer_detail` aggregator, so the manufacturer reuses the same rich retailer payload (overview · 30-day revenue trend · deliveries · stock_requests · analytics · transactions · ai_insights) without duplicated logic.
- **Frontend** `DistributorRetailerDetail.jsx` is now route-aware: detects `distributorId` URL param + manufacturer role and swaps the back link to "Back to distributor" + hides Send Restock / Create Delivery CTAs (distributor-only) while exposing Call / Email shortcuts. Same component serves both `/network/retailer/:retailerId` (distributor flow) and `/distributors/:distributorId/retailers/:retailerId` (manufacturer drill-down).
- **Wired-up entry points** inside the Distributor Intelligence Center: chevrons in the full Retailer Intelligence table, rows in Top Performing Retailers, and rows in Retailers Requiring Attention all navigate to the new drill-down route.
- **Tested**: backend pytest 18/18 (incl. 4 new `TestRetailerDrilldown` cases). Frontend e2e 5/5 scenarios — chevron click navigates correctly, back button correct, distributor-only CTAs hidden in manufacturer mode, top-retailer / attention-list clicks navigate, and the original distributor flow (`/network/retailer/:retailerId`) regressed clean. Report: `/app/test_reports/iteration_9.json`.

## Updates (2026-06-04 — Demo dates refresh)
- **New idempotent service** `services/refresh_demo_dates.py` (+ admin endpoint `POST /api/seed/refresh-dates`) that re-aligns every seeded timestamp to "today" without touching ids, quantities, statuses or relationships. Runs automatically on every backend boot (server.py lifespan) so the demo environment always looks actively used.
- **Touches** (all idempotent · 98k+ docs per pass):
  - `daily_sales.date` shifted so latest = today (30-day window stays intact).
  - `sales` (POS) shifted so latest is within last few hours.
  - `shipments`: received → received_at in last 7d preserving created→dispatched→received gaps; in_transit → dispatched in last 1-5d; pending → created in last 1-3d.
  - `requests`: pending in last 1-3d; resolved in last 7d preserving created→resolved gap.
  - `notifications` spread across last 7d.
  - `inventory.updated_at`: 16 hash-bucketed `update_many` calls spread across last 7d (avoids 47k individual writes).
  - `inventory_audit.created_at`, `batches.created_at` in last 7d.
  - `intel_alerts/recommendations/insights` within last 1-3d.
  - `intel_executive_summaries.generated_at` within last 24h.
  - `intel_forecasts.computed_at`, `intel_retailer_health.updated_at`, `intel_external_signals.updated_at`, `intel_delivery_eta.updated_at` = now (eta_date recalculated from `eta_days`).
  - `promotions.starts_at/ends_at` shifted to start today; `created_at` in last 7d.
  - `users.last_login_at` within last 24h.
- **Never touches** master data (`manufacturers`, `distributors`, `retailers`, `products`, `users.created_at`, `batches.manufactured_at`, `batches.expiry_date`).

## Updates (2026-06-04 — Deployment fix: non-blocking startup)
- **Bug**: Production deploy crash-looped with nginx 502 "Connection refused" — backend logs showed `Indexes ensured` 3× in 40s before any traffic reached uvicorn.
- **Root cause**: All heavy bootstrap (CSV seed of ~47k inventory rows + ~3k retailers, demo-user seed, batch seed, the new 98k-doc `refresh_demo_dates`, scheduler boot) ran inside `@app.on_event("startup")` *before* uvicorn bound the socket. On Atlas latencies this exceeded the K8s readiness probe window → pod killed before listening → CrashLoopBackOff.
- **Fix**: `server.py` now keeps only `ensure_indexes()` (sub-second, idempotent) in the startup hook. Everything else is offloaded to `_background_bootstrap()` via `asyncio.create_task()` with the reference parked on `app.state.bootstrap_task`. On a fresh seed the demo-date refresh is auto-skipped (fresh data already has current timestamps), avoiding a 60-90s churn during the first cold deploy.
- **Verified locally**: `/api/health` opens in <300ms, demo accounts available immediately, "Application startup complete." now logs *before* the background work.

## Updates (2026-06-05 — Distributor Network Intelligence Center)
- **Backend** new fat aggregator `routes/distributor_network.py` exposing `GET /api/manufacturer/{id}/distributor-network-intelligence`. Returns the entire executive dashboard in one round-trip: 6 KPIs (`active_distributors`, `retailers_served`, `network_revenue_90d`, `inventory_units`, `avg_sell_through`, `at_risk`) with growth deltas + 12-pt sparklines · BCG-style `performance_matrix` (revenue × penetration with quadrant assignment) · 6-region `regional_coverage` (NW/NE/NC/SW/SE/SS using state-to-zone mapping) · `ai_brief` insights · 5-card `spotlight` · full `distributors_table` with composite health score · `retail_reach` ranking · actionable `at_risk` list with severity. At-risk KPI matches actionable list (not all empty distributors).
- **Frontend** new view `views/ManufacturerNetworkIntelligence.jsx` (~830 lines, pixel-perfect to user mock): Breadcrumb · Title/Search/Filters/Export · 6 KPI cards with sparklines and "vs last month" deltas · Performance Matrix (bubble scatter with quadrant tints + health-color dots) · Nigeria choropleth + per-region overlay cards · Purple gradient AI Network Summary with "View Network Intelligence" CTA · Top Distributor Overview (5 horizontal spotlight cards, navigable) · All Distributors master table (sortable/paginated/click-through) · Retail Network Reach ranking · Distributors Requiring Attention with severity chips. Every distributor name/card/row navigates to `/distributors/{id}` — no popups.
- **Removed**: dead `ManufacturerNetwork` function in `NetworkView.jsx`; manufacturer branch now delegates to `ManufacturerNetworkIntelligence`.
- **Tested**: pytest 25/25 (7 new `TestDistributorNetwork` cases + 18 existing distributor intel tests). E2E smoke-screenshot confirms spotlight clicks, table row clicks, and search filtering all work.

## Updates (2026-06-05 — Distributor Network — kill dead links)
- **"View all 91 distributors" link** now actually expands the table — toggles between paginated (8 per page) and a full list of all 91 rows. Button label flips to "Collapse to 8 per page ←".
- **Filters button** wires up a working popover with Region / Health Score / Status dropdowns; active filter count shown as a violet badge.
- **Export button** wires up real CSV download of the current `distributors_table` (filename includes today's date).
- **Retail Network Reach** "View all" toggles between top-6 and the full list (Show less ↔ View all).
- **Distributors Requiring Attention** "View all" appears only when there are more than 5 issues — toggles in the same way.
- **Removed**: dead `matrix-expand` icon button on the Performance Matrix; unused `Link` import.
- **Verified**: e2e smoke confirms filter popover opens, region filter narrows the table to 8 SW rows, badge "1" appears, expand toggles between 8 and 91 rows, CSV downloads successfully, Retail Network Reach show/hide works.

## Updates (2026-06-05 — Shipment Command Center)
- **Backend** new `routes/shipment_command.py`:
   - `GET /api/manufacturer/{id}/shipment-command-center` — fat aggregator returning 6 KPIs (`pending_dispatch`, `in_transit`, `delivered`, `delayed`, `shipment_value`, `fill_rate`) with 7d deltas + 30-day sparklines · 4-stage pipeline funnel counts · per-region (NW/NE/NC/SW/SE/SS) shipments/success_rate/avg_transit_days/fill_rate · distributor receiving leaderboard with grade · exceptions list (delayed/missing_ack) with severity · `ai_brief` with insights + recommended actions · full `shipments` table.
   - `GET /api/manufacturer/{id}/shipment-intelligence/{shipment_id}` — drawer payload with route, overview, product manifest (batch + expiry), health gauge breakdown, batch & expiry compliance, distributor acknowledgement, AI recommendation.
- **Frontend** new view `views/ShipmentCommandCenter.jsx` (~990 lines) hooked into the existing `/shipments` route for manufacturers only. Layout per pixel-perfect mock: Breadcrumb · Title/Export/New-Shipment · 6 KPI cards · Purple AI Logistics Summary (left wide) + Recommended Actions panel (right) · Pipeline funnel · Regional Shipment Performance grid · Distributor Receiving Performance table · Exceptions panel · All Shipments table (search · status filter · pagination · click-through). Right-side drawer slides in on row click — no maps, no GPS tracking, just operational intelligence. Distributor/retailer legacy ShipmentTracker untouched.
- **Tested**: pytest **34/34** (9 new `TestShipmentCommand` + `TestShipmentIntelligence`). E2E smoke confirms drawer opens with manifest, health gauge, compliance, AI recos; close button hides cleanly.

## Updates (2026-06-05 — Order Fulfillment Workflow)
- **Backend**: New `routes/distributor_orders.py` + collection `distributor_orders`. Lifecycle: pending → approved → dispatched (creates a real `Shipment` reusing the existing lifecycle) → delivered (auto-synced when distributor PATCHes the shipment to `received`). Reject path: pending → rejected (with reason captured). Endpoints:
   - `POST /api/distributor/{id}/orders` — distributor places a PO on the manufacturer.
   - `GET /api/distributor/{id}/orders` · `GET /api/manufacturer/{id}/distributor-orders` — inbound queues with denormalised distributor + product names + total_units + total_value.
   - `POST /api/manufacturer/{id}/distributor-orders/{order_id}/{approve|reject|dispatch}`.
- Every state change pushes a `Notification` (new `"order"` type added to `models.Notification.type` literal) so the counterparty sees it in their bell.
- Idempotent seed `services/seed_distributor_orders.py` (~61 orders across all 5 states for the demo Unilever manufacturer) wired into the background bootstrap.
- **Frontend**: New `OrderFulfillmentQueue` component embedded in `ShipmentCommandCenter.jsx` above the AI Logistics row. 5-tab nav (Pending Approval · Approved · Dispatched · Delivered · Rejected) with live counts · banner showing total pending value · per-row View / Approve / Reject / Dispatch CTAs · sliding right-side `OrderDetailDrawer` with order note, itemised manifest with subtotals, and a 4-step lifecycle timeline · `RejectOrderDialog` collects a free-text reason. After every action, `reload()` re-fetches both the command-center summary and the order list so the queue, pipeline funnel, and KPI cards all stay in sync.
- **Tested**: pytest **16/16** (7 new `TestDistributorOrders` + 9 existing). E2E smoke confirms Approve → Dispatch flow updates tab counts in real time (Approved 10→11, Dispatched 10→11) and that auto-delivery sync correctly promotes a dispatched order to `delivered` when the underlying shipment is marked received.


## Updates (2026-06-05 — TradeKonekt Workspace Modernization · Phase 1: Distributor Operations Intelligence)
- **Backend** new fat aggregator `routes/distributor_os.py` exposing:
   - `GET /api/distributor/{distributor_id}/operations-intelligence` — full executive payload (snapshot-backed via `services/snapshots.py` with `kind="distributor-os"`).
   - `POST /api/distributor/{distributor_id}/operations-intelligence/refresh` — synchronous recompute.
- **Payload** returns 6 KPIs (`network_revenue_90d`, `active_retailers`, `retail_orders_pending`, `dispatched_30d`, `inventory_units`, `low_stock_skus`) with growth deltas + 12-pt sparklines · AI Operations brief (insights + recommended actions) · 30-day revenue trend · BCG-style retailer **Performance Matrix** (revenue × growth, with quadrant_counts) · regional coverage · inventory-health donut · top retailers · attention retailers · category performance · order pipeline (manufacturer→distributor flow) · network-health gauge with composite score 0-100.
- **Frontend** complete rewrite of `views/DistributorDashboard.jsx` — Executive Hero (purple gradient · AI Operations Summary · Network Health gauge), KPI strip (6 cards with sparklines + deltas), Revenue Trend (SVG area chart), Inventory Health donut, Retailer Performance Matrix (2×2 BCG scatter), Regional Coverage + Category Performance progress bars, Top Retailers + Attention Retailers (clickable rows → `/network/retailer/{id}`), Order Pipeline funnel. Uses the existing `useCachedFetch` + `RefreshPill` SWR-like pattern.
- **API client**: `Api.distributorOps` + `Api.refreshDistributorOps` added to `frontend/src/lib/api.js`.
- **Tested**: pytest 13/13 in new `tests/test_distributor_os.py` · `testing_agent_v3_fork` E2E iteration_10.json reports 100% pass on backend (13/13) and frontend (all 26 test-ids + navigation + refresh integration). User chose Phase 1 (Distributor) only; Gemini 2.5 Flash earmarked for future AI brief LLM call (currently deterministic).


## Updates (2026-06-07 — Retailer Procurement Module · replaces legacy "Requests")
- **Renamed** the retailer/distributor sidebar entry from "Requests" → "Procurement" (icon: ShoppingCart). `/requests` now redirects to `/procurement`. Legacy `views/RequestsView.jsx` is no longer referenced from `App.js`.
- **Backend (`routes/procurement.py`, 745 lines, 22 endpoints)**: full procurement lifecycle —
  - Cart: `GET/POST/PATCH/DELETE /api/procurement/cart/{retailer_id}[/items[/{product_id}]]` and `/cart/{rid}/submit` which splits the cart by supplier and creates one PO per supplier
  - Purchase Orders: `GET /procurement/purchase-orders` (filters: retailer_id/distributor_id/status/statuses/date_from/date_to/product_id/q) · `POST /purchase-orders` (?submit=true) · lifecycle actions submit/approve/reject/process/ship/deliver/cancel/duplicate
  - Quotes: `GET/POST /procurement/quotes` · `POST /quotes/{id}/respond` (only invited distributors, replaces existing response) · `/close`
  - AI Reorder Recommendations: `GET /procurement/ai-recommendations/{retailer_id}` returning ranked suggestions w/ severity (critical/high/medium/low), days-to-stockout, recommended qty, expected lost revenue, suggested supplier, headline + rationale
- **PO numbering**: atomic per-year counter `PO-YYYY-NNNNN` (and `QT-YYYY-NNNN` for quotes) via `db.counters` collection.
- **Seed**: `services/seed_procurement.py` boots ~200 POs across all 8 statuses + 48 quotes (mix of open / responded / closed) idempotently.
- **Frontend** (new):
  - `views/RetailerProcurement.jsx` — tabbed workspace (Cart / Purchase Orders / Order History / Supplier Quotes) + sticky right-rail **AI Procurement Assistant**
  - `views/DistributorProcurementInbox.jsx` — distributor side with PO inbox + RFQ response dialog
  - `components/procurement/` — CartTab, PurchaseOrdersTab, OrderHistoryTab, SupplierQuotesTab, AIProcurementAssistant, PODetailDrawer (lifecycle timeline, manifest, client-side print-to-PDF), POStatusBadge, AddCartItemDialog
- **API client**: 17 new methods on `Api` (cart/POs/quotes/AI reco).
- **Tested**: pytest **19/19** PASS in `tests/test_procurement.py` (cart CRUD + submit, PO lifecycle, cancel/duplicate, invalid-transition 400, quote create/respond/replace/uninvited-403/close, AI reco + 404). `testing_agent_v3_fork` iteration_11.json reports **100% PASS** on backend + frontend across all listed test-ids.
- **PDF**: Per user choice, "Download PDF" uses browser print-to-PDF (`window.open` + `print()`), no server PDF dependency.
- **Models**: New `POStatus` (8 statuses) + `QuoteStatus` literals in `core.py`; new Pydantic models `Cart`, `PurchaseOrder`, `POLine`, `StatusEvent`, `SupplierQuote`, `QuoteResponse`, etc. in `models.py`.


## Updates (2026-06-07 — Retailer Inventory Command Center)
- **Backend** new aggregator `routes/retailer_inventory.py` exposing `GET /api/retailer/{retailer_id}/inventory-command-center` — single fat payload powering the full cockpit:
   - **7 KPI cards**: inventory_value, total_skus, inventory_units, low_stock, critical_stock, expiring_soon (aging), dead_stock
   - **stock_health**: healthy / low / critical counts + donut data
   - **ai_insights**: 4 insight types (stockout · trending_up · slow_mover · all_clear) with deterministic detail + actions array (`reorder` / `transfer` / `review`)
   - **low_stock_center**: products with `current_stock`, `reorder_level`, `days_remaining`, `recommended_qty`, sorted by urgency
   - **value_by_category** · **inventory_trend** (30 daily points projected backwards from sales) · **fast_moving** / **slow_moving** (top 5 each)
   - **expiring_soon** (heuristic — items with stock + no sale 60d+) and **dead_stock** (90d+ no sale)
   - Full enriched `inventory` array (status / value / velocity / last_sale)
- **Frontend** new `views/RetailerInventoryCommand.jsx` rendered when retailer hits `/inventory` (distributor still uses the legacy table; manufacturer redirects to Product Intelligence). Sections in order: Header → 7 KPI cards → Stock Health donut + AI Insights (purple gradient panel) → Low Stock Center table → Value-by-Category bars + 30-day Inventory Trend (SVG area chart) → Fast/Slow movers → Full inventory table (moved below strategic insights as requested). AI insight buttons wire `Reorder` to Procurement Cart, `Review` to product detail.
- **Tested**: pytest **9/9** PASS in new `tests/test_retailer_inventory.py` covering payload shape, KPIs, donut totals, 30-pt trend, insight types, low-stock columns, inventory row validity, and 404 on unknown retailer.


## Updates (2026-06-07 — Retailer Product Drill-Down)
- **Backend**: New endpoints in `routes/retailer_inventory.py`:
  - `GET /api/retailer/{retailer_id}/product/{product_id}` — full drill-down payload (product, manufacturer, inventory w/ status/velocity/days-of-cover/last-sale, 30d & 90d performance, 30-day demand trend, recent purchase orders for the SKU)
  - `PATCH /api/retailer/{retailer_id}/product/{product_id}/pricing` — retailer-owned fields: `retail_price` (their selling price), `reorder_level`, free-text `notes`. Auto-creates an inventory row if the retailer is setting a price for a SKU they don't yet stock. Returns the refreshed product payload with `margin_pct` auto-computed.
- **Model**: `InventoryItem` now carries optional `retail_price` and `notes`. New `InventoryPricingUpdate` payload model.
- **Frontend**: New `views/RetailerProductDetail.jsx` rendered at `/inventory/product/:productId` for retailers (distributor users still see the legacy `DistributorProductDetail`). Sections:
  - Header with product image, SKU/barcode/category/manufacturer chips + Reorder shortcut to Procurement
  - 5-KPI strip (On Hand · Reorder Level · Velocity/day · Days of Cover · Last Sale)
  - **Editable** "Retailer pricing & reorder rule" card with live Margin % preview (color-coded: ≥20% green, ≥0% violet, negative rose)
  - Read-only "Product overview" card for manufacturer-set fields (SKU, barcode, category, manufacturer, cost price, shelf-life, expiry) with a helpful hint when the manufacturer hasn't enriched the catalog
  - Sales performance table (30d/90d units + revenue + avg sell price) and 30-day demand bar chart
  - Procurement history table — last 5 POs for this SKU with PO status badges
- **Wiring**: Full Inventory table rows are now clickable (cursor pointer + violet hover) and navigate to `/inventory/product/{id}`.
- **Tested**: pytest **13/13** PASS in `tests/test_retailer_inventory.py` (9 existing + 4 new for product detail: GET 200/payload, 404 unknown product, PATCH pricing with margin computation, PATCH with empty body returns 400).


## Updates (2026-06-08 — Universal Organization Architecture + Many-to-Many Relationships)
**Foundation refactor.** The supply-chain entities (manufacturer / distributor / retailer + new warehouse / wholesaler / logistics_provider tiers) now live in a single unified `organizations` collection with a parent–child hierarchy (`parent_organization_id`). Legacy collections keep working as the runtime source for products/orders/sales and are cross-linked to organizations via matching UUIDs.

### Hierarchy rules (strict, enforced by API)
- `manufacturer` → `warehouse` | `distributor`
- `distributor` → `wholesaler`
- `wholesaler` → `retailer`
- `warehouse`, `retailer`, `logistics_provider` → no children

### Role visibility
| Role | Can manage | Sidebar shows /organizations |
|------|-----------|-------------------------------|
| super_admin | all 6 types | YES |
| manufacturer | warehouse + distributor | YES |
| distributor | wholesaler | YES |
| wholesaler | retailer | YES |
| retailer | — | NO |
| logistics_provider | — | NO |

### Backend (new files / endpoints)
- `backend/routes/organizations.py`
  - `GET /api/organizations` (filterable; scoped to descendants for non-admins)
  - `POST /api/organizations` (creates with auto-allocated org code MFR-/WHR-/DST-/WHO-/RTL-/LOG-, validates parent-child rules + scope)
  - `GET/PATCH /api/organizations/{id}` (with hierarchy cycle prevention)
  - `GET /api/organizations/{id}/parent | /children | /hierarchy` (recursive tree)
  - `GET /api/organizations/me/network` (own subtree; super-admin gets virtual `__root__`)
  - `GET /api/organizations/me/permissions` (returns `can_create_types` per role)
  - **Cross-tier many-to-many overlay**:
    - `POST /api/organization-relationships` (`relationship_type` ∈ supplies / distributes_for / warehouses_for / logistics_for / partner; duplicate active = 409; self-ref = 400)
    - `GET /api/organization-relationships?organization_id=…&direction=from|to|both`
    - `GET /api/organizations/{id}/relationships` (inlines counterpart org + direction)
    - `PATCH /api/organization-relationships/{id}` (status transitions, auto-set `ended_at`)
    - `DELETE /api/organization-relationships/{id}`
- `backend/services/migrate_organizations.py` — idempotent backfill (reuses legacy UUIDs). Already executed: 3,172 rows (1 manufacturer + 91 distributors + 3,080 retailers).
- `backend/services/migrations.py` — indexes on `organizations` and `organization_relationships`.

### Models (`backend/models.py`)
- `Organization`, `OrganizationCreate`, `OrganizationUpdate`
- `OrganizationRelationship`, `OrganizationRelationshipCreate`, `OrganizationRelationshipUpdate`
- New literals in `core.py`: `OrganizationType`, `OrganizationStatus`, `OrganizationRelationshipType`, `OrganizationRelationshipStatus`, `ORG_CHILDREN_ALLOWED`

### Frontend
- `views/OrganizationManagement.jsx` — premium Org Mgmt page with two synchronized views:
  - **List** — type/status/region/search filters, table with type chips, edit per row
  - **Hierarchy** — collapsible tree rendered from `me/network`
  - **Create/Edit** dialog driven by `me/permissions` (only types the user can create are offered; parent options auto-filtered by `ORG_CHILDREN_ALLOWED`)
- `components/Layout.jsx` — sidebar shows `/organizations` for super_admin / manufacturer / distributor / wholesaler; hidden for retailer + logistics_provider.
- `lib/api.js` — added `Api.organizations / organization / createOrganization / updateOrganization / orgHierarchy / orgChildren / myOrgNetwork / myOrgPermissions / orgRelationships / orgRelationshipsFor / createOrgRelationship / updateOrgRelationship / deleteOrgRelationship`.
- `App.js` — route `/organizations` wired.

### Testing (iteration_12)
- **Backend pytest**: 31/31 PASS across `tests/test_organizations.py` (10) + new `tests/test_organizations_extended.py` (21) covering all 4 hierarchy paths, cycle prevention, scope enforcement, OrganizationRelationship CRUD + 409 dedup + scope, and legacy supply-chain regression (`/inventory`, `/shipments`, `/procurement/purchase-orders`, `/procurement/quotes`).
- **Frontend smoke**: Org Mgmt renders with 3,180 orgs for super_admin; retailer scoped to a single org with no Create button; sidebar visibility matrix verified.
- **One bug found and fixed in-flight**: super_admin sidebar was missing the `/organizations` entry (early `return` short-circuited the universal rule); now added directly to the super_admin nav array.

### Data caveat
The 3,080 existing retailers are parented directly to distributors (not via a wholesaler tier). The strict `ORG_CHILDREN_ALLOWED` rule means a distributor user can no longer CREATE new retailers (only wholesalers). Existing retailers remain visible because hierarchy scoping walks descendants by `parent_organization_id` regardless of type-chain. This is the intended new behaviour and is documented in `routes/organizations.py` module docstring.

## Updates (2026-06-08 — Regional Supply-Chain Topology built)
The full 4-tier chain is now wired end-to-end:

```
Unilever (manufacturer)
   ├── 7 regional Warehouses (WHR-0002 .. WHR-0008)
   │     └── 91 Distributors  (DST-xxxx, reparented by region)
   │           └── 18 Wholesalers  (WHO-0004 .. WHO-0021, "{Region} Wholesale Hub A/B/C")
   │                 └── 3,080 Retailers  (RTL-xxxx, evenly split per region)
```

### What changed
- **Hierarchy rule expansion** (`backend/core.py`): `ORG_CHILDREN_ALLOWED["warehouse"] = ["distributor"]` (was empty). `manufacturer → distributor` is kept as a legal direct path for small tenants.
- **New idempotent migration**: `backend/services/migrate_regional_topology.py` creates 1 warehouse per Nigerian region, reparents the 91 distributors under their region's warehouse, creates 3 wholesalers per region (Hub A/B/C) under representative distributors, and round-robin reparents retailers to wholesalers within the same region.
- **Boot integration**: the migration auto-runs as part of `server._background_bootstrap()` right after `migrate_organizations()`. Re-running is a no-op.
- **Counter sync**: `_next_code` in the migration now uses the same `db.counters` collection that the REST `POST /api/organizations` endpoint uses, so admin-driven creates can't collide with seed codes.
- **Performance fix**: `_descendants` in `routes/organizations.py` was capping each BFS level at `to_list(2000)` — bumped to `50000` so the hierarchy tree returns all 3,080 retailers (was silently truncated at 2,000).
- **Test fix**: `tests/test_organizations.py::test_hierarchy_tree` updated — direct manufacturer children are now warehouses (or distributors), not retailer-bearing distributors.

### Topology counts (verified)
| Tier | Count | Distribution |
|------|-------|--------------|
| Manufacturer | 1 | Unilever |
| Warehouse | 7 regional + 1 test | Lagos, South West, South East, South South, North Central, North East, North West |
| Distributor | 91 (+1 test) | reparented under regional warehouse |
| Wholesaler | 18 regional (+3 test) | 3 hubs × 6 regions (South West has 0 distributors so 0 hubs) |
| Retailer | 3,080 (+1 test) | round-robin across regional Hubs A/B/C: Lagos 185 each · NE 222 each · SE 187 each · NC 180 each · NW 143 each · SS 110 each |

### Test results
- Backend pytest: **76/76 PASS** (31 organization + 12 procurement + 13 retailer inventory + 20 distributor-os).
- API sanity: `/api/organizations/me/network` correctly returns the 4-tier subtree for every role (super_admin sees `__root__`; distributor sees its own → wholesalers → retailers).

### Notes / caveats
- The single "Unassigned" distributor and retailer (seed test rows without a region) are left in place — the migration skipped them and logged a warning. They remain accessible to super_admin via the flat list view.
- South West region has 0 distributors in the seed → its warehouse exists as a placeholder (ready for onboarding) but no wholesalers were spawned there.



## Updates (2026-06-08 — Ownership Model Migration Phase 1+2)
Foundation refactor — purely additive `organization_id` rollout across every ownership-bearing collection.

### Backfilled
**48,808 documents** across 12 collections got an `organization_id` field mirroring their legacy FK. Idempotent script (`services/migrate_ownership.py`) auto-runs at boot. `warehouse_id` placeholder (NULL) added to all 47,580 inventory rows for future Warehouse Management.

| Collection | Source FK | Rows backfilled |
|---|---|---:|
| products            | manufacturer_id  | 15 |
| inventory           | owner_id         | 47,580 |
| batches             | manufacturer_id  | 45 |
| promotions          | manufacturer_id  | 1 |
| purchase_orders     | retailer_id      | 235 |
| procurement_carts   | retailer_id      | 1 |
| supplier_quotes     | retailer_id      | 72 |
| distributor_orders  | distributor_id   | 61 |
| requests            | retailer_id      | 72 |
| sales               | retailer_id      | 37 |
| daily_sales         | retailer_id      | 613 |
| shipments           | from_id          | 76 |

### Indexes
13 new ascending `by_organization` indexes (plus a sparse `by_warehouse` on inventory). `ensure_indexes` boot output: `{'indexes_ensured': 70, 'indexes_failed': 0}`.

### Code
- `models.py` — added optional `organization_id` (and `warehouse_id` on InventoryItem) to Product, InventoryItem, Shipment, StockRequest, Cart, PurchaseOrder, SupplierQuote. Non-breaking defaults.
- `services/migrate_ownership.py` (new) — idempotent backfill with per-collection counts.
- `services/ownership.py` (new) — `org_or_legacy(field, oid)` helper for future read paths that want forward-compat (`$or` on either field).
- `services/migrations.py` — 13 new indexes registered.
- `server.py` — bootstrap chain extended to auto-run ownership migration after regional topology.

### Constraints honoured
**No write-path / workflow / UI / business-logic / legacy-field-removal changes.** Auth, RBAC, procurement, order approval, inventory math, analytics — all untouched.

### Regression
- `test_organizations` (10) + `test_organizations_extended` (21) + `test_procurement` (12) + `test_retailer_inventory` (13) + `test_distributor_os` (20) → **76/76 PASS**.
- `test_product_intelligence` + one `test_shipment_command` failure pre-date this iteration (confirmed via `git stash`-and-rerun on the prior commit). They are snapshot-cache / test-ordering issues unrelated to `organization_id`.

### Deferred (next phases)
- Drivers, Vehicles — collections don't exist yet (will be born with `organization_id` only, no legacy FK)
- Warehouse-level inventory split — waits for the WMS module with verified stock positions
- Phase 3 (write-path) and Phase 4 (legacy field removal) — pending until downstream consumers move to the unified field

Full deliverable: `/app/memory/OWNERSHIP_MIGRATION_REPORT.md`

## Updates (2026-06-08 — Multi-Tenant Validation + Critical Isolation Bug Fix)

Second manufacturer **Flour Mills Nigeria** seeded as a fully isolated tenant to prove the universal organization architecture is genuinely multi-tenant. Built a 9-node subtree (1 mfg → 1 warehouse → 1 distributor → 1 wholesaler → 5 retailers) with unique org codes (`MFR-0002`, `WHR-0013`, `DST-0097`, `WHO-0030`, `RTL-3086..3090`) and 5 test users at every tier.

### 🔴 Critical bug found & fixed
`migrate_regional_topology` was **not tenant-aware** — it queried distributors/retailers globally and reparented them by region into Unilever's warehouses & hubs. The bug was immediately surfaced by the validation exercise (initial run: 6/22 PASS). After fixing:
- `run()` now accepts a `manufacturer_id` and pre-computes its tenant subtree
- Distributor/retailer queries gated by `{id: {$in: tenant_ids}}`
- `seed_flour_mills_tenant._upsert_org` is now self-healing for drifted parent links

### Validation results (post-fix): **22/22 PASSED**
- super_admin sees both tenants (3223 + 9 orgs, disjoint)
- Every Flour Mills user sees only Flour Mills orgs (no Unilever leak)
- Every Unilever user sees no Flour Mills orgs (no Flour leak)
- Retailer users see only their own org (singular subtree)
- Permission matrix verified across all 5 tiers (manufacturer / warehouse / distributor / wholesaler / retailer)
- Cross-tenant direct GET by id returns 403 in both directions
- Hierarchy traversal returns exactly the expected 9-node Flour Mills tree

### Regression: 76/76 prior pytest tests still PASS.

### Files
- New: `services/seed_flour_mills_tenant.py` (idempotent + self-healing)
- New: `tests/test_multi_tenant_isolation.py` (CI-runnable validation harness)
- Modified: `services/migrate_regional_topology.py` (tenant-scoped)
- Report: `/app/memory/MULTI_TENANT_VALIDATION_REPORT.md`
- Credentials: `/app/memory/test_credentials.md` (Tenant 2 section added)

### Test credentials (Tenant 2 — password `FlourMills2026!`)
| Role | Email |
|---|---|
| manufacturer | `flour.admin@tradekonekt.io` |
| warehouse | `flour.warehouse@tradekonekt.io` |
| distributor | `prime.distributor@tradekonekt.io` |
| wholesaler | `lagos.wholesaler@tradekonekt.io` |
| retailer | `flour.retailer1@tradekonekt.io` |


## Updates (2026-06-08 — Flour Mills `Oil and Fat` catalogue + tenant-isolation hardening)

### Catalogue seeded
6 Golden Penny products under category **Oil and Fat**, owned by Flour Mills Nigeria (MFR-0002):

| SKU | Product | Pack | Unit Price | Barcode |
|---|---|---|---:|---|
| GP-SOYA-5L     | Golden Penny Soya Oil       | 5L bottle   | ₦12,500 | 6151001230011 |
| GP-VEG-5L      | Golden Penny Vegetable Oil  | 5L bottle   | ₦11,800 | 6151001230028 |
| GP-SPRD-250G   | Golden Penny Spread         | 250g tub    | ₦2,200  | 6151001230035 |
| GP-MARG-250G   | Golden Penny Margarine      | 250g tub    | ₦1,800  | 6151001230042 |
| GP-CHOC-500G   | Golden Penny Choc Oh        | 500g jar    | ₦3,500  | 6151001230059 |
| GP-IFAT-25KG   | Industrial Fat Products     | 25kg drum   | ₦42,000 | 6151001230066 |

12 batches (2 per product — one fresh, one mid-life; unit_cost = 70% of retail; 1-year shelf life).

### Inventory positions (48 rows)
| Tier | Rows | Total Units | Per-Product Target |
|---|---:|---:|---:|
| Warehouse (WHR-0013) | 6 | 30,105 | ~5,000 |
| Distributor (DST-0097) | 6 | 23,871 | ~4,000 |
| Wholesaler (WHO-0030) | 6 | 8,297 | ~1,400 |
| Retailers (RTL-3086..3090, 5 retailers) | 30 | 4,480 | ~150 |

Retail prices set at 15% markup over manufacturer unit_price. Warehouse rows include `warehouse_id` (the WHR-0013 id) — first use of the new field reserved for the future Warehouse Management module.

### 🔴 Critical isolation bug discovered & fixed
`GET /api/products` was completely unscoped (no auth dep, no tenant filter). Flour Mills admin could see all 15 Unilever products — direct multi-tenant breach. Fixed in `routes/entities.py::list_products`:
- Now accepts an optional auth via `_maybe_user(request)` helper (best-effort, no hard failure for legacy unauthenticated callers).
- If user is authenticated and not super_admin, defaults the filter to `{manufacturer_id: tenant_id}` resolved from the calling user.
- Explicit `?manufacturer_id=` parameter still works for legacy callers and the super_admin admin console.

### Tenant resolver upgraded
`services/auth.py::resolve_user_tenant` previously returned `""` for `warehouse`, `wholesaler`, `logistics_provider` roles (collections didn't exist when it was written). Added `_walk_to_manufacturer(org_id)` helper that walks `organizations.parent_organization_id` upward to find the manufacturer ancestor — works uniformly for every tier. Distributor + retailer resolution also fall back to this walk when their legacy collection rows are missing.

### Post-fix isolation matrix (verified via curl)
| User | products visible | Unilever SKUs | Flour Mills SKUs |
|---|---:|---:|---:|
| super_admin | 21 | 15 | 6 |
| Unilever Mfg | 15 | 15 | 0 |
| Unilever Distributor | 15 | 15 | 0 |
| Flour Mills Mfg | 6 | 0 | 6 |
| Flour Mills Warehouse | 6 | 0 | 6 |
| Flour Mills Wholesaler | 6 | 0 | 6 |
| Flour Mills Retailer | 6 | 0 | 6 |

### Regression
- pytest: **76/76 PASS** (no change)
- Multi-tenant validation: **22/22 PASS** (no change)

### Files
- New: `services/seed_flour_mills_products.py` (idempotent seeder)
- Modified: `routes/entities.py` (tenant-scoped products), `services/auth.py` (universal tenant resolver)


---

## 2026-02-09 — Manufacturer Warehouse Detail redesign

User requested an enterprise SaaS-style redesign of the per-warehouse drill-down at `/manufacturer/warehouses/:id`, inspired by Microsoft Dynamics 365, SAP Fiori, and Oracle Cloud SCM.

### What shipped
- Page title slot now reads **"Warehouse Management"** (breadcrumb) above the bold warehouse name.
- Status / location / code / **Owned** chips on the header line.
- **Actions** dropdown (Edit Warehouse / Open WMS Workspace / All Warehouses) + primary **Create Transfer** button.
- **Six** summary cards: Total Inventory, Inventory Value, Inbound Shipments Today, Outbound Shipments Today, Pending Transfers, Open Tasks — capacity utilization metrics intentionally removed per spec.
- Tabs reduced to short labels (Overview, Inventory, Users, Inbound, Outbound, Transfers, Analytics, Settings) on a card-style tab bar.
- **Overview tab** rebuilt with 4 sections:
  1. Warehouse Information (Name, Code, Location, Manager, Phone, Email, Status, Coordinates) with inline Edit.
  2. Recent Activity timeline (received / dispatched / transfer / alert / user — synthesized from real GRNs, dispatches, alerts).
  3. Operational Snapshot (Active Products, Open Inbound, Open Outbound, Pending Transfers, Inventory Alerts).
  4. Quick Actions grid: Receive Shipment, Create Dispatch, Create Transfer, Add User, View Inventory, Generate Report.
- Inventory / Inbound / Outbound tabs polished (status pills, low-stock highlighting).
- Transfers, Users, Analytics, Settings tabs now ship real (not placeholder) UI: synthesized transfer view, manager-as-user row + Add User CTA, top-SKUs-by-value chart, settings panel.

### Files
- Modified: `frontend/src/views/ManufacturerWarehouses.jsx` — full rewrite of `ManufacturerWarehouseDetail` and supporting sub-components (List page + create/edit dialog untouched).

---

## 2026-02-09 (b) — Warehouse Operations Center transformation

User feedback: the previous redesign was structurally correct but business-incorrect — every tab showed warehouse *master-data* rather than warehouse *operations*. Reworked each tab body to drive real workflows.

### What shipped
- **Overview**
  - Replaced "Warehouse Information" with **Warehouse Summary** (Manager, Status, Products Stored, Inventory Value, Units On Hand, Pending Transfers, Inbound Today, Outbound Today) — no setup fields.
  - Activity timeline now consumes real alerts (`/wms/alerts`), GRNs, and dispatches with timestamps.
  - New **Operational Watchlist**: Low Stock Items / Pending Approvals / Transfer Delays / Shipment Exceptions, each with count + CTA.
- **Inventory** — full 8-column operational table (Product / SKU / Available / Reserved / Damaged / Reorder / Last Movement / Actions). Reserved & Damaged synthesized like backend roll-up. Search + All/Low Stock/Healthy filter, Export & Bulk Adjust toolbar, per-row Adjust / Transfer / History actions, low-stock highlighting.
- **Inbound** — GRN #, Supplier, Expected Date, Received Date, Lines, Status (expected/receiving/received/closed), per-row actions. Filterable toolbar with New GRN CTA.
- **Outbound** — Dispatch #, Destination, Created By, Lines, Status, Date, with track/more actions. New Dispatch CTA.
- **Transfers** — Transfer #, Source, Destination, Products, Status, Created By, Date. Header strip visualizes full lifecycle: Draft → Approved → Picking → Loaded → In Transit → Received → Completed. New Transfer CTA.
- **Users** — Role buckets (Warehouse Manager, Receiving Officers, Dispatch Officers, Inventory Controllers) with member tables and per-row Change Role / Reset Password / Deactivate.
- **Analytics** — Recharts trend cards: Inventory Value Trend, Inbound Trend, Outbound Trend, Transfer Trend, Inventory Accuracy (99.2% target ≥ 98%), Returns Trend. Zero capacity utilization metrics.
- **Settings** — Warehouse Details + 4 rule cards (Notification Rules, Approval Rules, Transfer Rules, User Access Rules) with real operational rules.

### Backend fix
- Hardened the alerts loader to unwrap `{alerts, total}` envelope returned by `/api/wms/alerts` (was crashing `OverviewTab`).

### Files
- Modified: `frontend/src/views/ManufacturerWarehouses.jsx` — full tab-body rewrite, Recharts integration, new helper components (WatchTile, RuleCard, LifecyclePill, ListToolbar, ChartCard, RoleBadge, SumStat, RowAction, relativeTime/fmtDate utils).

---

## 2026-02-09 (c) — Warehouse Operations Demo Data Seeding

Created `services/seed_warehouse_operations.py` — a single idempotent seed that populates linked operational history across the Manufacturer Warehouse Module and the standalone WMS (both surfaces read the same underlying records).

### Generated per re-run (tagged `seed_tag = warehouse_ops_v1`)
- **Inventory**: 51 enriched rows with Available / Reserved / Damaged / Reorder / last_movement_at across 4 warehouses (Unilever Lagos, Unilever Kano, Unilever Abuja, Flour Mills Lagos).
- **Inbound GRNs**: 50 — distribution 15 received / 10 receiving / 15 expected / 5 delayed / 5 awaiting_review. Numbered GRN-2026-001…050.
- **Outbound dispatches**: 75 — 35 completed / 15 picking / 10 loaded / 10 awaiting_dispatch / 5 delayed. Numbered DSP-2026-001…075.
- **Warehouse transfers**: 30 inter-warehouse (same-tenant) moves across full lifecycle (draft → approved → picking → loaded → in_transit → received → completed). Numbered TRF-2026-xxx.
- **Warehouse users**: 36 across roles (Manager / Receiving / Dispatch / Inventory Controller / Store Keeper) with realistic Nigerian names + tenant-domain emails.
- **Tasks**: 50 across completed / in_progress / pending / escalated.
- **Notifications/Alerts**: 35 persisted notifications surfaced through `/wms/alerts`.
- **Returns**: 30 records with 5 reasons × 6 statuses.
- **Cycle counts**: 24 records (some clean, some with variance).
- Inventory effects: received GRNs increment stock; completed dispatches & transfers decrement source and credit destination. Final pass floors any negative rows to a low-stock positive band.

### Backend changes
- New `routes/wms.py` endpoints (all tenant-scoped via `_scope_warehouse`):
  - `GET /api/wms/users`
  - `GET /api/wms/returns`
  - `GET /api/wms/cycle-counts`
  - `GET /api/wms/transfers` (returns shipments where is_transfer or to_role=warehouse, in either direction)

### Frontend changes
- API client extended (`wmsListWarehouseUsers`, `wmsListReturns`, `wmsListCycleCounts`, `wmsListTransfers`).
- `ManufacturerWarehouseDetail` now loads warehouse users + canonical transfers list.
- `InventoryTab` reads `reserved`, `damaged`, `last_movement_at` directly from the inventory row (synthesis kept as fallback).
- `UsersTab` reads real warehouse_users grouped by role with last-active timestamps.
- `TransfersTab` now shows Direction (Incoming/Outgoing) + real source/destination names from the canonical transfer feed.
- `OutboundTab` displays the resolved destination name instead of just the role.
- Pending-transfers KPI now derived from the canonical transfers list.

### To re-seed
```
cd /app/backend && python -m services.seed_warehouse_operations
```

---

## 2026-02-09 (d) — Manufacturer-Controlled Order Allocation (Phase 1)

Implemented the new universal supply-chain workflow: distributors place demand on the **manufacturer**, manufacturers allocate inventory to warehouses, warehouses execute fulfillment. Distributors never order from warehouses; warehouses cannot modify allocated quantities.

### Decisions confirmed with user
- Legacy orders migrated to `status="completed"` on first seed run (clean slate).
- Auto-allocation priority: **region match → stock-on-hand → distance proxy**.
- Reservation timing: **reserve immediately on allocation**, release on rejection/cancellation.

### Backend
- `routes/allocation.py` — 9 endpoints:
  - `GET /api/allocation/summary` — bucket counts
  - `GET /api/allocation/pool?bucket=...` — orders in a bucket
  - `GET /api/allocation/orders/{id}` — order detail + full allocation/fulfillment/back-order audit trail
  - `GET /api/allocation/orders/{id}/recommendation` — per-product warehouse recommendation with region/stock/distance scoring
  - `POST /api/allocation/orders/{id}/auto-allocate`
  - `POST /api/allocation/orders/{id}/manual-allocate`
  - `POST /api/allocation/orders/{id}/back-order`
  - `POST /api/allocation/orders/{id}/reject`
  - `POST /api/allocation/orders/{id}/acknowledge`
  - `GET /api/allocation/back-orders`
- `routes/fulfillment.py` — Warehouse-side queue:
  - `GET /api/fulfillment/summary?warehouse_id=...`
  - `GET /api/fulfillment?warehouse_id=...&bucket=...`
  - `POST /api/fulfillment/{id}/advance` (pending_picking → picking → picked → loaded → dispatched → delivered → closed)
- Inventory side effects: allocation reserves; dispatch decrements reserved + quantity; delivery cascades back to parent order status.
- `services/seed_allocation.py` (idempotent, tag `allocation_v1`):
  - 44 legacy orders migrated to "completed"
  - Created orders across every bucket: 16 new, 12 awaiting_allocation, 10 allocated, 8 partially_allocated, 12 fulfillment_in_progress, 16 completed, 8 back-ordered, 6 rejected — across both Unilever and Flour Mills tenants
  - Materialised matching `order_allocations`, `fulfillment_orders`, `back_orders`; applied reservations/decrements based on FO stage.

### Frontend
- **New route**: `/manufacturer/allocation` with `AllocationCenter` page
  - 7 KPI bucket cards (New / Awaiting Allocation / Allocated / Fulfillment In Progress / Completed / Back Orders / Rejected)
  - Order list table with distributor, region, units, value, submitted time
  - Slide-over **Allocation Decision Drawer**:
    - Auto / Manual mode toggle
    - Per-product warehouse list with region match + available + score + "Recommended" badge
    - Manual mode lets the user enter per-warehouse quantities; live "Allocated / Requested" counter
    - Footer actions: Back Order, Reject (with reason), Auto-Allocate, Apply Allocation
- **Fulfillment tab** added to Manufacturer Warehouse Module (`/manufacturer/warehouses/:id`)
  - Banner explaining execution-center role
  - Bucket pill row with live counts per lifecycle stage
  - Table with Fulfillment #, Order Ref, Distributor, Units, Stage, Created, "Move to next stage" CTA
- **Nav**: "Order Allocation" link added to manufacturer sidebar
- API client extended with 13 new `allocation*` / `fulfillment*` methods.

### Data Model (new collections)
- `order_allocations` — per-decision audit row (mode, lines, decided_by, decided_at, notes)
- `fulfillment_orders` — what the warehouse executes (one per source warehouse per order)
- `back_orders` — outstanding demand awaiting future stock

### Phase 2 (next turn)
- Standalone WMS `/wms/fulfillment` page (same data, mirrored UI)
- Notifications for all 3 personas (currently best-effort push; need an in-app feed)
- Allocation KPIs: Fill Rate, Allocation Time, Back-Order Rate, Service Level, Warehouse Performance
- Audit trail viewer (timeline of allocation events per order)

---

## 2026-02-09 (e) — Distributor "Place Order" Workflow

The distributor side of the new order-allocation architecture: they now place purchase orders against the **manufacturer** directly from the Procurement page.

### What shipped (`DistributorProcurementInbox.jsx`)
- Page heading rewritten to **"Procurement Workspace"** with subtitle that reflects both outbound and inbound flows.
- Tabs reorganised into 4: **Place Order** (default), **My Purchase Orders**, Retailer Orders, Quote Requests.
- **Place Order tab**:
  - Manufacturer catalogue grid (filtered by `session.user.manufacturer_id`) with search, ± buttons + numeric input per row.
  - Sticky right-side cart with live line totals, units sum, order value, optional note, and a single "Submit Order to Manufacturer" CTA.
  - On submit, posts to existing `POST /api/distributor/{id}/orders` — the order lands in `distributor_orders` with `status="pending"`, which the Manufacturer's Allocation Center already surfaces in its "New Orders" bucket.
- **My Purchase Orders tab**:
  - Filter pill row covering every status (Submitted, Awaiting Allocation, Allocated, Partially Allocated, In Progress, Delivered, Back Ordered, Rejected) plus "Open" and "All".
  - Order cards with status badge + a 4-step progress tracker (Submitted → Allocated → In Progress → Delivered) with live violet fill per stage.
  - Rejected orders show the manufacturer's rejection reason inline.
  - Collapsible "View line items" table per order.
- API client extended with `distributorCreateOrder`, `distributorListMyOrders`, `distributorListManufacturers`.

### Verified end-to-end
- Logged in as `lagos.distributor@tradekonekt.io`, filled cart (500× Axe Body Spray + 300× Blue Band Margarine = ₦11.2M / 800 units), hit Submit → toast "Order F353DB7E submitted to manufacturer"; cart cleared.
- The order is now visible to `unilever@tradekonekt.io` in `/manufacturer/allocation` under "New Orders".

---

## 2026-02-10 — GCP Integration Phase 1 (BigQuery + Cloud Run packaging)

Wired the Real-Time Pulse foundation: TradeKonekt now streams sales events from the FastAPI backend into a BigQuery dataset hosted in europe-west2 and is packaged for Cloud Run deployment.

### What shipped
- **Secret storage**: SA key at `/app/backend/secrets/gcp-sa.json` (chmod 600, gitignored). `backend/.env` sets `GOOGLE_APPLICATION_CREDENTIALS`, `GCP_PROJECT_ID`, `BIGQUERY_DATASET=pulse`, `BIGQUERY_LOCATION=europe-west2`, `GENAI_MODEL_ID=gemini-2.5-flash`, `GOOGLE_GENAI_USE_VERTEXAI=true`.
- **BigQuery client** (`services/bigquery_client.py`): idempotent dataset+table bootstrap, ADC-aware (uses file in dev, attached SA on Cloud Run), helpers for streaming inserts and parameterised queries.
- **BigQuery schema** (`project-905e8cc5-7104-437c-825.pulse.sales_events`):
  - Columns: event_id · region · product_id · product_name · distributor_id · retailer_id · units_sold · value_naira (NUMERIC) · latitude · longitude · occurred_at · ingested_at · manufacturer_id
  - Partition: `occurred_at` (DAY) · Cluster: `region`, `product_id`
- **Pulse API** (`routes/pulse.py`):
  - `GET  /api/pulse/health` — bootstrap + show provisioned table info
  - `POST /api/pulse/event` — single event streaming insert
  - `POST /api/pulse/events:batch` — bulk (≤500) streaming insert
  - `GET  /api/pulse/by-region?hours=24` — regional aggregation for the Command Center map
  - `GET  /api/pulse/alerts` — proactive-restock candidates (24h velocity ≥ 1.5× 14d trailing avg)
- **Cloud Run**: `backend/Dockerfile` (multi-stage, gunicorn+uvicorn, secrets stripped at build), `backend/CLOUD_RUN_DEPLOY.md` with full gcloud commands for Artifact Registry, Secret Manager (mongo-url, db-name, jwt-secret), IAM bindings (bigquery.dataEditor, bigquery.jobUser, aiplatform.user, secretmanager.secretAccessor, run.invoker), deploy, and Cloud Scheduler hourly job.
- **Frontend**: `REACT_APP_MAPS_API_KEY` added to `frontend/.env` (referrer-restricted browser key for the upcoming Command Center map).

### Verified end-to-end
- `GET /api/pulse/health` provisioned the dataset + table in `europe-west2`.
- POSTed 6 sales events (1 single + 5 batch). `/api/pulse/by-region?hours=24` returned the proper regional rollup: Lagos ₦11.7M / 670 units, Abuja ₦336K, PH ₦102K, Kano ₦42.5K.

### Phase 2 (next turn)
- Manufacturer Command Center UI: Google Maps embed with markers + clustering driven by `/api/pulse/by-region`.
- Vertex AI Gemini call wired to `/api/pulse/alerts` to generate human-readable explanations per alert.
- Actually deploy to Cloud Run (requires the user to run the gcloud commands in `CLOUD_RUN_DEPLOY.md`; the agent's environment doesn't have gcloud auth).
- BigQuery alerts persisted in MongoDB so they survive across queries.

### Security reminder
The SA key was pasted into chat history. **Please rotate it again** in the GCP console and replace `/app/backend/secrets/gcp-sa.json`.

---

## 2026-02-10 — Manufacturer Command Center (Pulse Phase 2) shipped

The Real-Time Pulse Phase 2 UI is live for manufacturer users:

- **Route**: `/manufacturer/command-center` (wired in `App.js`)
- **Sidebar nav**: new "Command Center" entry (Globe2 icon) — manufacturer role only — sits above Product Intelligence
- **Page** (`views/CommandCenter.jsx`):
   - Hero with "REAL-TIME PULSE · POWERED BY GCP" eyebrow and Refresh button
   - 4 KPI cards driven by `/api/pulse/by-region?hours=24` — 24h Revenue / Units / Events / Restock-Alert count
   - **Google Maps JS embed** (loaded via `REACT_APP_MAPS_API_KEY`, dev key for now) centred on Nigeria, one circle per region sized by 24h revenue with click-to-info on Region · Revenue · Units · Events
   - **Vertex AI Proactive Restock Alerts** panel — fed by `/api/pulse/alerts/enriched`, shows product · region · velocity-ratio × · 24h units vs 14-day baseline · Gemini-generated one-sentence explanation per row
   - Footer: BigQuery · pulse.sales_events · europe-west2
- **End-to-end verified**: Lagos ₦984M / 66,434 units / 157 events; Abuja ₦114M; Kano ₦95M; +1 more region. Two Gemini-explained alerts: Knorr Bouillon Cubes (Abuja, 5.74×) and Axe Body Spray (Lagos, 3.55×). Smoke screenshot confirms map markers + alerts panel + KPI strip all populated.

Stack used:
- BigQuery `pulse.sales_events` (seeded 14 days of synthetic events earlier)
- Vertex AI `gemini-2.5-flash` via native `google-genai` + ADC
- Google Maps JS API (client-side, key in `frontend/.env`)


## 2026-02-10 (b) — Command Center now a Dashboard tab

User feedback: keep the Command Center accessible from the main Dashboard instead of a separate sidebar entry.

- **Dashboard tab switcher** added at the top of `ManufacturerDashboard.jsx`:
  - "Executive Overview" (default) — the existing AI Exec Summary / KPI Strip / Revenue Trend / Regional / Products / Distributors / Pipeline / Alerts cascade
  - "Command Center" with PULSE badge — embeds the `<CommandCenter />` component (Google Maps + KPIs + Vertex AI alerts) inline within the same `/dashboard` route
- Sidebar Command Center entry removed (it's a tab now); standalone `/manufacturer/command-center` route kept for direct linking.
- Smoke-tested end-to-end: tab switch toggles between hero + tab content; map + alerts render in the Pulse tab; data-testids `dashboard-tabs`, `dashboard-tab-overview`, `dashboard-tab-pulse` available for automation.


## 2026-02-10 (c) — Proactive Intelligence Center fully Vertex-AI driven

The Command Center's "alerts" panel was upgraded from a shallow velocity-ratio list with a one-sentence Gemini caption into a true **Proactive Intelligence Center**.

### Backend
- **`services/pulse_intelligence.py`** — multi-signal evidence pack from BigQuery: 24h vs 7d vs 14d velocity, day-over-day delta, z-score significance, distributor concentration, regional spread, top-driver distributors. Top 5 signals (by |LN(velocity)|) feed Vertex AI.
- **Vertex AI structured output** — uses `complete_json(response_schema=…)` with a strict JSON schema. Gemini 2.5 Flash returns, per signal: severity (CRITICAL/HIGH/MEDIUM/INFO), signal_type (DEMAND_SPIKE/SLUMP/STABLE_GROWTH/VOLATILE), headline, evidence-anchored narrative, 2-3 ranked root-cause hypotheses each with `confidence` + `evidence`, 24h trajectory forecast (units + revenue + confidence), 2-4 owner-assigned recommended actions, and snake_case risk_flags. PLUS a network-level `executive_summary` (headline + narrative + themes + top_action) in the same call.
- **Resilience** — 90s in-memory cache → 5 min cache (Vertex quota tight on newly-billed project), 3-attempt exponential backoff on 429, AND a deterministic evidence-only fallback so the UI always has actionable content if Vertex is rate-limited.
- **New endpoint**: `GET /api/pulse/intelligence` → `{briefings, executive_summary, signal_count, vertex_ai_used, ai_status, generated_at}`.

### Frontend (`CommandCenter.jsx`)
- **Executive Briefing card** at the top (violet/indigo gradient with a TOP PRIORITY ACTION band)
- **Per-signal `BriefingCard`** with severity pill, signal type tag, evidence grid (24h units, 14d avg, day-on-day %, z-score), risk-flag chips, and an "Show AI analysis" expand revealing: ranked hypotheses with confidence bars + evidence sentences, 24h forecast card, priority-ordered Recommended Actions with owner badges, and top-driver distributors.
- Live AI status pill (`VERTEX AI` violet vs `EVIDENCE MODE` amber when running in fallback).

Smoke-tested end-to-end: Gemini returned 5 fully-populated briefings + executive briefing for Unilever (`ai_status: vertex_ai`). Sample briefing: Knorr Bouillon Cubes · Port Harcourt · CRITICAL DEMAND_SLUMP 0.1× — narrative cites exact numbers (252 units / ₦214,200 / 93.69% drop / velocity 0.0742), hypotheses ranked 90/70/60% each with evidence anchored to the data, 4 risk flags, 24h forecast, owner-assigned actions.


## 2026-02-10 (d) — Sabi: Vertex-AI-only + strict tenant isolation

Dead Claude Sonnet 4.5 routing path removed and Sabi (the in-store retailer AI assistant) hardened against cross-tenant access at three layers.

### Backend (`routes/assistant.py`)
- Dropped `COMPLEX_PROVIDER`/`COMPLEX_MODEL`/`_route_model()`. Sabi now uses only `vertex_llm.DEFAULT_MODEL` (gemini-2.5-flash).
- New `_assert_can_access_retailer()` tenant guard applied to all three Sabi endpoints (`/assistant`, `/assistant/transcribe`, `/assistant/execute`). Allowed callers: the retailer themselves (`role=retailer` AND `entity_id == retailer_id`) or `super_admin`. Everything else → **403 "Sabi is scoped to your own store only."**.
- Anonymous requests → 401 (`get_current_user` dependency).
- Vertex quota 429s mapped to a graceful 503 "Sabi is briefly busy (AI rate limit reached). Please try again in a minute." instead of leaking the raw GenAI error.

### System prompt hardened (`services/retailer.py`)
- Prompt template now interpolates `retailer_id` in addition to `retailer_name`.
- Added explicit non-negotiable tenant-isolation rules:
  1. Strictly scoped to `retailer_id=…`. Every fact must come from the data block. No hallucination.
  2. Any question about other retailers / network-wide totals → respond with a fixed denial message.
  3. Never expose the retailer_id or any internal identifiers in the reply text.
  4. If the answer is not in the data block → say so plainly, ask one clarifying question.

### Frontend (`RetailerAssistantBubble.tsx`)
- Header comment updated to "Vertex AI (Gemini 2.5 Flash) only — text + voice via Gemini multimodal STT".
- All 3 axios calls (`/assistant`, `/assistant/execute`, `/assistant/transcribe`) now attach the Bearer token from `getAccessToken()` so they pass the new auth requirement.

### Tests verified (curl, live preview)
| Test | Caller | Target | Expected | Got |
|------|--------|--------|----------|-----|
| A | retailer1 | own Sabi | 200 | **200** — Gemini answered with retailer1's actual inventory only |
| B | retailer2 | retailer1's Sabi | 403 | **403** ✅ |
| C | distributor | retailer1's Sabi | 403 | **403** ✅ |
| D | anonymous | retailer1's Sabi | 401 | **401** ✅ |
| 429 path | retailer1 | own Sabi | 503 graceful | **503** ✅ |


## 2026-02-10 (e) — Manufacturer Intelligence: platform-grounded + scheduled

The Proactive Intelligence Center was rebuilt to be **grounded in real platform data** and **batch-scheduled** (hourly + on-demand recompute) instead of running Vertex AI per request.

### Backend
- **`services/pulse_intelligence.gather_platform_signals(mfr_id)`** — pulls a rich evidence pack from MongoDB:
  - Network size (distributors, retailers)
  - 24h / 7d order counts + ₦ revenue from `db.orders`
  - Stock requests from `db.requests`
  - Allocation backlog & fulfilment activity from `db.order_allocations` and `db.fulfillment_orders`
  - Stockout risk by region & top products at risk from `db.intel_forecasts`
  - Retailer churn risk from `db.intel_retailer_health`
  - Delivery risk from `db.intel_delivery_eta`
  - Recent anomaly alerts from `db.intel_alerts`
  - Top distributors by 24h revenue
  - (Optionally) BigQuery sales-velocity signals as a secondary feed
- **`compute_intelligence(mfr_id)`** — runs Gemini with a strict JSON schema (`PLATFORM_BRIEFING_SCHEMA`) producing per-(network/region/distributor/product) briefings + executive summary, both anchored to the evidence numbers. Persisted to **`db.pulse_intelligence`** keyed by manufacturer_id.
- **Evidence-only fallback** still produces structured briefings when Vertex is rate-limited.
- **Scheduler**: added `job_pulse_intelligence` to `services/intel/scheduler.py` — runs every 60 min (first run T+7 min so it doesn't collide with the existing hourly bundle).

### Endpoints
- `GET /api/pulse/intelligence` → now reads the latest persisted snapshot from Mongo. Never invokes Vertex AI directly. O(1) reads.
- `POST /api/pulse/intelligence/recompute` → manufacturer-only, forces an immediate recompute. Returns the fresh payload.

### Frontend (`CommandCenter.jsx`)
- "Last computed Xm ago · next auto-refresh in 47 minutes" stamp under the heading.
- New **"Recompute intelligence"** violet CTA button alongside Refresh.
- `BriefingCard` schema-updated to handle the new `scope` / `scope_label` shape (NETWORK / REGION / DISTRIBUTOR / PRODUCT) and gracefully suppress the BQ-only "velocity ×" badge & trajectory block when not relevant.

### Verified on live preview (Unilever)
- `ai_status: vertex_ai`, 6 briefings + 1 exec summary
- All numbers cited match Mongo: 500 retailers at risk (from `intel_forecasts`), 3,072 retailers at high churn risk (from `intel_retailer_health`), 5 fulfillment orders pending (from `fulfillment_orders`), zero 24h orders (from `orders`).
- Hypotheses cite specific evidence fields from the pack ("orders_count_24h: 0, fulfillment_pending: 5, allocations_pending: 0").

