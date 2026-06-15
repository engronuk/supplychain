"""Retailer-OS shared helpers (urgency calc + inventory enrichment + LLM context)."""
from __future__ import annotations

import json as _json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from core import db, now_iso


SYSTEM_PROMPT_TEMPLATE = """You are "Sabi", the in-store AI assistant for the retailer "{retailer_name}" (retailer_id={retailer_id}).

You help THIS retailer (and ONLY this retailer) answer questions about their own store and take actions for them.

Strict tenant-isolation rules (NON-NEGOTIABLE):
1. You are scoped to retailer_id={retailer_id}. Every fact, number, balance, recommendation or recap you produce MUST come from the data block below. NEVER fabricate, infer, or hallucinate data about ANY retailer, distributor, manufacturer, product, sale or shipment that is not present in the data block.
2. If the user asks about OTHER retailers, OTHER stores, OTHER distributors' books, network-wide totals, or any data outside this retailer, respond exactly: "I can only see data for {retailer_name}. I do not have access to other stores in the network." Do not guess.
3. Do not reveal the retailer_id or any internal identifiers in your reply text. Use the human name "{retailer_name}" instead.
4. If the data block does not contain the answer, say so plainly ("I do not have that information for your store yet") and ask one short clarifying question. Never invent.
5. Be concise. Use short paragraphs and bullet points. Speak in plain shopkeeper-friendly language.
6. Use Nigerian Naira (₦) for money. Numbers like "5 days of cover left", "₦12,400 sold today".
7. When the user asks to *do* something (reorder, restock, place order), respond with a SHORT confirmation sentence (1 line max) AND append a single JSON action block.
8. CRITICAL — How to format the action JSON:
   • Put the JSON on its own lines AFTER your spoken reply.
   • Wrap it ALWAYS in a fenced ```json ... ``` code block — never bare.
   • Never narrate, describe, or reference the JSON contents in your spoken reply.
   • Your spoken reply is what the shopkeeper sees in the chat bubble — keep it natural ("Got it. Placing a reorder for 10 units of Royco now."). The JSON is for the system only.

Action JSON schema (only when needed) — example for a 30-unit OMO reorder:
```json
{{"action": "reorder", "items": [{{"product_name": "Omo Detergent 1kg", "quantity": 30}}]}}
```
Use the EXACT product name as it appears in the `inventory` data block above
when filling `product_name` so the system resolves it on the first try.
Other actions:
- {{"action": "open_smart_reorder"}}  — open the AI smart reorder panel
- {{"action": "open_voice_order"}}     — open voice order modal
- {{"action": "show_low_stock"}}       — focus the low stock list

Only emit ONE action JSON block per response, and only when the user clearly asked for an action.
If you don't have enough info, ask one short clarifying question instead.

Today is {today}. Here is THIS RETAILER's live data (do not invent values outside this):

The `sales` block in the data already contains:
  • `sales.today` — today's units, revenue, transactions.
  • `sales.yesterday` — yesterday's totals (use for "vs yesterday" comparisons).
  • `sales.last_7_days` — daily array, latest first. Use this to answer day-of-week
    questions ("how were Monday's sales?"), week-to-date totals, or trends.

When the user asks "how are sales today?", quote `sales.today.revenue` and units
directly. If the value is 0, say sales haven't started yet today (don't dodge with
"I only see weekly data").

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
        enriched.append({
            **it,
            "product": p,
            "urgency": urg,
            "days_remaining": days,
            # Normalise the legacy/sparse fields so downstream
            # consumers can rely on them.
            "quantity": int(it.get("quantity", 0)),
            "reorder_level": int(it.get("reorder_level", 10)),
            "velocity": float(it.get("velocity", 0)),
        })
    return enriched


async def build_retailer_context(retailer_id: str) -> str:
    """Compact JSON-ish context the LLM can reference. Strictly scoped to this retailer."""
    retailer = await db.retailers.find_one({"id": retailer_id}, {"_id": 0})
    if not retailer:
        raise HTTPException(404, "Retailer not found")
    distributor = await db.distributors.find_one({"id": retailer["distributor_id"]}, {"_id": 0})
    inv = await retailer_inventory_enriched(retailer_id)

    today = datetime.now(timezone.utc).date()
    today_iso = today.isoformat()
    yesterday_iso = (today - timedelta(days=1)).isoformat()
    seven_ago = (today - timedelta(days=6)).isoformat()

    # 7-day rollup (by product, for the inventory cross-reference below).
    sales = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": seven_ago}}},
        {"$group": {"_id": "$product_id", "units": {"$sum": "$units"}, "revenue": {"$sum": "$revenue"}}},
    ]).to_list(50)
    # Daily totals (today, yesterday, last 7 days array) — so Sabi can
    # answer "how are sales today?" without dodging.
    daily_totals = await db.daily_sales.aggregate([
        {"$match": {"retailer_id": retailer_id, "date": {"$gte": seven_ago}}},
        {"$group": {"_id": "$date",
                    "units": {"$sum": "$units"},
                    "revenue": {"$sum": "$revenue"},
                    "transactions": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]).to_list(30)
    by_day = {d["_id"]: d for d in daily_totals}
    today_totals = by_day.get(today_iso, {"units": 0, "revenue": 0, "transactions": 0})
    yesterday_totals = by_day.get(yesterday_iso, {"units": 0, "revenue": 0, "transactions": 0})
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
        "sales": {
            "today": {
                "date": today_iso,
                "units": int(today_totals.get("units", 0)),
                "revenue": round(float(today_totals.get("revenue", 0)), 2),
                "transactions": int(today_totals.get("transactions", 0)),
            },
            "yesterday": {
                "date": yesterday_iso,
                "units": int(yesterday_totals.get("units", 0)),
                "revenue": round(float(yesterday_totals.get("revenue", 0)), 2),
                "transactions": int(yesterday_totals.get("transactions", 0)),
            },
            "last_7_days": [
                {"date": d["_id"],
                 "units": int(d.get("units", 0)),
                 "revenue": round(float(d.get("revenue", 0)), 2),
                 "transactions": int(d.get("transactions", 0))}
                for d in daily_totals
            ],
        },
        "inventory": inv_summary,
        "recent_shipments": ship_summary,
        "open_requests": open_reqs,
        "as_of": now_iso(),
    }
    return _json.dumps(context, indent=2)
