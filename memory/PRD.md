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

## Prioritized backlog
- P1 — Multi-manufacturer scoping: `retailers_count` in /api/analytics for manufacturer
  currently counts all retailers; should be scoped to that manufacturer's distributors
- P1 — Validate inventory ≥ requested at pending→in_transit instead of clamping at 0
- P2 — Split server.py into routers (entities, shipments, requests, analytics, reports, seed)
- P2 — Server-side guard on Shipment.from_role/to_role pairs (only mfg→dist or dist→ret)
- P2 — Silence Recharts width(-1) console warnings with explicit chart min-heights
- P3 — Multi-manufacturer support (currently single)
- P3 — Email/SMS notifications integration

## Next tasks
- Address any feedback from user
