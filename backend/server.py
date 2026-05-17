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
    seed as seed_route,
    shipments,
    stock_requests,
)
from services.seed import seed_from_csv

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
    if await db.manufacturers.count_documents({}) == 0:
        logger.info("Empty manufacturer collection — auto-seeding from CSVs.")
        await seed_from_csv()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
