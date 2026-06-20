# Distributor API Validation

**Probe date:** 2026-06-19 (preview env)  
**Auth:** `mfr-0001-dst-0001@tradekonekt.io / TradeKonekt2026!`  
**Distributor entity_id:** `f9dfaf08-4ee2-3c64-e96b-983c385625b2` (Apex Distributors — Apapa)

**Legend**  
✅ **Verified** — 200 with expected payload  
🟡 **Partial** — works but limited / requires special params / non-fatal anomaly  
❌ **Missing** — does not exist (404) or rejects distributor (400/422/500)

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

## B. Dashboard / Operations Intelligence

| Capability                       | Endpoint                                                                | Status      |
|----------------------------------|-------------------------------------------------------------------------|-------------|
| **Operations Intelligence (PRIMARY)** | `GET /api/distributor/{did}/operations-intelligence`              | ✅ Verified (6.6 KB live) |
| Refresh OS snapshot              | `POST /api/distributor/{did}/operations-intelligence/refresh`           | ✅ Verified |
| Legacy overview                  | `GET /api/distributor/{did}/overview`                                   | 🟡 404 for org-table distributors (only works for `db.distributors`-table entities). Mobile should ignore. |
| Refresh legacy overview          | `POST /api/distributor/{did}/overview/refresh`                          | 🟡 Same caveat as above |

---

## C. Wholesaler Network (direct downstream)

| Capability                                  | Endpoint                                                                 | Status      |
|---------------------------------------------|--------------------------------------------------------------------------|-------------|
| Wholesaler network                          | `GET /api/distributor/{did}/wholesaler-network`                          | ✅ Verified |
| Wholesaler detail                           | `GET /api/distributor/{did}/wholesaler/{wid}/detail`                     | ✅ Verified (404 for non-network wholesaler — expected) |

---

## D. Retailer Visibility (through wholesaler / key-account direct)

| Capability                              | Endpoint                                                                | Status      |
|-----------------------------------------|-------------------------------------------------------------------------|-------------|
| All retailers in distributor reach      | `GET /api/distributor/{did}/retailers`                                  | ✅ Verified (6.7 KB) |
| Retailer detail (drill-down)            | `GET /api/distributor/{did}/retailer/{rid}`                             | ✅ Verified |
| Product drill-down                      | `GET /api/distributor/{did}/product/{pid}`                              | ✅ Verified |
| Executive analytics                     | `GET /api/distributor/{did}/analytics/executive`                        | ✅ Verified |

---

## E. Procurement — Outbound (mine to manufacturer)

| Capability                  | Endpoint                                                              | Status      |
|-----------------------------|-----------------------------------------------------------------------|-------------|
| Create PO to manufacturer   | `POST /api/distributor/{did}/orders`                                  | ✅ Verified |
| My POs (outbound)           | `GET /api/distributor/{did}/orders`                                   | ✅ Verified |
| List manufacturers I can buy from | `GET /api/distributor/{did}/manufacturers`                       | 🟡 404 for org-table distributors. Fall back to `GET /api/manufacturers` |
| Manufacturers list (global) | `GET /api/manufacturers`                                              | ✅ Verified |

> The manufacturer-side approve/reject/dispatch endpoints (`/api/manufacturer/{mid}/distributor-orders/{order_id}/...`) are **out of scope** for the distributor mobile app — they belong to the manufacturer surface.

---

## F. Procurement — Inbound (retailer POs to me)

| Capability                  | Endpoint                                                                  | Status      |
|-----------------------------|---------------------------------------------------------------------------|-------------|
| List retailer POs to me     | `GET /api/procurement/purchase-orders?distributor_id={did}`               | ✅ Verified (42 KB) |
| PO detail                   | `GET /api/procurement/purchase-orders/{po_id}`                            | ✅ Verified |
| Submit / Approve / Reject   | `POST /api/procurement/purchase-orders/{po_id}/{action}`                  | ✅ Verified |
| Process / Ship / Deliver    | same                                                                      | ✅ Verified |
| Cancel / Duplicate          | same                                                                      | ✅ Verified |

---

## G. Procurement — Quote Requests (RFQs)

| Capability      | Endpoint                                                              | Status      |
|-----------------|-----------------------------------------------------------------------|-------------|
| List quotes     | `GET /api/procurement/quotes?distributor_id={did}`                    | ✅ Verified (empty list today) |
| Quote detail    | `GET /api/procurement/quotes/{quote_id}`                              | ✅ Verified |
| Create quote    | `POST /api/procurement/quotes`                                        | ✅ Verified |
| Respond         | `POST /api/procurement/quotes/{quote_id}/respond`                     | ✅ Verified |
| Close           | `POST /api/procurement/quotes/{quote_id}/close`                       | ✅ Verified |

---

## H. Procurement — Cross-tier visibility

