# TradeKonekt — Roadmap & Backlog

_Last updated: 2026-06-11 (Wholesaler Workspace · Phase 2 shipped — 30/30 backend tests + frontend e2e green)._

## ✅ Done
- **Wholesaler · Phase 1** — Dashboard, Inventory, Procurement, Distributor Network.
- **Wholesaler · Phase 2** — Distributor Orders (KPIs / funnel / queue / detail with rule-based availability + recommendation + risks / Approve / Reject / Modify / Partial / Backorder / Cancel), Fulfillment workflow (Picking → Packing → Dispatch), Shipment Management (Load → Start Transit → Deliver / Delay / Cancel).

## 🔥 P0 — Wholesaler · Phase 3 (Analytics & Intelligence)
- Distributor Analytics — top distributors · fastest growing · underperforming.
- Inventory Analytics — turnover · days of supply · inventory value over time.
- Demand Forecast (rule-based unless user wants AI) — product · regional · distributor demand.
- Replenishment Intelligence — reorder quantity suggestions · days-of-cover · stockout-risk signal.

## 🟡 P1
- Refactor `routes/wholesaler_orders.py` (1260 lines, exceeds the 700-line guideline) into `wholesaler_orders.py` + `wholesaler_fulfillment.py` + `wholesaler_shipments.py`.
- Replace the shipments catch-all route with explicit `/load`, `/start-transit`, `/deliver` endpoints for safety.
- Wrap `dispatch` (N+1 inventory writes + shipment insert + order/fulfillment updates) in a Mongo transaction.
- Replace `_next_seq` count-based numbering with an atomic counters collection (race-safe).
- Allocation KPIs strip on the Manufacturer Allocation Center — Fill Rate, Allocation Time, Back-Order Rate, Service Level, Warehouse Performance.
- Distributor reorder shortcut — "Reorder this PO" prefill on My POs cards.

## 🟢 P2
- In-app notifications feed — distributor / manufacturer / warehouse / wholesaler personas get a unified feed for allocation / transfer / replenishment / order events.
- Standalone WMS `/wms/fulfillment` page mirroring the warehouse tab.
- Coalesce `_decrement_stock_on_dispatch` / `_settle_in_transit_on_delivery` / `_adjust_reservation` into single `$inc` updates per product for atomicity.

## 🔵 P3 — Future
- Promotions Workspace — drafts exist (Product Command Center), no management UI.
- Super-Admin Dashboard — tenant management, onboarding wizards.
- Ownership Model Enforcement (Phases 3 & 4).
- Logistics integrations — driver mobile flows, proof of delivery, live GPS feeds.
- Payments & Credit — invoices, credit limits, settlements, aging reports.
