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
- **Multi-Tenant Login Switcher (✅ SHIPPED 2026-06-23)** —
  A real distributor or wholesaler that serves multiple manufacturers
  can now login once and choose which manufacturer's data to view.

  Scales to N manufacturers without code changes — adding a new
  manufacturer for the same business creates a new `distributors`/
  `wholesalers` row sharing the same `business_group_id`, which
  automatically surfaces in the picker.

  Implementation:

  * **`business_group_id`** — deterministic UUID-5 derived from
    `(role, name, city, state)`. Same real-world business → same id,
    regardless of how many manufacturers onboard it. Backfilled across
    `distributors` (12 rows), `wholesalers` (36 rows) and `users`
    (52 rows) at every backend boot.
  * **`GET /api/me/tenants`** — returns `{active, tenants[], multi_tenant}`
    for the calling user; manufacturer-scoped rows in the user's
    business_group are listed with `manufacturer_id`, `manufacturer_name`,
    `entity_id`, `entity_name`, `entity_city`, `is_default`.
  * **`POST /api/me/active-tenant`** — server-side validation that the
    chosen entity is in the user's membership list (security guard
    against header spoofing).
  * **`X-Active-Tenant-Id` header** — auth middleware reads it on every
    request and rewrites `user.entity_id` + `user.manufacturer_id` to
    the chosen tenant scope ONLY if it's in the caller's membership
    list (random id → 403). Endpoints that read `user.entity_id` /
    `user.manufacturer_id` therefore scope automatically without
    per-route plumbing.
  * **`TenantProvider` + axios interceptor** — frontend persists the
    chosen `entity_id` in `localStorage("tk.active_tenant_id")` and
    sends it as the header on every request. Modal-style selector
    auto-opens on first multi-tenant login; sidebar `TenantPill`
    shows the active scope + click-to-switch.

  Verified end-to-end: Apex Distributors (`mfr-0001-dst-0001`) sees
  2 tenants (Unilever + FMN), `/api/fleet/overview` returns the
  picked tenant's data, security spoof → 403. Same for wholesaler
  login `unilever.wholesaler@tradekonekt.io` which sees Royal Trading 1
  under both manufacturers.

- **Single-Source-of-Truth Audit Fix (✅ SHIPPED 2026-06-23)** —
  After the user reported the SAME distributor showing different data on
  web vs mobile, a full audit identified three issues:

  1. **Mobile pointed at preview backend, web pointed at production** —
     two different databases, guaranteed divergence. Mobile config must
     be set to `EXPO_PUBLIC_TRADEKONEKT_URL=https://www.app.tradekonekt.com`.
  2. **Schema split between `wholesalers` and `organizations` collections**
     — `wholesalers` was EMPTY while `organizations` held 36 wholesaler
     rows. Some screens read from one, some from the other. Fixed via
     new idempotent backfill
     `/app/backend/services/backfill_wholesalers.py` that mirrors orgs
     (type=wholesaler) into the canonical `wholesalers` table. Runs on
     every backend boot **and** every 5 minutes via the intel scheduler.
     Net result: 36 wholesalers now visible to every consumer.
  3. **Duplicate distributor names across manufacturers** (e.g. "Apex
     Distributors (Apapa)" exists under both Unilever and FMN). Per the
     user spec these are intentional (a distributor can serve multiple
     manufacturers). Added a manufacturer hint to the distributor
     workspace title bar (TitleBar in DistributorDashboard.jsx + new
     `manufacturer_name` field on
     `GET /api/distributor/{id}/operations-intelligence` response and
     `_empty_payload`) so dispatchers can distinguish duplicate-named
     distributors at a glance.

- **3 Mobile Backend Gaps Closed (✅ SHIPPED 2026-06-23)** —
  Fulfilled the mobile audit's 3 real backend gaps (gaps 4 + 5 were false
  alarms — endpoints already existed on preview but production was stale).

  * **`GET /api/search?q=&types=&limit=`** — global federated search across
    products · shipments · drivers · vehicles · distributors · wholesalers
    · retailers · warehouses. Tenant-scoped per role; returns
    ``{query, total, groups: {<type>: [{...,type,title,subtitle}]}}``.
    Drivers denied (403). New file
    `/app/backend/routes/search.py`.

  * **`/api/integrations`** — full CRUD over an 8-item integration
    catalogue (Google Maps · Vertex AI · Resend · Twilio SMS · Stripe ·
    OpenAI · ElevenLabs · Google OAuth). Endpoints:
      * ``GET /api/integrations`` — catalogue + connection state per org
      * ``GET /api/integrations/{slug}``
      * ``POST /api/integrations/{slug}/connect`` — body
        ``{config?, credentials_blob?, notes?}`` (secrets never echoed
        back; ``credentials_present`` flag exposed instead)
      * ``DELETE /api/integrations/{slug}``
    Storage: new ``integrations`` collection keyed on
    ``(org_id, slug)``. Dispatcher roles only (403 for driver/retailer).
    New file `/app/backend/routes/integrations.py`.

  * **`/api/distributor/{id}/reports`** — five canonical reports per
    distributor (sales, stock, deliveries, performance, compliance), each
    available as JSON or streaming CSV via ``?format=csv``. Auth allows
    the distributor itself, its upstream manufacturer, or super_admin —
    cross-manufacturer access returns 403 (verified). CSV emits with
    ``Content-Type: text/csv; charset=utf-8`` + ``Content-Disposition:
    attachment; filename="..."`` + ``X-Report-Kind`` / ``X-Row-Count``
    headers so mobile + web can save-as without parsing. New file
    `/app/backend/routes/distributor_reports.py`.

  All 3 routers wired into `server.py`. Linted clean, smoke-tested
  end-to-end. **Mobile agent's pending work**: 5-30 min adapter swap per
  group to replace mock fallback with real API calls + remove the
  graceful-degradation banners. After the next production redeploy, all
  five mobile-flagged gaps disappear at once.

