# Distributor Mobile UX Plan

**Plan date:** 2026-06-19  
**Inputs:** `/app/docs/DISTRIBUTOR_WORKSPACE_FUNCTIONAL_SPEC.md` · `/app/memory/distributor_api_validation.md`  
**Stop point:** This document is an IA plan only. **Do NOT build UI yet.**

---

## 1. Why this can't be a copy of the other mobile apps

| Aspect                 | Retailer                       | Wholesaler                              | Manufacturer                                | **Distributor (this app)**                                          |
|------------------------|--------------------------------|-----------------------------------------|---------------------------------------------|---------------------------------------------------------------------|
| Primary job-to-be-done | Sell at counter + restock      | Fulfill orders + dispatch trucks        | Govern the whole network                    | **Sell down to wholesalers + buy up from manufacturer**             |
| Highest-frequency act  | New sale                       | Approve order · Pick/Pack/Dispatch      | Approve PO · Acknowledge logistics event    | **Approve retailer/wholesaler PO · Place upstream PO · Respond to RFQ** |
| Money flow direction   | Outflow                         | Both                                    | Inflow only                                 | **Both — buy up + sell down**                                       |
| Direct downstream      | None                            | Retailers                               | Distributors → wholesalers → retailers      | **Wholesalers** (retailers are visibility only)                     |
| Direct upstream        | Wholesaler / Distributor       | Distributor                             | None                                        | **Manufacturer**                                                    |
| Logistics              | Inbound only                    | Outbound primary                        | Full control-tower                          | **Bi-directional, lightweight tracker (no map)**                    |
| RFQ workflow           | None                            | None                                    | None                                        | **Yes — respond to quote requests with price/MOQ/lead-time**         |
| Sabi                   | Yes (text + voice)              | No                                      | No                                          | **No — endpoint is 404**                                            |
| Sessions               | Short, in-shop                  | Warehouse floor + manager check-ins     | Manager / executive check-ins               | **Ops manager — desk + field, decision-led + entry-driven**         |

**Implication:** the Distributor mobile app must feel like a **two-way trading hub** — left-hand panel buys from up, right-hand panel sells down — with a single ops dashboard that watches both flows.

---

## 2. Information Architecture

### 2.1 Bottom Tabs (5 — hard cap)

| # | Tab           | Icon              | Surface                                                                       |
|---|---------------|-------------------|-------------------------------------------------------------------------------|
| 1 | **Home**      | LayoutDashboard   | Operations Intelligence — 6 KPIs, AI brief, Top/Attention wholesalers, Stockout, AI actions |
| 2 | **Orders**    | ClipboardList     | Two-way orders hub: `[Buy (mine)]   [Sell (retailer + WHO POs)]   [RFQs]` segmented |
| 3 | **Wholesalers**| Network          | Wholesaler network roster + detail (drill to retailers)                       |
| 4 | **Inventory** | Boxes             | SKU list · search · health filter · Adjust modal                              |
| 5 | **More**      | Menu              | Intelligence · Reports · Notifications · Profile · Sign out                   |

> **Why Orders has 3 view-modes:** the distributor has 3 distinct trade flows that share the same shape (PO + items + status). Splitting them into 3 tabs would crowd the bar; merging them into one with a segmented control is cleaner. The lifecycles do not interfere.

> **Why Wholesalers gets its own tab (not under More):** it's the distributor's *direct* downstream tier and the primary growth lever. A permanent tab keeps it one tap away.

> **Why Inventory is a tab (not under More):** the distributor owns a warehouse; checking stock and adjusting on damage / loss is daily.

> **Why no Logistics tab:** the distributor has no control-tower view — shipments are read-only inside PO detail. Adding a dedicated tab would advertise capability we don't have.

### 2.2 Top-of-screen elements

| Element                        | Visibility                                |
|--------------------------------|-------------------------------------------|
| Distributor name + city        | All tabs                                  |
| Notifications bell + unread    | All tabs                                  |
| "Live" pulse dot               | Home (data freshness < 60s)               |
| Pull-to-refresh                | All scrollable views                      |

### 2.3 Context-sensitive FAB

