"""TradeKonekt FastAPI entry — routers are registered from /backend/routes."""
from __future__ import annotations

import os

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import client, db, logger
from routes import (
    analytics,
    assistant,
    auth,
    distributor,
    entities,
    geo,
    hierarchy,
    intel,
    inventory,
    manufacturer,
    notifications,
    product_detail,
    product_intelligence,
    reports,
    retailer_os,
    sales,
    seed as seed_route,
    shipments,
    stock_requests,
)
from services.intel.scheduler import start_scheduler, stop_scheduler
from services.migrations import ensure_indexes
from services.seed import seed_from_csv
from services.seed_batches import seed_batches
from services.seed_demo_users import seed_demo_users

app = FastAPI(title="TradeKonekt API")
api_router = APIRouter(prefix="/api")

# All domain routers share the /api prefix
for r in (
    auth.router,
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
    manufacturer.router,
    product_intelligence.router,
    product_detail.router,
    retailer_os.router,
    assistant.router,
    sales.router,
    intel.router,
    seed_route.router,
):
    api_router.include_router(r)

app.include_router(api_router)

# CORS: when CORS_ORIGINS is unset (or "*"), use a regex that matches any
# origin AND echoes it back per-request. The CORS spec forbids responding
# with `Access-Control-Allow-Origin: *` when `Allow-Credentials: true`, which
# is what was breaking the browser /demo fetch on production. Setting an
# explicit list via CORS_ORIGINS still works.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
_cors_kwargs: dict = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if _cors_origins_env and _cors_origins_env != "*":
    _cors_kwargs["allow_origins"] = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    # Match every https origin (and localhost for dev). Browsers will get the
    # exact origin echoed back so withCredentials works.
    _cors_kwargs["allow_origin_regex"] = r"https?://.*"

app.add_middleware(CORSMiddleware, **_cors_kwargs)


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

    # Idempotent demo-user seed — creates super-admin + 1:1 demo accounts on
    # first boot. Safe to call every boot: existing users are left untouched.
    try:
        result = await seed_demo_users()
        if result.get("created"):
            logger.info("Demo users seeded: %s", result)
    except Exception:
        logger.exception("Demo user seed failed (continuing)")

    # Idempotent batch seed — ensures every product has 3 traceable batches.
    try:
        result = await seed_batches()
        if result.get("created"):
            logger.info("Batches seeded: %s", result)
    except Exception:
        logger.exception("Batch seed failed (continuing)")

    # Start the proactive intelligence layer. Each job has its own staggered
    # first-run time so the heavy ones don't all kick off at once on boot.
    # No initial pass is launched at startup — the scheduler's staggered
    # first runs handle the cold-start case, and /api/intel/recompute is
    # available for on-demand kicks.
    try:
        start_scheduler()
    except Exception:
        logger.exception("Intel scheduler failed to start")


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        stop_scheduler()
    except Exception:
        pass
    client.close()
