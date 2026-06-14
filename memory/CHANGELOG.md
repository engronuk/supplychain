# CHANGELOG

## 2026-06-14 — Strict 5-tier ownership hierarchy enforcement (P0)

**Architectural correction.** Per explicit user clarification, *ownership* (parent-child)
is strict 1-tier; *visibility* extends downstream; *transactions* are independent of
ownership. The previous model conflated all three.

Final ownership chain (each tier manages ONLY its immediate downstream tier):
```
Manufacturer → Warehouse → Distributor → Wholesaler → Retailer
```

### Data migration
- Re-parented **24 key-account retailers** (Shoprite, Spar, Game, Hubmart, Justrite,
  MarketSquare) from distributors to **region-matched wholesalers** under those same
  distributors.
- Preserved transactional flexibility: each migrated retailer keeps
  `metadata.distributor_id` and `metadata.preferred_supplier_type='distributor'`
  so it can still place purchase orders direct against a distributor.
- Migration is idempotent — re-running prints the validation report only.
- Script: `python -m scripts.migrate_keyaccounts_to_wholesalers`

### Hierarchy validation report
```
Allowed:
  retailers under wholesalers   : 168
  wholesalers under distributors : 36
  distributors under warehouses : 12
  warehouses under manufacturers: 6

Forbidden (must = 0):
  retailers under distributors  : 0   ✓
  retailers under warehouses    : 0   ✓
  retailers under manufacturers : 0   ✓
  wholesalers under warehouses  : 0   ✓
  wholesalers under manufacturers: 0  ✓
  distributors under manufacturers: 0 ✓
```
**PASS — strict ownership hierarchy verified.**

### Distributor dashboard rebuild
- Backend `/api/distributor/{id}/operations-intelligence`:
  - Portfolio entities are now **wholesalers** (direct children), not retailers.
  - New fields: `top_wholesalers`, `attention_wholesalers`,
    `totals.total_wholesalers`, `kpis.active_wholesalers`.
  - Removed: `top_retailers`, `attention_retailers`, `totals.total_retailers`,
    `kpis.active_retailers`.
  - Retailer rollups exposed under `downstream_visibility`
    (`total_retailers`, `active_retailers_30d`).
- Frontend `DistributorDashboard.jsx`:
  - Hero shows Wholesalers / Stars / Growth Opps / At Risk (was Retailers / …).
  - KPI strip now has "Active Wholesalers (30d)".
  - Performance Matrix renamed "Wholesaler Portfolio".
  - `TopWholesalersCard` / `AttentionWholesalersCard` replace the retailer cards.
  - New `DownstreamVisibilityBanner` shows aggregated retailer numbers labeled
    visibility-only.
- `WholesalerNetworkSection.jsx`: removed the "Key-Account Direct Retailers"
  exception block (those retailers are now properly owned by wholesalers).

### Manufacturer dashboard tightening
- Backend `/api/manufacturer/{id}/overview`:
  - New `kpis.warehouses` (direct tier).
  - New `hierarchy: { direct_children, downstream_visibility }` block.
- Frontend KPI strip:
  - "Warehouses · direct tier" KPI replaces the legacy "Active Distributors".
  - "Active Retailers" → "Active Retailers · downstream".
  - Coverage card "Distributor Performance" → "Distributors · visibility".
  - Distributor Intelligence card header now reads "Downstream visibility · 3
    tiers below" so the ownership boundary is unmistakable.

### Warehouse workspace
- Dispatch subtitle: "Send goods to your distributors — your direct downstream tier".
- Returns subtitle: "Manage inbound returns from your distributors (direct downstream tier)".

### Tests
- `/app/backend/tests/test_strict_ownership_hierarchy.py` (9 pytest tests, all PASS).
- Frontend regression via `testing_agent_v3_fork` → 100% verified across
  distributor / manufacturer / warehouse for both tenants (Unilever + FMN).

## 2026-06-14 — Distributor → Wholesaler Network UI live (earlier in day)
- Wired up `WholesalerNetworkSection` in `DistributorDashboard.jsx`.
- Fixed import path inside `WholesalerNetworkSection.jsx`.
- Hardened `RevenueTrendCard` against undefined `trend`.

## Earlier history
See PRD.md "Logistics Command Center Vision" section for dated phase history through 2026-02-13.
