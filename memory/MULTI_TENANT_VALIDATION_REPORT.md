# Multi-Tenant Isolation — Validation Report

_Date: 2026-06-08 · Result: **22/22 PASSED**_

## Tenants

| Tenant | Root org code | Orgs in subtree |
|---|---|---:|
| Unilever | (legacy) | 3207 |
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
| 1 | super_admin sees both tenants | ✅ | uni=3207 flour=9 |
| 2 | Tenant subtrees are disjoint | ✅ | intersection=0 |
| 3 | Flour [manufacturer] only sees Flour orgs | ✅ | count=9 flour_overlap=9 unilever_overlap=0 |
| 4 | Flour [warehouse] only sees Flour orgs | ✅ | count=8 flour_overlap=8 unilever_overlap=0 |
| 5 | Flour [distributor] only sees Flour orgs | ✅ | count=7 flour_overlap=7 unilever_overlap=0 |
| 6 | Flour [wholesaler] only sees Flour orgs | ✅ | count=6 flour_overlap=6 unilever_overlap=0 |
| 7 | Flour [retailer] only sees Flour orgs | ✅ | count=1 flour_overlap=1 unilever_overlap=0 |
| 8 | Unilever [manufacturer] cannot see any Flour Mills org | ✅ | count=3207 flour_overlap=0 |
| 9 | Unilever [distributor] cannot see any Flour Mills org | ✅ | count=197 flour_overlap=0 |
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
| 22 | Super-admin descendant query on Unilever root still works | ✅ | size=3207 expected=3207 |

## Result: 22/22 PASSED

All multi-tenant isolation invariants verified — Flour Mills and Unilever subtrees are fully isolated and respect the hierarchy / permission rules defined in `ORG_CHILDREN_ALLOWED`.