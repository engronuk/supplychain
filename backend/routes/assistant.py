"""Retailer AI Assistant ("Sabi") — Gemini 2.5 Flash by default, escalates to
Claude Sonnet 4.5 for complex queries (long-form drafts, multi-step planning).
Voice input via OpenAI Whisper.
"""
from __future__ import annotations

import json as _json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile

from core import db, logger
from models import (
    AssistantActionPayload, AssistantPayload, RequestLine, StockRequest,
)
from services.helpers import push_notification
from services.retailer import SYSTEM_PROMPT_TEMPLATE, build_retailer_context

router = APIRouter()

# ---------------------------------------------------------------------------
# Model routing — Gemini 2.5 Flash is 10× cheaper and good enough for ~95% of
# the shopkeeper-style questions. Only escalate to Claude Sonnet 4.5 when the
# query clearly needs multi-step planning / long-form drafting.
# ---------------------------------------------------------------------------
DEFAULT_PROVIDER = "gemini"
DEFAULT_MODEL = "gemini-2.5-flash"
COMPLEX_PROVIDER = "anthropic"
COMPLEX_MODEL = "claude-sonnet-4-5-20250929"

# Heuristic triggers — case-insensitive. Anything matching → escalate.
COMPLEX_PATTERNS = re.compile(
    r"\b(draft|create|write|prepare|build|design|generate)\b.*\b("
    r"procurement\s+plan|business\s+plan|marketing\s+plan|launch\s+plan|"
    r"forecast|projection|strategy|proposal|report|analysis|breakdown|roadmap"
    r")\b"
    r"|\b\d+[-\s]?day\b"
    r"|\bcompare\b.+\bvs\b"
    r"|\bstep[-\s]?by[-\s]?step\b"
    r"|\bpros\s+and\s+cons\b",
    re.IGNORECASE,
)


def _route_model(message: str) -> tuple[str, str]:
    """Pick (provider, model) based on the message. Long queries also escalate."""
    if len(message) > 280 or COMPLEX_PATTERNS.search(message or ""):
        return COMPLEX_PROVIDER, COMPLEX_MODEL
    return DEFAULT_PROVIDER, DEFAULT_MODEL


@router.post("/retailer/{retailer_id}/assistant")
async def retailer_assistant(retailer_id: str, payload: AssistantPayload):
    from services import vertex_llm
    if not vertex_llm.is_configured():
        raise HTTPException(500, "Assistant unavailable: Vertex AI is not configured")

    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    context_blob = await build_retailer_context(retailer_id)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        retailer_name=retailer["name"],
        today=datetime.now(timezone.utc).date().isoformat(),
        context=context_blob,
    )

    session_id = payload.session_id or f"retailer-{retailer_id}"
    provider, model = _route_model(payload.message)
    logger.info("Sabi routing: provider=%s model=%s len=%s", provider, model, len(payload.message))

    # Convert history to vertex_llm format. We ignore the legacy "provider" toggle
    # because Vertex AI Gemini is now the only engine.
    history = [{"role": h.role, "content": h.content} for h in payload.history[-8:]]
    try:
        text = await vertex_llm.complete(
            system=system_prompt,
            user=payload.message,
            history=history,
            model=model if model.startswith("gemini") else vertex_llm.DEFAULT_MODEL,
            temperature=0.5,
            max_output_tokens=1200,
        )
    except Exception as e:
        logger.exception("Assistant call failed")
        raise HTTPException(502, f"Assistant error: {e}")

    action: Optional[Dict[str, Any]] = None
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    spoken = text
    if m:
        try:
            action = _json.loads(m.group(1))
            spoken = (text[: m.start()] + text[m.end():]).strip()
        except Exception:
            action = None

    return {
        "reply": spoken, "action": action, "session_id": session_id,
        "model": model, "provider": "vertex-ai",
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
):
    """Transcribe an audio clip using Vertex AI Gemini multimodal input.

    Accepts mp3 / mp4 / m4a / wav / webm / ogg up to 25 MB. Returns:
        { "text": "<transcript>" }
    """
    from services import vertex_llm
    if not vertex_llm.is_configured():
        raise HTTPException(500, "Voice input unavailable: Vertex AI is not configured")

    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

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
async def retailer_assistant_execute(retailer_id: str, payload: AssistantActionPayload):
    """Execute a structured action returned by the assistant (server-side validated)."""
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

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
