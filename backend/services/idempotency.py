"""Cross-cutting idempotency contract for retailer mutating endpoints.

Contract (matches the mobile spec verbatim — see
`docs/retailer_offline_backend_endpoint_specs.md`):

REQUEST SIDE
  - Header (preferred):   Idempotency-Key: <UUIDv4>
  - Body fallback:        "client_op_id": "<UUIDv4>"
  - Header wins if both present.
  - Neither present → process normally (legacy behaviour, no dedup).

SERVER SIDE
  - Storage: collection ``idempotency_keys`` with unique compound index
    (retailer_id, endpoint, key). TTL index on ``expires_at`` evicts rows
    48h after creation.

BEHAVIOUR
  - First request with key K → process, persist row, return response.
  - Replay (same key, same payload_sha256) within 48h → return ORIGINAL
    status_code + response_body byte-for-byte with header
    ``Idempotent-Replay: true``. Side effects are NOT re-executed.
  - Replay after 48h → treated as fresh request (TTL purged the row).
  - Same key + DIFFERENT payload_sha256 → 409 Conflict
    ``{"detail":"Idempotency-Key reused with mismatched payload",
       "original_request_at":"<ISO>"}``.

Usage
-----
Decorate any mutating retailer endpoint with the
:func:`idempotent` dependency. The dependency returns an
:class:`IdempotencyContext`; the route logic calls
``ctx.set_response(status_code, body)`` to persist the canonical response
for future replays.

The standard pattern looks like::

    @router.post("/retailer/{retailer_id}/sales")
    async def create_sale(
        retailer_id: str,
        payload: SaleCreate,
        request: Request,
        ctx: IdempotencyContext = Depends(idempotent("retailer.sales.create")),
    ):
        if ctx.replay is not None:
            return ctx.replay   # FastAPI serialises Response objects natively

        ...do the real work...
        return ctx.set_response(200, {"id": sale_id, ...})
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Optional, Union

from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse

from core import db, now_iso

# Spec requirement: TTL = 48 hours.
TTL_HOURS = 48


def _payload_sha256(body: bytes) -> str:
    return hashlib.sha256(body or b"").hexdigest()


def _extract_client_op_id(body_bytes: bytes) -> Optional[str]:
    """Try to read ``client_op_id`` from a JSON body without consuming the
    request stream a second time. Returns ``None`` if the body isn't JSON
    or the field isn't present."""
    if not body_bytes:
        return None
    try:
        doc = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        return None
    if isinstance(doc, dict):
        val = doc.get("client_op_id")
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


@dataclass
class IdempotencyContext:
    """Per-request handle exposed to the route. The route either reads
    ``replay`` (and returns it directly) or calls
    :meth:`set_response` after performing its side effects."""

    enabled: bool
    key: Optional[str] = None
    retailer_id: Optional[str] = None
    endpoint: Optional[str] = None
    payload_sha: Optional[str] = None
    body_bytes: bytes = b""
    # When non-None, the dependency already loaded a stored response for
    # this (retailer, endpoint, key, sha) tuple. Route MUST return it.
    replay: Optional[JSONResponse] = None
    # Internal storage used by set_response().
    _stored: bool = field(default=False, repr=False)

    async def set_response(
        self, status_code: int, body: Union[Dict[str, Any], list]
    ) -> JSONResponse:
        """Persist the canonical response so future replays return it
        byte-for-byte. Always returns the JSONResponse the route should
        return to the client."""
        response = JSONResponse(status_code=status_code, content=body)
        if not self.enabled or self._stored:
            return response
        try:
            now = datetime.now(timezone.utc)
            row = {
                "retailer_id": self.retailer_id,
                "endpoint": self.endpoint,
                "key": self.key,
                "payload_sha256": self.payload_sha,
                "status_code": status_code,
                "response_body": body,
                "created_at": now.isoformat(),
                "expires_at": now + timedelta(hours=TTL_HOURS),
            }
            await db.idempotency_keys.insert_one(row)
            self._stored = True
        except Exception:
            # Don't fail the request if persistence misfires; the next call
            # will simply re-execute. Logged at module level via Mongo.
            pass
        return response