| Tab          | FAB icon         | Action                                                |
|--------------|------------------|-------------------------------------------------------|
| Orders/Buy   | ✚                | Place new upstream PO (catalogue → cart → submit)     |
| Orders/Sell  | ✓ checklist      | Bulk approve / bulk reject (P1)                       |
| Wholesalers  | Search           | Search wholesalers (also in screen header)            |
| Inventory    | ✚ minus          | Adjust stock (chooses SKU first)                      |

---

## 3. Navigation Hierarchy

```
Home (root)
 ├── AI Operations Brief card (insights + recommended actions)
 ├── 6-KPI strip
 ├── Network Health composite score
 ├── 30-day Revenue Trend
 ├── Top Wholesalers card  → tap → Wholesaler Detail
 ├── Attention Wholesalers card  → tap → Wholesaler Detail
 ├── Stockout Risk card  → tap → SKU detail
 ├── Order Pipeline funnel chip-bar  (pending · approved · dispatched · delivered_30d)
 ├── Downstream Visibility tile (retailers reachable, active 30d)
 └── Refresh OS pill ("Updated X ago" → POST refresh)

Orders
 ├── Segmented: [Buy (mine)] [Sell (Retailer + WHO POs)] [RFQs]
 ├── Buy → list (status filter) → Buy PO Detail (read-only; mfr-side actions only)
 │     └─ FAB (✚): Place upstream PO modal
 ├── Sell → list (combined retailer + WHO inbound), status filter → Sell PO Detail
 │     └─ Actions sheet (state machine — see §6)
 └── RFQs → list (open/responded/closed) → RFQ Detail → Respond sheet (price/MOQ/lead-time/valid-until/notes)

Wholesalers
 ├── KPI strip (totals + active + key-accounts + revenue 90d)
 ├── Search + status filter chips
 ├── Row → Wholesaler Detail
 │     ├─ Wholesaler KPIs (retailers, active 30d, revenue 90d, pending orders)
 │     ├─ Retailer roster (drill into Retailer Detail)
 │     ├─ Recent retailer POs (via this wholesaler)
 │     └─ Incoming wholesaler POs to me (procurement flow)
 └─ Key-account retailers section (direct relationship)

Inventory
 ├── KPI strip (total SKUs · total units · low/out · in-transit)
 ├── Search + health filter chips (Healthy · Low · Out)
 ├── Row → bottom sheet: Adjust (delta + reason)
 └── FAB → Adjust (picks SKU)

More
 ├── Intelligence    → Briefing + Recommendations (ack) + Stockout Forecasts + Delivery ETA + Retailer Health
 ├── Reports         → 2 CSV downloads (Shipments, Inventory)
 ├── Notifications   → list (also in bell)
 ├── Profile         → read-only entity card + sign-out
 └── About / Version
```

---

## 4. Dashboard Structure (Home tab)

> The web dashboard is **15 sections** + 6 KPIs. On mobile we condense aggressively.

### 4.1 Above-the-fold (no scroll, 6"–6.5" screen)

```
┌─────────────────────────────────────────┐
│ Apex Distributors · Apapa  🔔 3 · Live ●│
├─────────────────────────────────────────┤
│ ⚡ AI Brief (top insight, 2 lines)       │  ← ai_brief.insights[0]
├─────────────────────────────────────────┤
│ ₦12.3M │ 3 active │ 12 retailers reach  │  ← 3 hero stats (Rev 90D · Active WHOs · Downstream)
├─────────────────────────────────────────┤
│ ⚡ "2 retailer POs await approval"       │  ← tap → Orders/Sell?status=submitted
└─────────────────────────────────────────┘
```

### 4.2 Below-the-fold (one tap scroll)

1. **Full 6-KPI strip** — Revenue 90D · Active Wholesalers · Pending Orders · Dispatched 30d · Inventory Units · Low Stock SKUs.
2. **Revenue Trend** — 30-day daily area sparkline (`revenue_trend[]`).
3. **Top Wholesalers** — top 5 by revenue. Tap → Wholesaler Detail.
4. **Attention Wholesalers** — bottom 5 by growth. Tap → Wholesaler Detail.
5. **Stockout Risk** — first 5 rows, severity-tagged (`out`=red, `critical`=amber, `low`=yellow). Tap → Inventory tab filtered.
6. **Order Pipeline funnel** — horizontal chip bar `Pending {N} · Approved {N} · Dispatched {N} · Delivered (30d) {N}`. Tap chip → Orders/Sell filtered.
7. **AI Recommendations** — `ai_brief.recommended_actions[]` (3-4 cards w/ CTA deep-links).

