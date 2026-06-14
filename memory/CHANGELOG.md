# CHANGELOG

## 2026-06-14 — Distributor Dashboard wholesaler-network surface (P0 fix)
- Wired `WholesalerNetworkSection` into `DistributorDashboard.jsx` (missing import; page was crashing on render).
- Fixed import path inside `WholesalerNetworkSection.jsx` (`../lib/api` → `@/lib/api`).
- Hardened `RevenueTrendCard` against undefined `trend` array (could be missing while
  snapshot is still computing, causing `Cannot read properties of undefined (reading 'map')`).
- Verified on `unilever.distributor@tradekonekt.io` (Apex Distributors Apapa):
  3 wholesaler cards, 12 retailers in network, ₦35.7M 90d revenue, 2 key-account direct
  (Shoprite Apapa, Spar Ikeja). 0 console errors.

## Earlier history
See PRD.md "Logistics Command Center Vision" section for dated phase history through 2026-02-13.
