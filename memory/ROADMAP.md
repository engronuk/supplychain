# TradeKonekt — Roadmap & Backlog

_Last updated: 2026-06-11 (after Logistics Command Center shipped)._

## P1 — Upcoming
- Standalone WMS `/wms/fulfillment` page — mirror the Warehouse-tab UI so the standalone WMS workspace also shows fulfillment orders.
- Allocation KPIs strip — Fill Rate, Allocation Time, Back-Order Rate, Service Level, Warehouse Performance on the Manufacturer Allocation Center.
- Distributor reorder shortcut — "Reorder this PO" button on My Purchase Orders cards that prefills the cart.

## P2
- In-app notifications feed — Distributor, Manufacturer and Warehouse personas see their allocation/transfer events (logistics transfers + replenishment decisions are natural feed sources now).

## P3 — Future
- Promotions Workspace — drafts are saved from the Product Command Center but there is no UI to view/manage/activate them.
- Super-Admin Dashboard — tenant management, onboarding wizards, system ops.
- Ownership Model Enforcement — Phases 3 & 4.
- Logistics integrations — driver mobile flows, proof of delivery, live GPS feeds for the truck layer (currently positions are seeded/derived), control-tower visibility.

## Refactoring backlog
- `backend/routes/logistics.py` is ~970 lines — consider splitting into `logistics_overview.py` / `logistics_transfers.py` / `logistics_ai.py`.
- `_create_transfer` mutates 4 collections without a transaction — consider compensating cleanup or a Mongo transaction.
