"""Idempotent seed: ensures every product has a realistic set of batches.

Schema for `batches`:
    id              str   (uuid4)
    manufacturer_id str
    product_id      str
    batch_number    str   e.g. "OM260601A"
    manufactured_at iso date (YYYY-MM-DD)
    expiry_date     iso date (YYYY-MM-DD)
    quantity        int   total units originally produced in this batch
    status          str   healthy | near_expiry | expired | recalled
                          (derived from expiry_date; computed live too)

This module is intentionally idempotent: it inserts batches only for
products that don't already have one. Re-running it does not duplicate
or wipe existing data.
"""
from __future__ import annotations

import hashlib
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from core import db, new_id


# How many batches per SKU and how their expiries are distributed.
# Aim for a roughly realistic mix: most healthy, a small slice near-expiry,
# tiny slice expired.
BATCHES_PER_SKU = 3
EXPIRY_DISTRIBUTION = [
    # (days_until_expiry_min, days_until_expiry_max, weight)
    (180, 540, 6),   # healthy: shelf life 6m to 18m out
    (30, 90, 3),     # near_expiry: 1-3 months
    (-30, 20, 1),    # at-risk: 0-30 days remaining
]


def _seed_quantity(product_id: str, idx: int) -> int:
    """Deterministic batch size — same on every boot."""
    h = int(hashlib.sha256(f"{product_id}:{idx}".encode()).hexdigest(), 16)
    return 5000 + (h % 95_000)  # 5k..100k units per batch


def _seed_expiry(product_id: str, idx: int) -> datetime:
    """Pick a deterministic but varied expiry window per (product, batch)."""
    h = int(hashlib.sha256(f"{product_id}:exp:{idx}".encode()).hexdigest(), 16)
    # Weighted bucket pick
    total = sum(w for *_, w in EXPIRY_DISTRIBUTION)
    pick = h % total
    accum = 0
    for lo, hi, w in EXPIRY_DISTRIBUTION:
        accum += w
        if pick < accum:
            span = hi - lo
            days = lo + ((h // 7) % max(span, 1))
            return datetime.now(timezone.utc) + timedelta(days=days)
    return datetime.now(timezone.utc) + timedelta(days=180)


def _batch_number(product_label: str, expiry: datetime, idx: int) -> str:
    """Stripe-y batch code: first 2 letters of product label + YYMMDD + serial.

    Uses the product name (e.g. "OMO Multi-Active Detergent" -> "OM") rather
    than the SKU prefix which is identical across the manufacturer's catalog.
    """
    label = "".join(ch for ch in (product_label or "XX") if ch.isalpha()).upper()
    prefix = label[:2] or "XX"
    return f"{prefix}{expiry.strftime('%y%m%d')}{string.ascii_uppercase[idx % 26]}"


def _status_for(expiry: datetime) -> str:
    """Derive status from days remaining. Recalled is set manually only."""
    days = (expiry.date() - datetime.now(timezone.utc).date()).days
    if days < 0:
        return "expired"
    if days <= 90:
        return "near_expiry"
    return "healthy"


async def seed_batches() -> Dict[str, int]:
    """Ensure every product has BATCHES_PER_SKU batches. Idempotent."""
    products = await db.products.find({}, {"_id": 0}).to_list(5000)
    created = 0
    skipped = 0

    for p in products:
        existing = await db.batches.count_documents({"product_id": p["id"]})
        if existing >= BATCHES_PER_SKU:
            skipped += 1
            continue

        to_create = BATCHES_PER_SKU - existing
        batches: List[dict] = []
        # Use existing count as offset so re-runs use different seeds
        for j in range(existing, existing + to_create):
            expiry = _seed_expiry(p["id"], j)
            manufactured = expiry - timedelta(days=540 + (j * 17))  # 18m+ shelf life
            qty = _seed_quantity(p["id"], j)
            batch_number = _batch_number(p["name"], expiry, j)
            batches.append({
                "id": new_id(),
                "manufacturer_id": p.get("manufacturer_id"),
                "product_id": p["id"],
                "batch_number": batch_number,
                "manufactured_at": manufactured.date().isoformat(),
                "expiry_date": expiry.date().isoformat(),
                "quantity": qty,
                "status": _status_for(expiry),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        if batches:
            await db.batches.insert_many(batches)
            created += len(batches)

    return {"created": created, "skipped_existing": skipped}
