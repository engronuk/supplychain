# CHANGELOG

## 2026-06-14 — Manufacturer-side strict-tier navigation (P0 final)

The full 5-hop ladder is now enforced **on both sides** of the platform:
```
Manufacturer → Warehouse → Distributor → Wholesaler → Retailer
```

### Manufacturer Dashboard
- Replaced the legacy **"Distributor Intelligence"** card with a new
  **"Warehouse Network"** card (`data-testid="warehouse-network-card"`).
  Lists the manufacturer's direct children (warehouses); each row drills
  into `/manufacturer/warehouses/:id`. Sub-header rollup chips display
  downstream counts (distributors / wholesalers / retailers) as visibility,
  but click-through always goes to the warehouse next.

### `/network` (Manufacturer)
- New **Warehouse Hero** strip at the top of the page
  (`data-testid="warehouse-hero"`) — 3 warehouse tiles in a card grid.
- Breadcrumb updated: **NETWORK › WAREHOUSES › DISTRIBUTORS · VISIBILITY**.
- New **`downstream-vis-banner`** alert explicitly directs the user
  through the strict-tier path for navigation, while keeping the existing
  Distributor Network Intelligence analytics as *downstream visibility*.

### Warehouse Detail page (`/manufacturer/warehouses/:id`)
- New **Distributors tab** between Overview and Fulfillment
  (`data-testid="tab-distributors"`). Hosts the warehouse's direct
  children (distributors) with KPIs and a clickable list pointing to
  `/distributors/:did`. Powered by the new
  `GET /api/warehouse/{id}/distributor-network` endpoint.

### Backend
- New endpoint `GET /api/manufacturer/{id}/warehouse-network` returning
  per-warehouse cards with all 4 downstream tiers rolled up (distributors,
  wholesalers, retailers, revenue_90d, inventory, low stock, pending orders).
- New endpoint `GET /api/warehouse/{id}/distributor-network` returning the
  warehouse's direct-child distributors with downstream rollups. 404 on a
  warehouse-id that isn't actually a warehouse organization.

### Tests
- New `/app/backend/tests/test_warehouse_network_navigation.py` — 6 pytest
  cases. All pass.
- Regression `/app/backend/tests/test_wholesaler_drill_navigation.py` — 5/5
  still pass.
- `testing_agent_v3_fork` iteration_28 — 100% backend (11/11) · 100%
  frontend (all data-testids, 5-hop drill, breadcrumb, banner, distributor
  regression) · 0 console errors.

## 2026-06-14 (earlier) — Strict-tier NAVIGATION (distributor side)
Distributor sidebar "Retailers" → "Wholesalers". `/network` rewritten as a
Wholesaler Network. New `/distributor/:did/wholesaler/:wid` drill page.
Manufacturer's distributor-detail page replaced inline RetailerIntel table
with a WholesalerNetworkTable; Top/Attention retailer cards converted to
visibility-only (no click-through). Retailer detail page now respects
`?via=:wid` for tier-aware back navigation.

## 2026-06-14 (earlier) — Strict 5-tier OWNERSHIP enforcement
Re-parented 24 key-account retailers (Shoprite, Spar, Game, Hubmart,
Justrite, MarketSquare) from distributors to region-matched wholesalers.
Migration is idempotent and ships with a hierarchy validation report.

## Earlier history
See PRD.md "Logistics Command Center Vision" section.
