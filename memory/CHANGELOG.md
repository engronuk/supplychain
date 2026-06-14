# CHANGELOG
## 2026-06-14 — Production Sync Endpoint (deploy enabler)

Problem: Preview and production used separate MongoDB clusters (Cloud
Run injects `MONGO_URL` / `DB_NAME` from Secret Manager). Code deploys
left production with whatever data was first seeded, while preview
drifted through dozens of curated changes. After the last push the user
saw FMN at 332 retailers in prod vs the canonical 84 in preview.

### Repairs
- New router: `routes/admin_sync.py`
  - `GET /api/admin/sync/status`  — current counts, last sync marker.
  - `POST /api/admin/sync/diff`   — dry-run delta vs canonical target.
  - `POST /api/admin/sync/apply`  — async wipe-+-rebuild-+-backfill.
- Fire-and-forget pattern: `apply` returns `202 accepted` in <250ms and
  runs the 4-6 minute job in a background asyncio task. `admin_sync_in_flight`
  doc in `seed_meta` acts as a mutex.
- Auth: `X-Admin-Token` header must match `ADMIN_SYNC_TOKEN` env var
  (fail-closed if unset).
- Confirmation: apply requires `confirm: "I_UNDERSTAND_THIS_WIPES_DATA"`
  in the JSON body.
- `scripts/rebuild.py` refactored to expose `run_rebuild(db, log=)` so
  the endpoint can invoke it in-process.
- `scripts/backfill_history.py` refactored to accept an injected `db`
  handle.
- `services/data_backfills.py`: unchanged but its `run_all()` still runs
  on every boot — keeps legacy `wholesaler_orders` rows compatible.
- Runbook: `docs/DEPLOYMENT_RUNBOOK.md` documents the full deploy + sync
  flow including Secret Manager setup and stuck-lock recovery.

### Validation
- Bad token → 401. Missing confirm → 422. Bad confirm → 400. ✓
- Apply returns in 228ms with `status: accepted`. ✓
- Second apply while one is running → `status: already_running`. ✓
- Full apply cycle observed end-to-end in ~5min; `last_admin_sync`
  marker now persists (after fixing the key-mismatch upsert bug).
- Mutex auto-clears via `finally:` block when the task ends.


## 2026-06-14 — Forecast Data Sparsity Fix (P1)

User pain: manufacturer dashboard's 12-month Revenue & Shipment Trend was
flat for 9 of 12 months; Demand Forecast bars rendered as paper-thin
slivers; IntelligenceCenter forecasts card defaulted to a "critical"
filter that had 0 rows ("No critical stockouts predicted — good.").

### Root causes
1. `daily_sales` collection only had ~90 days of data (2026-03-16 →
   2026-06-14) — the 12M window asked for 365 days and got mostly zeros.
2. Each retailer had sales for ~2.5 of 20 SKUs/day (12.5% coverage),
   starving the EWMA velocity model.
3. Four read paths (`manufacturer.py` 4×, `distributor.py` 3×,
   `product_intelligence.py` 1×) queried `quantity_sold` but the
   canonical field is `units` — every read returned 0 units for ~92%
   of `daily_sales` rows.
4. `IntelligenceCenter.ForecastsCard` defaulted to the empty
   "critical" bucket with no count badges to guide the user.

### Repairs
- New idempotent backfill script: `scripts/backfill_history.py` —
  generates dense 12-month daily_sales with DOW seasonality, monthly
  growth, festive lifts, salary-window spikes; inserted 530,509 rows
  (no duplicates, indexed by (retailer, product, date)).
- Routes now read `units` with `quantity_sold` fallback (canonical
  pattern already used by `distributor_intelligence.py` /
  `retailer_inventory.py`).
- `compute_stock_exhaustion()` re-run on dense data: urgency dist
  went from `{0 critical, 19 high}` to `{8 critical, 12 high,
  193 medium, 626 low}` per Unilever tenant.
- `/intel/forecasts/stockout` now returns `urgency_counts` so the UI
  can render count badges per filter.
- `ForecastsCard` smart-defaults to the highest-priority non-empty
  urgency bucket on first load; adds a `low` filter; renders counts
  inline (`critical 8 · high 12 · medium 193 · low 626`).

### Validation
- Before: ₦105.6M 30d revenue, growth -72.4%, 0 critical alerts.
- After:  ₦546.6M 30d revenue, growth +12.8%, 8 critical alerts.
- 12M chart now renders all 12 monthly buckets with realistic
  festive peak (Dec 2025 = ₦535M / 212K units).
- 4/4 regression tests pass: `tests/test_forecast_density.py`.



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