### 4.3 Pulled-down "depth" surfaces (not Home)

- **Performance Matrix (BCG 2×2)**, **Regional Coverage**, **Category Performance**, **Inventory Health donut** — all moved to **More → Intelligence** or in-screen drill-downs on the Wholesalers tab.

---

## 5. Quick Actions

### 5.1 Always-visible on Home

No FAB. The action chip ("N retailer POs await approval") doubles as a deep-link to Orders/Sell.

### 5.2 Context-sensitive FAB

See §2.3.

### 5.3 Long-press / swipe shortcuts

| Surface             | Gesture        | Action                                       |
|---------------------|----------------|----------------------------------------------|
| Sell PO row         | Swipe right    | Approve                                      |
| Sell PO row         | Swipe left     | Reject (asks reason)                         |
| RFQ row             | Swipe right    | Open respond sheet                           |
| Wholesaler row      | Swipe right    | Open quick-call (tel: link from contact)     |
| Inventory row       | Swipe right    | Quick adjust (+/- modal)                     |
| Notification        | Swipe          | Mark read                                    |

---

## 6. High-Frequency Tasks (designed for one-handed use)

| Rank | Task                                            | Steps (mobile)                                              | Location           |
|------|-------------------------------------------------|-------------------------------------------------------------|--------------------|
| 1    | Approve a retailer PO                           | Orders/Sell → swipe right                                   | Orders             |
| 2    | Reject a retailer PO with reason                | Orders/Sell → swipe left → reason sheet                     | Orders             |
| 3    | Ship an approved PO                             | Orders/Sell → tap → Process → Ship sheet                    | Orders             |
| 4    | Mark in-transit PO as delivered                 | Orders/Sell → tap → Deliver                                 | Orders             |
| 5    | Place upstream PO with manufacturer             | Orders/Buy → FAB → catalogue → cart → submit                | Orders             |
| 6    | Respond to an RFQ                               | Orders/RFQs → swipe right → respond sheet                   | Orders             |
| 7    | Read AI Operations Brief                        | Home → top card                                             | Home               |
| 8    | Drill into an attention wholesaler              | Home → Attention list → tap                                 | Home/Wholesalers   |
| 9    | Check today's stockout risk                     | Home → Stockout Risk card                                   | Home               |
| 10   | Adjust SKU on damage / loss                     | Inventory → swipe right OR FAB → adjust sheet               | Inventory          |

> A "good" distributor mobile session should let an ops manager do **#1 + #5 + #6** without ever leaving the Orders tab.

---

## 7. Mobile-specific optimizations

### 7.1 Performance

- **Snapshot caching** — `/operations-intelligence` and `/wholesaler-network` cache to disk; advance `as_of` timestamp.
- **Optimistic actions** — Approve / Reject / Adjust reflect immediately; queued if offline; sync on reconnect.
- **Skeleton loaders**, no spinners.

### 7.2 Offline

- **Read-only fallback** — last OS snapshot, wholesaler list, sell-PO list, inventory list cached.
- **No offline create** — Place upstream PO and RFQ Respond must be online.

### 7.3 Scanning / Voice

- **No barcode scanner** in MVP. (Future: receive-stock on warehouse entry.)
- **No voice command** — Sabi endpoints are 404 for distributors.

### 7.4 Maps

- **No live control-tower map** — distributor backend does not surface vehicle positions. Shipment status comes from PO detail payload (`shipment{}` block).

### 7.5 Push notifications

- Backend endpoint **does not exist yet**. In-app bell is the only surface for MVP.

---

## 8. P0 / P1 / P2 Cut

### P0 — Must ship in mobile MVP (production-ready) — **23 items**

