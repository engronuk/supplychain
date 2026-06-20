# Manufacturer Mobile UX Plan

**Plan date:** 2026-06-19  
**Inputs:** `/app/docs/MANUFACTURER_WORKSPACE_FUNCTIONAL_SPEC.md` · `/app/memory/manufacturer_api_validation.md`  
**Stop point:** This document is an IA plan only. **Do NOT build UI yet.**

---

## 1. Why this can't be a copy of the Wholesaler or Retailer mobile app

| Aspect                 | Retailer mobile                | Wholesaler mobile                       | **Manufacturer mobile (this app)**                                |
|------------------------|--------------------------------|-----------------------------------------|-------------------------------------------------------------------|
| Primary job-to-be-done | Sell at counter + restock      | Fulfill orders + dispatch trucks        | **Govern the whole network — approve, allocate, monitor trucks**  |
| Highest-frequency act  | New sale                       | Approve order · Pick/Pack/Dispatch      | **Approve/allocate distributor PO · Acknowledge logistics event** |
| Direction of money     | Outflow                         | Both                                    | Inflow only (sells down)                                          |
| Inventory mutations    | Auto                            | Manual + frequent                       | Rare (warehouse-owned data is reference, not editable on mobile)  |
| Network span           | 1 supplier                      | ~50 retailers                           | **Entire 5-tier network (warehouses · distributors · wholesalers · retailers)** |
| Logistics              | Inbound only                    | Outbound primary                        | **Full control-tower across all legs**                            |
| Sabi                   | Yes (text + voice)              | No                                      | Logistics Copilot only (in-page; no generic Sabi bubble)          |
| Sessions               | Short, in-shop                  | Warehouse floor + manager check-ins     | **Manager / executive check-ins** — short, info-dense, decision-led|
| Map dependency         | None                            | Single shipment map                     | **Whole-fleet control-tower map**                                 |

**Implication:** the Manufacturer mobile app must feel like an **executive command center**, not a worker tool. Info density is high, but per-screen actions are few and decisive (allocate, approve, acknowledge, dispatch).

---

## 2. Information Architecture

### 2.1 Bottom Tabs (5 — hard cap)

| # | Tab            | Icon              | Surface                                                                       |
|---|----------------|-------------------|-------------------------------------------------------------------------------|
| 1 | **Home**       | LayoutDashboard   | Executive dashboard — KPIs, AI brief, Network Pulse, alerts, stockout risk    |
| 2 | **Orders**     | ClipboardList     | Outbound POs + Allocation (merged: Inbox + Allocation view-modes)             |
| 3 | **Logistics**  | Truck             | Control-tower: events feed (primary), live map (secondary)                    |
| 4 | **Products**   | Package           | Product Intelligence catalogue + create / edit                                |
| 5 | **More**       | Menu              | Warehouses · Distributors · Network Map · Intelligence · Reports · Notifications · Sign out |

> **Why "Orders" merges POs + Allocation:** every PO either has an allocation plan or needs one. Splitting them creates two screens for the same lifecycle. We expose them as **two view-modes inside the Orders tab** (`Inbox · Allocation`) via a segmented control.

> **Why "Logistics" is its own tab (not under More):** the manufacturer audit shows logistics is the densest surface — 8 KPIs, 6 tabs, 4 leg-types, real-time events. It earns a permanent slot.

> **Why "Warehouses" and "Distributors" are under More:** these are reference/admin surfaces — drilled into a few times a day, not every minute. Permanent tab slots would crowd the bar.

### 2.2 Top-of-screen elements

| Element                        | Visibility                                |
|--------------------------------|-------------------------------------------|
| Manufacturer name + tagline    | All tabs                                  |
| Notifications bell + unread    | All tabs                                  |
| "Live" pulse dot               | Home + Logistics (live data tabs)         |
| Pull-to-refresh                | All scrollable views                      |

> **No global FAB.** Unlike Wholesaler, the manufacturer has no single high-frequency mutation; FABs are scoped to the Orders and Products tabs only.

---

## 3. Navigation Hierarchy

