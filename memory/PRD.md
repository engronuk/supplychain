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
- **Manufacturer (Unilever / Flour Mills)** — flagship workspace (10 modules); sees the entire downstream chain.
- **Warehouse** — standalone `/wms` workspace (GRNs, dispatch, transfers, cycle counts, returns).
- **Wholesaler** — Phase-1 workspace shipped 2026-06-11: Dashboard, Inventory (Available / Reserved / Damaged / In-Transit + Receive / Adjust / Cycle-count), Procurement (PO lifecycle Draft → Submitted → Approved → Allocated → Shipped → Delivered with inventory credit on delivery), Distributor Network (soft-linked by region).
- **Distributor** — ops intelligence, retailer network drill-down, procurement (place order on mfr, my POs, retailer orders, quotes, shipments).
- **Retailer** — POS Sales Book, Inventory Command Center, Procurement (AI reorder, cart → PO split, RFQ quotes), Sabi AI assistant.

## Core requirements
- Strict multi-tenant isolation across the 5 personas.
- Generic Shipment with from_role/from_id/to_role/to_id supports every flow.
- Server-enforced status transitions (shipments, distributor orders, wholesaler POs).
- Inventory automatically adjusted on dispatch, receipt, and PO delivery.
- Vertex AI Gemini 2.5 Flash drives recommendations; rule-based fallback for cheap views.
- **NO AI for Wholesaler analytics or Manufacturer allocation/order routing logic** — explicit user rule. Pure programmatic Python.
- **NO MOCK DATA** — every UI surface reads from MongoDB seed data.
- Per-role Analytics dashboard + CSV exports.
- Role-based access enforcement on every cross-tenant endpoint. `/allocation/*` is restricted to manufacturer / warehouse / super_admin only; downstream roles get 403.

## Logistics Command Center Vision (added 2026-06-12)
Transform the logistics view into a real-time, event-driven Control Tower with 5-tier
visibility (Manufacturer → Warehouse → Distributor → Wholesaler → Retailer).
- **Real Google routing** — vehicle paths/ETAs use the Google Routes API v2
  (`routing.py::_routes_api_v2`; legacy Directions API is key-restricted, estimate fallback retained).
- **Event-driven architecture** — every logistics action (dispatch, deviation, geofence
  enter/exit, breakdown, delay, delivery) writes an immutable event to `logistics_events`.
- **Simulated exceptions** — `control_tower_sim.tick()` (scheduler, 2 min) moves trucks along
  real roads and rolls deviation/stop/delay/breakdown dice so the tower always has work.
- **Phase 1 (✅ SHIPPED 2026-06-12)** — End-to-End Visibility KPIs, Live Map control tower
  (dark cockpit, layer toggles), Event Stream with ack, Inventory-in-Transit 5-tier flow,
  Digital Twin panel (warehouses/distributors/wholesalers), Live Shipments table, Vehicle
  digital-twin sheet with event audit trail. UI at `/manufacturer/logistics-center`
  (Control Tower tab default; Planning & Ops tab keeps the original workspace).
  Tested: iteration_21 — 13/13 backend pytest + 100% frontend, 0 console errors.
  Regression file: `/app/backend/tests/test_control_tower.py`.
- **Phase 2 (✅ SHIPPED 2026-06-12)** — Route Planning Center tab: dispatch board (pending
  shipments grouped by warehouse + idle fleet pool), multi-stop Route Builder with Google
  Routes API optimized sequencing (`get_multi_stop_route`, optimizeWaypointOrder), ad-hoc
  delivery creation (real shipments + stock movement), one-click dispatch (planned_routes +
  route vehicle + event bus), and the Delivery Execution Timeline (planned vs actual per
  stop, live audit trail). Sim executes routes stop-by-stop via thresholds.
  Tested: iteration_22 — 25/25 backend pytest + 100% frontend.
  Regression: `/app/backend/tests/test_route_planning.py`.
- **Phase 3 (✅ SHIPPED 2026-06-12)** — AI Intelligence tab: Delay Prediction Engine
  (Gemini reasons over live truck telemetry → probability / predicted delay / recommendation,
  10-min cache, heuristic fallback, high-risk → `delay_predicted` events), Konekt Copilot
  (multi-turn, server-side sessions, grounded in live control-tower context, cites TK-/RT-
  codes), Demand↔Delivery Correlation (region-level retail sell-through WoW vs delivery
  performance + stock cover, Gemini insights, 15-min cache).
  Tested: iteration_23 — 14/14 backend + 38/38 regression + 100% frontend.
  Regression: `/app/backend/tests/test_logistics_ai.py`.
- **Phase 3.5 (✅ SHIPPED 2026-06-12)** — In-app Notifications feed + Actionable Copilot:
  - **Notifications**: the logistics event bus now fans out to the bell-icon feed
    (`logistics_events.notify()` + `_fanout_notifications`). Manufacturer gets every
    warning/critical event + milestones (route planned/replanned/completed, deliveries);
    destination party (distributor/wholesaler/retailer/warehouse) gets inbound-shipment
    notifications phrased from their perspective; origin warehouse gets route-dispatch
    notices. 45-min dedupe window applies ONLY to recurring warning/critical alerts.
    `NotificationsPopover.jsx` upgraded: type icons, severity-colored chips, All/Unread tabs.
  - **Copilot actions (confirm-before-execute, user choice A)**: Gemini structured output
    (`COPILOT_SCHEMA`) lets the copilot attach an action proposal to its reply —
    `reroute_vehicle` (fresh Google route from current position, clears deviations,
    recomputes multi-stop thresholds), `resolve_exception` (breakdown/stop/deviation),
    `dispatch_adhoc` (creates + dispatches a real route via route_planning), and
    `acknowledge_events`. Proposals persist in `copilot_actions` (proposed → executed |
    failed | dismissed); `POST /api/logistics/copilot/actions/{id}/execute|dismiss`.
    Chat UI renders action cards with Execute/Dismiss, result messages, retry on failure,
    and full persistence across reloads. Executors emit events (new `route_replanned`
    type) which loop back into the notifications feed.
  Tested: iteration_24 — backend pytest (`tests/test_copilot_actions_notifications.py`,
  all pass after fixes) + playwright UI flows.
