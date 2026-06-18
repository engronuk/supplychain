# Test Credentials

**Password for every seeded account:** `TradeKonekt2026!`

The canonical rebuild stamps a login for **every entity** in the hierarchy
(plus a per-role admin shortcut). Total active accounts: **235**.

## Production admin sync (deploy-time use only)

**`ADMIN_SYNC_TOKEN`** (in `backend/.env`) — protects `/api/admin/sync/*`.
The current preview value is: `tk-prod-sync-7f3a9c2e8b14d7f1a9c2e8b14d7f1a9c2e`

> **CRITICAL for production:** add `ADMIN_SYNC_TOKEN` to Google Secret
> Manager and inject via Cloud Run. Choose a **different** random value
> for prod than the preview value above.

### How to sync production to match preview after deploy

```bash
# 1. Dry-run — see what would change
curl -X POST "https://<prod-host>/api/admin/sync/diff" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN"

# 2. Apply (returns 202 immediately; runs in background for ~5 min)
curl -X POST "https://<prod-host>/api/admin/sync/apply" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"I_UNDERSTAND_THIS_WIPES_DATA","backfill_history":true,"recompute_forecasts":true}'

# 3. Poll status until in_flight=false
curl "https://<prod-host>/api/admin/sync/status" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN"
```


## Per-role admin shortcuts (easy demo logins)

### Unilever tenant (MFR-0001)
| Email | Role |
|---|---|
| `admin@tradekonekt.io` | super_admin (cross-tenant) |
| `unilever@tradekonekt.io` | manufacturer |
| `unilever.warehouse@tradekonekt.io` | warehouse |
| `unilever.distributor@tradekonekt.io` | distributor |
| `unilever.wholesaler@tradekonekt.io` | wholesaler |
| `unilever.retailer@tradekonekt.io` | retailer |

### Flour Mills Nigeria tenant (MFR-0002)
| Email | Role |
|---|---|
| `fmn@tradekonekt.io` | manufacturer |
| `fmn.warehouse@tradekonekt.io` | warehouse |
| `fmn.distributor@tradekonekt.io` | distributor |
| `fmn.wholesaler@tradekonekt.io` | wholesaler |
| `fmn.retailer@tradekonekt.io` | retailer |

## Entity-mapped logins (every node has a user)

Email pattern: `<lowercased org-code>@tradekonekt.io`. Examples:

| Entity type | Sample email |
|---|---|
| Unilever Lagos Warehouse | `mfr-0001-wh-0001@tradekonekt.io` |
| Apex Distributors (Apapa) | `mfr-0001-dst-0001@tradekonekt.io` |
| Royal Trading 1 (Lagos) | `mfr-0001-who-0001@tradekonekt.io` |
| Family Shop 1 (Lagos) | `mfr-0001-rtl-0001@tradekonekt.io` |
| Shoprite Apapa (Unilever key-account) | `mfr-0001-rtl-ka-0001@tradekonekt.io` |
| FMN Lagos Warehouse | `mfr-0002-wh-0001@tradekonekt.io` |
| FMN Retailer #50 | `mfr-0002-rtl-0050@tradekonekt.io` |

Counts per tenant:
- 1 manufacturer · 3 warehouses · 6 distributors · 18 wholesalers
- 72 wholesaler-served retailers (`MFR-XXXX-RTL-0001` … `MFR-XXXX-RTL-0072`)
- 12 key-account retailers (`MFR-XXXX-RTL-KA-0001` … `MFR-XXXX-RTL-KA-0012`)

## How to (re)build
- Full canonical rebuild (entities + transactions + users): `cd /app/backend && python -m scripts.rebuild`
- Live operational seed on top: `cd /app/backend && python -m scripts.live_activity`
- Re-map / refresh users only: `cd /app/backend && python -m scripts.map_users`
- Backup (rollback point): `/app/backups/pre_rebuild_20260613_073553`
