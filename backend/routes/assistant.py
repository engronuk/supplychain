"""Retailer AI Assistant ("Sabi") — Vertex AI (Gemini 2.5 Flash) only.

This route is strictly tenant-scoped: callers can only interact with the
Sabi assistant of a retailer they own (or super-admins, for support).
Cross-tenant calls are rejected with 403. The system prompt and the data
context provided to Gemini are also strictly limited to the requested
retailer's records — no other retailer / distributor / manufacturer data
is read or exposed.
"""
from __future__ import annotations

import json as _json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core import db, logger
from models import (
    AssistantActionPayload, AssistantPayload, RequestLine, StockRequest,
)
from services.auth import get_current_user
from services.helpers import push_notification
from services.retailer import SYSTEM_PROMPT_TEMPLATE, build_retailer_context

router = APIRouter()


# ---------------------------------------------------------------------------
# Tenant scope guard — the caller must own the retailer they're chatting with.
# ---------------------------------------------------------------------------
async def _assert_can_access_retailer(retailer_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    """Verify the authenticated user can interact with `retailer_id`.

    Allowed callers:
      • The retailer itself (role=retailer, entity_id matches).
      • super_admin (for support / debug).

    Returns the retailer record (without `_id`) on success, raises 403/404
    on failure.
    """
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    role = (user.get("role") or "").lower()
    entity_id = user.get("entity_id") or ""

    if role == "super_admin":
        return retailer
    if role == "retailer" and entity_id == retailer_id:
        return retailer

    logger.warning(
        "Sabi cross-tenant access denied: user=%s role=%s entity=%s → retailer=%s",
        user.get("id"), role, entity_id, retailer_id,
    )
    raise HTTPException(403, "Sabi is scoped to your own store only.")


@router.post("/retailer/{retailer_id}/assistant")
async def retailer_assistant(
    retailer_id: str,
    payload: AssistantPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    from services import vertex_llm
    if not vertex_llm.is_configured():
        raise HTTPException(500, "Assistant unavailable: Vertex AI is not configured")

    retailer = await _assert_can_access_retailer(retailer_id, user)

    # Strictly scoped to THIS retailer. build_retailer_context only queries
    # records keyed by retailer_id.
    context_blob = await build_retailer_context(retailer_id)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        retailer_id=retailer_id,
        retailer_name=retailer["name"],
        today=datetime.now(timezone.utc).date().isoformat(),
        context=context_blob,
    )

    session_id = payload.session_id or f"retailer-{retailer_id}"
    model = vertex_llm.DEFAULT_MODEL
    logger.info("Sabi call: retailer=%s user=%s model=%s len=%s",
                retailer_id, user.get("id"), model, len(payload.message))

    history = [{"role": h.role, "content": h.content} for h in payload.history[-8:]]
    try:
        text = await vertex_llm.complete(
            system=system_prompt,
            user=payload.message,
            history=history,
            model=model,
            temperature=0.5,
            max_output_tokens=1200,
        )
    except Exception as e:
        msg = str(e)
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            logger.warning("Sabi: Vertex AI quota exhausted for retailer=%s", retailer_id)
            raise HTTPException(503, "Sabi is briefly busy (AI rate limit reached). Please try again in a minute.")
        logger.exception("Assistant call failed")
        raise HTTPException(502, f"Assistant error: {e}")

    action = None
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    spoken = text
    if m:
        try:
            action = _json.loads(m.group(1))
            spoken = (text[: m.start()] + text[m.end():]).strip()
        except Exception:
            action = None

    return {
        "reply":      spoken,
        "action":     action,
        "session_id": session_id,
        "model":      model,
        "provider":   "vertex-ai",
    }


# ============================================================================
# Voice input — Gemini multimodal audio transcription
# ============================================================================
_ALLOWED_AUDIO_EXTS = {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg"}
_ALLOWED_AUDIO_MIME = {
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/m4a", "audio/x-m4a",
    "audio/wav", "audio/wave", "audio/x-wav",
    "audio/webm", "audio/ogg", "audio/oga",
    "video/mp4", "video/webm",
}
_MAX_AUDIO_BYTES = 25 * 1024 * 1024


@router.post("/retailer/{retailer_id}/assistant/transcribe")
async def retailer_assistant_transcribe(
    retailer_id: str,
    audio: UploadFile = File(...),
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Transcribe an audio clip using Vertex AI Gemini multimodal input.

    Accepts mp3 / mp4 / m4a / wav / webm / ogg up to 25 MB. Returns:
        { "text": "<transcript>" }
    Tenant-scoped: caller must own this retailer.
    """
    from services import vertex_llm
    if not vertex_llm.is_configured():
        raise HTTPException(500, "Voice input unavailable: Vertex AI is not configured")

    await _assert_can_access_retailer(retailer_id, user)

    ext = ((audio.filename or "").rsplit(".", 1)[-1] or "").lower()
    if (audio.content_type or "") not in _ALLOWED_AUDIO_MIME and ext not in _ALLOWED_AUDIO_EXTS:
        raise HTTPException(415, f"Unsupported audio type ({audio.content_type or ext})")

    data = await audio.read()
    if not data:
        raise HTTPException(400, "Empty audio file")
    if len(data) > _MAX_AUDIO_BYTES:
        raise HTTPException(413, "Audio file exceeds 25 MB limit")

    mime = audio.content_type or {
        "mp3": "audio/mpeg", "mp4": "audio/mp4", "m4a": "audio/m4a",
        "wav": "audio/wav", "webm": "audio/webm", "ogg": "audio/ogg",
    }.get(ext, "audio/webm")

    try:
        text = await vertex_llm.transcribe_audio(data, mime_type=mime)
    except Exception as e:
        logger.exception("Voice transcription failed")
        raise HTTPException(502, f"Transcription error: {e}")

    return {"text": text}


@router.post("/retailer/{retailer_id}/assistant/execute")
async def retailer_assistant_execute(
    retailer_id: str,
    payload: AssistantActionPayload,
    user: Dict[str, Any] = Depends(get_current_user),
):
    """Execute a structured action returned by the assistant (server-side validated).

    Tenant-scoped: caller must own this retailer.
    """
    retailer = await _assert_can_access_retailer(retailer_id, user)

    a = payload.action or {}
    kind = a.get("action")
    if kind == "reorder":
        items_in = a.get("items", []) or []
        all_products = await db.products.find({}, {"_id": 0}).to_list(5000)
        items: List[Dict[str, Any]] = []
        unresolved: List[str] = []
        for it in items_in:
            name = str(it.get("product_name", "")).strip().lower()
            qty = int(it.get("quantity", 0) or 0)
            if not name or qty <= 0:
                continue
            best = None
            best_score = 0
            for p in all_products:
                pn = p["name"].lower()
                if name in pn or pn in name:
                    score = len(pn) - abs(len(pn) - len(name))
                    if score > best_score:
                        best = p
                        best_score = score
            if best:
                items.append({"product_id": best["id"], "quantity": qty})
            else:
                unresolved.append(it.get("product_name", "?"))
        if not items:
            return {"ok": False, "error": "No products resolved", "unresolved": unresolved}

        req = StockRequest(
            retailer_id=retailer_id,
            distributor_id=retailer["distributor_id"],
            items=[RequestLine(**it) for it in items],
            note="Reorder via AI assistant",
        )
        await db.requests.insert_one(req.model_dump())
        await push_notification(
            "distributor", retailer["distributor_id"],
            "New Stock Request",
            f"{retailer['name']} sent a reorder via AI assistant ({len(items)} item(s)).",
            "request",
        )
        return {"ok": True, "request_id": req.id, "items_count": len(items), "unresolved": unresolved}

    return {"ok": True, "ui_action": kind}
