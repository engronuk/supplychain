# TradeKonekt — System Map, User Journeys & Gap Analysis
_Last updated: 2026-06-11. Source: full route/view/backend audit + CHANGELOG history._

## What the system is
Multi-tenant FMCG supply-chain OS for Nigeria: Manufacturer → Warehouse → Distributor → Wholesaler → Retailer.
Stack: React + FastAPI + MongoDB Atlas, Vertex AI (gemini-2.5-flash @ europe-west2), BigQuery pulse.sales_events, Google Maps, APScheduler.
Tenants: Unilever (7 WH / 91 DST / 18 WHO / 3,080 RTL / 15 SKUs) + Flour Mills Nigeria (9-node tree / 6 SKUs). Isolation verified 22/22.

## Persona maturity
- super_admin: console, impersonation, org management — FUNCTIONAL
- manufacturer: 10 modules (exec dashboard + pulse command center tab, logistics center, allocation, shipment command center, product intelligence, intel, network map, distributor intelligence 3-level drill-down, warehouses ops) — FLAGSHIP
- warehouse: standalone /wms (14 pages: GRN receiving, dispatch, transfers, cycle counts, returns, alerts, users, reports) — STRONG
- distributor: ops intelligence dashboard, retailer network + drill-down, procurement (place order on mfr / my POs w/ progress tracker / retailer orders / quotes / shipments tab) — STRONG
- retailer: POS Sales Book, Inventory Command Center (+ per-SKU pricing/margin), Procurement (AI reorder recos, cart→PO split per supplier, RFQ quotes, shipments tab), Sabi AI (tenant-walled, voice+text) — STRONG
- wholesaler: GAP — falls back to RetailerDashboardV2; no dedicated workspace
- logistics_provider: GAP — org type only, zero UI

## Working end-to-end flows (verified)
1. Order-to-Delivery: distributor cart → PO pending → mfr Allocation Center (auto: region→stock→distance; manual split; reserve-on-allocate) → fulfillment_orders per warehouse → pick/pack/load/dispatch (stock decrement) → shipment received → order completed.
2. Sense-to-Act AI loop: POS/daily_sales → scheduled forecasts (EWMA + weather/holidays) + anomalies + churn → Intelligence Center / logistics alerts / stockout predictions → Vertex AI transfer recommendation → execute → truck moves (10x time-lapse scheduler, 2-min ticks; frontend polls /logistics/trucks every 30s) → deliver credits destination stock.
3. Replenishment authorization: warehouse/wholesaler request → approve → auto transfer from best-stocked warehouse.
4. Retailer loop: POS sale (atomic $inc) → low-stock → AI reorder reco → cart → PO → distributor approves → shipment → received.
5. WMS ops: GRN increments stock; dispatch/transfers decrement; cycle counts with variance; returns.

## Fine-tuning opportunities
1. Wholesaler persona has no workspace (biggest gap).
2. Two parallel order systems (legacy `requests` vs procurement `purchase_orders`) — converge.
3. Allocation KPIs missing (Fill Rate, Allocation Time, Back-Order Rate, Service Level) — roadmap P1, data exists.
4. No unified in-app notifications feed (bell exists; logistics/allocation events are ready feed sources) — roadmap P2.
5. Regional forecast sparsity: recent daily_sales only for Lagos demo retailers → +576% outlier; widen seed or blend.
6. Boot date-refresh rebases shipment timestamps → fresh transfers look "4+ days delayed" (cosmetic alert pollution).
7. Promotions: drafts exist, no management workspace (P3).
8. /wms/fulfillment standalone page missing (P1) — warehouses only see fulfillment via the manufacturer surface.
9. Reports = CSV only.
10. Vertex 429 handling works but could add per-tenant AI budget + last-good cache surfacing.

## True gaps (not built)
- Payments/finance: no invoices, credit limits, settlements, aging (B2B flow has zero money layer; POS records payment methods only).
- Real logistics execution: simulated trucks; no driver app, POD, GPS ingestion; logistics_provider empty.
- Field/van sales rep journeys.
- Upstream returns / claims / credit notes (WMS returns only).
- Tenant onboarding wizard (invitation APIs exist; no self-serve UI).

## Recommended build order
1. Wholesaler Workspace (reuse distributor procurement + retailer-network patterns).
2. In-app Notifications Feed + Allocation KPIs strip (quick roadmap wins).
3. Payments & Credit layer (invoice on delivery, credit limits, aging) — biggest real-world value.
4. Promotions Workspace.
5. Driver/POD mobile flow (map infra ready).
6. Super-admin tenant onboarding wizard.

## Key credentials
All demo users: password `TradeKonekt2026!` (Flour Mills users: `FlourMills2026!`) — full roster in /app/memory/test_credentials.md.
