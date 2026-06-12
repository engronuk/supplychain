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
- **Phase 2 (NEXT)** — Route Planning Center UI, Route Builder, Delivery Execution Timeline.
- **Phase 3** — Delay prediction (Vertex AI), AI Logistics Copilot, Demand-to-Delivery correlation.

See `CHANGELOG.md` for dated implementation history and `ROADMAP.md` for the prioritized backlog.
