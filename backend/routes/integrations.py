"""Integrations CRUD — ``/api/integrations``.

Per-tenant connection state for third-party services. The catalogue of
supported integrations is hard-coded here (in lockstep with the playbook
docs) so the mobile and web Integrations Hub can render an ``available``
list even when nothing is connected yet.

Storage
-------
Single Mongo collection ``integrations`` keyed by ``(org_id, slug)``. We
intentionally do NOT store secrets in plain text — ``credentials_blob``
is treated as opaque and any caller-side encryption is preserved verbatim.
For now the field is left unencrypted; production should swap in
``services.security.encrypt`` once that helper lands.

Routes
------
* ``GET    /api/integrations``                 — catalog with connection state
* ``GET    /api/integrations/{slug}``          — single state row
* ``POST   /api/integrations/{slug}/connect``  — body: ``{config?, credentials_blob?}``
* ``DELETE /api/integrations/{slug}``          — disconnect
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, new_id
from services.auth import get_current_user as require_auth

router = APIRouter()


# ---------------------------------------------------------------------------
# Catalogue — keep in lockstep with /app/integration_playbooks/
# ---------------------------------------------------------------------------
CATALOGUE: List[Dict[str, Any]] = [
    {"slug": "google_maps",   "name": "Google Maps Platform",   "category": "logistics",
     "description": "Live geocoding + Directions API for the Logistics Command Center.",
     "config_schema": ["api_key"], "playbook": "GOOGLE_MAPS_INTEGRATION.md"},
    {"slug": "vertex_ai",     "name": "Vertex AI (Gemini)",     "category": "ai",
     "description": "Generative reasoning powering Logistics AI insights.",
     "config_schema": ["service_account_json"], "playbook": "VERTEX_AI_INTEGRATION.md"},
    {"slug": "resend",        "name": "Resend",                 "category": "email",
     "description": "Transactional email + compliance alert delivery.",
     "config_schema": ["api_key", "from_email"], "playbook": "RESEND_INTEGRATION.md"},
    {"slug": "twilio_sms",    "name": "Twilio SMS",             "category": "messaging",
     "description": "OTP + alert SMS for retailers and drivers.",
     "config_schema": ["account_sid", "auth_token", "from_number"], "playbook": "TWILIO_INTEGRATION.md"},
    {"slug": "stripe",        "name": "Stripe",                 "category": "payments",
     "description": "Card + bank-transfer settlement for invoices.",
     "config_schema": ["publishable_key", "secret_key", "webhook_secret"], "playbook": "STRIPE_INTEGRATION.md"},
    {"slug": "openai",        "name": "OpenAI",                 "category": "ai",
     "description": "GPT for chat assistants and content generation.",
     "config_schema": ["api_key"], "playbook": "OPENAI_INTEGRATION.md"},
    {"slug": "elevenlabs",    "name": "ElevenLabs",             "category": "voice",
     "description": "Text-to-speech for in-app voice prompts.",
     "config_schema": ["api_key"], "playbook": "ELEVENLABS_INTEGRATION.md"},
    {"slug": "google_oauth",  "name": "Google Sign-In",         "category": "auth",
     "description": "OAuth login for back-office users.",
     "config_schema": ["client_id", "client_secret"], "playbook": "GOOGLE_AUTH_INTEGRATION.md"},
]
SLUG_TO_META = {c["slug"]: c for c in CATALOGUE}
ALLOWED_DISPATCHER_ROLES = ("manufacturer", "distributor", "wholesaler", "super_admin")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_org(user: Dict[str, Any]) -> str:
    """Return the org_id the caller manages — hard 403 for non-dispatcher roles."""
    role = user.get("role")
    if role not in ALLOWED_DISPATCHER_ROLES:
        raise HTTPException(403, {"code": "FORBIDDEN_ROLE", "role": role})
    org = (user.get("entity_id") or user.get("manufacturer_id") or "").strip()
    if not org and role != "super_admin":
        raise HTTPException(400, {"code": "NO_TENANT_FOR_USER"})
    return org


def _strip_secrets(row: Dict[str, Any]) -> Dict[str, Any]:
    """Never echo the credentials_blob back over the wire."""
    out = {k: v for k, v in row.items() if k != "credentials_blob"}
    out["credentials_present"] = bool(row.get("credentials_blob"))
    return out


class ConnectPayload(BaseModel):
    config: Optional[Dict[str, Any]] = Field(default=None)
    credentials_blob: Optional[str] = Field(default=None,
                                            description="Opaque secret payload — caller should encrypt before sending.")
    notes: Optional[str] = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
@router.get("/integrations", response_model=Dict[str, Any])
async def list_integrations(user: Dict[str, Any] = Depends(require_auth)):
    org = _resolve_org(user)
    connections: Dict[str, Dict[str, Any]] = {}
    cursor = db.integrations.find({"org_id": org}, {"_id": 0})
    async for c in cursor:
        connections[c["slug"]] = _strip_secrets(c)

    items: List[Dict[str, Any]] = []
    for entry in CATALOGUE:
        slug = entry["slug"]
        conn = connections.get(slug)
        items.append({
            **entry,
            "status": (conn or {}).get("status", "available"),
            "connected_at": (conn or {}).get("connected_at"),
            "last_validated_at": (conn or {}).get("last_validated_at"),
            "credentials_present": bool(conn and conn.get("credentials_present")),
            "config": (conn or {}).get("config"),
            "notes": (conn or {}).get("notes"),
        })
    return {"items": items,
            "total": len(items),
            "connected_count": sum(1 for i in items if i["status"] == "connected"),
            "org_id": org}


@router.get("/integrations/{slug}", response_model=Dict[str, Any])
async def get_integration(slug: str, user: Dict[str, Any] = Depends(require_auth)):
    if slug not in SLUG_TO_META:
        raise HTTPException(404, {"code": "UNKNOWN_INTEGRATION", "slug": slug})
    org = _resolve_org(user)
    conn = await db.integrations.find_one({"org_id": org, "slug": slug}, {"_id": 0})
    base = {**SLUG_TO_META[slug], "status": "available", "credentials_present": False}
    if conn:
        base.update(_strip_secrets(conn))
    return base


@router.post("/integrations/{slug}/connect", response_model=Dict[str, Any])
async def connect_integration(slug: str,
                              payload: ConnectPayload = Body(default_factory=ConnectPayload),
                              user: Dict[str, Any] = Depends(require_auth)):
    if slug not in SLUG_TO_META:
        raise HTTPException(404, {"code": "UNKNOWN_INTEGRATION", "slug": slug})
    org = _resolve_org(user)
    now = _now_iso()
    existing = await db.integrations.find_one({"org_id": org, "slug": slug}, {"_id": 0, "id": 1})
    record = {
        "org_id": org,
        "slug": slug,
        "status": "connected",
        "config": payload.config or {},
        "credentials_blob": payload.credentials_blob,
        "notes": payload.notes,
        "connected_at": now,
        "last_validated_at": now,
        "connected_by_user_id": user.get("id"),
        "updated_at": now,
    }
    if existing:
        await db.integrations.update_one({"id": existing["id"]}, {"$set": record})
        record["id"] = existing["id"]
    else:
        record["id"] = new_id()
        record["created_at"] = now
        await db.integrations.insert_one(record)
    return _strip_secrets({**SLUG_TO_META[slug], **record})


@router.delete("/integrations/{slug}", response_model=Dict[str, Any])
async def disconnect_integration(slug: str,
                                 user: Dict[str, Any] = Depends(require_auth)):
    if slug not in SLUG_TO_META:
        raise HTTPException(404, {"code": "UNKNOWN_INTEGRATION", "slug": slug})
    org = _resolve_org(user)
    res = await db.integrations.delete_one({"org_id": org, "slug": slug})
    return {"slug": slug, "disconnected": bool(res.deleted_count),
            "status": "available"}
