# Wholesaler Mobile UX Plan

**Plan date:** 2026-06-18  
**Inputs:** `/app/docs/WHOLESALER_WORKSPACE_FUNCTIONAL_SPEC.md` · `/app/memory/wholesaler_api_validation.md`  
**Stop point:** This document is an IA plan only. **Do NOT build UI yet.**

---

## 1. Why this can't be a copy of the Retailer mobile app

| Aspect                | Retailer mobile                                      | Wholesaler mobile (different)                                |
|-----------------------|------------------------------------------------------|--------------------------------------------------------------|
| Primary job-to-be-done| **Sell at counter + restock my store**                | **Fulfill incoming retailer orders + dispatch trucks**       |
| Highest-frequency act | New sale (POS-like)                                  | Approve order · Pick / Pack · Dispatch                       |
| Money flow direction  | Outflow (buy from wholesaler)                        | Both directions (sell down, buy up)                          |
| Inventory mutations   | Almost none manually (auto-decrement on sale)        | **Receive · Adjust · Cycle-count** — manual + frequent       |
| Network               | Read-only (suppliers list)                           | Read + Action — approve, ship, follow up retailers           |
| Logistics             | Inbound only (track incoming)                        | Outbound primary, inbound secondary                          |
| Sabi                  | Yes (text + voice)                                   | Not yet (W1 lift)                                            |
| Sessions              | Short, frequent, in-shop                             | Mixed: warehouse floor (long, scan-heavy) + manager check-ins |

**Implication:** the Wholesaler mobile app must feel like a **warehouse + ops control center**, not a POS.

---

## 2. Information Architecture

### 2.1 Bottom Tabs (5 — hard cap)

| # | Tab         | Icon          | Surface                                                                       |
|---|-------------|---------------|-------------------------------------------------------------------------------|
| 1 | **Home**    | LayoutDashboard | Dashboard — KPIs, stockout watchlist, AI insights, action shortcuts          |
| 2 | **Orders**  | ClipboardList | Customer orders inbox + fulfillment pipeline (merged)                         |
| 3 | **Inventory**| Boxes        | Stock catalogue · receive · adjust · movements                                |
| 4 | **Shipments**| Truck         | Outbound shipments — list, detail, live ETA                                   |
| 5 | **More**    | Menu          | Procurement · Retailers · Analytics · Intelligence · Reports · Notifications · Sign out |

> Rationale for merging Orders + Fulfillment into one tab: every customer-order detail naturally flows into its fulfillment record. On mobile, two top-level tabs for the same lifecycle would fracture the mental model. We expose **two view-modes inside the Orders tab** (Inbox · Pipeline) via a segmented control.

### 2.2 Why "Procurement" and "Retailers" are inside "More"

- **Procurement** is a weekly task (place upstream POs), not a daily one. Manager-only.
- **Retailers** is reference data + occasional drill-in for a churning customer. Doesn't need a permanent tab slot.

### 2.3 Top-of-screen elements

| Element                        | Visibility                                   |
|--------------------------------|----------------------------------------------|
| Wholesaler name + city         | All tabs                                     |
| Notifications bell + unread    | All tabs                                     |
| Quick scan FAB (barcode)       | Floating on Orders & Inventory tabs only     |
| Pull-to-refresh                | All scrollable views                         |

---

## 3. Navigation Hierarchy

```
Home (root)
 ├── Dashboard cards (read-only; tap → deep-link)
 └── Quick actions (3 max — see §5)

Orders
 ├── Segmented: [Inbox] [Pipeline]
 ├── Inbox  → list (status filter) → Order Detail
 │     └─ Actions sheet: Approve · Reject · Modify · Cancel
 └── Pipeline → list grouped by stage → Fulfillment Detail
       └─ Stage action: Start Picking → Complete → Start Packing → Complete → Ready → Dispatch
       └─ Report Shortage (slide-over)

Inventory
 ├── Tabs: [Catalogue] [Movements]
 ├── Catalogue → SKU row → Bottom sheet: Adjust / Cycle Count
 ├── FAB → Receive Stock (modal)
 └── Search + health filter chips

Shipments
 ├── Status chips: All · In Transit · Delivered · Delayed
 ├── List → Shipment Detail (timeline + live truck card)
 └─── Actions: Delay · Cancel

More
 ├── Procurement      → PO list → Detail → state transition sheet
 ├── Retailers        → list/search → Retailer Detail (90d)
 ├── Analytics        → 4 simplified cards (Overview / Inventory / Retailers / Forecast)
 ├── Intelligence     → Briefing + Opportunities + Risks + Actions
 ├── Reports          → 2 CSV downloads
 ├── Notifications    → list (already in bell, but full page surface here)
 ├── Profile          → Read-only entity card + sign-out
 └── About / Version
```