- **End-to-End Validation + Full-Tier Movement (✅ SHIPPED 2026-06-12)** — user-requested
  audit of the whole logistics system. Gaps found & fixed:
  - **Factory → Warehouse (first mile)**: new `ensure_factory_replenishment` sim leg —
    manufacturer plant dispatches FAC-xxx shipments to its warehouses; on arrival goods
    are received into warehouse inventory (`_receive_at_warehouse` + factory_receipt
    movements).
  - **Wholesaler → Distributor**: `ensure_wholesaler_dispatch` (keeps the lane alive) +
    `bridge_wholesaler_shipments` mirrors dispatched wholesaler ledger shipments into the
    main `shipments` collection → real trucks/GPS/geofences/deviation detection; delivery
    syncs back to `wholesaler_shipments` (status history notes the confirming truck).
    Stale seeded backlog auto-closed (148 delivered).
  - Simulator `generate_shipment` fixed to emit proper from/to roles + tracking_code;
    40 broken-role shipments backfilled.
  - Control tower board resolves destination names for ALL legs (warehouses, wholesalers,
    retailers via org_dests fallback); fleet cap 32 with spawn priority for rare legs.
  Validated: iteration_25 — frontend dead-end crawl across manufacturer (12 nav items),
  wholesaler, distributor, 2nd tenant: 100%, 0 console errors, NO dead ends. All 6 legs
  visible: factory→WH, WH→WH, WH→distributor, WH→wholesaler, wholesaler→distributor,
  distributor→retailer. Driver app deferred per user (simulation stands in).
- **Control Tower Usability Round (✅ SHIPPED 2026-06-12 evening)** — user feedback fixes:
  track isolation (non-modal side sheet + dimmed fleet + cargo manifest), fullscreen map
  mode, received shipments at 100% progress, every in-transit shipment gets a truck
  (fleet cap 80), clickable wholesaler pending badge → pending orders sheet, copilot
  itemizes per-truck exceptions (24h log in context), and `maybe_tick()` self-healing
  simulation for production deploys (sim runs on page views if scheduler is absent).
  NOTE: production (app.tradekonekt.com) needs a REDEPLOY to pick all this up.
- **Fullscreen Watchlist (✅ SHIPPED 2026-06-12 night)** — wall-board mode: pin up to 3
  trucks in fullscreen map; side rail shows live status badge, ETA/speed, progress;
  click pans to truck; pins persist in localStorage across reloads.
- **Planning & Ops → Procurement merge (✅ SHIPPED 2026-06-12 late)** — manufacturer
  /procurement is now a 2-tab workspace (Shipments | Planning & Ops). Legacy map and
  duplicated shipment KPIs removed from Planning & Ops; Logistics Center slimmed to
  Control Tower · Route Planning · AI Intelligence.
- **Order Allocation → Procurement consolidation (✅ SHIPPED 2026-02-13)** —
  /procurement is now a 3-tab workspace (Order Allocation · Shipments · Planning & Ops).
  Order Allocation moved out of the sidebar and into Procurement as the default tab;
  Shipment Authorization Center moved from Planning & Ops to the top of the Shipments
  tab (collapsible). Planning & Ops trimmed to Transfers + Pipeline + Forecast + Alerts.
  Legacy `/manufacturer/allocation` redirects to `/procurement?tab=allocation`.
- **Production sync endpoint (✅ SHIPPED 2026-06-14)** — `POST /api/admin/sync/{diff,apply}`
  and `GET /api/admin/sync/status`. Wipe + rebuild + 12mo backfill +
  forecast recompute, gated by `ADMIN_SYNC_TOKEN`. Fire-and-forget;
  returns 202 in <250ms; mutex prevents concurrent runs. Runbook:
  `docs/DEPLOYMENT_RUNBOOK.md`.
- **Forecast Density (✅ SHIPPED 2026-06-14)** — backfilled 530K daily_sales
  rows (12-month dense history), unified `quantity_sold` → `units` reads,
  re-ran stock-exhaustion compute, surfaced per-urgency counts (critical/
  high/medium/low) in the IntelligenceCenter forecasts card with
  smart-default filter. Manufacturer 30d revenue now ₦546M (was ₦105M).
  Regression: `tests/test_forecast_density.py` — 4/4 PASS.
- **Supply-chain logic alignment (✅ SHIPPED 2026-02-13)** — procurement/order
  direction now matches the spec: Mfr → Warehouse → Distributor → Wholesaler → Retailer.
  Retailers order from wholesalers (primary) with distributor-direct as fallback
  for large-format retailers; wholesalers order from distributors (primary) with
  factory/warehouse direct as legacy. Cart/PO/Shipment models carry a `supplier_type`
  discriminator and ship_po now emits `wholesaler → retailer` shipments. New
  endpoints: `/api/procurement/retailer/{id}/suppliers` and
  `/api/distributor/{id}/incoming-wholesaler-pos`.

See `CHANGELOG.md` for dated implementation history and `ROADMAP.md` for the prioritized backlog.