- **Health Probe Endpoint (✅ SHIPPED 2026-06-23)** —
  `GET /api/health` — unauthenticated liveness probe returning
  ``{status, service, db, time}``. Added so the mobile QA team has a
  canonical probe instead of mistaking 404s on probe paths
  (``/api``, ``/api/healthz``) for backend outages.

- **Credentials Bundle Endpoint (✅ SHIPPED 2026-06-23)** —
  New `GET /api/_admin/credentials-bundle` returns every demo login in
  one JSON payload, grouped by role, with each row pre-resolved to its
  entity name (manufacturer / distributor / wholesaler / retailer /
  warehouse / driver). Driver rows additionally carry
  ``driver_code`` · ``driver_status`` · ``assigned_shipment_id`` ·
  ``compliance_severity`` so mobile QA can pick a driver in any
  lifecycle state. Supports ``?role=`` filter and ``?limit=`` cap.
  Role-gated to manufacturer + super_admin (403 for everyone else).
  Total available demo accounts: **247** (4 mfr · 14 dist · 38
  wholesaler · 170 retailer · 8 warehouse · 12 driver · 1 super_admin).

- **Distributor Driver Logins for Mobile QA (✅ SHIPPED 2026-06-23)** —
  Mobile QA team no longer single-threaded on Adaeze. New idempotent
  seeder `/app/backend/services/seed_distributor_driver_logins.py` mints
  one driver login per distributor (12 total) and wires the existing
  seeded driver row's `user_id` field. Email pattern
  ``driver-{distributor_id_short}@tradekonekt.io``, password = shared
  `DEMO_PASSWORD`. Auto-runs on every backend boot in both production
  and dev startup paths. Live list fetchable via
  ``GET /api/_admin/distributor-driver-logins`` (manufacturer or
  super_admin token). Credentials documented in
  `/app/memory/test_credentials.md`. Verified: driver login returns
  role=driver with proper entity_id linkage; `/api/driver/me` returns
  the full profile including the new `compliance_severity` field. Some
  drivers are already `on_trip`/`assigned` from the active-shipments
  demo seed — mobile QA can replay the lifecycle without first hitting
  the dispatch endpoint.

