# Wholesaler API Validation

**Probe date:** 2026-06-18 (preview env: `https://supply-chain-hub-189.preview.emergentagent.com`)  
**Auth:** `mfr-0001-who-0001@tradekonekt.io / TradeKonekt2026!`  
**Wholesaler entity_id:** `6458308e-3b90-283c-f156-1a385cc22dd1`

**Legend**  
✅ **Verified** — endpoint returns 200 with expected payload shape  
🟡 **Partial** — endpoint works but feature is incomplete (e.g. payload field unused, role not wired through, no UI surface, etc.)  
❌ **Missing** — endpoint does not exist (404) or wholesaler role rejected (400/422)

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

## B. Wholesaler — Dashboard & Overview

| Capability                     | Endpoint                                                              | Status      |
|--------------------------------|-----------------------------------------------------------------------|-------------|
| Wholesaler profile             | `GET /api/wholesaler/{wid}`                                          | ✅ Verified |
| Command-center overview        | `GET /api/wholesaler/{wid}/overview`                                  | ✅ Verified |

Payload exposes `kpis (8) · inventory_health · ai_insights · stockout_risks · wholesaler{name,region,city}`.

---

## C. Wholesaler — Inventory

| Capability               | Endpoint                                                                       | Status      |
|--------------------------|--------------------------------------------------------------------------------|-------------|
| Stock catalogue          | `GET  /api/wholesaler/{wid}/inventory`                                         | ✅ Verified |
| Movements ledger         | `GET  /api/wholesaler/{wid}/inventory/movements?limit=30`                      | ✅ Verified |
| Receive stock            | `POST /api/wholesaler/{wid}/inventory/receive`                                 | ✅ Verified |
| Adjust stock             | `POST /api/wholesaler/{wid}/inventory/{product_id}/adjust`                     | ✅ Verified |
| Cycle count              | `POST /api/wholesaler/{wid}/inventory/{product_id}/cycle-count`                | ✅ Verified |
| Inter-hub transfer       | —                                                                              | ❌ Missing  |
| Per-SKU detail page      | (none — row click is a modal, not a route)                                     | 🟡 Partial  |

---

## D. Wholesaler — Procurement (upstream POs to distributors)

| Capability                      | Endpoint                                                                          | Status      |
|---------------------------------|-----------------------------------------------------------------------------------|-------------|
| List POs                        | `GET  /api/wholesaler/{wid}/procurement/orders?status=`                          | ✅ Verified |
| Create PO                       | `POST /api/wholesaler/{wid}/procurement/orders`                                   | ✅ Verified |
| Transition PO (state-machine)   | `POST /api/wholesaler/{wid}/procurement/orders/{po_id}/transition`                | ✅ Verified |
| List suppliers                  | `GET  /api/wholesaler/{wid}/procurement/suppliers`                                | ✅ Verified |
| Browse catalog                  | `GET  /api/wholesaler/{wid}/procurement/catalog`                                  | ✅ Verified |
| PO duplicate / clone            | —                                                                                  | ❌ Missing  |
| PO timeline live truck ETA      | included in `transition` history — but no dedicated `…/{po_id}` GET               | 🟡 Partial  |

---

## E. Wholesaler — Customer Orders (inbound from retailers)

| Capability               | Endpoint                                                                       | Status      |
|--------------------------|--------------------------------------------------------------------------------|-------------|
| Orders dashboard         | `GET  /api/wholesaler/{wid}/orders/dashboard`                                  | ✅ Verified |
| List orders              | `GET  /api/wholesaler/{wid}/orders`                                            | ✅ Verified |
| List customer orders     | `GET  /api/wholesaler/{wid}/customer-orders`                                   | ✅ Verified |
| Order detail             | `GET  /api/wholesaler/{wid}/orders/{order_id}`                                 | ✅ Verified |
| Create order (manual)    | `POST /api/wholesaler/{wid}/orders`                                            | ✅ Verified |
| Approve                  | `POST /api/wholesaler/{wid}/orders/{order_id}/approve`                         | ✅ Verified |
| Reject                   | `POST /api/wholesaler/{wid}/orders/{order_id}/reject`                          | ✅ Verified |
| Modify                   | `POST /api/wholesaler/{wid}/orders/{order_id}/modify`                          | ✅ Verified |
| Cancel                   | `POST /api/wholesaler/{wid}/orders/{order_id}/cancel`                          | ✅ Verified |
| Bulk approve / bulk action| —                                                                              | ❌ Missing  |

---

## F. Wholesaler — Fulfillment Pipeline

| Capability                     | Endpoint                                                                            | Status      |
|--------------------------------|-------------------------------------------------------------------------------------|-------------|
| List fulfillments              | `GET  /api/wholesaler/{wid}/fulfillments`                                          | ✅ Verified |
| Fulfillment detail             | `GET  /api/wholesaler/{wid}/fulfillments/{ful_id}`                                 | ✅ Verified |
| Start Picking                  | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/start-picking`                   | ✅ Verified |
| Complete Picking               | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/complete-picking`                | ✅ Verified |
| Report Shortage                | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/report-shortage`                 | ✅ Verified |
| Start Packing                  | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/start-packing`                   | ✅ Verified |
| Complete Packing               | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/complete-packing`                | ✅ Verified |
| Ready Dispatch                 | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/ready-dispatch`                  | ✅ Verified |
| Dispatch (truck)               | `POST /api/wholesaler/{wid}/fulfillments/{ful_id}/dispatch`                        | ✅ Verified |
| Pick-by-scan (barcode)         | —                                                                                  | ❌ Missing  |

---

## G. Wholesaler — Shipments (outbound)

