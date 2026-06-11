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

See `CHANGELOG.md` for dated implementation history and `ROADMAP.md` for the prioritized backlog.
