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
