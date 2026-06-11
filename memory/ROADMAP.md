# TradeKonekt — Roadmap & Backlog

_Last updated: 2026-06-11 — Place Order on Behalf + Allocation KPIs strip shipped. Security: `/allocation/*` endpoints now role-locked to manufacturer/warehouse/super_admin._

## ✅ Done
- **Wholesaler · Phase 1** — Dashboard, Inventory, Procurement, Distributor Network.
- **Wholesaler · Phase 2** — Distributor Orders + Fulfillment workflow + Shipment Management.
- **Wholesaler · Phase 3 (Analytics + Detail)** — 6-tab Analytics page (rule-based, no AI), 360° Distributor Detail page, cross-persona widgets on Manufacturer dashboard + Distributor inbox.
- **Wholesaler · Place Order on Behalf** — "Place Order on Their Behalf" modal on Distributor Detail page; captures sales-call orders directly into `wholesaler_orders` via `POST /api/wholesaler/{wid}/orders`.
- **Manufacturer · Allocation KPIs** — Fill Rate, Allocation Time, Back-Order Rate, Service Level, Warehouse Performance leaderboard. `GET /api/allocation/kpis?days=30`. Pure programmatic logic.
- **Tenant scope hardening** — `_scope_manufacturer` now enforces a role allowlist (manufacturer / warehouse / super_admin). Downstream roles (distributor / wholesaler / retailer) blocked from every `/allocation/*` endpoint.

## 🟡 P1
- In-app notifications feed (distributor / manufacturer / warehouse / wholesaler) for allocation, transfer, replenishment, order events.
- Refactor `routes/wholesaler_orders.py` (1264 lines) and `routes/allocation.py` (812 lines) into split modules per guideline.
- Replace the shipments catch-all route with explicit `/load`, `/start-transit`, `/deliver` endpoints for safety.
- Wrap `dispatch` (N+1 inventory writes + shipment insert + order/fulfillment updates) in a Mongo transaction.
- Replace `_next_seq` count-based numbering with an atomic counters collection (race-safe).
- Distributor reorder shortcut — "Reorder this PO" prefill on My POs cards.

## 🟢 P2
- Promotions Workspace (drafts exist via Product Command Center, no management UI).
- Forecast Data Sparsity Fix — broaden `daily_sales` seed so regional forecast trends are less volatile and allocation on-time % differentiates across warehouses (currently all 100% due to clean seed timestamps).
- Standalone WMS `/wms/fulfillment` page mirroring the warehouse tab.
- Coalesce `_decrement_stock_on_dispatch` / `_settle_in_transit_on_delivery` / `_adjust_reservation` into single `$inc` updates per product for atomicity.
- Swap the native HTML date input in the Place-Order modal for the shadcn Calendar/Popover.
- Push allocation_kpis math into a Mongo aggregation pipeline (currently O(n) in Python on up to 5k orders).

## 🔵 P3 — Future
- Super-Admin Dashboard — tenant management, onboarding wizards.
- Ownership Model Enforcement (Phases 3 & 4).
- Logistics integrations — driver mobile flows, proof of delivery, live GPS feeds.
- Payments & Credit — invoices, credit limits, settlements, aging reports.
