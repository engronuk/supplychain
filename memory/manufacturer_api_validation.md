# Manufacturer API Validation

**Probe date:** 2026-06-19 (preview env)  
**Auth:** `unilever@tradekonekt.io / TradeKonekt2026!`  
**Manufacturer entity_id:** `b21c1dbe-1a6f-4c33-b036-f416579455d0`

**Legend**  
✅ **Verified** — 200 with expected payload  
🟡 **Partial** — works but limited / requires special params  
❌ **Missing** — does not exist (404) or rejects manufacturer (400/422)

---

## A. Identity & Session

| Capability        | Endpoint                                | Status      |
|-------------------|-----------------------------------------|-------------|
| Login             | `POST /api/auth/login`                  | ✅ Verified |
| Read self         | `GET  /api/auth/me`                     | ✅ Verified |
| Refresh token     | `POST /api/auth/refresh`                | ✅ Verified |
| Sign out          | `POST /api/auth/logout`                 | ✅ Verified |
| Forgot password   | `POST /api/auth/forgot-password`        | ✅ Verified |
| Reset password    | `POST /api/auth/reset-password`         | ✅ Verified |

---

## B. Executive / Overview

| Capability                | Endpoint                                                          | Status      |
|---------------------------|-------------------------------------------------------------------|-------------|
| Overview snapshot         | `GET  /api/manufacturer/{mid}/overview`                          | ✅ Verified |
| Refresh overview          | `POST /api/manufacturer/{mid}/overview/refresh`                  | ✅ Verified |
| Activity Pulse (60s)      | `GET  /api/manufacturer/{mid}/activity-pulse`                    | ✅ Verified |
| Network Pulse (live)      | `GET  /api/manufacturer/{mid}/network-pulse?limit=&since_iso=`   | ✅ Verified |

---

## C. Products / Product Intelligence

| Capability                   | Endpoint                                                                 | Status      |
|------------------------------|--------------------------------------------------------------------------|-------------|
| Network products list        | `GET  /api/manufacturer/{mid}/products`                                  | ✅ Verified |
| Product intelligence snapshot| `GET  /api/manufacturer/{mid}/product-intelligence`                      | ✅ Verified |
| Refresh PI snapshot          | `POST /api/manufacturer/{mid}/product-intelligence/refresh`              | ✅ Verified |
| Product detail (network view)| `GET  /api/manufacturer/{mid}/product/{product_id}`                      | ✅ Verified |
| Create product               | `POST /api/manufacturer/{mid}/products`                                  | ✅ Verified |
| Edit product                 | `PATCH /api/products/{product_id}`                                       | ✅ Verified |
| Adjust inventory at any owner| `POST /api/inventory/adjust`                                              | ✅ Verified |

---

## D. Distributors & Warehouses

| Capability                                  | Endpoint                                                                 | Status      |
|---------------------------------------------|--------------------------------------------------------------------------|-------------|
| Warehouse network list                      | `GET /api/manufacturer/{mid}/warehouse-network`                          | ✅ Verified |
| Warehouse → distributor downstream          | `GET /api/warehouse/{warehouse_id}/distributor-network`                  | ✅ Verified |
| Distributor detail                          | `GET /api/manufacturer/{mid}/distributor/{distributor_id}`               | ✅ Verified |
| Distributor edit                            | `PATCH /api/distributors/{distributor_id}`                               | ✅ Verified |
| Wholesaler POs (cross-tier monitoring)      | `GET /api/manufacturer/{mid}/wholesaler-pos`                             | ✅ Verified |

---

## E. Procurement / Outbound POs

| Capability                  | Endpoint                                                              | Status      |
|-----------------------------|-----------------------------------------------------------------------|-------------|
| List incoming POs           | `GET /api/procurement/purchase-orders?manufacturer_id={mid}`         | ✅ Verified |
| PO detail (live truck ETA)  | `GET /api/procurement/purchase-orders/{po_id}`                       | ✅ Verified |
| Submit / Approve / Reject   | `POST /api/procurement/purchase-orders/{po_id}/{action}`             | ✅ Verified |
| Process / Ship / Deliver    | same                                                                  | ✅ Verified |
| Cancel / Duplicate          | same                                                                  | ✅ Verified |