```
Home (root)
 ├── AI Executive Brief card (regenerate)
 ├── 5-KPI strip
 ├── Revenue Trend (12-mo sparkline)
 ├── Network Pulse live ticker  (15s polling, cursor)
 ├── Activity Pulse strip       (60s polling)
 ├── Stockout Risk list
 ├── Top Products card
 ├── Pipeline funnel chip-bar   (submitted/approved/in_transit/delivered)
 └── Alerts list

Orders
 ├── Segmented: [Inbox] [Allocation]
 ├── Inbox  → list (status filter) → PO Detail
 │     └─ Actions sheet (state machine — see §6)
 └── Allocation → list grouped by allocation status → Allocation Detail
       ├─ Recommendation card
       ├─ Auto-allocate · Manual-allocate (P1) · Back-order · Reject · Acknowledge
       └─ Back-orders list (sub-tab)

Logistics
 ├── Tabs: [Events] [Map]
 ├── Events → filtered list (severity chips, leg-type chips) → Event sheet (Ack / Bulk-ack)
 ├── Map    → live control-tower (read-only on phone) → Vehicle Detail (sheet)
 ├── Header KPIs: in_transit · delayed · deviations · unacked_critical
 └── Floating "Archive arrived" pill action

Products
 ├── KPI strip: total SKUs · in-network units · low-stock SKUs · revenue 90d
 ├── Search + status filter chips
 ├── Row → Product Detail (sparkline, distributors, retailers, 90d revenue, in-network units)
 ├── FAB → Create Product modal
 └── Refresh PI snapshot (overflow action)

More
 ├── Warehouses     → list → Warehouse Detail → Distributor Network sub-tab
 ├── Distributors   → list / search → Distributor Detail (90d)
 ├── Network Map    → 5-tier hierarchy (P2 on phone, P1 on tablet)
 ├── Intelligence   → Briefing + Recommendations (ack) + Stockout Forecast + Alerts + Delivery ETA + Retailer Health
 ├── Reports        → 2 CSV downloads (Shipments, Inventory)
 ├── Notifications  → list (also in bell)
 ├── Profile        → read-only entity card + sign-out
 └── About / Version
```

---

## 4. Dashboard Structure (Home tab)

> The web dashboard is **15 sections** + 5 KPIs. On mobile we condense aggressively.

### 4.1 Above-the-fold (no scroll, 6"–6.5" screen)

```
┌─────────────────────────────────────────┐
│ Unilever · Network Command Center  🔔 3 │
├─────────────────────────────────────────┤
│ ⚡ AI Exec Brief (2 lines + Regenerate) │  ← IntelExecSummary, role=manufacturer
├─────────────────────────────────────────┤
│ ₦1.2B  │  84 retailers │ 96 net health  │  ← 3 hero stats (Revenue · Active Retailers · Network Health)
├─────────────────────────────────────────┤
│ ⚡ Network Pulse live ticker · "Live ●" │  ← Last 3 cross-tier movements
└─────────────────────────────────────────┘
```

### 4.2 Below-the-fold (one tap scroll)

1. **Full 5-KPI strip** (Revenue · Warehouses · Active Retailers · Active Distributors · Network Health).
2. **Revenue Trend** — 12-mo area sparkline (`revenue_trend.spark[]`).
3. **Activity Pulse strip** — 60s polling throughput chips.
4. **Stockout Risk** — first 5 rows, severity-tagged. "View all" → Products tab filtered to `low/out`.
5. **Top Products** — top 5 SKUs by 90d revenue. Tap row → Product Detail.
6. **Pipeline funnel** — horizontal chip bar `Submitted N · Approved N · In Transit N · Delivered N`. Tap chip → Orders/Inbox filtered.
7. **Alerts** — `alerts[]` rendered as ToneCards (top 3 only).

### 4.3 Pulled-down "depth" pages (not Home)

- **Regional performance**, **Coverage KPIs**, **Categories mix**, **Demand Forecast**, **Distributor table** — all moved to **More → Intelligence** or dedicated detail screens.
- Full hierarchy / network map → **More → Network Map** (P2 phone).

