# Phase 1+2 Ownership Model Migration — Report

**Date:** 2026-06-08
**Scope:** Add a unified `organization_id` field (and an optional
`warehouse_id`) to every ownership-bearing collection so downstream code
can progressively move off the legacy `manufacturer_id` / `distributor_id`
/ `retailer_id` fields. Pure foundation — **no write paths, no business
workflows, no UI, no legacy field removal**.

---

## 1. Migration Report

Auto-runs at boot via `services/migrate_ownership.py`. Idempotent —
re-running only touches rows still missing the new field.

| Collection | Total Rows | Source FK → `organization_id` | Backfilled | Still Missing |
|---|---:|---|---:|---:|
| products            |    15 | `manufacturer_id` | 15    | 0 |
| inventory           | 47,580 | `owner_id`        | 47,580 | 0 |
| batches             |    45 | `manufacturer_id` | 45    | 0 |
| promotions          |     1 | `manufacturer_id` | 1     | 0 |
| purchase_orders     |   235 | `retailer_id`     | 235   | 0 |
| procurement_carts   |     1 | `retailer_id`     | 1     | 0 |
| supplier_quotes     |    72 | `retailer_id`     | 72    | 0 |
| distributor_orders  |    61 | `distributor_id`  | 61    | 0 |
| requests            |    72 | `retailer_id`     | 72    | 0 |
| sales               |    37 | `retailer_id`     | 37    | 0 |
| daily_sales         |   613 | `retailer_id`     | 613   | 0 |
| shipments           |    76 | `from_id`         | 76    | 0 |
| **TOTAL**           | **48,808** | | **48,808** | **0** |

`warehouse_id` placeholder added to all 47,580 inventory rows (set to
`NULL`). Reserved for the future Warehouse Management Module.

### Verification of FK ↔ `organization_id` parity

| Collection | matched (`org_id` == legacy FK) | mismatched |
|---|---:|---:|
| products            |     15 | 0 |
| inventory           | 47,580 | 0 |
| batches             |     45 | 0 |
| promotions          |      1 | 0 |
| purchase_orders     |    235 | 0 |
| procurement_carts   |      1 | 0 |
| supplier_quotes     |     72 | 0 |
| distributor_orders  |     61 | 0 |
| requests            |     72 | 0 |
| sales               |     37 | 0 |
| daily_sales         |    613 | 0 |
| shipments           |     76 | 0 |

Catch-up backfill confirmed working: rows created by pytest *after* the
initial backfill (5 POs + 4 quotes + 1 shipment) were auto-picked-up on
the next run with 0 manual intervention.

### Indexes added (Phase 1+2)

13 new ascending indexes — one per migrated collection:

```
products.by_organization
inventory.by_organization
inventory.by_warehouse                (sparse — most rows have NULL)
batches.by_organization
promotions.by_organization
purchase_orders.by_organization
procurement_carts.by_organization
supplier_quotes.by_organization
distributor_orders.by_organization
requests.by_organization
sales.by_organization
daily_sales.by_organization
shipments.by_organization
```

Boot output: `{'indexes_ensured': 70, 'indexes_failed': 0,
'total_specs': 70}` — every new index created cleanly.

---

## 2. Regression Test Report

| Suite | Result |
|---|---|
| `tests/test_organizations.py` (10) | **10/10 PASS** |
| `tests/test_organizations_extended.py` (21) | **21/21 PASS** |
| `tests/test_procurement.py` (12) | **12/12 PASS** |
| `tests/test_retailer_inventory.py` (13) | **13/13 PASS** |
| `tests/test_distributor_os.py` (20) | **20/20 PASS** |
| **Migration-relevant total** | **76/76 PASS** |

### Pre-existing failures (NOT caused by this iteration)

`test_product_intelligence.py` and `test_shipment_command.py::test_wrong_manufacturer_404`
were already failing on the prior commit `cb988bc` (confirmed via
`git stash` + rerun). They are pre-existing test-ordering / snapshot
caching issues that should be addressed independently. They do **not**
involve `organization_id` or any code path touched by this migration.

### Direct ownership query parity

