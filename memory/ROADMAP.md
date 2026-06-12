# TradeKonekt — Roadmap & Backlog

_Last updated: 2026-06-12 (late) — **Logistics Control Tower Phases 1 + 2 SHIPPED**: event-driven cockpit + Route Planning Center (multi-stop Google-optimized Route Builder, ad-hoc deliveries, Delivery Execution Timeline). iterations 21+22: 38 backend tests + 100% frontend._

## ✅ Done
- **Logistics Control Tower · Phase 2 (2026-06-12)** — `route_planning.py` API (board/preview/dispatch/detail), `get_multi_stop_route` (Routes API optimizeWaypointOrder), sim stop-by-stop execution (`_deliver_stop`/`_complete_route`, threshold-based), Route Planning tab UI (dispatch board, builder w/ itinerary + canvas map, ad-hoc dialog, active routes table, execution sheet). Regression: `backend/tests/test_route_planning.py` (25 tests).
- **Logistics Control Tower · Phase 1 (2026-06-12)** — Routes API v2 upgrade in `routing.py`; full dark-cockpit frontend (KPI strip, live map w/ layer toggles, Event Stream w/ ack, Tier Flow, Digital Twin, Live Shipments, VehicleTwinSheet w/ audit trail); Planning & Ops preserved as 2nd tab. Regression: `backend/tests/test_control_tower.py`.
- **Wholesaler · Phase 1** — Dashboard, Inventory, Procurement, Distributor Network.
- **Wholesaler · Phase 2** — Distributor Orders + Fulfillment workflow + Shipment Management + Place Order on Behalf modal.
- **Wholesaler · Phase 3A** — 8-item sidebar restructure + Distributor Analytics Center (KPIs · Status mix · Ranking · BCG matrix · Churn risk · 6-month trend).
- **Wholesaler · Phase 3B** — Inventory Analytics Center (Days of Supply red/yellow/green · Dead Stock 30/60/90 · Aging 0-30/31-60/61-90/90+ · Expiry Risk · Turnover by category & warehouse).
- **Wholesaler · Phase 3C** — Demand Forecast (7/30/90d product · regional · distributor) + Replenishment Recommendation Engine + Safety Stock Monitoring.
- **Wholesaler · Phase 3D** — Intelligence Center page (`/wholesaler/intelligence`) — rule-based Executive Briefing, Opportunities, Risks (severity-tagged), Recommended Actions (priority-tagged). NO AI.
- **Wholesaler · Phase 3E** — Control Tower View — Network Health Score 0-100 + 3 heat maps + network nodes + **live Google Map** (wired to existing REACT_APP_MAPS_API_KEY, pulls real DB data via city centroid lookup; trucks animate based on elapsed/ETA; demand overlay toggles).
- **Manufacturer · Allocation KPIs** — Fill Rate, Allocation Time, Back-Order Rate, Service Level, Warehouse Performance leaderboard at `/manufacturer/allocation`.
- **Security: `/allocation/*` + `/wholesaler/{wid}/analytics` + `/wholesaler/{wid}/distributors/{did}/detail`** role-locked to owner/super_admin.
- **Activity Simulator (Super Admin)** — background loop generates retail sales, distributor orders + allocations, shipments, transfers, replenishments, intel events on a Low/Med/High cadence. Tagged participants across both Unilever + Flour Mills tenants; tenant isolation enforced via parent-chain walk; one-click purge of every SYSTEM_SIMULATOR doc; idempotent demo-seeder.
- **Simulator → dashboard wiring (2026-06-12)** — retail sales now also write `sales` (POS book) + `daily_sales` (analytics rollup) and recompute 7-day `inventory.velocity`; 50% spotlight bias toward demo-login retailers so "Today's Sales" is always alive.
- **FMN 500-entity national network (2026-06-12)** — one-shot bulk seeder (`seed_flour_mills_network.py`, seed_meta-gated) + 14-day sales history; 877 simulation participants total.
- **Production deploy fixes (2026-06-12)** — stale `uniq_tenant` index auto-drop in `ensure_indexes()`; DuplicateKeyError-safe exec-summary upsert; 404 guards on the three manufacturer snapshot routes; deployment_agent scan PASS.

## 🟡 P1
- **Logistics Control Tower · Phase 3** — Delay prediction engine (Vertex AI), AI-Powered Logistics Copilot, Demand-to-Delivery correlation.
- In-app notifications feed (distributor / manufacturer / warehouse / wholesaler) for allocation, transfer, replenishment, order events. (Simulator already emits the source events into `notifications` — the UI feed is what's left.)
- **Refactor `wholesaler_analytics.py` (1938 lines)** into per-concern modules: `wholesaler_distributor_analytics.py`, `wholesaler_inventory_analytics.py`, `wholesaler_forecast.py`, `wholesaler_intelligence.py`, `wholesaler_control_tower.py`.
- Refactor `WholesalerAnalytics.jsx` (~1480 lines) — extract each tab into its own file.
- Refactor `routes/wholesaler_orders.py` (1264 lines) and `routes/allocation.py` (812 lines) per the 700-line guideline.
- Distributor reorder shortcut ("Reorder this PO" button) on `/procurement` cards.
- Push allocation_kpis + forecast math into Mongo aggregation pipelines (currently O(n) in Python on up to 5k orders).
- **Simulator polish** (testing agent comments): use `$inc` for `total_ticks`/`total_events` to remove read-then-write race; expose a public `tick()` on `SimulatorRuntime` instead of touching `_tick`; parallelise the 9 `count_documents` in `simulator_status` with `asyncio.gather`.

## 🟢 P2
- Promotions Workspace (drafts exist; needs a management UI).
- Forecast / seed-data sparsity fix — broaden `daily_sales` seed so warehouse on-time % differentiates, and so the BCG matrix has more spread.
- Interactive Google Map on Control Tower (currently uses card-based network graph for simplicity).
- Standalone WMS `/wms/fulfillment` page mirroring the warehouse tab.
- Coalesce `_decrement_stock_on_dispatch` / `_settle_in_transit_on_delivery` / `_adjust_reservation` into single `$inc` updates per product for atomicity.
- Swap native HTML date input in Place-Order modal for shadcn Calendar/Popover.

## 🔵 P3
- Tenant Onboarding Wizard for new manufacturers (self-serve super-admin UI).
- Logistics integrations — driver mobile flows, proof of delivery, live GPS feeds.
- Payments & Credit — invoices, credit limits, settlements, aging reports.
- CSV export on each new Phase 3 tab (Distributor Analytics, Inventory Analytics, Forecast).
