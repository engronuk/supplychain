# TradeKonekt Supply-Chain Certification Report

**Run date:** 2026-06-14
**Tenants:** Unilever (MFR-0001), Flour Mills Nigeria (MFR-0002)
**Audit script:** `/app/backend/scripts/audit_supply_chain.py`
**Repair script:** `/app/backend/scripts/repair_strict_tier_compliance.py`
**E2E simulation:** `/app/backend/scripts/simulate_e2e_transaction.py`
**Evidence directory:** `/app/test_reports/certification/`

---

## TL;DR — Certification Result

| Domain                              | Result   |
|-------------------------------------|----------|
| 1. Product ownership                | **PASS** |
| 2. Inventory flow                   | **PASS** |
| 3. Order flow                       | **PASS** |
| 4. Procurement flow                 | **PASS** |
| 5. Shipment flow                    | **PASS** |
| 6. Dashboard hierarchy              | **PASS** |
| 7. Network-map hierarchy            | **PASS** |
| 8. Data integrity                   | **PASS** |
| 9. Navigation hierarchy             | **PASS** |
| 10. End-to-end live transaction     | **PASS** (19/19) |

**Overall: CERTIFIED.**

---

## 1. Product ownership & stocking validation

```
Products with a valid manufacturer parent ........... 20 / 20  [PASS]
```

**Inventory ownership by tier** (no orphans, no duplicates):

| Tier         | Records | Valid | Invalid | SKUs | Units      |
|--------------|---------|-------|---------|------|------------|
| manufacturer | 0       | 0     | 0       | 0    | 0          |
| warehouse    | 60      | 60    | 0       | 20   | 490,050    |
| distributor  | 120     | 120   | 0       | 20   | 661,271    |
| wholesaler   | 360     | 360   | 0       | 20   | 363,860    |
| retailer     | 1,680   | 1,680 | 0       | 20   | 244,867    |
| **TOTAL**    | **2,220** | **2,220** | **0**   | **20** | **1,760,048** |

- `[PASS]` All inventory rows have a valid owner_id (0 orphans).
- `[PASS]` No duplicate `(owner_id × product_id)` inventory rows.

---

## 2. Order flow validation

| Test                                                            | Count | Result |
|-----------------------------------------------------------------|-------|--------|
| Retail purchase_orders (`supplier_type=wholesaler`)             | 980   | OK     |
| Retail purchase_orders (`supplier_type=distributor`)            | 169   | OK     |
| Retailer → Wholesaler POs reference correct tiers               | 0 mismatches | **PASS** |
| Distributor → Retailer direct POs (key-account flow)            | 169   | OK     |
| Distributor → Retailer POs WITHOUT key-account permission       | 0     | **PASS** |
| Wholesaler → Distributor POs reference correct tiers            | 0 mismatches | **PASS** |
| Distributor → Warehouse orders reference correct tiers          | 0 mismatches | **PASS** |

**Workflow status distribution** — full lifecycle is exercised in seeded data:

```
purchase_orders                  draft:54, submitted:219, approved:125, picking:71,
                                 packed:63, shipped:120, in_transit:100, delivered:282,
                                 closed:61, rejected:54
wholesaler_purchase_orders       draft:8, submitted:67, approved:16, picking:7,
                                 packed:5, shipped:48, in_transit:19, delivered:84,
                                 closed:10, rejected:5
distributor_orders               draft:1, submitted:13, approved:513, picking:3,
                                 packed:7, allocated:10, partially_allocated:8,
                                 awaiting_allocation:12, fulfillment_in_progress:12,
                                 back_ordered:8, shipped:9, in_transit:7,
                                 completed:40, rejected:9, closed:1
requests                         pending:9, approved:7, rejected:6, fulfilled:7
replenishment_requests           open:126, pending:10
```

Repairs applied in this run:
- **108** wholesaler POs that targeted `manufacturer`/`warehouse` (skip-tier procurement)
  were re-routed to the wholesaler's parent distributor.
- **592 + 9** distributor orders with `warehouse_id=NULL` were back-filled with the
  distributor's parent warehouse.
