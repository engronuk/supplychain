# CHANGELOG
## 2026-06-15 — End-to-end procurement ↔ logistics sync

User reported a wholesaler PO (WPO-2026-00005) in `in_transit` status
was not visible on the manufacturer's Logistics Command Center under
the "Wholesalers" toggle — meaning the procurement modules and the
Control Tower were disconnected.

### Root cause
- `services/control_tower_sim.py:bridge_wholesaler_shipments` was
  reading from the empty/legacy `wholesaler_shipments` collection.
- Real wholesaler procurement writes into `wholesaler_purchase_orders`.
- Real retailer procurement (incl. Sabi-placed orders) writes into
  `purchase_orders` with `supplier_type="wholesaler"`.
- Neither table was being read by any bridge, so no `shipments` +
  `vehicles` got minted when a PO went `in_transit`.
- Net effect: the map only saw factory→warehouse and warehouse→distributor
  trucks (factory-side simulator), and never the legs driven by real
  procurement.

### Repair
- Rewrote `bridge_wholesaler_shipments` as a TWO-leg procurement bridge:
  1. **Distributor → Wholesaler**: scans `wholesaler_purchase_orders`
     for `status ∈ {allocated, shipped, in_transit}` without a
     `mirror_shipment_id`. Mints a real `shipments` doc + spawns a
     vehicle via `_spawn_vehicle()`. Locks the PO with
     `mirror_shipment_id`.
  2. **Wholesaler → Retailer**: scans `purchase_orders` for
     `supplier_type=wholesaler` in the same active statuses. Walks the
     wholesaler's parent chain to find the manufacturer, then mints
     shipment+vehicle. Same locking.
- Emits a `shipment_created` event for both legs so the activity feed
  picks them up.
- Bridge already runs every simulator tick, so any new PO from the
  procurement UI or from Sabi auto-mirrors within seconds.

### Validation
- WPO-2026-00005 (Apex Distributors → Royal Trading 1, 1,046 units)
  now appears on the map as truck `TK-843`, status `in_transit`,
  destined for Crown Bulk Mart 2, classified `distributor_to_wholesaler`.
- Manufacturer Control Tower fleet count jumped from 195 → 622:
  · warehouse_to_distributor: 322
  · wholesaler_to_retailer:   212
  · manufacturer_to_warehouse: 54
  · distributor_to_wholesaler: 29
  · distributor_to_retailer:    5
- All four toggle filters now show populated truck counts.

## 2026-06-15 — Sabi · true copilot (orders that actually happen)

User report (screenshot): "Place order for Royco 10 units" → Sabi
replied "Order placed" but the JSON action block leaked into the bubble,
no toast appeared, and nothing showed up on the procurement page.

### Three root causes
1. **JSON leaked into the spoken reply.** The backend's regex only
   matched ```` ```json … ``` ```` fenced blocks; Gemini sometimes
   returned the JSON bare. So `action` came back as `None`, the frontend
   never called `/execute`, and the user saw the raw `{...}` in the chat.
2. **Reorder went to the wrong table.** `/execute` created a legacy
   `requests` doc with `distributor_id` (which is null in the 5-tier
   model — retailers reach distributors via wholesalers). The
   procurement page reads `purchase_orders`, so the order was
   invisible.
3. **Product matcher was too loose.** "Royco Classic 100s" collapsed
   onto "Lipton Yellow Label 100s" because they share the token "100s".

