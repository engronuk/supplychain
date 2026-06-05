"""Tiny async-safe TTL cache for expensive read endpoints.

This is an in-process cache only — fine for single-pod deployments and
greatly reduces DB pressure when the same dashboard is reloaded by the
same user multiple times within a short window.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


async def cached(key: str, ttl: float, producer: Callable[[], Awaitable[Any]]) -> Any:
    """Return cached value for ``key`` if fresh, else run ``producer`` and store."""
    now = time.time()
    entry = _store.get(key)
    if entry and entry[0] > now:
        return entry[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        entry = _store.get(key)
        if entry and entry[0] > now:
            return entry[1]
        value = await producer()
        _store[key] = (now + ttl, value)
        return value


def invalidate(prefix: str) -> int:
    """Drop every cache entry whose key starts with ``prefix``. Returns count."""
    dropped = 0
    for k in list(_store.keys()):
        if k.startswith(prefix):
            _store.pop(k, None)
            dropped += 1
    return dropped
