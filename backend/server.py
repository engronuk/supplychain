"""TradeKonekt FastAPI entry — routers are registered from /backend/routes."""
from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from core import client, db, logger
from routes import (
    analytics,
    assistant,
    auth,
    distributor,
    distributor_intelligence,
    distributor_network,
    distributor_orders,
    distributor_os,
    shipment_command,
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
    uploads,
)
from services.intel.scheduler import start_scheduler, stop_scheduler
from services.migrations import ensure_indexes
from services.seed import seed_from_csv
from services.seed_batches import seed_batches
from services.seed_demo_users import seed_demo_users
from services.seed_distributor_orders import seed_distributor_orders
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
    distributor_orders.router,
    distributor_os.router,
    shipment_command.router,
    manufacturer.router,
    product_intelligence.router,
    product_detail.router,
    retailer_os.router,
    assistant.router,
    sales.router,
    intel.router,
    seed_route.router,
    uploads.router,
):
    api_router.include_router(r)

app.include_router(api_router)

# Serve uploaded files (product images, etc.) — mounted under /api so the
# Kubernetes ingress routes the requests to the backend pod.
_static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(_static_dir, exist_ok=True)
app.mount("/api/static", StaticFiles(directory=_static_dir), name="static")

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
    # In production we never want to run demo seeding / mass date refreshes.
    # Atlas can take 60-90s to apply ~100k updates on a small cluster which
    # can race with the readiness probe and cause CrashLoopBackOff. Skip the
    # whole demo block when ENVIRONMENT == "production". We DO still start
    # the intel scheduler AND pre-warm dashboard snapshots in production so
    # the very first page hit returns < 1 s.
    environment = (os.environ.get("ENVIRONMENT") or "").strip().lower()
    is_production = environment == "production"

    if is_production:
        logger.info("ENVIRONMENT=production — skipping demo seed/refresh routines.")
        try:
            start_scheduler()
        except Exception:
            logger.exception("Failed to start intel scheduler")
        # Pre-warm dashboard snapshots so the very first request is instant.
        try:
            await _prewarm_dashboard_snapshots()
        except Exception:
            logger.exception("Failed to pre-warm dashboard snapshots")
        logger.info("Background bootstrap complete (production mode).")
        return

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

    # Idempotent distributor → manufacturer order seed — used by the
    # Shipment Command Center's order-fulfillment queue.
    try:
        result = await seed_distributor_orders()
        if result.get("created"):
            logger.info("Distributor orders seeded: %s", result)
    except Exception:
        logger.exception("Distributor order seed failed (continuing)")

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


async def _prewarm_dashboard_snapshots():
    """Compute & store snapshots for every manufacturer so the first user
    request hits a warm Mongo doc instead of paying the 20-60 s build cost.

    Runs once during the production startup path. Errors per-tenant are
    isolated so a single bad row can't block the rest.
    """
    from services.snapshots import get_snapshot, set_snapshot
    from routes.manufacturer import _build_manufacturer_overview
    from routes.product_intelligence import _build_product_intelligence
    from routes.shipment_command import _build_shipment_command
    from routes.distributor_network import _build_distributor_network

    builders = {
        "overview": _build_manufacturer_overview,
        "product-intelligence": _build_product_intelligence,
        "shipment-command": _build_shipment_command,
        "distributor-network": _build_distributor_network,
    }
    cursor = db.manufacturers.find({}, {"_id": 0, "id": 1})
    tenant_ids = [doc["id"] async for doc in cursor]
    logger.info("Pre-warming dashboard snapshots for %d tenant(s)…", len(tenant_ids))
    for mid in tenant_ids:
        for kind, build in builders.items():
            try:
                existing = await get_snapshot(kind, mid)
                if existing:
                    continue
                payload = await build(mid)
                await set_snapshot(kind, mid, payload)
                logger.info("Pre-warmed snapshot %s for %s", kind, mid)
            except Exception:
                logger.exception("Pre-warm failed for %s:%s", kind, mid)


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        stop_scheduler()
    except Exception:
        pass
    client.close()
