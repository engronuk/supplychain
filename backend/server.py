"""TradeKonekt FastAPI entry — routers are registered from /backend/routes."""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core import client, db, logger
from routes import (
    analytics,
    assistant,
    auth,
    distributor,
    distributor_intelligence,
    distributor_network,
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
from services.refresh_demo_dates import refresh_demo_dates

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
    distributor_intelligence.router,
    distributor_network.router,
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
async def boot_app():
    """Open the HTTP port FAST, then bootstrap the database in the background.

    On a cold deploy against Atlas, seeding 47k inventory rows + 3k retailers
    + running the demo-date refresh (~98k updates) easily takes 60-90s. If
    that work runs inside the startup hook, uvicorn never binds the socket
    until it finishes — Kubernetes' readiness probe times out, kills the
    pod, and the deploy enters a CrashLoopBackOff (visible in the logs as
    repeated 'Indexes ensured' lines + nginx 'Connection refused' upstream
    errors).

    We keep `ensure_indexes()` blocking (idempotent, sub-second) so any
    query that arrives the moment the port opens has the right indexes.
    Everything else is offloaded.
    """
    try:
        idx = await ensure_indexes()
        logger.info("Indexes ensured: %s", idx)
    except Exception:
        logger.exception("ensure_indexes failed on startup (continuing)")

    # Fire-and-forget. The task keeps a reference on the app state so the
    # garbage collector doesn't drop it mid-flight.
    app.state.bootstrap_task = asyncio.create_task(_background_bootstrap())


async def _background_bootstrap():
    """Heavy, deploy-aware bootstrap that runs AFTER the port is open."""
    if await db.manufacturers.count_documents({}) == 0:
        logger.info("Empty manufacturer collection — auto-seeding from CSVs.")
        try:
            result = await seed_from_csv()
            logger.info("Auto-seed complete: %s", result)
            # Freshly-seeded data already has current timestamps — skip the
            # refresh pass to avoid churning 98k docs on a cold deploy.
            fresh_seed = True
        except Exception:
            logger.exception("Auto-seed failed — run `python seed.py --force` manually.")
            fresh_seed = False
    else:
        fresh_seed = False

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

    # Refresh seeded date fields so the demo always looks "actively used
    # today". Skipped immediately after a fresh seed (data is already
    # current). Idempotent — safe to run on every subsequent boot.
    if not fresh_seed:
        try:
            result = await refresh_demo_dates()
            logger.info(
                "Demo dates refreshed: %d documents updated across %d collections",
                result.get("total_docs_updated", 0), len(result.get("operations", [])),
            )
        except Exception:
            logger.exception("Demo date refresh failed (continuing)")
    else:
        logger.info("Demo date refresh skipped (fresh seed has current timestamps).")

    # Start the proactive intelligence layer. Each job has its own staggered
    # first-run time so the heavy ones don't all kick off at once on boot.
    try:
        start_scheduler()
        logger.info("Background bootstrap complete.")
    except Exception:
        logger.exception("Failed to start intel scheduler")


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        stop_scheduler()
    except Exception:
        pass
    client.close()
