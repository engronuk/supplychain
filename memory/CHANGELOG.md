# CHANGELOG

## 2026-06-14 — Strict-tier NAVIGATION enforcement (P0 follow-up)

**The data model was already strict after the morning's ownership migration, but
the UI was still surfacing tier-skipping drill paths.** This change closes the
gap end-to-end. Visibility is allowed to skip levels, navigation is not.

### Sidebar
- Distributor sidebar item "Retailers" → **"Wholesalers"** (`/network`).

### Distributor → `/network` (rewritten)
- `NetworkView.jsx` rewired: the distributor role now renders
  `DistributorWholesalerNetwork`, a Wholesaler-Network table with KPI band,
  filter pills, CSV export, and tier-explicit footer note.
- The legacy "Retailer Intelligence" page for distributors is gone.

### NEW route: `/distributor/:distributorId/wholesaler/:wholesalerId`
- New view `DistributorWholesalerDetail.jsx`. Renders the strict middle tier
  — retailers owned by the selected wholesaler — with breadcrumb
  *Distributor › Wholesalers › <name>*, KPI strip, retailer directory, recent
  retailer-orders, and upstream procurement-to-distributor cards.
- Powered by the existing `GET /api/distributor/{did}/wholesaler/{wid}/detail`
  endpoint (returns 404 on a wholesaler that is not actually a child of the
  given distributor).

### Manufacturer → `/distributors/:distributorId` (drill page)
- Replaced the embedded `RetailerIntelligenceTable` with a new
  `WholesalerNetworkTable` ("Direct downstream · ownership") — clicking any
  wholesaler row drills to `/distributor/:did/wholesaler/:wid`.
- Converted `TopRetailers` + `AttentionList` from `<Link>`-wrapped rows to
  plain `<div>` rows. They remain as visibility-only rollups; retailer rows
  are no longer clickable from this page (preventing manufacturer →
  distributor → retailer skipping the wholesaler tier).
- Cards now display the framing "DOWNSTREAM VISIBILITY · Owned by wholesalers
  — open via Wholesaler Network".

### Retailer detail page tier-awareness
- `DistributorRetailerDetail.jsx` now honors a `?via=<wholesalerId>` query
  param: the "Back" button reads **"Back to wholesaler"** and routes to
  `/distributor/:did/wholesaler/:wid` when the user reached the retailer
  through the strict tier path.

### Tests
- `/app/backend/tests/test_wholesaler_drill_navigation.py` — 5 new pytest
  cases (endpoint shape, retailer membership, 404 on mismatched IDs,
  wholesaler-network listing). All pass.
- Strict-ownership migration validator still PASS (0 forbidden, 168 retailers
  under wholesalers).
- `testing_agent_v3_fork` (iteration_27): backend 100% · frontend 100% ·
  0 console errors across distributor + manufacturer flows.

## 2026-06-14 — Strict 5-tier OWNERSHIP enforcement (earlier today)
See previous block in this file. Re-parented 24 key-account retailers
(Shoprite, Spar, Game, Hubmart, Justrite, MarketSquare) from distributors to
region-matched wholesalers. Ownership ≠ Transactions ≠ Visibility — these
three concepts are now cleanly separated platform-wide.

## 2026-06-14 — Distributor → Wholesaler Network UI live
Wired `WholesalerNetworkSection` into Distributor dashboard; hardened
`RevenueTrendCard` against undefined `trend`.

## Earlier history
See PRD.md "Logistics Command Center Vision" section.
