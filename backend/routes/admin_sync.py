"""Production "Sync Now" admin endpoint.

Lets an operator reset a deployed environment to the canonical preview
state (curated 5-tier hierarchy + 12 months of dense historical sales).
Designed for use after a fresh deploy when production has drifted from
preview.

Security:
    Protected by the standard ``super_admin`` JWT role — the same gate
    the rest of the admin console uses. There is no separate "admin
    sync token" to copy-paste; sign in as super_admin and you have
    access. For automated/curl-from-shell use cases, set ``ADMIN_SYNC_TOKEN``
    env var and pass it via the ``X-Admin-Token`` header — that path is
    optional and acts as a side-door for headless ops.

Endpoints:
    POST /api/admin/sync/diff      Dry-run — returns current counts +
                                   what a sync would change.
    POST /api/admin/sync/apply     Wipes & rebuilds the hierarchy, then
                                   runs the 12-month backfill and
                                   recomputes stock-exhaustion forecasts.
                                   Requires confirmation token in body.
    GET  /api/admin/sync/status    Returns the last sync marker.

Body for /apply:
    {
        "confirm": "I_UNDERSTAND_THIS_WIPES_DATA",
        "backfill_history": true,           # default true
        "recompute_forecasts": true         # default true
    }
"""
from __future__ import annotations

import asyncio
import os
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from core import db, logger
from services.auth import require_role

router = APIRouter(tags=["admin-sync"])

CONFIRM_PHRASE = "I_UNDERSTAND_THIS_WIPES_DATA"
_super_admin = require_role("super_admin")


def _check_admin_token(token: Optional[str]) -> bool:
    """Returns True if the ``X-Admin-Token`` header matches the env var.
    Acts as a headless escape-hatch for curl-from-shell ops; the
    primary auth is the super_admin JWT.
    """
    expected = (os.environ.get("ADMIN_SYNC_TOKEN") or "").strip()
    if not expected or not token:
        return False
    return token.strip() == expected


async def _require_super_admin_or_token(
    request: Request,
    x_admin_token: Optional[str] = Header(None),
):
    """Dual auth: super_admin JWT OR the legacy X-Admin-Token header.
    Either is sufficient.  The header is optional — if both are
    missing/invalid the JWT path raises 401/403.
    """
    if _check_admin_token(x_admin_token):
        return {"via": "token"}
    user = await _super_admin(request)
    return {"via": "jwt", "user": user}


async def _current_counts() -> Dict[str, Any]:
    """Snapshot of what's currently in this database — feeds the diff view."""
    type_counts: Dict[str, int] = {}
    async for row in db.organizations.aggregate([
        {"$group": {"_id": "$organization_type", "c": {"$sum": 1}}},
    ]):
        type_counts[row["_id"] or "?"] = row["c"]
    return {
        "organizations_by_type": type_counts,
        "daily_sales": await db.daily_sales.count_documents({}),
        "intel_forecasts": await db.intel_forecasts.count_documents({}),
        "users": await db.users.count_documents({}),
        "inventory_rows": await db.inventory.count_documents({}),
        "purchase_orders": await db.purchase_orders.count_documents({}),
        "wholesaler_orders": await db.wholesaler_orders.count_documents({}),
        "shipments": await db.shipments.count_documents({}),
        "vehicles": await db.vehicles.count_documents({}),
    }


# Canonical target state — what `scripts/rebuild.py` produces for preview.
# Sourced from the live preview DB. Used in /diff for the "after" preview.
CANONICAL_TARGET: Dict[str, Any] = {
    "organizations_by_type": {
        "manufacturer": 2,
        "warehouse": 6,
        "distributor": 12,
        "wholesaler": 36,
        "retailer": 168,
    },
    "daily_sales_floor": 500_000,
    "users_min": 200,
    "inventory_rows_min": 2_000,
}


class ApplyPayload(BaseModel):
    confirm: str = Field(..., description=f"Must equal '{CONFIRM_PHRASE}'")
    backfill_history: bool = True
    recompute_forecasts: bool = True