- The wholesaler-procurement endpoint now enforces strict-tier rule at
  request-time (`supplier_type='distributor'` only, and `supplier_id` must equal
  the wholesaler's parent organization id).
- The background simulator (`services/simulator_generators.py`) now writes
  `warehouse_id` on every generated distributor_order.

---

## 3. Logistics / Shipment flow validation

**Shipment route distribution** (after repair):

| Route                          | Count | Result |
|--------------------------------|-------|--------|
| wholesaler → retailer          | 477   | OK     |
| warehouse → distributor        | 456   | OK     |
| distributor → wholesaler       | 89    | OK     |
| distributor → retailer (key-account direct) | 86 | OK |
| warehouse → warehouse (inter-WH transfer)   | 40 | OK |
| wholesaler → distributor (return flow)      | 25 | OK |
| manufacturer → warehouse                    | 21 | OK |

**Forbidden routes (must = 0):**

| Forbidden route             | Count | Result |
|-----------------------------|-------|--------|
| warehouse → retailer        | 0     | **PASS** |
| warehouse → wholesaler      | 0     | **PASS** |
| manufacturer → retailer     | 0     | **PASS** |
| manufacturer → wholesaler   | 0     | **PASS** |
| manufacturer → distributor  | 0     | **PASS** |

- `[PASS]` Distributor → Retailer shipments are all key-accounts (`0 violators`).
- Repair: **50** shipments routed `warehouse→retailer` (23) and `warehouse→wholesaler`
  (27) were re-routed to `warehouse→distributor` of the rightful owning distributor.
  `_legacy_to_role` / `_legacy_to_id` preserved on each fixed doc for audit.

**Shipment status distribution** — every state in the lifecycle is exercised:

```
shipments         draft:3, awaiting_approval:3, awaiting_dispatch:10, picking:20,
                  loaded:15, shipped:132, in_transit:60, delayed:5,
                  received:527, completed:45, delivered:401, pending:3
wholesaler_shipments delivered:92, in_transit:1
```

---

## 4 & 9. Dashboard & Navigation hierarchy

(Verified by iteration_26 + iteration_27 + iteration_28 — see `/app/test_reports/`.)

| Tier        | Direct children                  | Result |
|-------------|----------------------------------|--------|
| Manufacturer | 6 Warehouses (only)             | **PASS** |
| Warehouse   | 12 Distributors (only)           | **PASS** |
| Distributor | 36 Wholesalers (only)            | **PASS** |
| Wholesaler  | 168 Retailers (only)             | **PASS** |
| Retailer    | none                             | **PASS** |

- `Dashboard cards` — Manufacturer Dashboard shows Warehouse Network (3 cards),
  not Distributor Intelligence. Distributor dashboard shows Wholesaler Network.
- `Drill paths` — strict 5-hop ladder verified by `testing_agent_v3_fork`:
  Dashboard → Warehouse → Distributors tab → Distributor → Wholesalers →
  Wholesaler → Retailers. No skip is possible.
- `Network views` — `/network` for manufacturer is warehouse-first;
  for distributor it is wholesaler-first; legacy retailer-direct tables
  removed or converted to visibility-only.

---

## 5. Network-map hierarchy

| Rule                                  | Count | Result |
|---------------------------------------|-------|--------|
| Retailers parented under wholesaler   | 168 / 168 | **PASS** |
| Wholesalers parented under distributor | 36 / 36 | **PASS** |
| Distributors parented under warehouse  | 12 / 12 | **PASS** |
| Warehouses parented under manufacturer | 6 / 6   | **PASS** |
| Retailers under distributor (forbidden) | 0     | **PASS** |
| Retailers under warehouse (forbidden)   | 0     | **PASS** |
| Retailers under manufacturer (forbidden) | 0    | **PASS** |
| Wholesalers under warehouse (forbidden) | 0     | **PASS** |
| Wholesalers under manufacturer (forbidden) | 0  | **PASS** |
| Distributors under manufacturer (forbidden) | 0 | **PASS** |

---

## 6. End-to-end live business simulation

Real transaction executed via the production API endpoints.
Ladder used: **Unilever → Lagos Warehouse → Apex Distributors (Apapa) →
Royal Trading 1 → Family Shop 1**, product = *Omo Detergent 1kg*.

| Step | API call | Result |
|------|----------|--------|
| 1 | Retailer login (`POST /api/auth/login`) | **PASS** |
| 2 | Full ladder M→W→D→Wh→R resolved | **PASS** |
| 3 | Found product to order | **PASS** |
| 4 | Retailer creates PO against wholesaler (`POST /api/procurement/purchase-orders`, PO-2026-00001) | **PASS** |
| 5 | Wholesaler login | **PASS** |
| 6 | PO workflow → approved | **PASS** |
| 7 | PO workflow → picking | **PASS** |
| 8 | PO workflow → shipped | **PASS** |
| 9 | PO workflow → delivered | **PASS** |
| 10 | Wholesaler creates PO against distributor (`POST /api/wholesaler/{wid}/procurement/orders`, WPO-2026-0271) | **PASS** |
| 11 | Wholesaler PO transition → submit | **PASS** |
| 12 | Wholesaler PO transition → approve | **PASS** |
| 13 | Wholesaler PO transition → allocate | **PASS** |
| 14 | Wholesaler PO transition → ship | **PASS** |
| 15 | Wholesaler PO transition → deliver (credits wholesaler inventory) | **PASS** |
| 16 | Inventory snapshot @ warehouse (10 records) | **PASS** |
| 17 | Inventory snapshot @ distributor (10 records) | **PASS** |
| 18 | Inventory snapshot @ wholesaler (10 records) | **PASS** |
| 19 | Inventory snapshot @ retailer (10 records) | **PASS** |

**E2E: 19/19 steps PASS.**

---

## Fixes applied during this certification run

| # | File / Endpoint | Change |
|---|-----------------|--------|
| 1 | `services/simulator_generators.py` | Simulator now stamps `warehouse_id` on every `distributor_orders` doc it generates. |
| 2 | `scripts/repair_strict_tier_compliance.py` (NEW) | One-shot repair: re-route skip-tier wholesaler-POs (108), back-fill missing warehouse_ids (601), re-route illegal warehouse shipments (50). |
| 3 | `routes/wholesaler.py` | `POST /wholesaler/{wid}/procurement/orders` now enforces strict-tier rule: supplier_type must be `distributor` AND supplier_id must equal the wholesaler's parent. |
| 4 | `routes/wholesaler.py` | PO transition → `delivered` no longer crashes when a legacy inventory row is missing `id`; falls back to composite key match. |
| 5 | `scripts/audit_supply_chain.py` (NEW) | Comprehensive audit covering products / inventory / orders / shipments / hierarchy. Returns non-zero exit code on any failure. |
| 6 | `scripts/simulate_e2e_transaction.py` (NEW) | Live 19-step E2E business simulation through real API endpoints. |

---

## Re-validation instructions

```bash
cd /app/backend
python -m scripts.audit_supply_chain         # static integrity audit
python -m scripts.simulate_e2e_transaction   # live 9-stage transaction
```

Both must report `PASS` to maintain certification.
