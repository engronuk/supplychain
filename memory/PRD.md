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
- Per-role Analytics dashboard + CSV exports.

See `CHANGELOG.md` for dated implementation history and `ROADMAP.md` for the prioritized backlog.