---

## 4. Dashboard Structure (Home tab)

> The web dashboard is 8 KPIs + 3 cards. On mobile we condense.

### 4.1 Above-the-fold (no scroll, 6"–6.5" screen)

```
┌─────────────────────────────────────────┐
│ Royal Trade Partners · Port Harcourt    │
├─────────────────────────────────────────┤
│  ⚡ Action chip: "5 orders awaiting"     │  ← deep-link to Orders/Inbox?status=submitted
├─────────────────────────────────────────┤
│  ₦39.4 M    │  4 active │ 0.15× turnover│  ← 3 hero stats (Inventory Value · Retailers · Turnover)
├─────────────────────────────────────────┤
│  [ Receive Stock ]  [ Dispatch Truck ]  │  ← Quick Actions
└─────────────────────────────────────────┘
```

### 4.2 Below-the-fold (one tap scroll)

1. **Stockout Watchlist** — first 5 rows with severity chip. "View all" → Inventory tab w/ filter=out.
2. **Today's Pipeline** — horizontal funnel: `Submitted N → Approved N → Picking N → Packed N → Dispatched N`. Tap a stage → Orders/Pipeline filtered to it.
3. **Incoming + Outgoing Shipments** — two compact cards.
4. **AI Insights** — vertical list of `ToneCard`s (top 3 only).

### 4.3 Pulled-down "depth" pages (not Home)

- Full 8-KPI strip lives on `More → Analytics → Overview`.
- Inventory Health donut lives on `More → Analytics → Inventory`.

---

## 5. Quick Actions

### 5.1 Always-visible on Home (max 2)

| Action             | Why it's on Home                                               |
|--------------------|----------------------------------------------------------------|
| **Receive Stock**  | Highest-frequency hands-on action when trucks arrive at the hub|
| **Dispatch Truck** | The most "checkpoint" moment in the day; manager-confirms      |

### 5.2 Context-sensitive FAB

| Tab        | FAB icon          | Action                                                 |
|------------|-------------------|--------------------------------------------------------|
| Orders     | ✓ checklist        | Bulk approve mode (toggle multi-select)                |
| Inventory  | + plus             | Receive Stock                                          |
| Shipments  | 📡 broadcast       | Track-by-tracking-code (jump to detail)                |

### 5.3 Long-press / swipe shortcuts

| Surface          | Gesture                       | Action                                |
|------------------|-------------------------------|---------------------------------------|
| Order row        | Swipe right                   | Approve                               |
| Order row        | Swipe left                    | Reject (asks reason in sheet)         |
| Inventory row    | Swipe right                   | Quick adjust (+/- modal)              |
| Notification     | Swipe                         | Mark read                             |

---

## 6. High-Frequency Tasks (designed for one-handed use)

| Rank | Task                                | Steps (mobile)                       | Location              |
|------|-------------------------------------|--------------------------------------|-----------------------|
| 1    | Approve a customer order            | Open Orders/Inbox → tap row → Approve| Orders                |
| 2    | Bulk approve same-retailer orders   | FAB → select N → Approve             | Orders                |
| 3    | Mark fulfilment stage complete      | Pipeline tab → row → stage button    | Orders/Pipeline       |
| 4    | Dispatch a truck                    | Pipeline → Ready row → Dispatch sheet| Orders/Pipeline       |
| 5    | Receive stock (after delivery in)   | Home FAB or Inventory FAB → Receive  | Home / Inventory      |
| 6    | Adjust a SKU after damage           | Inventory → row → Adjust             | Inventory             |
| 7    | Check shipment ETA for a retailer's call | Shipments → tracking code search| Shipments             |
| 8    | Flag a delayed shipment             | Shipments → row → Delay (reason+ETA) | Shipments             |
| 9    | See today's revenue trend           | Home → "Today's Pipeline" tile       | Home                  |
| 10   | Read AI briefing                    | More → Intelligence                  | More                  |

> A "good" wholesaler mobile experience should let an ops manager do **#1 + #5 + #4** without ever leaving the Orders tab.

---

## 7. Mobile-specific optimizations

### 7.1 Performance

- **Snapshot caching** — every list call (`/orders`, `/inventory`, `/shipments`) feeds the same `localStorage` pattern already used by `retailerAnalyticsService.ts`. Mobile uses identical patterns.
- **Long-poll cursors** — Notifications + Network Pulse should use the `since_iso` cursor pattern already in place (see retailer Network Pulse).
- **Skeleton loaders** for everything; never spinners.