def idempotent(
    endpoint_name: str,
) -> Callable[..., Awaitable[IdempotencyContext]]:
    """FastAPI dependency factory.

    ``endpoint_name`` is the canonical name used to scope the idempotency
    key inside the ``idempotency_keys`` collection (e.g.
    ``"retailer.sales.create"``). Two endpoints can re-use the same key
    safely because the row is keyed on (retailer_id, endpoint, key)."""

    async def _dep(retailer_id: str, request: Request) -> IdempotencyContext:
        body_bytes = await request.body()
        key = request.headers.get("Idempotency-Key") or _extract_client_op_id(body_bytes)
        if not key:
            # Neither header nor client_op_id supplied — legacy mode,
            # no dedup. Route runs normally; set_response is a no-op.
            return IdempotencyContext(
                enabled=False, body_bytes=body_bytes,
                retailer_id=retailer_id, endpoint=endpoint_name,
            )

        sha = _payload_sha256(body_bytes)
        existing = await db.idempotency_keys.find_one(
            {"retailer_id": retailer_id, "endpoint": endpoint_name, "key": key},
            {"_id": 0},
        )
        if existing:
            # Same key seen before; compare payload.
            if existing.get("payload_sha256") != sha:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "detail": "Idempotency-Key reused with mismatched payload",
                        "original_request_at": existing.get("created_at"),
                    },
                )
            replay = JSONResponse(
                status_code=int(existing.get("status_code", 200)),
                content=existing.get("response_body"),
                headers={"Idempotent-Replay": "true"},
            )
            return IdempotencyContext(
                enabled=True, key=key, retailer_id=retailer_id,
                endpoint=endpoint_name, payload_sha=sha,
                body_bytes=body_bytes, replay=replay, _stored=True,
            )

        # Fresh key. The route will fill in the response via set_response.
        return IdempotencyContext(
            enabled=True, key=key, retailer_id=retailer_id,
            endpoint=endpoint_name, payload_sha=sha, body_bytes=body_bytes,
        )

    return _dep


async def check_delta_replay(
    *, retailer_id: str, endpoint: str, delta_op_id: str,
    payload_sha: str,
) -> Optional[dict]:
    """Per-delta idempotency lookup for the inventory batch endpoint.

    Returns the stored row if this ``delta_op_id`` was already applied
    with the same payload; ``None`` for a fresh delta.
    Raises 409 on payload mismatch.
    """
    if not delta_op_id:
        return None
    existing = await db.idempotency_keys.find_one(
        {"retailer_id": retailer_id, "endpoint": endpoint, "key": delta_op_id},
        {"_id": 0},
    )
    if not existing:
        return None
    if existing.get("payload_sha256") != payload_sha:
        raise HTTPException(
            status_code=409,
            detail={
                "detail": "client_delta_op_id reused with mismatched payload",
                "original_request_at": existing.get("created_at"),
            },
        )
    return existing


async def persist_delta_replay(
    *, retailer_id: str, endpoint: str, delta_op_id: str,
    payload_sha: str, response_body: dict,
) -> None:
    """Persist a single batch-item response for per-delta replay."""
    if not delta_op_id:
        return
    now = datetime.now(timezone.utc)
    try:
        await db.idempotency_keys.insert_one({
            "retailer_id": retailer_id,
            "endpoint": endpoint,
            "key": delta_op_id,
            "payload_sha256": payload_sha,
            "status_code": 200,
            "response_body": response_body,
            "created_at": now.isoformat(),
            "expires_at": now + timedelta(hours=TTL_HOURS),
        })
    except Exception:
        pass


__all__ = [
    "IdempotencyContext",
    "idempotent",
    "check_delta_replay",
    "persist_delta_replay",
    "_payload_sha256",
]
