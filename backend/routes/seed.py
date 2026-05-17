"""Seed + migration endpoints (production-callable)."""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from core import db
from services.migrations import ensure_indexes
from services.seed import seed_from_csv
from services.seed_backfill import (
    backfill_all, backfill_inventory, backfill_notifications,
    backfill_sample_requests, backfill_sample_shipments,
)
from services.seed_daily_sales import seed_daily_sales

router = APIRouter()


async def _primary_ids() -> dict:
    """Resolve the canonical primary distributor + retailer.

    First checks the `seed_meta` doc (persisted at seed time so the values
    survive idempotent skip-paths). Falls back to insertion-order discovery
    so older databases that pre-date seed_meta still get a sensible answer.
    """
    meta = await db.seed_meta.find_one({"id": "primary"}, {"_id": 0})
    if meta and meta.get("primary_distributor_id"):
        return {
            "primary_distributor_id": meta["primary_distributor_id"],
            "primary_retailer_id": meta.get("primary_retailer_id"),
        }
    distributors = await db.distributors.find({}, {"_id": 0}).to_list(5000)
    if not distributors:
        return {"primary_distributor_id": None, "primary_retailer_id": None}
    primary_d = distributors[0]
    primary_r = await db.retailers.find_one(
        {"distributor_id": primary_d["id"]}, {"_id": 0, "id": 1},
    )
    return {
        "primary_distributor_id": primary_d["id"],
        "primary_retailer_id": (primary_r or {}).get("id"),
    }


@router.post("/seed")
async def seed_data():
    """Idempotent seed: only seeds when the DB is empty. Always returns the
    canonical primary distributor / retailer IDs so callers don't have to
    branch on the "skipped vs fresh" shape.
    """
    if await db.manufacturers.count_documents({}) > 0:
        return {"ok": True, "skipped": True, "reason": "database already populated",
                **(await _primary_ids())}
    result = await seed_from_csv()
    await ensure_indexes()
    return {"ok": True, "seeded": True, **result}


@router.post("/seed/force")
async def seed_force(token: str = ""):
    """DESTRUCTIVE — wipes & reseeds. Requires SEED_ADMIN_TOKEN env var to match.

    Use to fully reset production demo data:
        curl -X POST 'https://www.app.tradekonekt.com/api/seed/force?token=YOUR_TOKEN'
    """
    expected = os.environ.get("SEED_ADMIN_TOKEN", "")
    if not expected:
        raise HTTPException(503, "SEED_ADMIN_TOKEN not configured on this server")
    if token != expected:
        raise HTTPException(401, "Invalid seed admin token")
    result = await seed_from_csv()
    await ensure_indexes()
    return {"ok": True, "reseeded": True, **result}


@router.post("/migrate")
async def migrate():
    """Run index migrations only. Idempotent — safe to call from production."""
    idx = await ensure_indexes()
    return {"ok": True, **idx}


@router.post("/seed/daily-sales")
async def seed_daily_sales_endpoint(
    days: int = 30,
    retailers_limit: int = 200,
    force: bool = False,
):
    """Generate realistic historical daily_sales for retailers/products.

    Idempotent — only inserts rows missing from the (retailer_id, product_id,
    date) key space for the requested window.

    Query params:
      - days: history depth ending today (default 30, max 120)
      - retailers_limit: top-N retailers by velocity to seed (default 200, max 5000)
      - force: wipe this seeder's prior rows in the window first (default false)
    """
    return await seed_daily_sales(
        days=days, retailers_limit=retailers_limit, force=force,
    )


@router.post("/seed/inventory")
async def seed_inventory_endpoint(retailers_limit: int = 5000):
    """Backfill inventory rows for any owner missing them.

    Idempotent — skips owner_id × product_id pairs that already exist.
    Use this when master data is present but the inventory collection is
    empty (typical state of a fresh production deployment).
    """
    return await backfill_inventory(retailers_limit=retailers_limit)


@router.post("/seed/notifications")
async def seed_notifications_endpoint():
    """Create welcome notifications for primary manufacturer / distributor /
    retailer if no notifications exist. Idempotent."""
    return await backfill_notifications()


@router.post("/seed/sample-requests")
async def seed_sample_requests_endpoint():
    """Create a single demo pending stock request if none exist. Idempotent."""
    return await backfill_sample_requests()


@router.post("/seed/sample-shipments")
async def seed_sample_shipments_endpoint():
    """Create 6 demo shipments (mfg→dist + dist→ret) if none exist. Idempotent."""
    return await backfill_sample_shipments()


@router.post("/seed/backfill")
async def seed_backfill_endpoint(retailers_limit: int = 5000):
    """One-shot backfill of inventory + notifications + sample requests +
    sample shipments for environments with master data only.

    Idempotent — each sub-step only writes what's missing. Recommended order
    after a fresh deployment:
      1) POST /api/seed                     (master data — if empty)
      2) POST /api/seed/backfill            (operational data — this endpoint)
      3) POST /api/seed/daily-sales         (analytics history)
    """
    return await backfill_all(retailers_limit=retailers_limit)
