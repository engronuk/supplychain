"""Seed POST endpoint."""
from __future__ import annotations

from fastapi import APIRouter

from services.seed import seed_from_csv

router = APIRouter()


@router.post("/seed")
async def seed_data():
    return await seed_from_csv()
