# Retailer Offline-First Backend — Validation Report

**Date:** 2026-06-25
**Owner:** Track A backend
**Scope:** Phase C/D/E enabling endpoints + cross-cutting idempotency contract
**Status:** ✅ **READY for mobile probe suite**

---

## 1. What shipped

| Deliverable | Files | Endpoints | Status |
|---|---|---|---|
| Idempotency middleware (Section 1) | `services/idempotency.py` | shared dependency `idempotent("<endpoint>")` | ✅ |
| Idempotent sale create (Gap #1) | `routes/sales.py` | `POST /api/retailer/{rid}/sales` (+ new fields `customer_id`, `occurred_at`, `client_op_id`) | ✅ |
| Customers CRUD (Gap #2) | `routes/retailer_customers.py` (new) | 5 endpoints under `/api/retailer/{rid}/customers` | ✅ |
| Inventory delta ledger (Gap #3) | `routes/retailer_inventory_adjust.py` (new) | 3 endpoints under `/api/retailer/{rid}/inventory/adjust` | ✅ |
| Incremental sync cursors (Section 5.1) | `routes/sales.py`, `routes/inventory.py`, `routes/procurement.py` | `updated_since=` accepted on sales, PO list, inventory | ✅ |
| ETag / If-Match (Section 5.2) | `routes/retailer_customers.py` | ETag header on GET; `If-Match` on PATCH | ✅ |
| Storage indexes | `services/migrations.py` | TTL 48h on `idempotency_keys`, partial-unique on `(retailer_id, normalized_phone)`, + 4 supporting indexes | ✅ |
| Regression suite | `tests/test_retailer_offline.py` (new) | 19 acceptance tests | ✅ 19/19 PASS |

---

## 2. Test results

```
$ cd /app/backend && python -m pytest tests/test_retailer_offline.py -v
...
tests/test_retailer_offline.py::test_idempotency_first_call_runs_normally PASSED
tests/test_retailer_offline.py::test_idempotency_replay_returns_same_response PASSED
tests/test_retailer_offline.py::test_idempotency_mismatched_payload_returns_409 PASSED
tests/test_retailer_offline.py::test_idempotency_client_op_id_fallback PASSED
tests/test_retailer_offline.py::test_sale_idempotency_returns_same_id PASSED
tests/test_retailer_offline.py::test_sale_with_customer_id_updates_crm_rollups PASSED
tests/test_retailer_offline.py::test_sale_with_unknown_customer_id_is_400 PASSED
tests/test_retailer_offline.py::test_customers_list_excludes_soft_deleted PASSED
tests/test_retailer_offline.py::test_customers_phone_upsert PASSED
tests/test_retailer_offline.py::test_customers_patch_with_stale_if_match_412 PASSED
tests/test_retailer_offline.py::test_customers_updated_since_cursor PASSED
tests/test_retailer_offline.py::test_inventory_single_delta_decrements_atomically PASSED
tests/test_retailer_offline.py::test_inventory_idempotent_replay PASSED
tests/test_retailer_offline.py::test_inventory_negative_warning PASSED
tests/test_retailer_offline.py::test_inventory_batch_partial_replay PASSED
tests/test_retailer_offline.py::test_inventory_ledger_lists_adjustments PASSED
tests/test_retailer_offline.py::test_sales_updated_since_returns_only_newer PASSED
tests/test_retailer_offline.py::test_unauthenticated_endpoints_are_locked PASSED
tests/test_retailer_offline.py::test_cross_tenant_retailer_access_denied PASSED
============================= 19 passed in 27.06s ==============================
```

Every acceptance checklist item in the source spec is covered.

---

## 3. Endpoint validation evidence (curl)

### 3.1 Idempotency contract — same key + same body → replay

```bash
$ curl -i -X POST $API/retailer/$RID/sales \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: ik_demo_${RANDOM_UUID}" \
    -H "Content-Type: application/json" \
    -d '{"items":[{"product_id":"...","quantity":1,"unit_price":100}],
         "payment_method":"cash","occurred_at":"2026-06-25T12:00:00Z"}'
HTTP/2 200
  sale_id: 1d775a06-328e-4da9-9796-ab08e76ec060

# Replay with the SAME key and body:
$ curl -i -X POST $API/retailer/$RID/sales \
    -H "Idempotency-Key: ik_demo_${SAME_UUID}" ... (same body)
HTTP/2 200
idempotent-replay: true
  sale_id: 1d775a06-328e-4da9-9796-ab08e76ec060   ← identical
```

### 3.2 Idempotency contract — same key + different body → 409

```bash
$ curl -i -X POST $API/retailer/$RID/sales \
    -H "Idempotency-Key: ik_demo_${SAME_UUID}" \
    ... (quantity changed to 99)
HTTP/2 409
{
  "detail": {
    "detail": "Idempotency-Key reused with mismatched payload",
    "original_request_at": "2026-06-25T17:12:11.242701+00:00"
  }
}
```

### 3.3 Customers create

```bash
$ curl -X POST $API/retailer/$RID/customers \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"Demo Customer","phone":"+2348012345678","email":"demo@example.com"}'
{
  "id": "fe9042c4-fbc8-400a-9b52-9a8210b75e94",
  "retailer_id": "49e47d4f-914a-733f-3aa6-37f716dfe766",
  "name": "Demo Customer",
  "phone": "+2348012345678",
  "normalized_phone": "+2348012345678",
  "email": "demo@example.com",
  "credit_balance": 0.0, "total_spent": 0.0, "lifetime_orders": 0,
  "tags": [],
  "created_at": "2026-06-25T17:12:29.684231+00:00",
  "updated_at": "2026-06-25T17:12:29.684231+00:00",
  "deleted_at": null,
  ...
}
```

### 3.4 Inventory single delta

```bash
$ curl -X POST $API/retailer/$RID/inventory/adjust \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"product_id":"...","delta":-2,"reason":"sale"}'
{
  "id": "ee100584-1e4b-46de-b6b7-b5488d266dbb",
  "delta": -2,
  "reason": "sale",
  "applied_at": "2026-06-25T17:12:30.364447+00:00",
  "occurred_at": "2026-06-25T17:12:30.364447+00:00",
  "resulting_quantity": 90,
  "resulting_available": 90,
  "warning": null
}
```

### 3.5 Inventory batch — partial OK + per-item rejection

```bash
$ curl -X POST $API/retailer/$RID/inventory/adjust/batch \
    -d '{"adjustments":[
      {"product_id":"...","delta":3,"reason":"shipment_received",
       "client_delta_op_id":"0affa8d6-..."},
      {"product_id":"...","delta":0,"reason":"sale",
       "client_delta_op_id":"ed4d1228-..."}
    ]}'
{
  "ok": true,
  "applied": 1, "skipped": 0, "rejected": 1,
  "results": [
    {"status": "applied", "id": "3ee97056-...",
     "resulting_quantity": 93, "resulting_available": 93, "warning": null},
    {"status": "rejected", "reason": "delta must be non-zero"}
  ]
}
```

(Replay of the **applied** row in a subsequent call returns
``status: "skipped"`` with the original `resulting_quantity` — covered
by `test_inventory_batch_partial_replay`.)

### 3.6 Negative balance warning (still applies)

```bash
$ curl -X POST $API/retailer/$RID/inventory/adjust \
    -d '{"product_id":"...","delta":-99999,"reason":"count"}'
{ "delta": -99999, "resulting_quantity": -99906,
  "warning": "negative_balance", ... }
```

### 3.7 Incremental sync (updated_since)

```bash
$ curl "$API/retailer/$RID/sales?updated_since=<latest_known_ts>" \
    -H "Authorization: Bearer $TOKEN"
{ "total": 0, "limit": 50, "offset": 0, "rows": [], "next_cursor": null }
```

Anchor a pull on the most recent row's ``updated_at`` → second pull
returns 0 rows.

---

## 4. Acceptance checklist — completed

### Deliverable 1 — Idempotency

- [x] Header (`Idempotency-Key`) preferred; `client_op_id` fallback honoured.
- [x] First call with key K → processes + stores + responds.
- [x] Replay within 48h → identical body, `Idempotent-Replay: true`.
- [x] Same key + different payload → 409 with `original_request_at`.
- [x] No key → legacy mode, no dedup.
- [x] TTL index on `expires_at` (48h) — `idempotency_keys.ttl_expires_at`.
- [x] Cross-cutting: single helper, used by sales + customers + inventory.

### Deliverable 2 — Idempotent sales

- [x] Duplicate `Idempotency-Key` → same `sale_id`, no second row.
- [x] `Idempotent-Replay: true` present on replay.
- [x] Same key + different body → 409.
- [x] Omitting key → still works (zero regression).
- [x] `occurred_at` persisted.
- [x] `customer_id` validated against `/customers` (rejects unknown IDs, links
  to CRM, updates `lifetime_orders` + `total_spent` + `first/last_purchase_at`).
- [x] `client_op_id` echoed back in response.

### Deliverable 3 — Customers CRUD

- [x] 5 endpoints respond with documented shapes.
- [x] POST with duplicate `Idempotency-Key` returns existing customer.
- [x] POST with duplicate `(retailer_id, normalized_phone)` upserts.
- [x] PATCH with stale `If-Match` → 412.
- [x] DELETE is soft (`deleted_at`); GET list filters by default.
- [x] `updated_since` returns only rows updated after cursor.
- [x] Sale rows referencing soft-deleted customer still resolve
  `customer_name` (denormalised on the sale row at creation time).

### Deliverable 4 — Inventory ledger

- [x] POST `delta=-2` decrements `inventory.quantity` by exactly 2,
  atomically (`find_one_and_update` + `$inc`).
- [x] Same `Idempotency-Key` → same row, no double-decrement.
- [x] Resulting `< 0` → `warning: "negative_balance"` but applies.
- [x] Batch processes each adjustment independently.
- [x] Per-delta `client_delta_op_id` makes each item individually idempotent.
- [x] Replayed batch → already-applied deltas come back as `"skipped"`.
- [x] GET ledger returns full audit trail (sorted by `applied_at` DESC).

### Deliverable 5 — Sync cursors

- [x] `GET /retailer/{rid}/sales?updated_since=<iso>` honours the cursor;
  returns 0 rows when nothing has changed.
- [x] `GET /procurement/purchase-orders?updated_since=<iso>` honours.
- [x] `GET /inventory?updated_since=<iso>` honours; legacy clients (no param)
  still get the bare list — **zero backwards-incompat**.
- [x] All new endpoints expose `updated_since` natively.

### Auth + ownership

- [x] All new endpoints require JWT (401 without).
- [x] All new endpoints reject cross-retailer access (403).
- [x] Sales endpoint left auth-open to match existing in-market behaviour.

### Backwards-compat with shipped clients

- [x] All new request fields are optional; existing iOS / Android builds
  that don't send `Idempotency-Key`, `client_op_id`, `customer_id` or
  `occurred_at` continue to work without change.
- [x] All new response fields are additive; field removals are zero.
- [x] `GET /inventory` without `updated_since` keeps the bare-list shape.

---

## 5. Offline architecture impact assessment

### 5.1 What the mobile client can now do

| Capability | Before | After |
|---|---|---|
| Replay a sale after network drop | Created duplicate sales | Returns the same `sale_id`, no duplicate row |
| Attach a sale to a recurring customer | Free-text `customer_name` only | `customer_id` FK + auto CRM rollups |
| Backdate an offline sale | Server stamped `created_at = now()` | Spec'd `occurred_at` honoured for analytics |
| Local customer CRM | No backend at all (404) | Full CRUD + offline-friendly upsert by phone |
| Edit a customer on two devices | Race conditions / silent overwrites | Optimistic `If-Match` ETag (412 on conflict) |
| Decrement inventory locally then sync | No path — only `/sales` mutated stock | Delta ledger + batch + per-delta idempotency |
| Pull only what changed | Required a full re-read | `updated_since` cursor on sales/POs/inventory |

### 5.2 Storage model

* **`idempotency_keys`** — TTL 48h. Compound unique on
  `(retailer_id, endpoint, key)`. Stores `payload_sha256`, `status_code`,
  `response_body`. Used by both the request-level helper and the
  per-delta batch path.
* **`retailer_customers`** — partial-unique on
  `(retailer_id, normalized_phone)` **only where phone is a string**.
  Documents without a phone do NOT collide (the previous sparse index
  bug treated `null` as a real value — fixed). Soft-delete via
  `deleted_at`. Mirrors of name/phone/email + CRM rollups
  (`lifetime_orders`, `total_spent`, `first/last_purchase_at`).
* **`retailer_inventory_adjustments`** — append-only ledger. Snapshots
  `resulting_quantity` and `resulting_available` at the moment of apply
  so the audit trail survives even if later adjustments overshoot.

### 5.3 Concurrency guarantees

* Inventory mutations use `find_one_and_update` with `$inc`, which is
  atomic at the MongoDB server. Two concurrent cashiers will never
  double-decrement.
* Negative balances are explicitly allowed (offline backdating may
  arrive late). The `warning: "negative_balance"` flag lets the mobile
  client surface a "your shop went into the red on Jun 23, please
  verify" UI without blocking the sync.

### 5.4 What the mobile team still has to build

The backend now satisfies every dependency for Phases C / D / E. Mobile-side
work the spec calls out:

1. **Outbox queue** with `Idempotency-Key` minted per pending mutation.
2. **Phone-canonical customer cache** keyed on the same normalisation rules
   the server uses (strip whitespace/dashes/parens, keep leading `+`).
3. **ETag store** on the customer row so PATCH retries can send
   `If-Match: <last_seen_updated_at>` for conflict detection.
4. **Cursor tracking** per collection (`sales`, `purchase-orders`,
   `inventory`, `customers`, `inventory/adjust`) using the
   `next_cursor` / `updated_at` returned by each list call.
5. **Backfill on first sync** — full sync (no `updated_since`) on cold
   install, then deltas thereafter.

### 5.5 Production deployment notes

* Backend running on **preview** with all changes. Production redeploy
  required before mobile can probe against `https://www.app.tradekonekt.com`.
* Indexes auto-create on backend boot (`services/migrations.py`).
  The stale `uniq_retailer_phone` (sparse) is dropped first via
  `STALE_INDEXES` — guaranteed clean state for new deploys.
* No data migration required — all new collections are additive.

---

## 6. Curl reference for the mobile probe suite

```bash
# Setup
API="https://www.app.tradekonekt.com/api"
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"unilever.retailer@tradekonekt.io","password":"TradeKonekt2026!"}' \
  | jq -r '.access_token // .token')
RID="49e47d4f-914a-733f-3aa6-37f716dfe766"
KEY="ik_$(uuidgen)"
H_AUTH="Authorization: Bearer $TOKEN"
H_JSON="Content-Type: application/json"
H_IDEM="Idempotency-Key: $KEY"

# Sale — first call
PID=$(curl -s "$API/inventory?owner_type=retailer&owner_id=$RID" -H "$H_AUTH" \
  | jq -r '.[] | select(.quantity>=5) | .product_id' | head -1)
curl -i -X POST "$API/retailer/$RID/sales" \
  -H "$H_AUTH" -H "$H_JSON" -H "$H_IDEM" \
  -d "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1,\"unit_price\":100}],
       \"payment_method\":\"cash\",
       \"occurred_at\":\"2026-06-25T12:00:00Z\"}"

# Replay — same key + same body
curl -i -X POST "$API/retailer/$RID/sales" \
  -H "$H_AUTH" -H "$H_JSON" -H "$H_IDEM" \
  -d "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":1,\"unit_price\":100}],
       \"payment_method\":\"cash\",
       \"occurred_at\":\"2026-06-25T12:00:00Z\"}"
# → 200 with header `Idempotent-Replay: true`

# Conflict — same key + different body
curl -i -X POST "$API/retailer/$RID/sales" \
  -H "$H_AUTH" -H "$H_JSON" -H "$H_IDEM" \
  -d "{\"items\":[{\"product_id\":\"$PID\",\"quantity\":99,\"unit_price\":100}],
       \"payment_method\":\"cash\"}"
# → 409 with detail.original_request_at

# Customer create + delete + list (soft-delete check)
CID=$(curl -s -X POST "$API/retailer/$RID/customers" \
        -H "$H_AUTH" -H "$H_JSON" \
        -d '{"name":"Demo","phone":"+2348012345678"}' | jq -r .id)
curl -X DELETE "$API/retailer/$RID/customers/$CID" -H "$H_AUTH"  # 204
curl "$API/retailer/$RID/customers" -H "$H_AUTH"                  # CID hidden
curl "$API/retailer/$RID/customers?include_deleted=true" -H "$H_AUTH"
                                                                  # CID present

# Inventory delta + batch
curl -X POST "$API/retailer/$RID/inventory/adjust" \
  -H "$H_AUTH" -H "$H_JSON" \
  -d "{\"product_id\":\"$PID\",\"delta\":-2,\"reason\":\"sale\"}"

curl -X POST "$API/retailer/$RID/inventory/adjust/batch" \
  -H "$H_AUTH" -H "$H_JSON" \
  -d "{\"adjustments\":[
        {\"product_id\":\"$PID\",\"delta\":3,
         \"reason\":\"shipment_received\",
         \"client_delta_op_id\":\"$(uuidgen)\"}
      ]}"

# Incremental sync cursor
LAST=$(curl -s "$API/retailer/$RID/sales?limit=1" -H "$H_AUTH" \
        | jq -r '.rows[0].updated_at // .rows[0].created_at')
curl "$API/retailer/$RID/sales?updated_since=$LAST" -H "$H_AUTH"
# → {"total":0,"rows":[]}
```

---

## 7. STOP — handoff to mobile

Per the user's instruction, no mobile offline-core implementation begins
until this report is approved. Action items for the mobile agent:

1. Read this report end-to-end.
2. Run their Phase A probe suite against this preview URL:
   `https://supply-chain-hub-189.preview.emergentagent.com`
3. Confirm every checklist item in §4 passes against the probe.
4. Sign off on the data model in §5.2 (especially the
   `partialFilterExpression` on customer phone uniqueness).
5. Decide whether to ship Phases C / D / E in one mobile release or in
   three (backend supports either).

Once mobile signs off, the backend can be redeployed to production at
`https://www.app.tradekonekt.com` and Phase C mobile work can begin.

— Track A backend
