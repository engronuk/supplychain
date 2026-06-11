# TradeKonekt — Roadmap & Backlog

_Last updated: 2026-06-11 (Wholesaler Workspace Phase 1 shipped)._

## P0 — Wholesaler Workspace · Phase 2 (next iteration)
- Incoming Distributor Orders — fulfilment workflow (Submitted → Approved → Allocated → Picking → Packing → Shipped → Delivered) with approve / reject / modify / partial fulfilment actions.
- Outbound & Inbound Shipment Management — full timeline view with ETAs and batch numbers.
- Smart Allocation — Vertex AI recommendations on which warehouse / wholesaler can best fulfil an incoming distributor request.

## P1
- Wholesaler Workspace · Phase 3 — Analytics & Intelligence (top/growing/declining distributors, inventory turnover, demand forecast, replenishment intelligence).
- Refactor `routes/wholesaler.py` (~970 lines) into `wholesaler_overview.py / wholesaler_inventory.py / wholesaler_procurement.py / wholesaler_distributors.py`.
- Standalone WMS `/wms/fulfillment` page mirroring the Warehouse tab.
- Allocation KPIs strip — Fill Rate, Allocation Time, Back-Order Rate, Service Level, Warehouse Performance on the Manufacturer Allocation Center.
- Distributor reorder shortcut — "Reorder this PO" prefill on My POs cards.

## P2
- In-app notifications feed — distributor / manufacturer / warehouse / wholesaler personas see allocation / transfer / replenishment events.
- Seed enrichment so Prime Distribution Services has delivered orders in the last 90 days (currently 44 orders / ₦0 revenue on the Wholesaler Distributor Network — cosmetic).
- Wrap PO `delivered` transition in a MongoDB transaction (currently N+1 inventory writes, no rollback on partial failure).

## P3 — Future
- Promotions Workspace — drafts exist (Product Command Center), no management UI.
- Super-Admin Dashboard — tenant management, onboarding wizards, system ops.
- Ownership Model Enforcement — Phases 3 & 4.
- Logistics integrations — driver mobile flows, proof of delivery, live GPS feeds for the truck layer.
- Payments & Credit — invoices, credit limits, settlements, aging reports.
