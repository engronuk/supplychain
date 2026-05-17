"""Retailer AI Assistant (Aisle) — Claude Haiku via emergentintegrations."""
from __future__ import annotations

import json as _json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

from core import db, logger
from models import (
    AssistantActionPayload, AssistantPayload, RequestLine, StockRequest,
)
from services.helpers import push_notification
from services.retailer import SYSTEM_PROMPT_TEMPLATE, build_retailer_context

router = APIRouter()


@router.post("/retailer/{retailer_id}/assistant")
async def retailer_assistant(retailer_id: str, payload: AssistantPayload):
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(500, "Assistant unavailable: missing LLM key")

    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as e:
        raise HTTPException(500, f"emergentintegrations unavailable: {e}")

    context_blob = await build_retailer_context(retailer_id)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        retailer_name=retailer["name"],
        today=datetime.now(timezone.utc).date().isoformat(),
        context=context_blob,
    )

    session_id = payload.session_id or f"retailer-{retailer_id}"

    chat = LlmChat(
        api_key=api_key, session_id=session_id, system_message=system_prompt,
    ).with_model("anthropic", "claude-haiku-4-5-20251001")

    # Replay short history (last 8 turns) so multi-turn works without DB persistence
    for h in payload.history[-8:]:
        if h.role == "user":
            try:
                await chat.send_message(UserMessage(text=h.content))
            except Exception:
                break

    try:
        response = await chat.send_message(UserMessage(text=payload.message))
    except Exception as e:
        logger.exception("Assistant call failed")
        raise HTTPException(502, f"Assistant error: {e}")

    text = str(response or "").strip()

    action: Optional[Dict[str, Any]] = None
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    spoken = text
    if m:
        try:
            action = _json.loads(m.group(1))
            spoken = (text[: m.start()] + text[m.end():]).strip()
        except Exception:
            action = None

    return {"reply": spoken, "action": action, "session_id": session_id}


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