---

## F. Allocation Center

| Capability                 | Endpoint                                                                | Status      |
|----------------------------|-------------------------------------------------------------------------|-------------|
| Summary                    | `GET /api/allocation/summary?manufacturer_id={mid}`                    | ✅ Verified |
| KPIs                       | `GET /api/allocation/kpis?manufacturer_id={mid}`                       | ✅ Verified |
| Pool (warehouse scoped)    | `GET /api/allocation/pool?warehouse_id={whid}`                          | 🟡 Partial — without `warehouse_id` returns 502 |
| Order recommendation       | `GET /api/allocation/orders/{order_id}/recommendation`                  | ✅ Verified |
| Auto-allocate              | `POST /api/allocation/orders/{order_id}/auto-allocate`                  | ✅ Verified |
| Manual-allocate            | `POST /api/allocation/orders/{order_id}/manual-allocate`                | ✅ Verified |
| Back-order                 | `POST /api/allocation/orders/{order_id}/back-order`                     | ✅ Verified |
| Reject                     | `POST /api/allocation/orders/{order_id}/reject`                         | ✅ Verified |
| Acknowledge                | `POST /api/allocation/orders/{order_id}/acknowledge`                    | ✅ Verified |
| Back-orders list           | `GET /api/allocation/back-orders?manufacturer_id={mid}`                | ✅ Verified |
| Order detail               | `GET /api/allocation/orders/{order_id}`                                 | ✅ Verified |

---

## G. Logistics Control Tower

| Capability               | Endpoint                                                              | Status      |
|--------------------------|-----------------------------------------------------------------------|-------------|
| Control tower snapshot   | `GET /api/logistics/control-tower?manufacturer_id={mid}`             | ✅ Verified |
| Events feed              | `GET /api/logistics/events?manufacturer_id={mid}&limit=`             | ✅ Verified |
| Ack single event         | `POST /api/logistics/events/{event_id}/ack`                           | ✅ Verified |
| Bulk-ack events          | `POST /api/logistics/events/bulk-ack`                                  | ✅ Verified |
| Archive arrived vehicles | `POST /api/logistics/vehicles/archive`                                 | ✅ Verified |
| Archived vehicles list   | `GET /api/logistics/vehicles/archived?manufacturer_id={mid}`          | ✅ Verified |
| Shipment timeline        | `GET /api/logistics/shipment-timeline/{shipment_id}`                  | ✅ Verified |
| Geofences                | `GET /api/logistics/geofences`                                         | ✅ Verified |
| Pending orders (wholesaler) | `GET /api/logistics/wholesalers/{wholesaler_id}/pending-orders`     | ✅ Verified |

---

## H. Route Planning & Logistics AI

| Capability                  | Endpoint                                                              | Status      |
|-----------------------------|-----------------------------------------------------------------------|-------------|
| Route planning data         | `GET /api/logistics/route-planning?manufacturer_id={mid}`            | ✅ Verified |
| Preview route plan          | `POST /api/logistics/route-planning/preview`                          | ✅ Verified |
| Dispatch a plan             | `POST /api/logistics/route-planning/dispatch`                          | ✅ Verified |
| Route detail                | `GET /api/logistics/route-planning/routes/{route_id}`                  | ✅ Verified |
| Delay predictions           | `GET /api/logistics/predictions?manufacturer_id={mid}`                 | ✅ Verified |
| Demand vs Delivery          | `GET /api/logistics/demand-delivery?manufacturer_id={mid}`             | ✅ Verified |
| Logistics Copilot chat      | `POST /api/logistics/copilot/chat`                                     | ✅ Verified |
| Copilot history             | `GET /api/logistics/copilot/history`                                    | ✅ Verified |
| Execute Copilot action      | `POST /api/logistics/copilot/actions/{action_id}/execute`               | ✅ Verified |
| Dismiss Copilot action      | `POST /api/logistics/copilot/actions/{action_id}/dismiss`               | ✅ Verified |

