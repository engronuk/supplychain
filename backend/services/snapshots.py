"""Persistent dashboard snapshots — the "Intel module" pattern for heavy
read endpoints.

Each heavy endpoint stores its last-computed payload in a Mongo collection
``dashboard_snapshots`` so subsequent reads are always cheap. A scheduled
APScheduler job (and an explicit "Refresh" button on the UI) recomputes the
payload off the read path. The very first read for a tenant returns a
"computing" placeholder immediately and schedules the build in the
background so the request never blocks for more than a Mongo round-trip.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from core import db, logger

# Per-key locks so concurrent cold-start requests don't fan out to N parallel
# builds of the same payload.
_build_locks: dict[str, asyncio.Lock] = {}
_building: set[str] = set()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _key(kind: str, manufacturer_id: str) -> str:
    return f"{kind}:{manufacturer_id}"


async def get_snapshot(kind: str, manufacturer_id: str) -> Optional[dict]:
    return await db.dashboard_snapshots.find_one(
        {"key": _key(kind, manufacturer_id)}, {"_id": 0},
    )


async def set_snapshot(kind: str, manufacturer_id: str, payload: dict) -> dict:
    doc = {
        "key": _key(kind, manufacturer_id),
        "kind": kind,
        "manufacturer_id": manufacturer_id,
        "computed_at": now_iso(),
        "payload": payload,
    }
    await db.dashboard_snapshots.update_one(
        {"key": doc["key"]}, {"$set": doc}, upsert=True,
    )
    return doc


async def _build_in_background(
    kind: str,
    manufacturer_id: str,
    producer: Callable[[], Awaitable[dict]],
) -> None:
    """Compute and store a snapshot under a per-key lock."""
    k = _key(kind, manufacturer_id)
    lock = _build_locks.setdefault(k, asyncio.Lock())
    if k in _building:
        return
    async with lock:
        if k in _building:
            return
        _building.add(k)
        try:
            payload = await producer()
            await set_snapshot(kind, manufacturer_id, payload)
        except Exception:
            logger.exception("background snapshot build failed for %s", k)
        finally:
            _building.discard(k)


def _placeholder_envelope(kind: str) -> dict:
    """Empty-but-valid payload returned while the first compute is in flight."""
    return {
        "kpis": {},
        "shipments": [],
        "regional": [],
        "distributor_performance": [],
        "exceptions": [],
        "pipeline": {},
        "portfolio": [],
        "performance_matrix": [],
        "batch_health": {},
        "expiry_risk": {},
        "category_performance": [],
        "geographic_heatmap": [],
        "stock_risk": [],
        "recent_alerts": [],
        "ai_brief": {"insights": [], "recommended_actions": []},
        "ai_summary": [],
        "coverage_kpis": {},
        "top_products": [],
        "fastest_growing_categories": [],
        "demand_forecast": [],
        "stockout_risk": [],
        "distributor_table": [],
        "distributors_table": [],
        "alerts": [],
        "_snapshot": {
            "as_of": None,
            "kind": kind,
            "fresh": False,
            "computing": True,
        },
    }


async def read_or_compute(
    kind: str,
    manufacturer_id: str,
    producer: Callable[[], Awaitable[dict]],
) -> dict:
    """Return the latest snapshot envelope; never blocks on cold compute.

    Response envelope:
        { ...payload, "_snapshot": { "as_of": ISO, "kind": kind,
                                     "fresh": bool, "computing": bool } }
    """
    snap = await get_snapshot(kind, manufacturer_id)
    if snap:
        payload = snap.get("payload") or {}
        return {
            **payload,
            "_snapshot": {
                "as_of": snap.get("computed_at"),
                "kind": kind,
                "fresh": False,
                "computing": False,
            },
        }
    # Cold path — kick off compute in background, return a placeholder.
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(_build_in_background(kind, manufacturer_id, producer))
    except Exception:
        logger.exception("could not schedule background build for %s:%s", kind, manufacturer_id)
    return _placeholder_envelope(kind)


async def recompute(
    kind: str,
    manufacturer_id: str,
    producer: Callable[[], Awaitable[dict]],
) -> dict:
    """Force a recompute synchronously, persist, and return the envelope."""
    try:
        payload = await producer()
    except Exception:
        logger.exception("snapshot recompute failed for %s:%s", kind, manufacturer_id)
        raise
    await set_snapshot(kind, manufacturer_id, payload)
    return {
        **payload,
        "_snapshot": {"as_of": now_iso(), "kind": kind, "fresh": True, "computing": False},
    }


async def refresh_all_snapshots(producers: dict[str, Callable[[str], Awaitable[dict]]]):
    """Periodic background refresh — called by the intel scheduler."""
    manufacturer_ids = [
        m["id"] async for m in db.manufacturers.find({}, {"_id": 0, "id": 1})
    ]
    for mid in manufacturer_ids:
        for kind, fn in producers.items():
            try:
                payload = await fn(mid)
                await set_snapshot(kind, mid, payload)
            except Exception:
                logger.exception("snapshot refresh failed for %s:%s", kind, mid)
