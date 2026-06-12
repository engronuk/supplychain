"""TradeKonekt Activity Simulator — core service.

Generates realistic low-volume activity on a tight loop so dashboards,
forecasts, intelligence centers, maps and KPIs stay populated even when
no real users are signed in.

Design rules:
    • SYSTEM_SIMULATOR marker — every doc the simulator creates carries
      `generated_by="SYSTEM_SIMULATOR"`. Purge is a hard delete keyed on
      this marker.
    • Tag-based allowlist — organizations carrying
      `simulation_participant=true` are the *only* entities the simulator
      touches. A doc must never be created against any other tenant.
    • Tenant isolation — each generated activity is scoped to the
      participant's existing tenant (manufacturer_id). The simulator
      never crosses tenant boundaries.
    • Auto-start on boot — driven by `simulation_settings.enabled`
      (default True on first run, persisted thereafter).
    • Cadence — Low = 10 min, Medium = 3 min, High = 1 min.

The actual activity generators live in `services/simulator_generators.py`
to keep this loop small + auditable.
"""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core import db
from services.simulator_generators import run_cycle

logger = logging.getLogger("tradekonekt.simulator")

SIMULATOR_MARKER = "SYSTEM_SIMULATOR"

# Activity-level → seconds between ticks. Confirmed by user.
LEVEL_INTERVALS_SEC: Dict[str, int] = {
    "low": 10 * 60,
    "medium": 3 * 60,
    "high": 1 * 60,
}

# How many activities each tick fires, per level. Tuned to "low-volume but
# present" — visible on dashboards within minutes, not overwhelming.
LEVEL_ACTIVITY_COUNTS: Dict[str, Dict[str, int]] = {
    "low":    {"retail_sales": 2, "distributor_orders": 1, "shipments": 1, "intel_events": 1},
    "medium": {"retail_sales": 5, "distributor_orders": 2, "shipments": 2, "intel_events": 1},
    "high":   {"retail_sales": 12, "distributor_orders": 4, "shipments": 3, "intel_events": 2},
}

SETTINGS_ID = "__singleton__"


# ---------------------------------------------------------------------------
# Settings persistence (singleton doc in `simulation_settings`).
# ---------------------------------------------------------------------------
async def get_settings() -> Dict[str, Any]:
    """Return the singleton settings doc, creating defaults the first time."""
    doc = await db.simulation_settings.find_one({"_id": SETTINGS_ID})
    if not doc:
        doc = {
            "_id": SETTINGS_ID,
            "enabled": True,
            "activity_level": "low",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "last_tick_at": None,
            "last_error": None,
            "total_ticks": 0,
            "total_events": 0,
        }
        await db.simulation_settings.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def update_settings(**fields: Any) -> Dict[str, Any]:
    if not fields:
        return await get_settings()
    await db.simulation_settings.update_one(
        {"_id": SETTINGS_ID}, {"$set": fields}, upsert=True,
    )
    return await get_settings()


# ---------------------------------------------------------------------------
# Participant discovery (tag-based allowlist).
# ---------------------------------------------------------------------------
async def list_participants() -> List[Dict[str, Any]]:
    """Return every organization currently flagged as a sim participant."""
    cursor = db.organizations.find(
        {"simulation_participant": True},
        {"_id": 0, "id": 1, "organization_name": 1, "organization_type": 1,
         "parent_organization_id": 1, "city": 1, "state": 1, "region": 1,
         "metadata": 1},
    )
    return await cursor.to_list(5000)