- **Active-Shipments Demo Seed (✅ SHIPPED 2026-06-23)** —
  Every distributor now starts with 3 live shipments (1 ``created`` in
  the dispatcher queue + 1 ``assigned`` + 1 ``in_transit``) routed to
  one of their downstream retailers/wholesalers. Idempotent
  (`/app/backend/services/seed_active_shipments.py`, keyed on
  ``source="fleet_demo_v1"``). The assigned + in_transit shipments also
  flip their driver to ``assigned/on_trip`` and vehicle to
  ``loading/in_transit`` so every status board on the Fleet Status panel
  shows live activity. Net: 36 new shipments (12 distributors × 3).
  Wired into both the production and dev server startup paths after the
  fleet production seed. Sim guard preserved — these are
  ``source="fleet_demo_v1"`` shipments, not simulator rows.

- **Logistics IA Refactor — Single Operations Cockpit (✅ SHIPPED 2026-06-23)** —
  Per the new product spec, monitoring + dispatch + master-data are now
  cleanly separated:

  • **Logistics Command Center** = single operations cockpit. New 4-tab
    layout: **Control Tower · Fleet Status · Route Planning · AI
    Intelligence**. The new **Fleet Status** tab (`/app/frontend/src/
    views/logistics/FleetStatusView.jsx`) merges the deleted FleetDashboard
    + Fleet Command Centre into one read-only board (KPI cube · vehicle
    status board · driver status board · compliance summary · active
    shipments · fleet alerts with ack). Distributor + wholesaler are now
    role-gated to **only** see the Fleet Status tab; manufacturer + super
    admin keep all four. Control Tower / Route Planning / AI Intelligence
    remain manufacturer-only.

  • **Dispatch Console** promoted to standalone top-level workspace at
    `/dispatch` (new `DispatchConsolePage.jsx`). Manufacturer + distributor
    + wholesaler + warehouse + super_admin can access. It is the **only**
    place where dispatch mutations (assign · reassign-driver · reassign-
    vehicle · cancel) happen.

  • **Fleet** workspace slimmed to master-data only. TABS reduced to
    `[Drivers, Vehicles, Compliance]`. `/fleet` index redirect now points
    to `/fleet/drivers`. Legacy paths (`/fleet/dashboard`,
    `/fleet/command-centre`, `/fleet/dispatch`, `/fleet/analytics`) kept
    as 301-style redirects so bookmarks keep working.

  • **Sidebar** restructured for every dispatcher role to expose the new
    IA: `Logistics Center → Dispatch → Fleet`. Distributor + wholesaler
    now see the Logistics Center entry (was manufacturer-only).

  • **Backend untouched**: every Phase B endpoint preserved
    (`/api/fleet/overview`, `/api/drivers/workload`,
    `/api/vehicles/utilization`, `/api/fleet/compliance/board`, assignment-
    history, default-pairing). Fleet Status is a pure UI consumer.

  • **Removed files**: `views/fleet/FleetDashboard.jsx`,
    `views/fleet/CommandCentre.jsx`.

  • **Known follow-up (P1)**: tenant-scoped Control Tower for distributor
    + wholesaler. The current `/api/logistics/control-tower` endpoint
    routes through `_scope_manufacturer` which 403s non-manufacturer
    callers — distributor + wholesaler therefore only see Fleet Status
    today. A future sibling endpoint or scope helper will deliver the
    tenant-scoped live map.

- **Fleet Management Production Data Hookup (✅ SHIPPED 2026-06-23)** —
  Every Track A tenant (2 manufacturers + 12 distributors) now has a real,
  non-simulator fleet in the unified `/fleet/*` workspace. New idempotent
  seeder `/app/backend/services/seed_fleet_production.py` inserts 4 drivers
  + 4 vehicles per tenant (Unilever keeps its 8) with Nigerian names, FRSC
  licence numbers, state-plate registrations, capacity, odometer, last-
  service date, and `insurance_expiry/roadworthiness_expiry/registration_
  expiry` deterministically spread across the six severity buckets (ok /
  info / warning / high / critical / expired) so the Compliance Centre is
  always populated. Also performed a one-time orphan migration: 7
  `manual/seed` vehicles with `owner_org_id=""` were reassigned to the
  primary Unilever tenant. Compliance + KPI jobs re-run automatically after
  the seed. Net effect: 52 new drivers + 52 new vehicles (total 60 real
  fleet rows) keyed on `(tenant_id, employee_number)` /
  `(tenant_id, registration_number)` so re-running is a no-op. Sim guard
  preserved — the legacy control-tower simulator continues to operate on
  its own 4,839 `source="simulator"` vehicles which are excluded from
  every `/api/fleet/*` endpoint. Verified via curl as both Unilever
  manufacturer and Apex Distributor: each sees only its own production
  fleet with live compliance buckets and KPIs. Seeder wired into
  `server.py` startup (production + canonical-rebuild + dev paths).

