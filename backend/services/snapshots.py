"""Persistent dashboard snapshots — the "Intel module" pattern for heavy
read endpoints.

Each heavy endpoint stores its last-computed payload in a Mongo collection
``dashboard_snapshots`` so subsequent reads are always cheap. A scheduled
APScheduler job (and an explicit "Refresh" button on the UI) recomputes the
payload off the read path.

Snapshot document shape:
    { key: "<kind>:<manufacturer_id>",
      computed_at: ISO-8601 string,
      payload: <arbitrary dict> }
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from core import db, logger


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


async def read_or_compute(
    kind: str,
    manufacturer_id: str,
    producer: Callable[[], Awaitable[dict]],
) -> dict:
    """Return the latest snapshot envelope; compute & persist on first miss.

    Response envelope:
        { ...payload, "_snapshot": { "as_of": ISO, "kind": kind, "fresh": bool } }
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
            },
        }
    # Cold path — compute once, store, return.
    payload = await producer()
    await set_snapshot(kind, manufacturer_id, payload)
    return {
        **payload,
        "_snapshot": {"as_of": now_iso(), "kind": kind, "fresh": True},
    }


async def recompute(
    kind: str,
    manufacturer_id: str,
    producer: Callable[[], Awaitable[dict]],
) -> dict:
    """Force a recompute, persist, and return the freshly built envelope."""
    try:
        payload = await producer()
    except Exception:
        logger.exception("snapshot recompute failed for %s:%s", kind, manufacturer_id)
        raise
    await set_snapshot(kind, manufacturer_id, payload)
    return {
        **payload,
        "_snapshot": {"as_of": now_iso(), "kind": kind, "fresh": True},
    }


async def refresh_all_snapshots(producers: dict[str, Callable[[str], Awaitable[dict]]]):
    """Periodic background refresh — called by the intel scheduler.

    ``producers`` maps ``kind`` -> ``async (manufacturer_id) -> payload``.
    """
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
