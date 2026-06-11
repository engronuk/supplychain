"""Super-admin Simulation Control Panel routes."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, Field

from core import db
from services.auth import require_role
from services.simulator import (
    SIMULATOR_MARKER,
    get_runtime,
    get_settings,
    list_participants,
    purge_generated,
    trigger_one_tick,
    update_settings,
    LEVEL_INTERVALS_SEC,
)

logger = logging.getLogger("tradekonekt.simulator.routes")

router = APIRouter(tags=["admin-simulator"])


_admin_only = require_role("super_admin")


# ---------------------------------------------------------------------------
# GET /api/admin/simulator -- status overview.
# ---------------------------------------------------------------------------
@router.get("/admin/simulator")
async def simulator_status(_admin=Depends(_admin_only)) -> Dict[str, Any]:
    settings = await get_settings()
    runtime = get_runtime()
    participants = await list_participants()
    last_runs = await db.simulation_runs.find(
        {}, {"_id": 0},
    ).sort("started_at", -1).limit(5).to_list(5)
    # Live count of generated docs across the purgeable collections.
    counts: Dict[str, int] = {}
    for col in (
        "retail_sales", "distributor_orders", "wholesaler_orders",
        "shipments", "wholesaler_shipments", "order_allocations",
        "inventory_transfers", "replenishment_requests", "notifications",
    ):
        try:
            counts[col] = await db[col].count_documents(
                {"generated_by": SIMULATOR_MARKER},
            )
        except Exception:
            counts[col] = 0

    return {
        "settings": settings,
        "running": runtime.running,
        "intervals_sec": LEVEL_INTERVALS_SEC,
        "participants": {
            "total": len(participants),
            "by_type": _group_by_type(participants),
            "list": participants,
        },
        "recent_runs": last_runs,
        "generated_counts": counts,
        "marker": SIMULATOR_MARKER,
    }


def _group_by_type(rows: List[dict]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rows:
        t = r.get("organization_type", "unknown")
        out[t] = out.get(t, 0) + 1
    return out


# ---------------------------------------------------------------------------
# POST /api/admin/simulator/toggle -- enable / disable.
# ---------------------------------------------------------------------------
class ToggleBody(BaseModel):
    enabled: bool


@router.post("/admin/simulator/toggle")
async def simulator_toggle(body: ToggleBody, _admin=Depends(_admin_only)):
    settings = await update_settings(enabled=bool(body.enabled))
    runtime = get_runtime()
    if body.enabled and not runtime.running:
        runtime.start()
    runtime.wake()
    return settings


# ---------------------------------------------------------------------------
# POST /api/admin/simulator/level -- change activity level.
# ---------------------------------------------------------------------------
class LevelBody(BaseModel):
    level: str = Field(..., pattern="^(low|medium|high)$")


@router.post("/admin/simulator/level")
async def simulator_level(body: LevelBody, _admin=Depends(_admin_only)):
    settings = await update_settings(activity_level=body.level)
    get_runtime().wake()  # so the new interval kicks in immediately
    return settings


# ---------------------------------------------------------------------------
# POST /api/admin/simulator/tick -- force a single tick now.
# ---------------------------------------------------------------------------
@router.post("/admin/simulator/tick")
async def simulator_tick(_admin=Depends(_admin_only)):
    return await trigger_one_tick()


# ---------------------------------------------------------------------------
# GET /api/admin/simulator/events -- recent run log.
# ---------------------------------------------------------------------------
@router.get("/admin/simulator/events")
async def simulator_events(
    limit: int = Query(50, ge=1, le=500),
    _admin=Depends(_admin_only),
):
    rows = await db.simulation_runs.find(
        {}, {"_id": 0},
    ).sort("started_at", -1).limit(limit).to_list(limit)
    return {"rows": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# DELETE /api/admin/simulator/purge -- hard wipe of simulator-generated data.
# ---------------------------------------------------------------------------
@router.delete("/admin/simulator/purge")
async def simulator_purge(_admin=Depends(_admin_only)):
    deleted = await purge_generated()
    # Reset run-level counters (settings doc is preserved).
    await update_settings(total_ticks=0, total_events=0)
    return {"deleted": deleted, "total_deleted": sum(deleted.values())}


# ---------------------------------------------------------------------------
# POST /api/admin/simulator/participants/tag -- bulk flag entities.
# ---------------------------------------------------------------------------
class TagBody(BaseModel):
    organization_ids: List[str] = Field(default_factory=list)
    organization_names: List[str] = Field(default_factory=list)
    enable: bool = True


@router.post("/admin/simulator/participants/tag")
async def simulator_tag(body: TagBody, _admin=Depends(_admin_only)):
    if not (body.organization_ids or body.organization_names):
        raise HTTPException(400, "organization_ids or organization_names required")
    or_clauses: List[dict] = []
    if body.organization_ids:
        or_clauses.append({"id": {"$in": body.organization_ids}})
    if body.organization_names:
        regexes = [
            {"organization_name": {"$regex": f"^{name.strip()}", "$options": "i"}}
            for name in body.organization_names if name.strip()
        ]
        or_clauses.extend(regexes)
    if not or_clauses:
        raise HTTPException(400, "no matching criteria")
    result = await db.organizations.update_many(
        {"$or": or_clauses},
        {"$set": {"simulation_participant": bool(body.enable)}},
    )
    return {
        "matched": result.matched_count,
        "modified": result.modified_count,
        "enabled": bool(body.enable),
    }
