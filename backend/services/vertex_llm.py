"""Centralised Vertex AI (Gemini) client for TradeKonekt.

This is the **only** place AI calls should originate from. New AI features
must import and use the helpers below — do NOT pull in emergentintegrations.

Auth & config come from environment variables that were set up during the
GCP rollout (`backend/.env` locally, Cloud Run env on production):
    GOOGLE_GENAI_USE_VERTEXAI=true     # route google-genai through Vertex
    GOOGLE_CLOUD_PROJECT=<project-id>
    GOOGLE_CLOUD_LOCATION=<region>     # e.g. europe-west2
    GOOGLE_APPLICATION_CREDENTIALS=<path/to/sa-key.json>   # local only
    GENAI_MODEL_ID=gemini-2.5-flash    # default
    GENAI_PRO_MODEL_ID=gemini-2.5-pro  # for deeper/longer reasoning
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL = os.environ.get("GENAI_MODEL_ID", "gemini-2.5-flash")
# Note: gemini-2.5-pro is not GA in every region (e.g. unavailable in
# europe-west2 as of this writing). Fall back to flash unless the operator
# explicitly opts in via GENAI_PRO_MODEL_ID.
PRO_MODEL     = os.environ.get("GENAI_PRO_MODEL_ID", DEFAULT_MODEL)


@lru_cache(maxsize=1)
def get_client() -> Optional[genai.Client]:
    """Return a memoised Vertex AI client (None if not configured)."""
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return None
    try:
        # google-genai picks up ADC + the GOOGLE_GENAI_USE_VERTEXAI flag.
        return genai.Client()
    except Exception:
        logger.exception("[vertex_llm] client init failed")
        return None


def is_configured() -> bool:
    return get_client() is not None


# ---------------------------------------------------------------------------
# Single-shot completion
# ---------------------------------------------------------------------------
async def complete(
    *,
    system: str,
    user: str,
    history: Optional[List[Dict[str, str]]] = None,
    model: Optional[str] = None,
    temperature: float = 0.4,
    max_output_tokens: int = 1024,
) -> str:
    """Generate a single text response from Gemini.

    `history` is a list of `{role: "user"|"model", content: str}` turns.
    The system prompt is passed as `system_instruction`; conversational
    history is converted to `Content` objects.
    """
    client = get_client()
    if client is None:
        raise RuntimeError("Vertex AI is not configured (GOOGLE_CLOUD_PROJECT missing)")

    contents: List[types.Content] = []
    for h in history or []:
        role = "user" if h.get("role") == "user" else "model"
        text = str(h.get("content", "")).strip()
        if not text:
            continue
        contents.append(types.Content(role=role, parts=[types.Part(text=text)]))
    contents.append(types.Content(role="user", parts=[types.Part(text=user)]))

    cfg = types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        system_instruction=system,
        # Gemini 2.5 reserves a "thinking" budget that otherwise eats the
        # output cap and returns empty text. Disable it for our use case.
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )

    # google-genai is synchronous-by-default; run in a thread to keep async
    # callers from blocking the event loop.
    import asyncio
    try:
        resp = await asyncio.to_thread(
            client.models.generate_content,
            model=(model or DEFAULT_MODEL),
            contents=contents,
            config=cfg,
        )
    except Exception:
        logger.exception("[vertex_llm] generate_content failed")
        raise

    return (resp.text or "").strip()


# ---------------------------------------------------------------------------
# Multimodal audio transcription — Whisper replacement
# ---------------------------------------------------------------------------
async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """Use Gemini multimodal input to transcribe an audio clip.

    Gemini 2.5 Flash accepts audio parts directly; we ask it to return the
    transcription text only.
    """
    client = get_client()
    if client is None:
        raise RuntimeError("Vertex AI is not configured")

    audio_part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
    instr = (
        "Transcribe the user's spoken audio. Return ONLY the verbatim transcript "
        "as plain text. No commentary, no quotation marks, no formatting."
    )
    cfg = types.GenerateContentConfig(
        temperature=0.0,
        max_output_tokens=2048,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )
    import asyncio
    resp = await asyncio.to_thread(
        client.models.generate_content,
        model=DEFAULT_MODEL,
        contents=[types.Content(role="user", parts=[audio_part, types.Part(text=instr)])],
        config=cfg,
    )
    return (resp.text or "").strip()