1. Login + forgot password + reset + token refresh + sign-out (5)
2. Home: 3-hero KPI + full 6-KPI strip
3. Home: AI Operations Brief (insight card)
4. Home: action chip ("N retailer POs await")
5. Home: 30-day Revenue Trend
6. Home: Top Wholesalers card (top 5)
7. Home: Attention Wholesalers card (top 5)
8. Home: Stockout Risk card (top 5)
9. Home: Order Pipeline funnel chip-bar
10. Home: AI Recommendations cards
11. Refresh OS snapshot (pill action)
12. Orders/Buy list + Buy PO Detail (read-only)
13. Place upstream PO modal (catalogue → cart → submit)
14. Orders/Sell list — combined retailer + WHO POs, status filter
15. Sell PO Detail — full payload, shipment block
16. Sell PO actions — approve / reject / process / ship / deliver / cancel
17. Wholesalers list + search + KPI strip
18. Wholesaler Detail — KPIs + retailers + recent orders + incoming WHO POs
19. Inventory list — search + health filter + KPI strip
20. Inventory Adjust modal — delta + reason
21. Notifications list + mark-read + mark-all-read
22. Profile read-only + Sign-out
23. Plumbing — offline read fallback, optimistic actions, pull-to-refresh, skeleton loaders

### P1 — Ship in v1.1 — **9 items**

24. Performance Matrix (BCG 2×2) on Home or Intelligence
25. Regional Coverage list
26. Inventory Health donut
27. Retailer drill-down (Wholesaler → Retailer Detail)
28. Key-account retailer detail (direct)
29. Product detail (`/distributor/{did}/product/{pid}`)
30. RFQs list + Respond sheet
31. Intelligence Center (Brief + Recommendations ack + Stockout Forecast + Delivery ETA)
32. Executive Analytics (`/distributor/{did}/analytics/executive`)

### P2 — Defer / web-only acceptable — **6 items**

33. Incoming wholesaler POs (cross-tier visibility)
34. Intel Retailer Health peers
35. Intel External signals (weather)
36. Intel Live Feed (**defer until backend 500 is fixed**)
37. Intel Copilot chat
38. CSV reports (Shipments, Inventory)

### Out of scope completely (backend doesn't exist)

- Sabi Copilot for distributors (404)
- Push notifications + preferences
- Driver / Vehicle CRUD
- Payments / credit / invoicing
- Promotions authoring
- CRM / messaging downstream
- Live control-tower map (no vehicle data exposed to distributor)

---

## 9. Answer to the W0 question

> **What are the 20–25 P0 features required for a production-ready Distributor mobile app?**

The **23 P0 items** above. They fall into 8 clusters:

| Cluster                              | P0 count |
|--------------------------------------|----------|
| Auth + Session                       | 5        |
| Home dashboard                       | 9        |
| Orders/Buy                           | 2        |
| Orders/Sell                          | 3        |
| Wholesalers                          | 2        |
| Inventory                            | 2        |
| Notifications + Profile + Plumbing   | 2 (+ universal plumbing)        |

**Hard constraints that fall out of the audit:**

- **`/distributor/{did}/overview` is broken** for org-table distributors — use `/operations-intelligence` instead.
- **`/distributor/{did}/manufacturers` returns 404** for org-table distributors — use `GET /manufacturers` as fallback.
- **`/intel/feed?role=distributor` returns 500** — defer Live Feed to P2 until backend fixes.
- **No Sabi for distributor** — `/distributor/{did}/assistant` is 404. Don't render Sabi UI.
- **No control-tower map** — backend doesn't expose vehicle positions to distributors.
- **No vehicle/driver CRUD** — codes are typed at dispatch only.

---

## 10. Stop point reached

Discovery is complete. No UI built. The next step is **design review of this IA plan** with the user, followed by hi-fi mocks for the 5 bottom-tab surfaces.

**Sign-off needed on:**
1. 5-tab structure (Home / Orders / Wholesalers / Inventory / More)
2. Orders tab merging Buy + Sell + RFQs into one with a segmented control
3. P0/P1/P2 cut (23 / 9 / 6)
4. Out-of-scope confirmations (Sabi, push, drivers, payments, promotions, control-tower map)

*End of plan.*
