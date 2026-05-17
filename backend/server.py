"""TradeKonekt FastAPI entry — routers are registered from /backend/routes."""
from __future__ import annotations

import os

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import client, db, logger
from routes import (
    analytics,
    assistant,
    distributor,
    entities,
    geo,
    hierarchy,
    inventory,
    notifications,
    reports,
    retailer_os,
    sales,
    seed as seed_route,
    shipments,
    stock_requests,
)
from services.seed import seed_from_csv
from services.migrations import ensure_indexes

app = FastAPI(title="TradeKonekt API")
api_router = APIRouter(prefix="/api")

# All domain routers share the /api prefix
for r in (
    entities.router,
    inventory.router,
    shipments.router,
    stock_requests.router,
    notifications.router,
    analytics.router,
    reports.router,
    hierarchy.router,
    geo.router,
    distributor.router,
    retailer_os.router,
    assistant.router,
    sales.router,
    seed_route.router,
):
    api_router.include_router(r)

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def auto_seed_if_needed():
    """On boot: ensure indexes (idempotent) and auto-seed when the DB is empty.

    This is what makes a fresh PRODUCTION deployment usable on first request
    without a manual migration step. If the data dir is missing in the
    deployed image, the seed will short-circuit gracefully (empty inserts).
    """
    try:
        idx = await ensure_indexes()
        logger.info("Indexes ensured: %s", idx)
    except Exception:
        logger.exception("ensure_indexes failed on startup (continuing)")

    if await db.manufacturers.count_documents({}) == 0:
        logger.info("Empty manufacturer collection — auto-seeding from CSVs.")
        try:
            result = await seed_from_csv()
            logger.info("Auto-seed complete: %s", result)
        except Exception:
            logger.exception("Auto-seed failed — run `python seed.py --force` manually.")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