| Capability                | Endpoint                                                                       | Status      |
|---------------------------|--------------------------------------------------------------------------------|-------------|
| Shipments dashboard       | `GET  /api/wholesaler/{wid}/shipments/dashboard`                              | ✅ Verified |
| List shipments            | `GET  /api/wholesaler/{wid}/shipments?status=`                                 | ✅ Verified |
| Shipment detail           | `GET  /api/wholesaler/{wid}/shipments/{ship_id}`                               | ✅ Verified |
| Delay shipment            | `POST /api/wholesaler/{wid}/shipments/{ship_id}/delay`                         | ✅ Verified |
| Cancel shipment           | `POST /api/wholesaler/{wid}/shipments/{ship_id}/cancel`                        | ✅ Verified |
| Live control tower map    | `GET  /api/wholesaler/{wid}/control-tower/map`                                 | ✅ Verified |
| Driver directory          | —                                                                              | ❌ Missing  |
| Vehicle directory / CRUD  | —                                                                              | ❌ Missing  |

---

## H. Wholesaler — Retailer Network

| Capability                   | Endpoint                                                                            | Status      |
|------------------------------|-------------------------------------------------------------------------------------|-------------|
| Retailer directory + KPIs    | `GET /api/wholesaler/{wid}/distributors`                                            | ✅ Verified (URL still `/distributors`; payload is retailer-tier after P0 sprint) |
| Retailer detail (90d)        | `GET /api/wholesaler/{wid}/distributors/{distributor_id}/detail`                    | ✅ Verified |
| Onboard / suspend retailer   | —                                                                                   | ❌ Missing  |
| Retailer credit exposure     | —                                                                                   | ❌ Missing  |

---

## I. Wholesaler — Analytics

| Capability                        | Endpoint                                                              | Status      |
|-----------------------------------|-----------------------------------------------------------------------|-------------|
| Wholesaler analytics (fat)        | `GET /api/wholesaler/{wid}/analytics`                                | ✅ Verified |
| Manufacturer-side wholesaler POs  | `GET /api/manufacturer/{mid}/wholesaler-pos`                          | ✅ Verified (cross-tier) |
| Distributor-side wholesaler orders| `GET /api/distributor/{did}/wholesaler-orders`                        | ✅ Verified (cross-tier) |
| Distributor view of incoming WPOs | `GET /api/distributor/{did}/incoming-wholesaler-pos`                  | ✅ Verified |
| Generic role analytics            | `GET /api/analytics?role=wholesaler&entity_id={wid}`                  | ❌ Missing (400 — role not allowed) |

---

## J. Wholesaler — Intelligence

| Capability                | Endpoint                                                              | Status      |
|---------------------------|-----------------------------------------------------------------------|-------------|
| Intel block (rule-based)  | `GET /api/wholesaler/{wid}/analytics → intelligence.*`                | ✅ Verified |
| Generic exec summary      | `GET /api/intel/exec-summary?role=wholesaler&entity_id={wid}`         | ❌ Missing (400 — role not allowed) |
| Generic intel feed        | `GET /api/intel/feed?role=wholesaler&entity_id={wid}`                 | ❌ Missing (400) |
| Intel acknowledge         | —                                                                     | ❌ Missing  |

---

## K. Notifications

| Capability       | Endpoint                                                                            | Status      |
|------------------|-------------------------------------------------------------------------------------|-------------|
| List             | `GET /api/notifications?target_type=wholesaler&target_id={wid}&limit=`              | ✅ Verified |
| Mark one read    | `PATCH /api/notifications/{notif_id}/read`                                          | ✅ Verified |
| Mark all read    | `PATCH /api/notifications/read-all`                                                 | ✅ Verified |
| Preferences      | —                                                                                   | ❌ Missing  |
| Push registration| —                                                                                   | ❌ Missing  |

---

## L. Reports

| Capability         | Endpoint                                                                  | Status      |
|--------------------|---------------------------------------------------------------------------|-------------|
| Shipments CSV      | `GET /api/reports/shipments.csv?role=wholesaler&entity_id={wid}`          | ✅ Verified |
| Inventory CSV      | `GET /api/reports/inventory.csv?role=wholesaler&entity_id={wid}`          | ✅ Verified |
| Orders CSV         | —                                                                          | ❌ Missing  |
| Fulfillments CSV   | —                                                                          | ❌ Missing  |
| Forecast CSV / PDF | —                                                                          | ❌ Missing  |
| Analytics PDF      | —                                                                          | ❌ Missing  |

---

## M. Sabi Copilot (LLM)

| Capability                       | Endpoint                                                | Status      |
|----------------------------------|---------------------------------------------------------|-------------|
| Wholesaler chat                  | `POST /api/wholesaler/{wid}/assistant`                  | ❌ Missing (404) |
| Wholesaler voice transcribe      | `POST /api/wholesaler/{wid}/assistant/transcribe`       | ❌ Missing |
| Wholesaler action execute        | `POST /api/wholesaler/{wid}/assistant/execute`          | ❌ Missing |

> Recommended W1 lift: clone the retailer assistant routes + handlers, swap intent vocabulary (approve/reject/dispatch/replenish). Until then, the mobile app must **not** advertise Sabi for wholesalers.

---

## Summary

| Verified                 | Partial             | Missing                              |
|--------------------------|---------------------|--------------------------------------|
| 48 endpoints             | 2                   | 13                                    |

**Gaps the mobile MVP can live with (no blocker):** transfer, driver directory, vehicle CRUD, bulk approve, CSVs for orders, intel acknowledge, push prefs.

**Gaps the mobile MVP must NOT advertise:** Sabi copilot, intel exec-summary, generic `/api/analytics?role=wholesaler`, deep-link to retailer credit / payments.