# ---------------------------------------------------------------------------
# Background loop. Owned by FastAPI lifespan; started in server.py.
# ---------------------------------------------------------------------------
class SimulatorRuntime:
    """Single instance held on `app.state`. Owns the asyncio task + a stop
    event so we can cooperatively cancel on shutdown or on a settings flip.
    """

    def __init__(self) -> None:
        self._task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop())

    def stop(self) -> None:
        if not self.running:
            return
        self._stop.set()
        self._wake.set()

    def wake(self) -> None:
        """Force the loop to re-read settings (e.g., after a level change)."""
        self._wake.set()

    async def _loop(self) -> None:
        logger.info("[simulator] background loop started")
        while not self._stop.is_set():
            self._wake.clear()
            try:
                settings = await get_settings()
            except Exception:
                logger.exception("[simulator] failed to read settings")
                settings = {"enabled": False, "activity_level": "low"}

            interval = LEVEL_INTERVALS_SEC.get(
                settings.get("activity_level", "low"), 600,
            )

            if settings.get("enabled"):
                try:
                    await self._tick(settings)
                except Exception as exc:
                    logger.exception("[simulator] tick failed")
                    await update_settings(last_error=str(exc))

            # Sleep until interval elapses OR something asks us to wake.
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
        logger.info("[simulator] background loop stopped")

    async def _tick(self, settings: Dict[str, Any]) -> None:
        level = settings.get("activity_level", "low")
        counts = LEVEL_ACTIVITY_COUNTS.get(level, LEVEL_ACTIVITY_COUNTS["low"])
        now = datetime.now(timezone.utc).isoformat()
        run_doc = {
            "started_at": now,
            "activity_level": level,
            "generated_by": SIMULATOR_MARKER,
            "events": [],
            "errors": [],
        }
        try:
            participants = await list_participants()
            events_generated = 0
            if participants:
                tally = await run_cycle(participants, counts, rng=random)
                events_generated = sum(tally.values())
                run_doc["events"] = tally
            run_doc["events_generated"] = events_generated
            run_doc["ended_at"] = datetime.now(timezone.utc).isoformat()
            await db.simulation_runs.insert_one(run_doc)
            await update_settings(
                last_tick_at=now,
                total_ticks=int(settings.get("total_ticks", 0)) + 1,
                total_events=int(settings.get("total_events", 0)) + events_generated,
                last_error=None,
            )
        except Exception as exc:
            run_doc["errors"].append(str(exc))
            run_doc["ended_at"] = datetime.now(timezone.utc).isoformat()
            try:
                await db.simulation_runs.insert_one(run_doc)
            except Exception:
                pass
            raise


# Module-level singleton (filled by `attach_to_app`).
_runtime: Optional[SimulatorRuntime] = None


def get_runtime() -> SimulatorRuntime:
    global _runtime
    if _runtime is None:
        _runtime = SimulatorRuntime()
    return _runtime


async def trigger_one_tick() -> Dict[str, Any]:
    """Force-run a single tick now (used by the manual button on the panel)."""
    settings = await get_settings()
    runtime = get_runtime()
    await runtime._tick(settings)
    return await get_settings()


# ---------------------------------------------------------------------------
# Purge — hard delete every doc carrying `generated_by == SIMULATOR_MARKER`.
# Keeps run-log + settings (they don't carry the marker).
# ---------------------------------------------------------------------------
PURGEABLE_COLLECTIONS = [
    "wholesaler_orders",
    "wholesaler_shipments",
    "wholesaler_fulfillment_orders",
    "distributor_orders",
    "order_allocations",
    "shipments",
    "retail_sales",
    "sales",
    "daily_sales",
    "inventory_transfers",
    "replenishment_requests",
    "notifications",
    "wholesaler_inventory_movements",
    "inventory_movements",
]


async def purge_generated() -> Dict[str, int]:
    deleted: Dict[str, int] = {}
    for col in PURGEABLE_COLLECTIONS:
        try:
            result = await db[col].delete_many({"generated_by": SIMULATOR_MARKER})
            if result.deleted_count:
                deleted[col] = result.deleted_count
        except Exception:
            logger.exception("[simulator] purge failed for %s", col)
    # Also wipe simulation_runs so the panel starts fresh.
    runs = await db.simulation_runs.delete_many({"generated_by": SIMULATOR_MARKER})
    if runs.deleted_count:
        deleted["simulation_runs"] = runs.deleted_count
    return deleted