### 7.2 Offline

- **Read-only fallback** — last-seen dashboard, inventory list, orders inbox cached.
- **Optimistic actions** — Approve / Stage-complete buttons reflect immediately; queued if offline; sync on reconnect.
- **No offline create** — Receive Stock and Dispatch must be online (real-time inventory + truck commitment).

### 7.3 Scanning / Voice

- **Barcode scanner** for the **Inventory → Receive Stock** flow (deep-link → camera).
- **Voice command** is **out of scope** for MVP because the wholesaler Sabi endpoints don't exist yet.

### 7.4 Print-aware

- **No printing** from mobile.
- Pack list (fulfillment detail) shows a "Share PDF" action that triggers the browser print dialog when on iPad/Android tablet — but is hidden on phones.

### 7.5 Push notifications

- Hookable via FCM/APNs, but **registration endpoint doesn't exist yet** — out of MVP.
- For MVP, the in-app bell is the only surface.

---

## 8. P0 / P1 / P2 Cut

### P0 — Must ship in mobile MVP (production-ready) — **22 items**

1. Login + forgot password + token refresh + sign-out.
2. Home dashboard hero (3 KPIs + action chip + quick actions).
3. Stockout Watchlist (top 5).
4. Today's Pipeline horizontal funnel.
5. Inventory list with search + health filter.
6. Inventory KPI strip (4 cards).
7. **Receive Stock** modal.
8. **Adjust Stock** modal.
9. Movements ledger (read-only, last 30).
10. Customer Orders **Inbox** — list, status filter, search.
11. Customer Order detail — items, retailer, history.
12. **Approve / Reject / Cancel** order (swipe + button).
13. Fulfillment **Pipeline** — list grouped by stage.
14. **Start/Complete Picking + Packing + Ready Dispatch + Dispatch** actions.
15. Shipments list + status chips.
16. Shipment detail with live truck ETA.
17. Retailer directory (basic list + open detail).
18. Retailer detail (KPIs, 90d trend, recent orders).
19. Notifications list + mark-read + mark-all-read.
20. Profile (read-only) + Sign out.
21. Offline read fallback + optimistic stage transitions.
22. Pull-to-refresh + skeleton loaders.

### P1 — Ship in v1.1 — **8 items**

23. Modify order (line-edit).
24. Report Shortage in picking.
25. Procurement — list, create PO, transition state.
26. Procurement — suppliers + catalog browse.
27. Shipment Delay action.
28. Shipment Cancel action.
29. Analytics simplified (Overview, Inventory, Retailers, Forecast — 4 cards each).
30. Intelligence Center (Briefing + Opportunities + Risks + Actions).

### P2 — Defer / web-only acceptable — **5 items**

31. Cycle Count (warehouse staff workflow — keep on web until barcode scanner is fully wired).
32. Bulk approve / multi-select.
33. Control-Tower live map (keep on web — small screens fight large maps).
34. CSV reports.
35. Driver / Vehicle directory (doesn't exist server-side yet).

> **Out of scope until backend lifts ship:** Sabi Copilot for wholesalers · push notifications · retailer credit exposure · transfer between hubs · intel acknowledge · generic analytics route.

---

## 9. Answer to the W0 question

> **What are the 20–25 P0 features required for a production-ready Wholesaler mobile app?**

The 22 P0 items above. They fall into 7 clusters:

| Cluster         | P0 count |
|-----------------|----------|
| Auth + Session  | 4        |
| Home dashboard  | 4        |
| Inventory       | 4        |
| Customer Orders | 4        |
| Fulfillment     | 1 (covers 6 stage actions) |
| Shipments       | 2        |
| Retailers       | 2        |
| Notifications + Profile + Plumbing | 1 |

**Hard constraints that fall out of the audit:**

- **Sabi cannot be promised** in MVP — endpoint is 404.
- **Generic intel exec-summary cannot be promised** — wholesaler role not whitelisted (400).
- **`/api/analytics?role=wholesaler` cannot be promised** — 400. Use the fat `/wholesaler/{wid}/analytics` instead.
- **Driver / Vehicle / Transfer / Credit dashboards cannot be promised** — server-side does not model them.

---

## 10. Stop point reached

Discovery is complete. No UI built. The next step is **design review of this IA plan** with the user, followed by hi-fi mocks for the 5 bottom-tab surfaces.

**Sign-off needed on:**
1. 5-tab structure (Home / Orders / Inventory / Shipments / More)
2. Orders + Fulfillment merge into one tab with a segmented control
3. P0/P1/P2 cut
4. Out-of-scope confirmations (Sabi, push, credit, drivers)
