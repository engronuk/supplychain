"""Seed + migration endpoints (production-callable)."""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from core import db
from services.migrations import ensure_indexes
from services.seed import seed_from_csv

router = APIRouter()


@router.post("/seed")
async def seed_data():
    """Idempotent seed: only seeds when the DB is empty. Safe to expose."""
    if await db.manufacturers.count_documents({}) > 0:
        return {"ok": True, "skipped": True, "reason": "database already populated"}
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