### Repairs
- `routes/assistant.py`:
  - JSON extraction now tries three patterns (fenced-with-lang,
    fenced-bare, inline-`{"action": …}`) and strips them all from the
    spoken reply. Belt-and-braces regex cleans any leftover ``` fences.
  - Reorder execute path rewritten: creates a real `PurchaseOrder` doc
    with proper `po_number`, `supplier_type="wholesaler"`,
    `total_amount`, `status_history`. Notifies the wholesaler. Returns
    `po_id`, `po_number`, `total`, `resolved`, `unresolved` so the UI
    can speak naturally.
  - Smarter product matcher: brand-token-anchored — the first token of
    the user's request must overlap the candidate product's tokens, so
    "Royco" never matches "Lipton".
- `services/retailer.py`:
  - System prompt tightened: "Never narrate the JSON. Wrap it strictly
    in ```json ... ``` at the end. Speak naturally in 1-2 sentences."
  - Daily-sales scope added to the context (today, yesterday, last 7 days).
- `components/RetailerAssistantBubble.tsx`:
  - Client-side `sanitizeReply()` strips any JSON leftovers the backend
    missed. Defence in depth.
  - On `/execute` success the toast surfaces the actual PO number +
    total ("PO PO-2026-00004 placed · ₦15,350"). A confirmation turn
    is appended to the chat with the PO number so the operator has a
    permanent record without scanning the toast.
  - Unresolved products surface a specific "Couldn't find: X" error
    instead of the generic one.

### Validation
- "Royco Classic 100s" → PO-2026-00003 · ₦22,000 ✓
- Multi-line "Royco + Knorr Beef" → both resolved correctly ✓
- "Coca Cola" (not in catalog) → 400 with unresolved list ✓
- All Sabi-placed POs visible on Procurement → Purchase Orders ✓
- Wholesaler receives a notification on PO submit ✓

## 2026-06-15 — Retailer Dashboard + Inventory Command Center fix (P0)

User report: retailer dashboard and retailer inventory command center
were blank on both preview and production with "Failed to load" toast.

### Root cause
2,220 of 2,224 inventory rows were seeded **without** an `id` field, and
2,222 were missing `reorder_level`. The legacy data came from
`scripts/rebuild.py` which used an older inventory shape. Three
downstream consumers crashed:
- `routes/retailer_inventory.py:169` — `inv["id"]` → KeyError
- `routes/retailer_os.py:114` — `i["reorder_level"]` → KeyError
- `services/simulator_generators.py:181` — `row["id"]` → KeyError
  (this was also the source of the 1Hz simulator log spam)

The dashboard further used `Promise.all` so ONE 500 wiped every panel.

### Repairs
- **Inventory backfill** — stamped `id=uuid4` and
  `reorder_level=max(10, 20% of qty)` on 2,220+ rows. Wired into
  `services/data_backfills.py` so any future env (incl. production after
  the next Sync Now) gets the same repair on boot.
- **Defensive reads** — `retailer_inventory.py`, `retailer_os.py`,
  `simulator_generators.py`, and `services/retailer.py` now use
  `.get("id")` / `.get("reorder_level", N)` with fallbacks. The
  enrichment service also normalises every row so downstream consumers
  can rely on the fields existing.
- **Manufacturer-id backfill** also rolled into `data_backfills.run_all()`
  so the orphaned-trucks fix from yesterday auto-applies on every boot.
- **Dashboard resilience** — `RetailerDashboardV2.tsx` switched from
  `Promise.all` to `Promise.allSettled`. One bad panel no longer blanks
  the whole page; the operator sees a focused error listing which panels
  failed.

### Validation
- `/api/retailer/{id}/insights` → 200 ✓
- `/api/retailer/{id}/inventory-command-center` → 200 ✓
- Visual: dashboard shows ₦110,450 today's sales, 88/100 stock score,
  AI insights ✓
- Inventory CC shows ₦4.3M value, 10 SKUs, donut, AI reorder cards ✓
- Simulator KeyError log spam silenced ✓

## 2026-06-15 — Logistics map · leg-type toggles

User wanted visibility into the upstream legs of the supply chain on the
Control Tower map. Added a filter row showing:
- **All**  (every active vehicle)
- **Distributors** *from warehouses*  (Warehouse → Distributor)
- **Wholesalers** *from distributors*  (Distributor → Wholesaler)
- **Retailers** *from wholesalers*  (Wholesaler → Retailer)

Each chip displays a live count and the map collapses to just that leg
on click. Footer reads `filtered · X moving · Y delivered · Z exception(s)`
when a non-default filter is active.

### Backend
- `/api/logistics/control-tower` now joins each vehicle to its referenced
  shipment and stamps `leg_type` + `from_role`/`to_role` on the response
  fleet array.
- One-time backfill: `scripts/backfill_mfr_ids.py` patched 652 orphaned
  shipments and 119 orphaned vehicles missing `manufacturer_id` (legacy
  data from the rebuild seeders). Future inserts from the simulator
  already set manufacturer_id correctly.

### Frontend
- `ControlTowerMap.jsx`: new `LegChip` component, `legFilter` state,
  filtered `fleet` + watchlist + footer stats. Default `all`.
- data-testid: `map-leg-filter`, `map-leg-{all|distributors|wholesalers|retailers}`.

## 2026-06-14 — Sync Now UX simplified (drop token gate)

- Auth on `/api/admin/sync/*` now uses the same super_admin JWT as the
  rest of the admin console — no separate `ADMIN_SYNC_TOKEN` paste in
  the UI.
- `X-Admin-Token` header is kept as an optional escape-hatch for curl /
  CI use, but it is no longer required.
- `SyncPanel.jsx` opens straight into the control surface; the
  Lock/Unlock screen is removed.
- Backend dual-auth dependency: `_require_super_admin_or_token(request,
  x_admin_token)` — JWT path runs `require_role("super_admin")`, header
  path bypasses if it matches the env var.
- Verified: anon → 401 · header token → 200 · super_admin JWT → 200 ·
  non-admin JWT → 403.

## 2026-06-14 — Sync Now UI panel

Added a self-service Sync surface to `/admin` (Super Admin Console → Sync tab):
- Token gate (paste `ADMIN_SYNC_TOKEN`, held only in-tab).
- Live count cards per tier (current vs canonical target, green-tick when aligned).
- 4-step indicator: Wipe & Rebuild → Backfill → Recompute → Done.
- "Preview Diff (dry run)" pulls the org-delta + the list of collections that would be wiped.
- "Sync Now (wipe & rebuild)" opens a confirmation modal with two toggleable options (backfill history, recompute forecasts) and a destructive-action button.
- Polls `/status` every 5 s while a sync is in flight so the operator sees live progress.
- Files: `frontend/src/views/admin/SyncPanel.jsx` (new); `frontend/src/lib/api.js` (added `SyncApi`); `frontend/src/views/SuperAdminConsole.jsx` (new Sync tab wired).

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
