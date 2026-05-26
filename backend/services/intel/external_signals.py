"""Weather + holidays external signal collection.

Weather: Open-Meteo (free, no API key, great African coverage)
  https://open-meteo.com/

Holidays: hardcoded Nigerian calendar (public holidays + salary windows).
  No external dependency — fast, deterministic, free.

Output → db.intel_external_signals, one doc per tenant_id.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Dict, List

import httpx

from core import db, logger, now_iso

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"

# Approximate geo-anchors for Nigerian regions (Lagos, Kano, Port Harcourt, Abuja…)
REGION_ANCHORS = {
    "South West": (6.5244, 3.3792),   # Lagos
    "South East": (5.4840, 7.0354),   # Aba
    "South South": (4.8156, 7.0498),  # Port Harcourt
    "North Central": (9.0820, 7.3986),  # Abuja
    "North West": (12.0022, 8.5919),  # Kano
    "North East": (11.8333, 13.1500), # Maiduguri
}

NG_HOLIDAYS_2026: List[Dict] = [
    {"date": "2026-01-01", "name": "New Year's Day"},
    {"date": "2026-03-31", "name": "Eid al-Fitr"},
    {"date": "2026-04-03", "name": "Good Friday"},
    {"date": "2026-04-06", "name": "Easter Monday"},
    {"date": "2026-05-01", "name": "Workers' Day"},
    {"date": "2026-06-07", "name": "Eid al-Adha"},
    {"date": "2026-06-12", "name": "Democracy Day"},
    {"date": "2026-09-05", "name": "Eid al-Mawlid"},
    {"date": "2026-10-01", "name": "Independence Day"},
    {"date": "2026-12-25", "name": "Christmas Day"},
    {"date": "2026-12-26", "name": "Boxing Day"},
]


async def _fetch_region_weather(client: httpx.AsyncClient, name: str, lat: float, lon: float) -> Dict:
    try:
        r = await client.get(OPEN_METEO, params={
            "latitude": lat, "longitude": lon,
            "daily": "rain_sum,temperature_2m_max,temperature_2m_min",
            "past_days": 1, "forecast_days": 7, "timezone": "auto",
        }, timeout=10)
        r.raise_for_status()
        data = r.json().get("daily", {})
        rains = data.get("rain_sum") or []
        tmaxs = data.get("temperature_2m_max") or []
        tmins = data.get("temperature_2m_min") or []
        return {
            "region": name,
            "rainfall_mm_7d": round(sum(float(x or 0) for x in rains), 1),
            "temp_max_c": round(max((float(x) for x in tmaxs if x is not None), default=30), 1),
            "temp_min_c": round(min((float(x) for x in tmins if x is not None), default=20), 1),
            "rain_today_mm": round(float(rains[0]) if rains else 0, 1),
        }
    except Exception as e:
        logger.warning("Weather fetch failed for %s: %s", name, e)
        return {"region": name, "rainfall_mm_7d": 0, "temp_max_c": 30, "temp_min_c": 22, "rain_today_mm": 0}


def _holiday_signals(today: date) -> Dict:
    upcoming = []
    holiday_within_3d = False
    holiday_within_7d = False
    for h in NG_HOLIDAYS_2026:
        try:
            hdate = datetime.fromisoformat(h["date"]).date()
        except Exception:
            continue
        delta = (hdate - today).days
        if 0 <= delta <= 14:
            upcoming.append({**h, "days_away": delta})
        if 0 <= delta <= 3:
            holiday_within_3d = True
        if 0 <= delta <= 7:
            holiday_within_7d = True
    # Salary window — end-of-month 25-end
    salary_window = today.day >= 25
    return {
        "upcoming": upcoming,
        "holiday_within_3d": holiday_within_3d,
        "holiday_within_7d": holiday_within_7d,
        "salary_window": salary_window,
    }


async def refresh_external_signals(tenant_id: str) -> dict:
    """Fetch fresh weather + recompute holiday signals for the tenant."""
    by_region: Dict[str, Dict] = {}
    async with httpx.AsyncClient() as client:
        for name, (lat, lon) in REGION_ANCHORS.items():
            by_region[name] = await _fetch_region_weather(client, name, lat, lon)

    # National aggregate (max rainfall, mean temp)
    national = {
        "rainfall_mm_7d": round(max(v["rainfall_mm_7d"] for v in by_region.values()), 1),
        "temp_max_c": round(sum(v["temp_max_c"] for v in by_region.values()) / len(by_region), 1),
        "max_rainfall_region": max(by_region.items(), key=lambda kv: kv[1]["rainfall_mm_7d"])[0],
    }

    today = datetime.now(timezone.utc).date()
    holidays = _holiday_signals(today)

    payload = {
        "weather": {
            "by_region": by_region,
            "national": national,
            "rainfall_mm_7d": national["rainfall_mm_7d"],
            "temp_max_c": national["temp_max_c"],
        },
        # Unified holidays object for client convenience + keep flat fields for back-compat
        "holidays": holidays,
        **holidays,
        "refreshed_at": now_iso(),
    }

    await db.intel_external_signals.update_one(
        {"tenant_id": tenant_id},
        {"$set": {"tenant_id": tenant_id, "payload": payload, "updated_at": now_iso()}},
        upsert=True,
    )
    return {"regions": len(by_region), "holidays_upcoming": len(holidays["upcoming"])}
