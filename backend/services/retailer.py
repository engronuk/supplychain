"""Retailer-OS shared helpers (urgency calc + inventory enrichment + LLM context)."""
from __future__ import annotations

import json as _json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from core import db, now_iso


SYSTEM_PROMPT_TEMPLATE = """You are "Aisle", the in-store AI assistant for the retailer "{retailer_name}".

You help the retailer answer questions about THEIR own store and take actions for them.

Strict rules:
1. You ONLY have access to the data of "{retailer_name}". Never speculate about other retailers, distributors or manufacturers in the network. If asked about other retailers, politely explain you can only see this store's data.
2. Be concise. Use short paragraphs and bullet points. Speak in plain shopkeeper-friendly language.
3. Use Nigerian Naira (₦) for money. Numbers like "5 days of cover left", "₦12,400 sold today".
4. When the user asks to *do* something (reorder, restock, place order), respond with a short confirmation message AND append a single fenced JSON block at the end with action details.

Action JSON schema (only when needed):
```json
{{"action": "reorder", "items": [{{"product_name": "OMO Multi-Active Detergent", "quantity": 30}}]}}
```
Other actions:
- {{"action": "open_smart_reorder"}}  — open the AI smart reorder panel
- {{"action": "open_voice_order"}}     — open voice order modal
- {{"action": "show_low_stock"}}       — focus the low stock list

Only emit ONE action JSON block per response, and only when the user clearly asked for an action.
If you don't have enough info, ask one short clarifying question instead.

Today is {today}. Here is THIS RETAILER's live data (do not invent values outside this):

{context}
"""


def urgency(quantity: int, velocity: float, reorder_level: int) -> Tuple[str, float]:
    """Return (urgency_level, days_remaining)."""
    if velocity <= 0:
        days = 999.0
    else:
        days = quantity / velocity
    if quantity <= 0:
        return "critical", 0.0
    if quantity <= reorder_level or days <= 3:
        return "critical", round(days, 1)
    if days <= 7 or quantity <= reorder_level * 1.5:
        return "warning", round(days, 1)
    return "healthy", round(days, 1)


async def retailer_inventory_enriched(retailer_id: str) -> List[Dict[str, Any]]:
    inv = await db.inventory.find(
        {"owner_type": "retailer", "owner_id": retailer_id}, {"_id": 0}
    ).to_list(2000)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(2000)}
    enriched = []
    for it in inv:
        p = products.get(it["product_id"], {})
        urg, days = urgency(
            int(it["quantity"]),
            float(it.get("velocity", 0)),
            int(it.get("reorder_level", 10)),
        )
        enriched.append({**it, "product": p, "urgency": urg, "days_remaining": days})
    return enriched


async def build_retailer_context(retailer_id: str) -> str:
    """Compact JSON-ish context the LLM can reference. Strictly scoped to this retailer."""
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    distributor = await db.distributors.find_one({"id": retailer["distributor_id"]}, {"_id": 0})
    inv = await retailer_inventory_enriched(retailer_id)

    today = datetime.now(timezone.utc).date()
    seven_ago = (today - timedelta(days=6)).isoformat()
    sales = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": seven_ago}}},
        {"$group": {"_id": "$product_id", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
    ]).to_list(50)
    products = {p["id"]: p for p in await db.products.find({}, {"_id": 0}).to_list(5000)}
    sales_by_pid = {s["_id"]: s for s in sales}

    inv_summary = []
    for it in inv:
        p = it.get("product") or {}
        s = sales_by_pid.get(it["product_id"], {})
        inv_summary.append({
            "product": p.get("name", "?"),
            "sku": p.get("sku", ""),
            "stock": int(it["quantity"]),
            "reorder_level": int(it["reorder_level"]),
            "velocity_per_day": float(it.get("velocity", 0)),
            "days_remaining": it["days_remaining"],
            "urgency": it["urgency"],
            "sales_7d_units": int(s.get("units", 0)),
            "sales_7d_revenue": round(float(s.get("revenue", 0)), 2),
        })

    ships = await db.shipments.find(
        {"retailer_id": retailer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(5)
    distributors = {d["id"]: d for d in await db.distributors.find({}, {"_id": 0}).to_list(2000)}
    ship_summary = []
    for s in ships:
        ship_summary.append({
            "tracking_code": s.get("tracking_code"),
            "status": s.get("status"),
            "from": distributors.get(s.get("distributor_id", ""), {}).get("name", ""),
            "items": [
                {"product": products.get(it["product_id"], {}).get("name", "?"),
                 "qty": int(it["quantity"])}
                for it in s.get("items", [])
            ],
            "created_at": s.get("created_at"),
        })

    open_reqs = await db.requests.count_documents({
        "retailer_id": retailer_id, "status": {"$in": ["pending", "approved"]},
    })

    context = {
        "retailer": {
            "name": retailer["name"],
            "region": retailer.get("region", ""),
            "city": retailer.get("city", ""),
            "distributor": (distributor or {}).get("name", ""),
        },
        "inventory": inv_summary,
        "recent_shipments": ship_summary,
        "open_requests": open_reqs,
        "as_of": now_iso(),
    }
    return _json.dumps(context, indent=2)
