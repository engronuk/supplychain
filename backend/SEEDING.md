# Database Seeding & Migrations

TradeKonekt uses **MongoDB** (schemaless), so traditional SQL migrations don't
apply. Instead we have two production-safe tools:

1. **Seeder** — populates demo data from CSVs in `/app/backend/data/`.
2. **Migrator** — ensures all required indexes exist (idempotent).

Both ship as the single CLI `python seed.py` and are also exposed via HTTP for
environments where you can't SSH in.

---

## Environment separation

Each deployment is isolated by the `DB_NAME` env var inside that pod's
`backend/.env`. Preview and Production point at different MongoDB databases
(possibly different clusters too via `MONGO_URL`). There is no shared state —
seeding production never touches preview, and vice versa.

```
backend/.env
├── MONGO_URL    # mongodb://… (different per environment)
└── DB_NAME      # e.g. tradekonekt_preview vs tradekonekt_prod
```

---

## What gets seeded

Every entity in the requirements is covered by `services/seed.py::seed_from_csv()`:

| Entity            | Source / How it's built                                              |
|-------------------|----------------------------------------------------------------------|
| Manufacturers     | Hard-coded `Unilever` (extend in `seed.py` for multi-tenant).         |
| Regions           | Derived from `distributors.region`; surfaced via `/api/hierarchy/regions/{mfg_id}`. |
| Distributors      | `data/distributors.csv` → ~91 rows.                                  |
| Retailers         | `data/distributors.csv` → ~3,080 rows with GPS lat/lon.              |
| Products          | `data/products.csv` → 15 SKUs with barcodes, prices, categories.     |
| Inventory         | Generated: mfg level (5k–10k/SKU), distributor (400–1000/SKU/dist), retailer (from CSV cells). ~47k rows. |
| Deliveries        | `shipments` collection — 12+ seeded with mixed statuses (Pending/In-Transit/Received). |
| Stock Requests    | 1+ pending request from a sample retailer (weekend rush prep).        |
| Daily Sales       | 14 days × sample retailers — drives all analytics dashboards.         |
| Notifications     | Welcome notifs for each role workspace.                              |
| Transactions      | Derived view of received shipments — no separate collection needed.   |

Relational integrity is preserved by inserting in the order **manufacturer →
products → distributors → retailers → inventory → shipments → requests →
daily_sales → notifications** and threading the parent UUIDs through.

---

## Quick start

### 1. From the shell (CLI)

```bash
cd /app/backend

# Default: seed only if empty, then ensure indexes (production-safe).
python seed.py

# Wipe and reseed (destructive — preview/development only).
python seed.py --force

# Inspect current counts without writing anything.
python seed.py --summary

# Just create indexes, no data.
python seed.py --migrate-only
```

Output looks like:

```
════════════════════════════════════════════════════════════
  TradeKonekt seeder · target DB: tradekonekt_preview
════════════════════════════════════════════════════════════
  Before  →  (empty)
  Database is empty — seeding from CSVs…
  Seed    →  {'manufacturers': 1, 'distributors': 91, 'retailers': 3080, ...}
  Indexes →  ensured=23/23 failed=0
  After   →  manufacturers=1, distributors=91, retailers=3080, …
  ✓ Done. Target DB 'tradekonekt_preview' is ready.
```

### 2. From HTTP (no SSH needed)

```bash
# Idempotent — only seeds when the DB is empty:
curl -X POST https://www.app.tradekonekt.com/api/seed

# Migrate-only (index creation):
curl -X POST https://www.app.tradekonekt.com/api/migrate

# DESTRUCTIVE force-reseed — requires SEED_ADMIN_TOKEN to be set in prod env:
curl -X POST "https://www.app.tradekonekt.com/api/seed/force?token=YOUR_TOKEN"
```

To enable `/api/seed/force` in production:
1. Add `SEED_ADMIN_TOKEN=<random-string>` to the production `backend/.env`.
2. Redeploy.
3. Call the endpoint with the same token.

If `SEED_ADMIN_TOKEN` is unset, the endpoint responds 503 (safe-by-default).

### 3. On deploy — auto-init

The FastAPI app boots with this lifecycle hook:

```python
@app.on_event("startup")
async def auto_seed_if_needed():
    await ensure_indexes()             # always — idempotent
    if manufacturers_count == 0:
        await seed_from_csv()          # only on a fresh DB
```

That means a fresh production deployment **populates itself on first request**
as long as `/app/backend/data/*.csv` is included in the image (it is — the
Dockerfile already bundles the whole `backend/` directory).

If for any reason the auto-seed didn't fire (image missing CSVs, network
timeout to Mongo, etc.), just call `POST /api/seed` once and you're set.

---

## Adding new seeded entities

1. Add the data to `/app/backend/data/<entity>.csv` (or generate it in code).
2. Open `services/seed.py` and extend `seed_from_csv()` to insert into the new
   collection **after** its parent entities exist.
3. Add the relevant indexes to `services/migrations.py::INDEX_SPECS`.
4. Re-run `python seed.py --force` in preview and verify counts.

---

## Indexes managed

Defined in `services/migrations.py::INDEX_SPECS`. Highlights:

- `inventory.{owner_type, owner_id, product_id}` (unique) — guards the
  hot-path inventory rollup aggregations.
- `shipments.{status, created_at}` — speeds up the 14-day timeline chart.
- `daily_sales.{retailer_id, date}` and `{product_id, date}` — backs every
  analytics page.
- All `id` fields are unique-indexed across master-data collections.

To inspect what's actually present in your live DB:

```bash
python seed.py --migrate-only
mongosh "$MONGO_URL/$DB_NAME" --eval "db.inventory.getIndexes()"
```