@router.get("/admin/sync/status")
async def sync_status(_auth=Depends(_require_super_admin_or_token)):
    """Returns the most recent canonical-sync marker (if any)."""
    last_sync = await db.seed_meta.find_one(
        {"key": "last_admin_sync"}, {"_id": 0},
    )
    canonical = await db.seed_meta.find_one(
        {"key": "canonical_rebuild_v1"}, {"_id": 0},
    )
    in_flight = await db.seed_meta.find_one(
        {"key": "admin_sync_in_flight"}, {"_id": 0},
    )
    return {
        "configured": True,
        "in_flight": in_flight,
        "last_sync": last_sync,
        "canonical_rebuild": canonical,
        "current": await _current_counts(),
        "target": CANONICAL_TARGET,
    }


@router.post("/admin/sync/diff")
async def sync_diff(_auth=Depends(_require_super_admin_or_token)):
    """Dry-run — shows the operator what a /apply would change."""
    current = await _current_counts()
    target_orgs = CANONICAL_TARGET["organizations_by_type"]
    current_orgs = current["organizations_by_type"]
    delta: Dict[str, int] = {}
    for kind, want in target_orgs.items():
        have = current_orgs.get(kind, 0)
        delta[kind] = want - have
    # collections that will be wiped (mirrors scripts/rebuild.py KEEP set)
    keep = {"users", "simulation_settings", "route_cache", "geofences",
            "seed_meta"}
    all_collections = await db.list_collection_names()
    to_wipe = [c for c in sorted(all_collections) if c not in keep]
    return {
        "current": current,
        "target": target_orgs,
        "organization_delta": delta,
        "collections_to_wipe": to_wipe,
        "notes": [
            "Apply will WIPE the listed collections then rebuild the strict "
            "5-tier hierarchy (Mfr → Warehouse → Distributor → Wholesaler → "
            "Retailer) for Unilever and Flour Mills Nigeria.",
            "It re-seeds 90 days of operational data (orders, inventory, "
            "shipments) + 12 months of dense daily_sales history.",
            "`users` collection is PRESERVED — only the demo accounts in "
            "the canonical set are rewritten/added.",
            "Idempotent: re-running will produce the same state.",
        ],
    }


async def _run_canonical_sync(*, backfill_history: bool,
                              recompute_forecasts: bool) -> Dict[str, Any]:
    """Heavy lifter — refuses to import unless an admin actually calls it."""
    from scripts.rebuild import run_rebuild
    from scripts.backfill_history import backfill as run_backfill

    started = datetime.now(timezone.utc).isoformat()
    log_lines: list[str] = []

    def _log(msg: str) -> None:
        log_lines.append(str(msg))
        logger.info("[admin-sync] %s", msg)

    # 1) Wipe + rebuild hierarchy
    try:
        rebuild_report = await run_rebuild(db, log=_log)
    except Exception as exc:
        logger.exception("admin-sync rebuild failed")
        err_record = {
            "key": "last_admin_sync",
            "started_at": started,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "status": "error",
            "stage": "rebuild",
            "error": str(exc),
            "log_tail": log_lines[-30:],
        }
        await db.seed_meta.update_one(
            {"key": "last_admin_sync"},
            {"$set": err_record},
            upsert=True,
        )
        return {
            "status": "error",
            "stage": "rebuild",
            "error": str(exc),
            "traceback": traceback.format_exc(),
            "log": log_lines,
        }

    # 2) Optional history backfill (~530k rows for 12 dense months)
    backfill_result: Dict[str, Any] = {"skipped": True}
    if backfill_history:
        try:
            backfill_result = await run_backfill(db=db)
        except Exception as exc:
            logger.exception("admin-sync backfill failed")
            backfill_result = {"error": str(exc),
                               "traceback": traceback.format_exc()}

    # 3) Optional forecast recompute
    forecasts_result: Dict[str, Any] = {"skipped": True}
    if recompute_forecasts:
        try:
            from services.intel.forecasts import compute_stock_exhaustion
            tenants: list[Dict[str, Any]] = []
            async for org in db.organizations.find(
                {"organization_type": "manufacturer"}, {"_id": 0, "id": 1},
            ):
                tenants.append(org)
            tally: Dict[str, int] = {}
            for org in tenants:
                res = await compute_stock_exhaustion(org["id"])
                tally[org["id"]] = res.get("forecasts", 0)
            forecasts_result = {"per_tenant": tally,
                                "total": sum(tally.values())}
        except Exception as exc:
            logger.exception("admin-sync forecast recompute failed")
            forecasts_result = {"error": str(exc),
                                "traceback": traceback.format_exc()}

    # 4) Clear cached snapshots so the dashboards pick up the new data
    try:
        snap_cleared = await db.dashboard_snapshots.delete_many({})
        snap_cleared_count = snap_cleared.deleted_count
    except Exception:
        snap_cleared_count = -1

    # 5) Persist a sync record for auditing
    finished = datetime.now(timezone.utc).isoformat()
    record = {
        "key": "last_admin_sync",
        "started_at": started,
        "finished_at": finished,
        "rebuild": rebuild_report,
        "backfill": backfill_result,
        "forecasts": forecasts_result,
        "snapshots_cleared": snap_cleared_count,
    }
    await db.seed_meta.update_one(
        {"key": "last_admin_sync"},
        {"$set": record},
        upsert=True,
    )

    return {
        "status": "ok",
        "started_at": started,
        "finished_at": finished,
        "rebuild_summary": {
            k: v for k, v in rebuild_report.items()
            if k in ("hierarchy_health", "tier_counts", "wiped")
        },
        "backfill": backfill_result,
        "forecasts": forecasts_result,
        "snapshots_cleared": snap_cleared_count,
        "after": await _current_counts(),
        "log_tail": log_lines[-30:],
    }


