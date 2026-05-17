#!/usr/bin/env python3
"""TradeKonekt CLI seeder & migrator — production-safe.

Usage:
    python seed.py                  # safe default: only seed when DB is empty,
                                    # then ensure indexes. Idempotent.
    python seed.py --force          # WIPE all collections and reseed from CSVs.
    python seed.py --if-empty       # explicit form of the default behaviour.
    python seed.py --migrate-only   # only run index migrations (no data seed).
    python seed.py --summary        # don't write anything, just print counts.

Environment:
    MONGO_URL                       # mongodb connection string (required)
    DB_NAME                         # database name (required) — naturally separates
                                    # preview vs production deployments because each
                                    # environment ships its own .env

What gets seeded (covers all 9 entities in the requirements):
    - manufacturers     (1: Unilever)
    - regions           (derived from distributors.region; not a collection,
                         exposed via /api/hierarchy/regions/{mfg_id})
    - distributors      (~91 from CSV)
    - retailers         (~3,080 from CSV — with GPS lat/lon)
    - products          (15 SKUs with barcodes + category + price)
    - inventory         (~47k rows: mfg + dist + retailer levels)
    - shipments         (deliveries: 12+ seeded with mixed statuses)
    - stock requests    (1+ pending request from a sample retailer)
    - daily_sales       (14 days × sample retailers, drives analytics)
    - notifications     (welcome notifs per workspace)

GPS coordinates ship with every retailer in distributors.csv and are used by
both the Leaflet Nigeria Map View and the radial network visualization.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Make the backend dir importable when running this script directly
sys.path.insert(0, str(Path(__file__).resolve().parent))

from core import db, logger  # noqa: E402
from services.migrations import ensure_indexes  # noqa: E402
from services.seed import seed_from_csv  # noqa: E402


async def current_counts() -> dict:
    return {
        "manufacturers": await db.manufacturers.count_documents({}),
        "distributors": await db.distributors.count_documents({}),
        "retailers": await db.retailers.count_documents({}),
        "products": await db.products.count_documents({}),
        "inventory": await db.inventory.count_documents({}),
        "shipments": await db.shipments.count_documents({}),
        "requests": await db.requests.count_documents({}),
        "daily_sales": await db.daily_sales.count_documents({}),
        "notifications": await db.notifications.count_documents({}),
    }


def _banner(env: str) -> None:
    bar = "═" * 60
    print(f"\n{bar}\n  TradeKonekt seeder · target DB: {env}\n{bar}")


async def main(args: argparse.Namespace) -> int:
    env_name = db.name
    _banner(env_name)

    counts_before = await current_counts()
    is_empty = counts_before["manufacturers"] == 0
    print(f"  Before  →  {_one_line(counts_before)}")

    if args.summary:
        print("  (--summary: no writes performed)\n")
        return 0

    if args.migrate_only:
        idx = await ensure_indexes()
        print(f"  Indexes →  ensured={idx['indexes_ensured']}/{idx['total_specs']} failed={idx['indexes_failed']}")
        return 0

    should_seed = args.force or (args.if_empty and is_empty) or (not args.force and not args.if_empty and is_empty)

    if should_seed:
        if args.force and not is_empty:
            print("  --force: wiping existing data and reseeding from CSVs…")
        else:
            print("  Database is empty — seeding from CSVs…")
        result = await seed_from_csv()
        print(f"  Seed    →  {result}")
    else:
        print("  Database already populated. Skipping seed (use --force to wipe & reseed).")

    idx = await ensure_indexes()
    print(f"  Indexes →  ensured={idx['indexes_ensured']}/{idx['total_specs']} failed={idx['indexes_failed']}")

    counts_after = await current_counts()
    print(f"  After   →  {_one_line(counts_after)}")
    print(f"\n  ✓ Done. Target DB '{env_name}' is ready.\n")
    return 0


def _one_line(counts: dict) -> str:
    parts = [f"{k}={v}" for k, v in counts.items() if v]
    return ", ".join(parts) if parts else "(empty)"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="TradeKonekt seeder & migrator")
    p.add_argument("--force", action="store_true",
                   help="Wipe all collections and reseed (destructive).")
    p.add_argument("--if-empty", action="store_true",
                   help="Seed only when the DB has zero manufacturers (default).")
    p.add_argument("--migrate-only", action="store_true",
                   help="Only run index migrations, no data seeding.")
    p.add_argument("--summary", action="store_true",
                   help="Print current row counts without writing anything.")
    return p.parse_args()


if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main(parse_args()))
    except KeyboardInterrupt:
        print("\nAborted.")
        exit_code = 130
    except Exception as e:
        logger.exception("Seeder failed")
        print(f"\n✗ Seeder failed: {e}")
        exit_code = 1
    sys.exit(exit_code)
