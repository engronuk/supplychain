"""Centralised Vertex AI (Gemini) client for TradeKonekt.

This is the **only** place AI calls should originate from. New AI features
must import and use the helpers below — do NOT pull in emergentintegrations.

Auth & config (env vars):
    GCP_PROJECT_ID            — preferred project id (our convention)
    GOOGLE_CLOUD_PROJECT      — fallback / google-genai's native var
    GOOGLE_CLOUD_LOCATION     — Vertex region (defaults to BIGQUERY_LOCATION
                                 then europe-west2)
    GENAI_MODEL_ID            — default model (gemini-2.5-flash)
    GENAI_PRO_MODEL_ID        — heavier model (defaults to DEFAULT_MODEL)

Credentials:
    • Cloud Run (K_SERVICE set) → Application Default Credentials via the
      attached service account. The SA JSON file is IGNORED even if present.
    • Local dev → ADC. If GOOGLE_APPLICATION_CREDENTIALS points to an SA
      JSON file the SDK uses it automatically.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL_FALLBACK = "gemini-2.5-flash"

# Map of deprecated / decommissioned model IDs → their current replacement.
# We rewrite at runtime so an operator who still has `GENAI_MODEL_ID=
# gemini-2.0-flash` set in their deployment env vars doesn't 404 on every
# AI call. The mapping should be conservative — only models that Vertex AI
# has actually removed or that 404 in our regions belong here.
_DEPRECATED_MODELS = {
    "gemini-2.0-flash":          "gemini-2.5-flash",
    "gemini-2.0-flash-001":      "gemini-2.5-flash",
    "gemini-2.0-flash-lite":     "gemini-2.5-flash",
    "gemini-2.0-flash-lite-001": "gemini-2.5-flash",
    "gemini-2.0-pro":            "gemini-2.5-flash",  # 2.0 pro never went GA
    "gemini-1.5-flash":          "gemini-2.5-flash",
    "gemini-1.5-flash-001":      "gemini-2.5-flash",
    "gemini-1.5-flash-002":      "gemini-2.5-flash",
    "gemini-1.5-pro":            "gemini-2.5-flash",
    "gemini-1.5-pro-001":        "gemini-2.5-flash",
    "gemini-1.5-pro-002":        "gemini-2.5-flash",
    "gemini-1.0-pro":            "gemini-2.5-flash",
    "gemini-pro":                "gemini-2.5-flash",
}


def _resolve_model(requested: Optional[str]) -> str:
    """Resolve the requested model ID, rewriting any decommissioned alias.

    Logs at WARNING level the first time a deprecated alias is rewritten so
    operators are nudged to update their env var.
    """
    name = (requested or "").strip()
    if not name:
        return DEFAULT_MODEL_FALLBACK
    if name in _DEPRECATED_MODELS:
        target = _DEPRECATED_MODELS[name]
        # Cache the warning per (alias → target) so we don't spam logs.
        if (name, target) not in _RESOLVE_WARNED:
            logger.warning(
                "[vertex_llm] model '%s' is deprecated/decommissioned in Vertex AI — "
                "auto-rewriting to '%s'. Update GENAI_MODEL_ID to silence this warning.",
                name, target,
            )
            _RESOLVE_WARNED.add((name, target))
        return target
    return name


_RESOLVE_WARNED: set = set()

# Default model — read at import time, rewritten if the operator picked a
# decommissioned alias.
DEFAULT_MODEL = _resolve_model(os.environ.get("GENAI_MODEL_ID"))
# Note: gemini-2.5-pro is not GA in every region (e.g. unavailable in
# europe-west2 as of this writing). Fall back to flash unless the operator
# explicitly opts in via GENAI_PRO_MODEL_ID.
PRO_MODEL     = _resolve_model(os.environ.get("GENAI_PRO_MODEL_ID") or DEFAULT_MODEL)


# ---------------------------------------------------------------------------
# Runtime config helpers — read env at CALL time so values reflect Cloud Run
# injection even if this module was imported before.
# ---------------------------------------------------------------------------
def _project_id() -> str:
    return (
        os.environ.get("GCP_PROJECT_ID")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or ""
    )


def _location() -> str:
    return (
        os.environ.get("GOOGLE_CLOUD_LOCATION")
        or os.environ.get("BIGQUERY_LOCATION")
        or "europe-west2"
    )


def _on_cloud_run() -> bool:
    return bool(os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB"))


@lru_cache(maxsize=1)
def get_client() -> Optional[genai.Client]:
    """Return a memoised Vertex AI client.

    Auth strategy mirrors `bigquery_client`:
      • Cloud Run (K_SERVICE present) → ADC via attached service account.
        The SA JSON file path is ignored even if it accidentally exists.
      • Local dev → ADC; if GOOGLE_APPLICATION_CREDENTIALS points to a real
        file the SDK picks it up automatically.

    The project and location are passed explicitly to the Client so the
    integration works regardless of whether the operator set
    `GCP_PROJECT_ID` (our convention) or `GOOGLE_CLOUD_PROJECT` (google-genai's).
    """
    project = _project_id()
    if not project:
        return None
    if _on_cloud_run():
        # Defensive: never let an accidentally-mounted dev key win on prod.
        os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
    try:
        return genai.Client(vertexai=True, project=project, location=_location())
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
            model=_resolve_model(model or DEFAULT_MODEL),
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
        model=_resolve_model(DEFAULT_MODEL),
        contents=[types.Content(role="user", parts=[audio_part, types.Part(text=instr)])],
        config=cfg,
    )
    return (resp.text or "").strip()


# ---------------------------------------------------------------------------
# Structured JSON completion — deterministic schema-conformant output
# ---------------------------------------------------------------------------
async def complete_json(
    *,
    system: str,
    user: str,
    response_schema: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
    temperature: float = 0.3,
    max_output_tokens: int = 4096,
) -> Any:
    """Run Gemini in JSON-mode and return the parsed payload.

    Uses Vertex AI's controlled-generation feature so the model emits a JSON
    document conforming to `response_schema` (when supplied). Falls back to a
    tolerant ``json.loads`` of the first {...}/[...] block if the model
    sneaks prose around the JSON.
    """
    client = get_client()
    if client is None:
        raise RuntimeError("Vertex AI is not configured")

    import asyncio
    import json as _json
    import re

    cfg = types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=response_schema,
        thinking_config=types.ThinkingConfig(thinking_budget=0),
    )
    contents = [types.Content(role="user", parts=[types.Part(text=user)])]
    # Retry on 429 (RESOURCE_EXHAUSTED) — Vertex AI quota is per-minute.
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            resp = await asyncio.to_thread(
                client.models.generate_content,
                model=_resolve_model(model or DEFAULT_MODEL),
                contents=contents,
                config=cfg,
            )
            last_err = None
            break
        except Exception as e:
            last_err = e
            msg = str(e)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s
                continue
            logger.exception("[vertex_llm] complete_json generate_content failed")
            raise
    if last_err is not None:
        logger.exception("[vertex_llm] complete_json exhausted retries")
        raise last_err

    text = (resp.text or "").strip()
    if not text:
        return None
    try:
        return _json.loads(text)
    except Exception:
        m = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if m:
            return _json.loads(m.group(0))
        raise
