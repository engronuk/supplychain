# CHANGELOG

## 2026-06-14 — Full E2E supply-chain certification (PASS)

Comprehensive validation across all 5 tiers. **Certification report:
`/app/test_reports/certification/CERTIFICATION_REPORT.md`**.

### Audit findings + repairs
- Inventory ownership: 2,220 rows · 0 orphans · 0 duplicates across all tiers
  (1.76M units total). **PASS**.
- Order flow: 0 tier-mismatched POs after repair. 108 wholesaler POs that
  skipped the distributor tier were re-routed; 601 distributor orders with
  missing `warehouse_id` were back-filled with the distributor's parent
  warehouse.
- Shipment flow: 50 illegal warehouse-skip shipments re-routed to
  `warehouse → distributor`. Forbidden routes (warehouse→retailer,
  warehouse→wholesaler, manufacturer→anything-but-warehouse) all return 0.
- Hierarchy integrity: 168/168 retailers under wholesalers · 36/36
  wholesalers under distributors · 12/12 distributors under warehouses ·
  6/6 warehouses under manufacturers. **0 forbidden parent-child pairs**.

### Hardening
- `POST /api/wholesaler/{wid}/procurement/orders` now enforces strict-tier
  rule at request-time: `supplier_type` must be `distributor` AND
  `supplier_id` must equal the wholesaler's parent organization id.
- `services/simulator_generators.py` now stamps `warehouse_id` on every
  generated `distributor_orders` doc (eliminates the data leak that produced
  the 592 broken orders).
- `routes/wholesaler.py` transition-to-`delivered` no longer crashes on
  legacy inventory rows missing the `id` field; falls back to composite key.

### Live business simulation
19/19 steps PASS across the strict-tier chain Unilever → Lagos Warehouse →
Apex Distributors → Royal Trading 1 → Family Shop 1 (product: Omo Detergent
1kg). PO-2026-00001 (retailer→wholesaler) and WPO-2026-0271 (wholesaler→
distributor) both walked the full state machine from `draft` to `delivered`
with inventory credited at the wholesaler tier.

### New scripts
- `/app/backend/scripts/audit_supply_chain.py` — full integrity audit
- `/app/backend/scripts/repair_strict_tier_compliance.py` — one-shot repair
- `/app/backend/scripts/simulate_e2e_transaction.py` — live 19-step E2E test

## 2026-06-14 — Manufacturer-side strict-tier navigation (P0 final)
See previous block. Warehouse Network card replaces Distributor Intelligence
on the manufacturer dashboard; /network is warehouse-first; Warehouse Detail
page has a new Distributors tab. 5-hop drill validated end-to-end.

## 2026-06-14 — Strict-tier NAVIGATION (distributor side)
Distributor sidebar "Retailers" → "Wholesalers". `/network` rewritten as a
Wholesaler Network. New `/distributor/:did/wholesaler/:wid` drill page.
Retailer detail tier-aware back navigation.

## 2026-06-14 — Strict 5-tier OWNERSHIP enforcement
Re-parented 24 key-account retailers from distributors to region-matched
wholesalers. Idempotent migration + hierarchy validation report.

## Earlier history
See PRD.md "Logistics Command Center Vision" section.
