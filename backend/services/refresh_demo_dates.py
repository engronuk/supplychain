"""Refresh seeded date fields so the demo environment looks 'actively used today'.

Idempotent: running this multiple times always re-aligns 'today' to the
current UTC date. Preserves all relative spread (so the same shipments
remain ordered the same way) and never touches business-logic fields
(quantities, statuses, ids, relationships).

Refresh rules (per user spec):
  - daily_sales: shift the date range forward so the latest day = today.
    Net effect: 30-day window ends today.
  - sales (POS retailer sales): latest within last 1-7 days, shift forward.
  - shipments:
      * received → received_at within last 7 days (keeps original created→dispatched→received gaps)
      * in_transit → dispatched_at within last 1-5 days
      * pending  → created_at within last 1-3 days
  - requests:
      * pending → created_at within last 1-3 days
      * approved/rejected → created_at within last 7 days
  - notifications: spread within last 7 days
  - inventory.updated_at: spread within last 7 days
  - inventory_audit.created_at: spread within last 7 days
  - batches.created_at: within last 7 days. manufactured_at preserved.
  - intel_alerts: within last 1-3 days
  - intel_recommendations: within last 1-3 days
  - intel_executive_summaries.generated_at: within last 24 hours
  - intel_insights: within last 1-3 days
  - intel_forecasts.computed_at: now
  - intel_retailer_health: now
  - intel_delivery_eta: now (eta_date stays in future window from today)
  - intel_external_signals.updated_at: now
  - promotions.created_at: within last 7 days (preserve starts/ends if future)
  - users.last_login_at: within last 24 hours

Will never touch: manufacturers, distributors, retailers, products
(those are the "creation" records that anchor history).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from core import db

logger = logging.getLogger("refresh_demo_dates")


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        # YYYY-MM-DD parses as naive — coerce to UTC midnight.
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


def _hash_pos(value: str, modulo: int) -> int:
    """Deterministic 0..modulo-1 position from a string id (no PRNG state)."""
    import hashlib
    return int(hashlib.sha1((value or "").encode("utf-8")).hexdigest()[:8], 16) % modulo


def _spread(idx: int, total: int, min_h: float, max_h: float) -> datetime:
    """Place doc idx of total into a timestamp window (min_h..max_h hours ago)."""
    if total <= 1:
        offset = max_h
    else:
        # Linear sweep with a tiny ±15-minute jitter from the hash
        frac = idx / (total - 1)
        offset = max_h - frac * (max_h - min_h)
    return _now() - timedelta(hours=offset)


async def _shift_by_max(collection: str, fields: List[str], target: datetime) -> dict:
    """Shift every doc in `collection` so the maximum value of `fields[0]`
    aligns with `target`. The same delta is applied to every field listed."""
    coll = db[collection]
    # Find current max of the anchor field
    cursor = coll.find(
        {fields[0]: {"$ne": None}}, {"_id": 0, fields[0]: 1},
    ).sort(fields[0], -1).limit(1)
    docs = await cursor.to_list(1)
    if not docs:
        return {"collection": collection, "updated": 0, "skipped": "empty"}
    raw_max = docs[0][fields[0]]
    max_dt = _parse_iso(raw_max) if isinstance(raw_max, str) else raw_max
    if not max_dt:
        return {"collection": collection, "updated": 0, "skipped": "no_anchor"}
    # already aligned
    if abs((target - max_dt).total_seconds()) < 60:
        return {"collection": collection, "updated": 0, "skipped": "already_aligned"}
    delta = target - max_dt
    updated = 0
    async for doc in coll.find({}, {"_id": 0, "id": 1, **{f: 1 for f in fields}}):
        update = {}
        for f in fields:
            v = doc.get(f)
            if v is None:
                continue
            if isinstance(v, str):
                dt = _parse_iso(v)
                if not dt:
                    continue
                # Preserve YYYY-MM-DD vs full ISO format
                shifted = dt + delta
                update[f] = shifted.date().isoformat() if len(v) == 10 else _iso(shifted)
            elif isinstance(v, datetime):
                update[f] = v + delta
        if update and doc.get("id"):
            await coll.update_one({"id": doc["id"]}, {"$set": update})
            updated += 1
    return {"collection": collection, "updated": updated, "delta_days": delta.days}


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
async def refresh_demo_dates() -> dict:
    now = _now()
    today = now.date()
    end_today = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) \
                + timedelta(hours=18)  # end-of-business-day-ish today

    summary: dict = {"now": _iso(now), "operations": []}

    # ---------- 1. daily_sales: shift so latest date = today -----------------
    summary["operations"].append(
        await _shift_by_max("daily_sales", ["date"], end_today)
    )

    # ---------- 2. sales (POS): shift so latest is in last 1-7 days ----------
    summary["operations"].append(
        await _shift_by_max("sales", ["created_at", "paid_at"], now - timedelta(hours=2))
    )

    # ---------- 3. shipments: handle each status separately ------------------
    # Received: latest received_at = ~12h ago; spread across last 7 days.
    received_total = await db.shipments.count_documents({"status": "received"})
    if received_total:
        # sort by current received_at desc to preserve order
        idx = 0
        async for s in db.shipments.find(
            {"status": "received"}, {"_id": 0, "id": 1, "created_at": 1, "dispatched_at": 1, "received_at": 1},
        ).sort("received_at", -1):
            new_received = _spread(idx, received_total, min_h=12, max_h=24 * 7)
            old_created = _parse_iso(s.get("created_at"))
            old_dispatched = _parse_iso(s.get("dispatched_at"))
            old_received = _parse_iso(s.get("received_at"))
            update = {"received_at": _iso(new_received)}
            # Keep the original transit gaps if they exist
            if old_received and old_dispatched:
                gap_d = (old_received - old_dispatched)
                update["dispatched_at"] = _iso(new_received - gap_d)
            else:
                update["dispatched_at"] = _iso(new_received - timedelta(hours=24))
            if old_received and old_created:
                gap_c = (old_received - old_created)
                update["created_at"] = _iso(new_received - gap_c)
            else:
                update["created_at"] = _iso(new_received - timedelta(hours=36))
            await db.shipments.update_one({"id": s["id"]}, {"$set": update})
            idx += 1
        summary["operations"].append({"collection": "shipments[received]", "updated": idx})

    # In transit: dispatched within last 1-5 days
    in_transit_total = await db.shipments.count_documents({"status": "in_transit"})
    if in_transit_total:
        idx = 0
        async for s in db.shipments.find(
            {"status": "in_transit"}, {"_id": 0, "id": 1, "created_at": 1, "dispatched_at": 1},
        ).sort("dispatched_at", -1):
            new_dispatched = _spread(idx, in_transit_total, min_h=12, max_h=24 * 5)
            old_created = _parse_iso(s.get("created_at"))
            old_dispatched = _parse_iso(s.get("dispatched_at"))
            update = {"dispatched_at": _iso(new_dispatched)}
            if old_created and old_dispatched:
                gap = old_dispatched - old_created
                update["created_at"] = _iso(new_dispatched - gap)
            else:
                update["created_at"] = _iso(new_dispatched - timedelta(hours=6))
            await db.shipments.update_one({"id": s["id"]}, {"$set": update})
            idx += 1
        summary["operations"].append({"collection": "shipments[in_transit]", "updated": idx})

    # Pending: created within last 1-3 days
    pending_total = await db.shipments.count_documents({"status": "pending"})
    if pending_total:
        idx = 0
        async for s in db.shipments.find(
            {"status": "pending"}, {"_id": 0, "id": 1},
        ).sort("created_at", -1):
            new_created = _spread(idx, pending_total, min_h=2, max_h=24 * 3)
            await db.shipments.update_one(
                {"id": s["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "shipments[pending]", "updated": idx})

    # ---------- 4. requests --------------------------------------------------
    pending_req = await db.requests.count_documents({"status": "pending"})
    if pending_req:
        idx = 0
        async for r in db.requests.find({"status": "pending"}, {"_id": 0, "id": 1}).sort("created_at", -1):
            new_created = _spread(idx, pending_req, min_h=2, max_h=24 * 3)
            await db.requests.update_one(
                {"id": r["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "requests[pending]", "updated": idx})

    resolved_req = await db.requests.count_documents({"status": {"$in": ["approved", "rejected"]}})
    if resolved_req:
        idx = 0
        async for r in db.requests.find(
            {"status": {"$in": ["approved", "rejected"]}}, {"_id": 0, "id": 1, "created_at": 1, "resolved_at": 1},
        ).sort("resolved_at", -1):
            new_resolved = _spread(idx, resolved_req, min_h=6, max_h=24 * 7)
            old_created = _parse_iso(r.get("created_at"))
            old_resolved = _parse_iso(r.get("resolved_at"))
            update = {"resolved_at": _iso(new_resolved)}
            if old_created and old_resolved:
                gap = old_resolved - old_created
                update["created_at"] = _iso(new_resolved - gap)
            else:
                update["created_at"] = _iso(new_resolved - timedelta(hours=12))
            await db.requests.update_one({"id": r["id"]}, {"$set": update})
            idx += 1
        summary["operations"].append({"collection": "requests[resolved]", "updated": idx})

    # ---------- 5. notifications --------------------------------------------
    notif_total = await db.notifications.count_documents({})
    if notif_total:
        idx = 0
        async for n in db.notifications.find({}, {"_id": 0, "id": 1}).sort("created_at", -1):
            new_created = _spread(idx, notif_total, min_h=1, max_h=24 * 7)
            await db.notifications.update_one(
                {"id": n["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "notifications", "updated": idx})

    # ---------- 6. inventory: spread updated_at last 7 days ------------------
    # All ids are UUIDs (lowercase hex first char) — 16 buckets cover the set
    # uniformly so we only need 16 update_many() calls instead of 47k writes.
    inv_total = await db.inventory.count_documents({})
    if inv_total:
        hex_chars = "0123456789abcdef"
        updated = 0
        for i, ch in enumerate(hex_chars):
            window = _spread(i, len(hex_chars), min_h=2, max_h=24 * 7)
            res = await db.inventory.update_many(
                {"id": {"$regex": f"^{ch}"}},
                {"$set": {"updated_at": _iso(window)}},
            )
            updated += res.modified_count
        summary["operations"].append({"collection": "inventory", "updated": updated})

    # ---------- 7. inventory_audit ------------------------------------------
    audit_total = await db.inventory_audit.count_documents({})
    if audit_total:
        idx = 0
        async for a in db.inventory_audit.find({}, {"_id": 0, "id": 1}).sort("created_at", -1):
            new_created = _spread(idx, audit_total, min_h=4, max_h=24 * 7)
            await db.inventory_audit.update_one(
                {"id": a["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "inventory_audit", "updated": idx})

    # ---------- 8. batches.created_at (manufactured_at left untouched) ------
    summary["operations"].append(
        await _shift_by_max("batches", ["created_at"], now - timedelta(days=2))
    )

    # ---------- 9. intel_alerts ---------------------------------------------
    alerts_total = await db.intel_alerts.count_documents({})
    if alerts_total:
        idx = 0
        async for a in db.intel_alerts.find({}, {"_id": 0, "id": 1}).sort("created_at", -1):
            new_created = _spread(idx, alerts_total, min_h=1, max_h=24 * 3)
            await db.intel_alerts.update_one(
                {"id": a["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "intel_alerts", "updated": idx})

    # ---------- 10. intel_recommendations -----------------------------------
    rec_total = await db.intel_recommendations.count_documents({})
    if rec_total:
        idx = 0
        async for r in db.intel_recommendations.find({}, {"_id": 0, "id": 1}).sort("created_at", -1):
            new_created = _spread(idx, rec_total, min_h=2, max_h=24 * 3)
            await db.intel_recommendations.update_one(
                {"id": r["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "intel_recommendations", "updated": idx})

    # ---------- 11. intel_insights ------------------------------------------
    ins_total = await db.intel_insights.count_documents({})
    if ins_total:
        idx = 0
        async for it in db.intel_insights.find({}, {"_id": 0, "id": 1}).sort("created_at", -1):
            new_created = _spread(idx, ins_total, min_h=2, max_h=24 * 3)
            await db.intel_insights.update_one(
                {"id": it["id"]}, {"$set": {"created_at": _iso(new_created)}}
            )
            idx += 1
        summary["operations"].append({"collection": "intel_insights", "updated": idx})

    # ---------- 12. intel_executive_summaries -------------------------------
    es_total = await db.intel_executive_summaries.count_documents({})
    if es_total:
        idx = 0
        async for s in db.intel_executive_summaries.find({}, {"_id": 0, "id": 1}).sort("generated_at", -1):
            new_gen = _spread(idx, es_total, min_h=1, max_h=24)
            await db.intel_executive_summaries.update_one(
                {"id": s["id"]}, {"$set": {"generated_at": _iso(new_gen)}}
            )
            idx += 1
        summary["operations"].append({"collection": "intel_executive_summaries", "updated": idx})

    # ---------- 13. intel_forecasts.computed_at = now -----------------------
    res = await db.intel_forecasts.update_many({}, {"$set": {"computed_at": _iso(now)}})
    summary["operations"].append({"collection": "intel_forecasts", "updated": res.modified_count})

    # ---------- 14. intel_retailer_health ----------------------------------
    res = await db.intel_retailer_health.update_many(
        {},
        {"$set": {"updated_at": _iso(now), "as_of": today.isoformat()}},
    )
    summary["operations"].append({"collection": "intel_retailer_health", "updated": res.modified_count})

    # ---------- 15. intel_delivery_eta -------------------------------------
    # Shift eta_date to (today + lane baseline elapsed) — keep risk window realistic
    eta_total = await db.intel_delivery_eta.count_documents({})
    if eta_total:
        idx = 0
        async for r in db.intel_delivery_eta.find({}, {"_id": 0, "id": 1, "eta_days": 1}).sort("updated_at", -1):
            eta_days = int(r.get("eta_days") or 2)
            new_eta = (today + timedelta(days=max(0, eta_days - 1))).isoformat()
            await db.intel_delivery_eta.update_one(
                {"id": r["id"]}, {"$set": {"updated_at": _iso(now), "eta_date": new_eta}}
            )
            idx += 1
        summary["operations"].append({"collection": "intel_delivery_eta", "updated": idx})

    # ---------- 16. intel_external_signals ---------------------------------
    res = await db.intel_external_signals.update_many({}, {"$set": {"updated_at": _iso(now)}})
    summary["operations"].append({"collection": "intel_external_signals", "updated": res.modified_count})

    # ---------- 17. promotions ---------------------------------------------
    promo_total = await db.promotions.count_documents({})
    if promo_total:
        idx = 0
        async for p in db.promotions.find({}, {"_id": 0, "id": 1, "starts_at": 1, "ends_at": 1}).sort("created_at", -1):
            new_created = _spread(idx, promo_total, min_h=4, max_h=24 * 7)
            update = {"created_at": _iso(new_created)}
            # Keep starts_at = today if it was today, otherwise leave
            old_starts = _parse_iso(p.get("starts_at"))
            if old_starts and old_starts.date() < today:
                shift = today - old_starts.date()
                update["starts_at"] = _iso(old_starts + shift)
                old_ends = _parse_iso(p.get("ends_at"))
                if old_ends:
                    update["ends_at"] = _iso(old_ends + shift)
            await db.promotions.update_one({"id": p["id"]}, {"$set": update})
            idx += 1
        summary["operations"].append({"collection": "promotions", "updated": idx})

    # ---------- 18. users.last_login_at -------------------------------------
    users_total = await db.users.count_documents({"last_login_at": {"$ne": None}})
    if users_total:
        idx = 0
        async for u in db.users.find({"last_login_at": {"$ne": None}}, {"_id": 0, "id": 1}).sort("last_login_at", -1):
            new_login = _spread(idx, users_total, min_h=1, max_h=24)
            await db.users.update_one(
                {"id": u["id"]}, {"$set": {"last_login_at": _iso(new_login)}}
            )
            idx += 1
        summary["operations"].append({"collection": "users", "updated": idx})

    total = sum((op.get("updated") or 0) for op in summary["operations"])
    summary["total_docs_updated"] = total
    logger.info("Demo dates refreshed: %d documents updated", total)
    return summary
