"""Demo-time fleet motion engine.

Advances every in-transit vehicle along its origin → destination line on a
time-lapse factor (DEMO_SPEEDUP), so the Logistics Command Center map shows
trucks visibly moving between refreshes. An ~8h trip completes in roughly
8h / DEMO_SPEEDUP of wall-clock time.

State per vehicle: `progress` (0..1) and `total_minutes` (full trip length).
Legacy rows without these fields get them derived from coordinates once.
"""
from __future__ import annotations

from typing import Any, Dict

from core import db, logger, now_iso

DEMO_SPEEDUP = 10          # 1 real minute == 10 trip-minutes
DEFAULT_TRIP_MINUTES = 480  # 8h end-to-end when nothing better is known


def _derive_progress(v: Dict[str, Any]) -> float:
    """Estimate progress from coordinates for legacy rows (linear lanes)."""
    o_lat, o_lng = v.get("origin_lat"), v.get("origin_lng")
    d_lat, d_lng = v.get("dest_lat"), v.get("dest_lng")
    lat, lng = v.get("lat"), v.get("lng")
    if None in (o_lat, o_lng, d_lat, d_lng, lat, lng):
        return 0.0
    span = max(abs(d_lat - o_lat), abs(d_lng - o_lng))
    if span < 1e-9:
        return 1.0
    if abs(d_lat - o_lat) >= abs(d_lng - o_lng):
        t = (lat - o_lat) / (d_lat - o_lat)
    else:
        t = (lng - o_lng) / (d_lng - o_lng)
    return min(1.0, max(0.0, float(t)))


async def advance_vehicles(tick_minutes: float = 2.0) -> int:
    """Move all in-transit trucks forward. Returns how many were updated."""
    moved = 0
    async for v in db.vehicles.find(
        {"status": "in_transit", "dest_lat": {"$ne": None}}, {"_id": 0},
    ):
        try:
            progress = v.get("progress")
            if progress is None:
                progress = _derive_progress(v)
            total = float(v.get("total_minutes") or 0)
            if total <= 0:
                eta = float(v.get("eta_minutes") or 0)
                total = eta / (1 - progress) if (eta and progress < 0.99) else DEFAULT_TRIP_MINUTES

            t_new = min(1.0, progress + (tick_minutes * DEMO_SPEEDUP) / total)
            o_lat, o_lng = v["origin_lat"], v["origin_lng"]
            d_lat, d_lng = v["dest_lat"], v["dest_lng"]
            update: Dict[str, Any] = {
                "lat": o_lat + (d_lat - o_lat) * t_new,
                "lng": o_lng + (d_lng - o_lng) * t_new,
                "progress": t_new,
                "total_minutes": total,
                "eta_minutes": round((1 - t_new) * total / DEMO_SPEEDUP),
                "updated_at": now_iso(),
            }
            if t_new >= 1.0:
                update["eta_minutes"] = 0
                if v.get("ref_type") == "transfer":
                    # Hold at the gate until the transfer is marked delivered
                    # (delivery credits destination stock and parks the truck).
                    pass
                else:
                    update.update({"status": "idle", "dest_name": None,
                                   "dest_lat": None, "dest_lng": None,
                                   "origin_lat": d_lat, "origin_lng": d_lng,
                                   "progress": None, "total_minutes": None,
                                   "speed_kmh": 0})
            await db.vehicles.update_one({"id": v["id"]}, {"$set": update})
            moved += 1
        except Exception:
            logger.exception("[fleet] failed to advance vehicle %s", v.get("code"))
    return moved