- **Driver Mobile App W0 Discovery (✅ SHIPPED 2026-06-20)** —
  Four W0 docs created (functional spec + UX plan + build brief + API
  validation), exposed via `/api/public-docs/driver-*`. 17/17 endpoints
  verified green; no-tab IA with a single state-aware mega-button covers
  the entire 8-state lifecycle. P0 cut: 15 features. Driver Mobile Agent
  has everything needed to begin the build.
- **Track A — Logistics Foundation Layer (✅ SHIPPED 2026-06-20)** —
  43 new endpoints across Shipment lifecycle (8-state machine), Driver entity,
  Vehicle fleet registry, and OTP-based Proof of Delivery. Driver added to
  `VALID_ROLES`. Backfilled 3,740 shipments + 3,257 vehicles to schema v2 via
  idempotent migration. Tenant security retrofitted on `/api/notifications`
  (was unauthenticated — closed OTP leak). 35/35 tests passing (20 from
  testing-agent + 15 manual E2E). Full readiness report at
  `/app/docs/TRACK_A_READINESS_REPORT.md` and at
  `/api/public-docs/track-a-readiness`. Driver Mobile App W0 gate: ✅ OPEN.
- **Track A Cascade Migration Fix (✅ SHIPPED 2026-06-20)** —
  Extended `migrate_logistics_v2.py` with two new idempotent passes:
  (1) `normalize_drifted_statuses()` rewrites v2 shipments whose status
  drifted back to legacy values (e.g. legacy `wms`/`manufacturer` callers
  writing `received` on a v2 doc) → mapped to canonical 8-state. 268 docs
  normalized. (2) `cascade_terminal_associations()` finds drivers/vehicles
  whose `assigned_shipment_id` / `current_shipment_id` points to a terminal
  shipment (`delivered`/`cancelled`) and resets them to `available` with
  cleared associations. 1,384 vehicles freed across two passes. Preview DB
  verified clean — 0 stuck drivers/vehicles, 0 drift remaining. Driver
  `DRV-W0-11542` now `available` and ready for new assignments.
- **Manufacturer Mobile Docs Handover (✅ SHIPPED 2026-06-19)** —
  Completed the third and final mobile-app handover package. New artefacts:
  `/app/docs/MANUFACTURER_MOBILE_UX_PLAN.md` (IA + 5-tab plan + P0/P1/P2 cut)
  and `/app/docs/MANUFACTURER_MOBILE_BUILD_BRIEF.md` (32 KB self-contained
  brief: 24 P0 screens, 13-endpoint smoke test, state machines, testid map,
  error landmines). All four manufacturer docs whitelisted in
  `/app/backend/routes/public_docs.py` — slugs `manufacturer-mobile-brief`,
  `manufacturer-functional`, `manufacturer-mobile-ux`,
  `manufacturer-api-validation` (each verified HTTP 200 via curl).
- **P0+P1 Manufacturer→Retailer remediation sprint (✅ SHIPPED 2026-06-17)** —
  inventory now credits at every tier on delivery (was warehouse-only); tier
  rollups discover retailers via parent chain (was empty); wholesaler
  workspace correctly serves retailers (was "distributors"); PO statuses
  flip to delivered on shipment receipt; live map auto-archives trucks
  >12h post-delivery (was 664 stale "arrived" markers); new bulk-ack and
  archive endpoints; logistics events auto-resolve; dashboard snapshots
  auto-refresh when stale (was "Updated 2d ago"); shipment line items now
  carry full unit_price/gross/discount/net financials. Regression
  `/app/backend/tests/test_p0p1_sprint.py` — 15/15 PASS. Audit
  `/app/test_reports/audit_inventory.json` — zero inventory leaks, zero
  stale POs.

See `CHANGELOG.md` for dated implementation history and `ROADMAP.md` for the prioritized backlog.