---

## 5. Quick Actions

### 5.1 Always-visible on Home

No FAB. Instead, the **Network Pulse ticker** doubles as a tap-to-deep-link surface (tap a movement → Logistics/Events filtered to that shipment).

### 5.2 Context-sensitive FAB

| Tab        | FAB icon         | Action                                                |
|------------|------------------|-------------------------------------------------------|
| Orders     | ✓ checklist      | Bulk approve / bulk auto-allocate (P1 multi-select)   |
| Logistics  | 🗄 archive        | Archive arrived vehicles (one-tap, cutoff_hours=12)   |
| Products   | + plus           | Create Product modal                                  |

### 5.3 Long-press / swipe shortcuts

| Surface          | Gesture        | Action                                       |
|------------------|----------------|----------------------------------------------|
| PO row           | Swipe right    | Approve                                      |
| PO row           | Swipe left     | Reject (asks reason)                         |
| Allocation row   | Swipe right    | Auto-allocate                                |
| Event row        | Swipe right    | Acknowledge                                  |
| Notification     | Swipe          | Mark read                                    |

---

## 6. High-Frequency Tasks (designed for one-handed use)

| Rank | Task                                          | Steps (mobile)                                              | Location           |
|------|-----------------------------------------------|-------------------------------------------------------------|--------------------|
| 1    | Acknowledge a logistics event                 | Logistics → Events → swipe right                            | Logistics          |
| 2    | Bulk-ack same-severity events                 | Logistics → Events → select severity chip → Bulk-ack pill   | Logistics          |
| 3    | Approve a distributor PO                      | Orders/Inbox → tap row → Approve                            | Orders             |
| 4    | Auto-allocate a pending PO                    | Orders/Allocation → swipe right                              | Orders             |
| 5    | Ship an approved PO                           | Orders/Inbox → tap row → Process → Ship                      | Orders             |
| 6    | Read the AI Executive Brief                   | Home → top card                                             | Home               |
| 7    | Glance at live network movements              | Home → Network Pulse                                        | Home               |
| 8    | Drill into a distributor's health             | More → Distributors → tap row                               | More               |
| 9    | Read today's stockout risk                    | Home → Stockout Risk card                                   | Home               |
| 10   | Archive arrived vehicles for the day          | Logistics → FAB                                             | Logistics          |

> A "good" manufacturer mobile session should let an exec do **#1 + #3 + #6 + #9** in under 60 seconds.

---

## 7. Mobile-specific optimizations

### 7.1 Performance

- **Snapshot caching** — every list call (`/overview`, `/product-intelligence`, `/customer-orders`-equivalent) feeds the same `localStorage`-style cache the web uses. Mobile uses identical patterns (`as_of` timestamps drive freshness).
- **Cursor polling** — Network Pulse uses `since_iso` cursor (already wired). Notifications use `created_at` cursor.
- **Skeleton loaders**, no spinners.

### 7.2 Offline

- **Read-only fallback** — last dashboard snapshot, PO inbox, allocation list cached.
- **Optimistic actions** — Approve / Ack reflect immediately; queued if offline; sync on reconnect.
- **No offline create** — Create Product and Manual-allocate must be online.

### 7.3 Scanning / Voice

- **No barcode scanner** in MVP. The manufacturer does not pick stock on mobile.
- **No voice command** in MVP. Manufacturer Sabi endpoints return 404; only the logistics copilot exists and is in-page chat only.

### 7.4 Maps

- **Single control-tower map** in Logistics tab. Use Google Maps SDK or MapLibre. Phone-screen map is **read-only** (no draw-route gestures). Vehicle markers cluster above 20.
- **Network Map** (5-tier tree) is heavy — defer to tablet / P2.

### 7.5 Push notifications

- Backend endpoint **does not exist yet**. In-app bell is the only surface for MVP.

---

## 8. P0 / P1 / P2 Cut

### P0 — Must ship in mobile MVP (production-ready) — **24 items**

