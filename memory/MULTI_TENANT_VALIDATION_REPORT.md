# Multi-Tenant Isolation — Validation Report

_Date: 2026-06-08 · Result: **22/22 PASSED**_

## Tenants

| Tenant | Root org code | Orgs in subtree |
|---|---|---:|
| Unilever | (legacy) | 3223 |
| Flour Mills Nigeria | MFR-0002 | 9 |

## Flour Mills network (verified hierarchy)

```
manufacturer   MFR-0002 Flour Mills Nigeria
  warehouse      WHR-0013 Flour Mills Lagos Warehouse
    distributor    DST-0097 Prime Distribution Services Ltd
      wholesaler     WHO-0030 Lagos Wholesale Hub
        retailer       RTL-3089 Flour Mills Retailer 4
        retailer       RTL-3088 Flour Mills Retailer 3
        retailer       RTL-3087 Flour Mills Retailer 2
        retailer       RTL-3090 Flour Mills Retailer 5
        retailer       RTL-3086 Flour Mills Retailer 1
```

## Test accounts (Flour Mills tenant)

| Email | Role | Org tier |
|---|---|---|
| `flour.admin@tradekonekt.io` | `manufacturer` | manufacturer |
| `flour.warehouse@tradekonekt.io` | `warehouse` | warehouse |
| `prime.distributor@tradekonekt.io` | `distributor` | distributor |
| `lagos.wholesaler@tradekonekt.io` | `wholesaler` | wholesaler |
| `flour.retailer1@tradekonekt.io` | `retailer` | retailer |

Password (all accounts): `FlourMills2026!`

## Test matrix

| # | Test | Result | Detail |
|---:|---|:---:|---|
| 1 | super_admin sees both tenants | ✅ | uni=3223 flour=9 |
| 2 | Tenant subtrees are disjoint | ✅ | intersection=0 |
| 3 | Flour [manufacturer] only sees Flour orgs | ✅ | count=9 flour_overlap=9 unilever_overlap=0 |
| 4 | Flour [warehouse] only sees Flour orgs | ✅ | count=8 flour_overlap=8 unilever_overlap=0 |
| 5 | Flour [distributor] only sees Flour orgs | ✅ | count=7 flour_overlap=7 unilever_overlap=0 |
| 6 | Flour [wholesaler] only sees Flour orgs | ✅ | count=6 flour_overlap=6 unilever_overlap=0 |
| 7 | Flour [retailer] only sees Flour orgs | ✅ | count=1 flour_overlap=1 unilever_overlap=0 |
| 8 | Unilever [manufacturer] cannot see any Flour Mills org | ✅ | count=3223 flour_overlap=0 |
| 9 | Unilever [distributor] cannot see any Flour Mills org | ✅ | count=193 flour_overlap=0 |
| 10 | Unilever [retailer] cannot see any Flour Mills org | ✅ | count=1 flour_overlap=0 |
| 11 | Unilever retailer sees only own org | ✅ | count=1 |
| 12 | Flour retailer sees only own org | ✅ | count=1 |
| 13 | Permissions [manufacturer] | ✅ | can_create=['distributor', 'warehouse'] expected=['warehouse', 'distributor'] can_manage=True expected=True |
| 14 | Permissions [warehouse] | ✅ | can_create=['distributor'] expected=['distributor'] can_manage=True expected=True |
| 15 | Permissions [distributor] | ✅ | can_create=['wholesaler'] expected=['wholesaler'] can_manage=True expected=True |
| 16 | Permissions [wholesaler] | ✅ | can_create=['retailer'] expected=['retailer'] can_manage=True expected=True |
| 17 | Permissions [retailer] | ✅ | can_create=[] expected=[] can_manage=False expected=False |
| 18 | Flour Mfg `/me/network` returns full 9-node tree | ✅ | visited=9 flour=9 match=True |
| 19 | Unilever mfg → GET Flour distributor returns 403 | ✅ | status=403 body={"detail":"Outside your organization scope"} |
| 20 | Flour mfg → GET Unilever distributor returns 403 | ✅ | status=403 body={"detail":"Outside your organization scope"} |
| 21 | Super-admin descendant query on Flour root == 9 nodes | ✅ | size=9 |
| 22 | Super-admin descendant query on Unilever root still works | ✅ | size=3223 expected=3223 |

## Result: 22/22 PASSED

All multi-tenant isolation invariants verified — Flour Mills and Unilever subtrees are fully isolated and respect the hierarchy / permission rules defined in `ORG_CHILDREN_ALLOWED`.

## Bug discovered & fixed during this exercise

### 🔴 Critical: Tenant-isolation breach in `migrate_regional_topology`

**Symptom.** Immediately after seeding Flour Mills with `region="Lagos"`, the backend hot-reloaded and the boot-time `migrate_regional_topology` migration **silently re-parented Flour Mills' Lagos distributor + retailers under Unilever's Lagos warehouse and Unilever's Lagos wholesale hubs A/B/C** — completely violating tenant isolation.

**Root cause.** `services/migrate_regional_topology.py::run()` queried `db.organizations.find({"organization_type": "distributor"})` and `…"retailer"` WITHOUT any tenant filter, then bucketed everyone by `region` and forcibly reparented to whichever regional warehouse/wholesaler was in scope (always Unilever's, since Unilever was the only tenant the script knew about).

**Fix.** Three changes:
1. `run()` now accepts an optional `manufacturer_id` parameter and pre-computes the set of org IDs belonging to that tenant's subtree (BFS over `parent_organization_id`). If none is passed, it defaults to **Unilever specifically** (looked up by name), with a fallback to "the first manufacturer ever created". This ensures the migration NEVER touches other tenants.
2. Both the distributor query and the retailer query are now gated by `{"id": {"$in": list(tenant_ids)}}` — guaranteeing other manufacturers' subtrees stay untouched.
3. `services/seed_flour_mills_tenant.py::_upsert_org` is now self-healing — if a matching org exists but its `parent_organization_id` has drifted (e.g. from an earlier non-tenant-aware migration), the seed restores it to the expected parent.

**Verification.** Boot log after fix:
```
Manufacturer root: Unilever (b21c1dbe-1a6f-4c33-b036-f416579455d0)
Regional topology migration done: { distributors_reparented: 0, retailers_reparented: 0 }
```
The 5 entries previously logged as "Skipping … in region=Unassigned" are the long-standing pytest `TEST_*` rows inside Unilever's subtree — Flour Mills orgs are no longer visible to the migration at all.

### Lessons / Follow-ups (P2)
- Add a CI assertion: `assert set(<unilever_subtree>).isdisjoint(set(<flour_mills_subtree>))` after every boot.
- Every future cross-tenant migration must accept a `tenant_id` (or `manufacturer_id`) parameter and scope its writes.
- The new Org Management UI does NOT yet show a "Tenant" badge on each row. Adding one would prevent future operator confusion (current workaround: code prefix `MFR-0001` vs `MFR-0002`).