@router.post("/admin/sync/apply")
async def sync_apply(
    payload: ApplyPayload,
    _auth=Depends(_require_super_admin_or_token),
):
    """Kick off the canonical sync as a background task and return 202.

    The job typically takes 4-6 minutes (wipe + rebuild + 12mo backfill +
    forecast recompute). The HTTP response cannot reasonably block that
    long behind a Cloud Run / gunicorn timeout, so we return immediately
    and let the operator poll ``/api/admin/sync/status`` for completion.
    """
    if payload.confirm != CONFIRM_PHRASE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Body field 'confirm' must equal '{CONFIRM_PHRASE}'.",
        )

    # Refuse if another sync is already running (poor-man's mutex).
    running = await db.seed_meta.find_one(
        {"key": "admin_sync_in_flight"}, {"_id": 0},
    )
    if running:
        return {
            "status": "already_running",
            "started_at": running.get("started_at"),
            "message": (
                "A sync is already in progress. Poll "
                "/api/admin/sync/status to see completion. If you're "
                "sure no sync is running, delete the 'admin_sync_in_flight' "
                "doc from seed_meta to force-clear the lock."
            ),
        }

    started = datetime.now(timezone.utc).isoformat()
    await db.seed_meta.update_one(
        {"key": "admin_sync_in_flight"},
        {"$set": {"key": "admin_sync_in_flight", "started_at": started}},
        upsert=True,
    )

    async def _job():
        try:
            result = await _run_canonical_sync(
                backfill_history=payload.backfill_history,
                recompute_forecasts=payload.recompute_forecasts,
            )
            logger.info("[admin-sync] job complete: %s", result.get("status"))
        except Exception:
            logger.exception("[admin-sync] background job crashed")
        finally:
            await db.seed_meta.delete_one({"key": "admin_sync_in_flight"})

    # Fire-and-forget — task pinned to the app loop so gunicorn/uvicorn
    # keep it alive for the worker's lifetime.
    asyncio.create_task(_job())

    return {
        "status": "accepted",
        "started_at": started,
        "message": (
            "Sync started in the background. Poll "
            "/api/admin/sync/status — the 'last_sync' field updates "
            "when the job completes (typically 4-6 minutes)."
        ),
        "estimated_duration_seconds": 360,
    }