1. Login + forgot password + reset + token refresh + sign-out (5)
2. Home: 3-hero KPI + full 5-KPI strip
3. Home: AI Executive Brief (read + regenerate)
4. Home: Network Pulse live ticker (15s polling + `since_iso` cursor)
5. Home: Activity Pulse strip (60s polling)
6. Home: Stockout Risk card (top 5)
7. Home: Top Products card
8. Home: Pipeline funnel chip-bar
9. Orders Inbox — list, status filter, search
10. PO Detail — full payload + live truck ETA inside payload
11. PO Actions — submit / approve / reject / process / ship / deliver / cancel / duplicate
12. Orders Allocation view — summary + KPIs + per-order list
13. Allocation Detail — recommendation card
14. Allocation actions — auto-allocate · back-order · reject · acknowledge
15. Logistics Events — list, severity chip, leg-type chip
16. Logistics Event Ack + Bulk-ack
17. Logistics Map — live control-tower (read-only on phone)
18. Logistics Header KPIs
19. Products list — search + status filter + KPI strip
20. Product Detail — sparkline + retailers/distributors + in-network units
21. Distributors list (under More) + Distributor Detail
22. Warehouses list (under More) + Warehouse Detail (read-only)
23. Notifications list + mark-read + mark-all-read
24. Profile read-only + Sign-out, pull-to-refresh + skeleton loaders + offline read fallback

### P1 — Ship in v1.1 — **9 items**

25. Manual-allocate order (line-edit)
26. Back-orders list view
27. Wholesaler POs cross-tier monitoring (read-only)
28. Create Product modal
29. Edit Product (inline fields)
30. Refresh PI snapshot
31. Archive arrived vehicles (FAB action)
32. Intelligence Center (Briefing + Recommendations ack + Stockout Forecast + Alerts + Delivery ETA + Retailer Health)
33. Bulk-approve / multi-select POs

### P2 — Defer / web-only acceptable — **7 items**

34. Network Map (5-tier hierarchy view — phone-hostile)
35. Route Planning (preview + dispatch — manager workflow, table-heavy)
36. Delay Predictions tab
37. Demand vs Delivery tab
38. Logistics Copilot chat
39. CSV reports (Shipments + Inventory)
40. Inventory adjust at any owner (admin-only, rare)

### Out of scope completely (backend doesn't exist)

- Sabi Copilot for manufacturers (404)
- Push notifications + preferences
- Driver / Vehicle CRUD
- Payments / credit / invoicing
- Promotions authoring
- CRM / messaging

---

## 9. Answer to the W0 question

> **What are the 20–25 P0 features required for a production-ready Manufacturer mobile app?**

The **24 P0 items** above. They fall into 8 clusters:

| Cluster                              | P0 count |
|--------------------------------------|----------|
| Auth + Session                       | 5        |
| Home dashboard                       | 7        |
| Orders (POs)                         | 3        |
| Orders (Allocation)                  | 3        |
| Logistics                            | 4        |
| Products                             | 2        |
| Network (Distributors + Warehouses)  | 2        |
| Notifications + Profile + Plumbing   | 2        |

**Hard constraints that fall out of the audit:**

- **No Sabi Copilot for manufacturer** — `/manufacturer/{mid}/assistant` returns 404. Do not show a generic copilot bubble.
- **Logistics Copilot** exists but is in-page chat only; defer to P2.
- **`/allocation/pool` requires `warehouse_id`** — never call it without one (gives 502).
- **No vehicle/driver CRUD** — codes are typed at dispatch only; no roster on mobile.
- **No order export / CSV** on mobile in MVP.

---

## 10. Stop point reached

Discovery is complete. No UI built. The next step is **design review of this IA plan** with the user, followed by hi-fi mocks for the 5 bottom-tab surfaces.

**Sign-off needed on:**
1. 5-tab structure (Home / Orders / Logistics / Products / More)
2. Orders Inbox + Allocation merge with segmented control
3. P0/P1/P2 cut (24 / 9 / 7)
4. Out-of-scope confirmations (Sabi, push, drivers, payments, promotions, CRM)

*End of plan.*
