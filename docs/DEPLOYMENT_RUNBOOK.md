# Production Deployment Runbook

This guide explains how to deploy TradeKonekt to production and make the
production environment match the current preview state.

## Why production and preview drift

Production (Google Cloud Run) and preview use **separate MongoDB
clusters**. When you deploy, only the **code** moves — the **data**
stays where it is. So after a deploy:

- Production keeps whatever data was seeded the last time you initialised it.
- Preview reflects every script you've run during development (hand-curated
  hierarchy, 12 months of dense daily_sales, recomputed forecasts, etc).

To make them match you have to **explicitly tell production to re-sync**.
That's what the admin sync endpoint is for.

## One-time prerequisite: add `ADMIN_SYNC_TOKEN` to Secret Manager

```bash
# Generate a strong random token
openssl rand -hex 32

# Store in Google Secret Manager
gcloud secrets create admin-sync-token --replication-policy=automatic
echo -n "<paste the random value>" | gcloud secrets versions add admin-sync-token --data-file=-

# Update the Cloud Run service to inject it
gcloud run services update tk-backend \
  --region=europe-west2 \
  --set-secrets=ADMIN_SYNC_TOKEN=admin-sync-token:latest
```

## Step-by-step deploy + sync

### 1. Push the code to production via Emergent's "Save to GitHub" / Cloud Run pipeline

Use Emergent's standard deployment flow. Once Cloud Run reports the new
revision as healthy, proceed.

### 2. Dry-run the diff

```bash
curl -X POST "https://<prod-url>/api/admin/sync/diff" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN" | jq .
```

This shows you:
- `current` — what's actually in prod right now.
- `target` — what the canonical preview state looks like.
- `organization_delta` — per-tier diff (negative = needs removing).
- `collections_to_wipe` — exactly which collections would be cleared.

If the diff matches your expectation, continue.

### 3. Apply (this WIPES + REBUILDS prod data)

```bash
curl -X POST "https://<prod-url>/api/admin/sync/apply" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "confirm": "I_UNDERSTAND_THIS_WIPES_DATA",
    "backfill_history": true,
    "recompute_forecasts": true
  }'
```

The endpoint returns `202` immediately with `status: "accepted"`. The
actual rebuild runs in the background. **Do NOT call /apply again** —
the endpoint refuses with `status: "already_running"` while the job is
in flight.

### 4. Poll for completion

```bash
# Watch in flight until it goes false
watch -n 10 'curl -s "https://<prod-url>/api/admin/sync/status" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN" | jq .in_flight,.last_sync.finished_at'
```

Typical runtime: **4-6 minutes** (90s wipe + 90s hierarchy build + 60s
inventory + 120s 90-day data + 60s user remap + ~90s backfill +
~30s forecast recompute).

### 5. Verify

```bash
# Counts should now match canonical
curl "https://<prod-url>/api/admin/sync/status" \
  -H "X-Admin-Token: $ADMIN_SYNC_TOKEN" | jq .current

# Smoke-test the demo portal
open "https://<prod-url>/"
# Expected: 2 manufacturers; FMN with 3 WH · 6 DST · 18 WHO · 84 RTL; same for Unilever.

# Sign in
curl -X POST "https://<prod-url>/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"unilever@tradekonekt.io","password":"TradeKonekt2026!"}'
```

## What gets wiped and what's preserved

**Wiped on apply**: every collection except the keepers below. This
includes `organizations`, `daily_sales`, `purchase_orders`, `shipments`,
`vehicles`, `inventory`, `wholesaler_*`, `intel_*`, `notifications`,
caches, etc.

**Preserved**:
- `users` — auth accounts (canonical demo users are re-stamped, others
  left untouched).
- `simulation_settings` — feature toggles.
- `route_cache` — Google Maps cache (regen on demand).
- `geofences` — tenant-agnostic zone defs.
- `seed_meta` — idempotency markers (so re-runs are safe).

## Recovery: force-clear a stuck in-flight lock

Should the worker die mid-sync (rare), the `admin_sync_in_flight`
marker can remain set, blocking re-runs. Clear it via Mongo shell:

```bash
mongo "$MONGO_URL" --eval 'db.seed_meta.deleteOne({key:"admin_sync_in_flight"})'
```

Then re-run `/apply`.

## Endpoint reference

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/admin/sync/status` | Current counts + last sync record |
| `POST` | `/api/admin/sync/diff`   | Dry-run delta vs canonical |
| `POST` | `/api/admin/sync/apply`  | Wipe + rebuild + backfill (async) |

All require header `X-Admin-Token: <ADMIN_SYNC_TOKEN>`.