For every Unilever-owned collection, queries on the new field return the
same count as queries on the legacy FK:

```
✓ products            legacy=15      organization_id=15
✓ inventory           legacy=15      organization_id=15
✓ batches             legacy=45      organization_id=45
✓ shipments           legacy=24      organization_id=24
```

`services/ownership.py::org_or_legacy(field, oid)` helper exposed for any
future read-path that wants forward-compatibility (matches either field).

---

## 3. Entities successfully migrated to `organization_id`

| # | Entity | Pydantic Model Updated | Index Added | Auto-backfill |
|---|---|:---:|:---:|:---:|
| 1 | Product            | ✅ | ✅ | ✅ |
| 2 | InventoryItem      | ✅ | ✅ | ✅ |
| 3 | Batch              | ❌ (no model) | ✅ | ✅ |
| 4 | Promotion          | ❌ (no model) | ✅ | ✅ |
| 5 | PurchaseOrder      | ✅ | ✅ | ✅ |
| 6 | Cart               | ✅ | ✅ | ✅ |
| 7 | SupplierQuote      | ✅ | ✅ | ✅ |
| 8 | DistributorOrder   | ❌ (no model) | ✅ | ✅ |
| 9 | StockRequest       | ✅ | ✅ | ✅ |
| 10 | Sale              | ❌ (no model) | ✅ | ✅ |
| 11 | DailySale         | ❌ (no model) | ✅ | ✅ |
| 12 | Shipment          | ✅ | ✅ | ✅ |

`InventoryItem` additionally got the optional `warehouse_id` field
(currently NULL on all rows — reserved for future Warehouse Management).

The "no model" entries are collections that the codebase stores as raw
dicts; the migration script handles them directly.

---

## 4. Entities DEFERRED to future phases

| Entity | Reason | Future Phase |
|---|---|---|
| **Warehouse-level stock** | No verified warehouse-level inventory positions yet. Inventory remains manufacturer-owned for now. | Warehouse Management Module |
| **Drivers**       | Collection doesn't exist. | Logistics Module |
| **Vehicles**      | Collection doesn't exist. | Logistics Module |
| **Notifications** | Routing key is `target_id` + `target_type`. No ownership semantics — every notification is for a specific recipient, not an organization. Will be revisited if/when we need org-scoped audit trails. | TBD |
| **Users**         | Auth + role + impersonation logic is explicitly out-of-scope this iteration. | Future identity / multi-tenant phase |
| **Counters**      | Internal sequence generator — no ownership semantics. | Never (system table) |
| **intel_***       | Read-only computed snapshots (forecasts, alerts, recommendations, retailer_health). Their inputs are already migrated; their outputs would auto-pick up `organization_id` on the next scheduler run if needed. Defer until consumer code wants it. | When dashboards switch to the unified field |

### Phases not yet started

- **Phase 3 — Write-path migration**: have every CREATE endpoint also set
  `organization_id` directly so the boot-time backfill becomes redundant.
- **Phase 4 — Cleanup**: remove the legacy `manufacturer_id` /
  `distributor_id` / `retailer_id` fields once every read site has moved
  to `organization_id`.

These will be triggered when downstream consumers (Logistics / Warehouse /
Driver / Vehicle modules) start writing on the unified field directly.

---

## 5. Constraints honoured

Per user direction, this iteration **did NOT** touch any of:

- Authentication, login, role/permission enforcement
- Procurement workflows
- Order creation & approval workflows
- Inventory quantity calculations
- Analytics & Intelligence calculations
- Organization hierarchy / visibility (already working)
- Production data deletion
- Write paths or business workflows
- UI redesigns
- Inventory redistribution
- Shipment / driver / vehicle / logistics implementation

Files changed are limited to:
- `backend/models.py` — added optional `organization_id` / `warehouse_id`
  fields to 6 Pydantic models (defaulted, non-breaking).
- `backend/services/migrate_ownership.py` (new) — idempotent backfill.
- `backend/services/ownership.py` (new) — `org_or_legacy()` read helper.
- `backend/services/migrations.py` — 13 additive indexes.
- `backend/server.py` — wired the ownership migration into bootstrap.
