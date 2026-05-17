"""AI-powered insight generation via Claude Haiku (emergentintegrations).

Falls back to deterministic placeholders when LLM key/library is missing.
"""
from __future__ import annotations

import json as _json
import os
import re
import time
from typing import Dict, List, Tuple

from core import logger

_INSIGHTS_CACHE: Dict[str, Tuple[float, List[dict]]] = {}  # key -> (expires_at, insights)


async def generate_ai_insights(*, prompt_id: str, kind: str, context: str) -> List[dict]:
    """Returns 3-5 short, action-oriented insights as JSON objects.

    Cached for 5 minutes to avoid hammering the LLM on every page load.
    """
    cached = _INSIGHTS_CACHE.get(prompt_id)
    if cached and cached[0] > time.time():
        return cached[1]

    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        return _fallback_insights(kind, context)

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception:
        return _fallback_insights(kind, context)

    system = (
        "You are a supply-chain analytics advisor. Reply with STRICT JSON ONLY: "
        "an array of 3-5 insight objects. Each object must have:\n"
        '  "tone"  : "positive" | "warning" | "critical" | "info"\n'
        '  "icon"  : one of "trending-up","trending-down","sparkles","alert-octagon","alert-triangle","clock","shield-check","trophy","info"\n'
        '  "title" : <= 70 chars, no markdown\n'
        '  "detail": <= 140 chars, single actionable line\n'
        "No prose, no markdown fences, no commentary — only the JSON array."
    )
    chat = (
        LlmChat(api_key=api_key, session_id=prompt_id, system_message=system)
        .with_model("anthropic", "claude-haiku-4-5-20251001")
    )
    try:
        resp = await chat.send_message(UserMessage(text=context))
        text = str(resp or "").strip()
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            return _fallback_insights(kind, context)
        parsed = _json.loads(m.group(0))
        clean: List[dict] = []
        for item in parsed[:5]:
            clean.append({
                "tone": item.get("tone", "info"),
                "icon": item.get("icon", "info"),
                "title": str(item.get("title", "")).strip()[:90],
                "detail": str(item.get("detail", "")).strip()[:180],
            })
        _INSIGHTS_CACHE[prompt_id] = (time.time() + 300, clean)
        return clean
    except Exception:
        logger.exception("AI insights generation failed")
        return _fallback_insights(kind, context)


def _fallback_insights(kind: str, context: str) -> List[dict]:
    return [{
        "tone": "info", "icon": "info",
        "title": "Insights unavailable",
        "detail": "Could not contact the LLM service — showing baseline view.",
    }]