---

## I. Intelligence (LLM + rule-based)

| Capability                | Endpoint                                                                    | Status      |
|---------------------------|-----------------------------------------------------------------------------|-------------|
| Executive Summary         | `GET  /api/intel/exec-summary?role=manufacturer&entity_id={mid}`           | ✅ Verified |
| Regenerate brief          | `POST /api/intel/exec-summary/regenerate`                                   | ✅ Verified |
| Live feed                 | `GET  /api/intel/feed?role=manufacturer&entity_id={mid}&limit=`            | ✅ Verified |
| Stockout forecasts        | `GET  /api/intel/forecasts/stockout?role=manufacturer&entity_id={mid}`     | ✅ Verified |
| Recommendations           | `GET  /api/intel/recommendations?role=manufacturer&entity_id={mid}`         | ✅ Verified |
| Acknowledge recommendation| `PATCH /api/intel/recommendations/{rec_id}`                                 | ✅ Verified |
| Alerts                    | `GET  /api/intel/alerts?role=manufacturer&entity_id={mid}`                  | ✅ Verified |
| External signals          | `GET  /api/intel/external?role=manufacturer&entity_id={mid}`                | ✅ Verified |
| Delivery ETA              | `GET  /api/intel/delivery-eta?role=manufacturer&entity_id={mid}`            | ✅ Verified |
| Retailer health           | `GET  /api/intel/retailer-health?role=manufacturer&entity_id={mid}`         | ✅ Verified |
| Force recompute           | `POST /api/intel/recompute`                                                  | ✅ Verified |
| Copilot chat              | `POST /api/intel/copilot`                                                    | ✅ Verified |

---

## J. Generic Analytics & Reports

| Capability        | Endpoint                                                                | Status      |
|-------------------|-------------------------------------------------------------------------|-------------|
| Generic analytics | `GET /api/analytics?role=manufacturer&entity_id={mid}`                  | ✅ Verified |
| Shipments CSV     | `GET /api/reports/shipments.csv?role=manufacturer&entity_id={mid}`      | ✅ Verified |
| Inventory CSV     | `GET /api/reports/inventory.csv?role=manufacturer&entity_id={mid}`      | ✅ Verified |
| Orders CSV        | —                                                                        | ❌ Missing  |
| Forecast CSV/PDF  | —                                                                        | ❌ Missing  |
| Analytics PDF     | —                                                                        | ❌ Missing  |

---

## K. Notifications

| Capability       | Endpoint                                                                            | Status      |
|------------------|-------------------------------------------------------------------------------------|-------------|
| List             | `GET /api/notifications?target_type=manufacturer&target_id={mid}&limit=`            | ✅ Verified |
| Mark one read    | `PATCH /api/notifications/{notif_id}/read`                                           | ✅ Verified |
| Mark all read    | `PATCH /api/notifications/read-all`                                                  | ✅ Verified |
| Preferences      | —                                                                                    | ❌ Missing  |
| Push registration| —                                                                                    | ❌ Missing  |

---

## L. Sabi (manufacturer-specific)

| Capability                       | Endpoint                                              | Status      |
|----------------------------------|-------------------------------------------------------|-------------|
| Manufacturer chat                | `POST /api/manufacturer/{mid}/assistant`              | ❌ Missing (404) |
| Manufacturer voice transcribe    | `POST /api/manufacturer/{mid}/assistant/transcribe`   | ❌ Missing       |
| Manufacturer execute action      | `POST /api/manufacturer/{mid}/assistant/execute`      | ❌ Missing       |

> Workaround: the Logistics Copilot (`/api/logistics/copilot/chat`) is the closest available LLM surface but is scoped to logistics topics only.

---

## Summary

| Verified | Partial | Missing |
|---|---|---|
| **68 endpoints** | 1 | 6 |

**Gaps mobile MVP can ignore:** Sabi for manufacturer, orders CSV, analytics PDF, push prefs.  
**Gaps mobile MVP must NOT advertise:** manufacturer Sabi bubble, push notification settings.