| Capability                          | Endpoint                                                            | Status      |
|-------------------------------------|---------------------------------------------------------------------|-------------|
| Wholesaler→Distributor PO funnel    | `GET /api/distributor/{did}/incoming-wholesaler-pos`                | ✅ Verified (24 KB) |

---

## I. Inventory

| Capability                  | Endpoint                                                                                 | Status      |
|-----------------------------|------------------------------------------------------------------------------------------|-------------|
| List inventory rows         | `GET /api/inventory?owner_type=distributor&owner_id={did}`                              | ✅ Verified |
| Adjust inventory            | `POST /api/inventory/adjust` body `{owner_type:"distributor", owner_id, product_id, delta, reason}` | ✅ Verified |
| Distributor-namespaced inv  | `GET /api/distributor/{did}/inventory`                                                  | ❌ Missing (404 — use generic `/inventory` instead) |

---

## J. Intelligence (LLM + rule-based)

| Capability                | Endpoint                                                                    | Status      |
|---------------------------|-----------------------------------------------------------------------------|-------------|
| Executive Summary         | `GET  /api/intel/exec-summary?role=distributor&entity_id={did}`            | ✅ Verified |
| Regenerate brief          | `POST /api/intel/exec-summary/regenerate`                                   | ✅ Verified |
| Live feed                 | `GET  /api/intel/feed?role=distributor&entity_id={did}&limit=`             | 🟡 500 today — distributor role triggers an internal error; skip on mobile until backend fix |
| Stockout forecasts        | `GET  /api/intel/forecasts/stockout?role=distributor&entity_id={did}`      | ✅ Verified (72 KB) |
| Recommendations           | `GET  /api/intel/recommendations?role=distributor&entity_id={did}`         | ✅ Verified |
| Acknowledge recommendation| `PATCH /api/intel/recommendations/{rec_id}`                                | ✅ Verified |
| Alerts                    | `GET  /api/intel/alerts?role=distributor&entity_id={did}`                  | ✅ Verified (returns `[]` today) |
| External signals          | `GET  /api/intel/external?role=distributor&entity_id={did}`                | ✅ Verified |
| Delivery ETA              | `GET  /api/intel/delivery-eta?role=distributor&entity_id={did}`            | ✅ Verified |
| Retailer health           | `GET  /api/intel/retailer-health?role=distributor&entity_id={did}`         | ✅ Verified |
| Force recompute           | `POST /api/intel/recompute`                                                  | ✅ Verified |
| Copilot chat              | `POST /api/intel/copilot`                                                    | ✅ Verified |

---

## K. Generic Analytics & Reports

| Capability        | Endpoint                                                                | Status      |
|-------------------|-------------------------------------------------------------------------|-------------|
| Generic analytics | `GET /api/analytics?role=distributor&entity_id={did}`                   | ✅ Verified |
| Shipments CSV     | `GET /api/reports/shipments.csv?role=distributor&entity_id={did}`       | ✅ Verified (35 KB) |
| Inventory CSV     | `GET /api/reports/inventory.csv?role=distributor&entity_id={did}`       | ✅ Verified |
| Orders CSV        | —                                                                        | ❌ Missing  |
| Analytics PDF     | —                                                                        | ❌ Missing  |

---

## L. Notifications

| Capability       | Endpoint                                                                            | Status      |
|------------------|-------------------------------------------------------------------------------------|-------------|
| List             | `GET /api/notifications?target_type=distributor&target_id={did}&limit=`             | ✅ Verified (71 KB) |
| Mark one read    | `PATCH /api/notifications/{notif_id}/read`                                           | ✅ Verified |
| Mark all read    | `PATCH /api/notifications/read-all`                                                  | ✅ Verified |
| Preferences      | —                                                                                    | ❌ Missing  |
| Push registration| —                                                                                    | ❌ Missing  |

---

## M. Sabi (distributor-specific)

| Capability                       | Endpoint                                              | Status      |
|----------------------------------|-------------------------------------------------------|-------------|
| Distributor chat                 | `POST /api/distributor/{did}/assistant`               | ❌ Missing (404) |
| Distributor voice transcribe     | `POST /api/distributor/{did}/assistant/transcribe`    | ❌ Missing       |
| Distributor execute action       | `POST /api/distributor/{did}/assistant/execute`       | ❌ Missing       |

---

## Summary

| Verified | Partial | Missing |
|---|---|---|
| **42 endpoints** | 4 | 7 |

**Gaps mobile MVP can ignore:** Sabi for distributor, Orders/Analytics CSV/PDF, push prefs, distributor-namespaced inventory route.  
**Gaps mobile MVP must NOT advertise:** distributor Sabi bubble, push notification settings, the buggy `/intel/feed` (skip until backend ships a fix), the legacy `/overview` route (use `/operations-intelligence`).
