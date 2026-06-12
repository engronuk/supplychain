"""Road routing service — Google Directions API with graceful fallback.

`get_route(origin, dest)` returns real road geometry, distance and duration
when the tenant's Maps key has the Directions API enabled; otherwise a
plausible curved estimate (straight-line × road factor) so the control tower
keeps working with zero GCP configuration.

Routes are cached forever in `route_cache` keyed by rounded endpoints, so a
busy fleet costs at most a handful of Directions calls per origin→dest lane.
"""
from __future__ import annotations

import math
import os
from typing import Dict, List, Optional, Tuple

import httpx

from core import db, logger, now_iso

LatLng = Tuple[float, float]

AVG_SPEED_KMH = 48.0
ROAD_FACTOR = 1.32


def haversine_km(a: LatLng, b: LatLng) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def decode_polyline(encoded: str) -> List[List[float]]:
    """Decode a Google encoded polyline into [[lat, lng], ...]."""
    points: List[List[float]] = []
    index = lat = lng = 0
    while index < len(encoded):
        for is_lng in (False, True):
            result, shift = 0, 0
            while True:
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if (result & 1) else (result >> 1)
            if is_lng:
                lng += delta
            else:
                lat += delta
        points.append([lat / 1e5, lng / 1e5])
    return points


def _estimate_route(origin: LatLng, dest: LatLng) -> Dict:
    """Curved straight-line estimate when Directions API is unavailable."""
    dist = haversine_km(origin, dest) * ROAD_FACTOR
    n = 16
    # Perpendicular bow so the path doesn't look like a ruler line.
    dx, dy = dest[0] - origin[0], dest[1] - origin[1]
    norm = math.hypot(dx, dy) or 1e-9
    px, py = -dy / norm, dx / norm
    bow = min(0.18, norm * 0.12)
    pts = []
    for i in range(n + 1):
        t = i / n
        arc = math.sin(t * math.pi) * bow
        pts.append([
            round(origin[0] + dx * t + px * arc, 5),
            round(origin[1] + dy * t + py * arc, 5),
        ])
    return {
        "distance_km": round(dist, 1),
        "duration_min": round(dist / AVG_SPEED_KMH * 60),
        "polyline": pts,
        "source": "estimate",
    }


def _cache_key(origin: LatLng, dest: LatLng) -> str:
    return (f"{round(origin[0], 3)},{round(origin[1], 3)}"
            f"|{round(dest[0], 3)},{round(dest[1], 3)}")


async def _routes_api_v2(client: httpx.AsyncClient, origin: LatLng,
                         dest: LatLng, api_key: str) -> Optional[Dict]:
    """Modern Routes API (computeRoutes) — works on keys where the legacy
    Directions API is restricted."""
    r = await client.post(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        headers={
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": ("routes.distanceMeters,routes.duration,"
                                 "routes.polyline.encodedPolyline"),
        },
        json={
            "origin": {"location": {"latLng": {
                "latitude": origin[0], "longitude": origin[1]}}},
            "destination": {"location": {"latLng": {
                "latitude": dest[0], "longitude": dest[1]}}},
            "travelMode": "DRIVE",
        },
    )
    if r.status_code != 200:
        logger.warning("[routing] Routes API HTTP %s — trying legacy Directions",
                       r.status_code)
        return None
    g = ((r.json().get("routes")) or [{}])[0]
    pts = decode_polyline(((g.get("polyline") or {}).get("encodedPolyline")) or "")
    if not pts:
        return None
    if len(pts) > 120:
        step = len(pts) // 120 + 1
        pts = pts[::step] + [pts[-1]]
    dur_s = float(str(g.get("duration") or "0s").rstrip("s") or 0)
    return {
        "distance_km": round((g.get("distanceMeters") or 0) / 1000.0, 1),
        "duration_min": round(dur_s / 60),
        "polyline": pts,
        "source": "google",
    }


# After 3 consecutive REQUEST_DENIED responses (API not enabled on the key),
# stop calling Google for this process lifetime — fallback only. Resets on
# restart/redeploy so enabling the API later upgrades routes automatically.
_denied_count = 0
ESTIMATE_CACHE_TTL_H = 6


async def get_route(origin: LatLng, dest: LatLng) -> Dict:
    """Road route between two points: {distance_km, duration_min, polyline, source}."""
    global _denied_count
    key = _cache_key(origin, dest)
    cached = await db.route_cache.find_one({"_id": key})
    if cached:
        fresh = cached.get("source") == "google"
        if not fresh:
            try:
                from datetime import datetime, timedelta, timezone
                age = datetime.now(timezone.utc) - datetime.fromisoformat(
                    cached["cached_at"].replace("Z", "+00:00"))
                fresh = age < timedelta(hours=ESTIMATE_CACHE_TTL_H) or _denied_count >= 3
            except (ValueError, TypeError, KeyError):
                fresh = True
        if fresh:
            return {k: cached[k] for k in ("distance_km", "duration_min", "polyline", "source")}

    route: Optional[Dict] = None
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if api_key and _denied_count < 3:
        # Prefer the modern Routes API; fall through to legacy Directions.
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                route = await _routes_api_v2(client, origin, dest, api_key)
        except Exception as e:
            logger.warning("[routing] Routes API call failed (%s)", e)
    if route is None and api_key and _denied_count < 3:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(
                    "https://maps.googleapis.com/maps/api/directions/json",
                    params={
                        "origin": f"{origin[0]},{origin[1]}",
                        "destination": f"{dest[0]},{dest[1]}",
                        "region": "ng",
                        "key": api_key,
                    },
                )
            body = r.json()
            if body.get("status") == "OK" and body.get("routes"):
                _denied_count = 0
                g = body["routes"][0]
                legs = g.get("legs", [])
                dist_km = sum(l["distance"]["value"] for l in legs) / 1000.0
                dur_min = sum(l["duration"]["value"] for l in legs) / 60.0
                pts = decode_polyline(g["overview_polyline"]["points"])
                # Thin very dense polylines to keep payloads small.
                if len(pts) > 120:
                    step = len(pts) // 120 + 1
                    pts = pts[::step] + [pts[-1]]
                route = {
                    "distance_km": round(dist_km, 1),
                    "duration_min": round(dur_min),
                    "polyline": pts,
                    "source": "google",
                }
            else:
                if body.get("status") == "REQUEST_DENIED":
                    _denied_count += 1
                    if _denied_count == 3:
                        logger.warning("[routing] Directions API denied 3× — "
                                       "switching to estimates for this session "
                                       "(enable the Directions API on your Maps key)")
                else:
                    logger.warning("[routing] Directions API returned %s — using estimate",
                                   body.get("status"))
        except Exception as e:
            logger.warning("[routing] Directions call failed (%s) — using estimate", e)

    if route is None:
        route = _estimate_route(origin, dest)

    await db.route_cache.update_one(
        {"_id": key},
        {"$set": {**route, "cached_at": now_iso()}},
        upsert=True,
    )
    return route


def _latlng_body(p: LatLng) -> Dict:
    return {"location": {"latLng": {"latitude": p[0], "longitude": p[1]}}}


def _thin(pts: List[List[float]], cap: int = 80) -> List[List[float]]:
    if len(pts) > cap:
        step = len(pts) // cap + 1
        return pts[::step] + [pts[-1]]
    return pts


async def _multi_stop_google(origin: LatLng, stops: List[LatLng],
                             optimize: bool, api_key: str) -> Optional[Dict]:
    """Routes API computeRoutes with intermediates + waypoint optimization."""
    if optimize:
        # Farthest stop anchors the run; the rest are optimizable intermediates.
        idx_far = max(range(len(stops)), key=lambda i: haversine_km(origin, stops[i]))
        inter_idx = [i for i in range(len(stops)) if i != idx_far]
    else:
        idx_far = len(stops) - 1
        inter_idx = list(range(len(stops) - 1))
    body: Dict = {
        "origin": _latlng_body(origin),
        "destination": _latlng_body(stops[idx_far]),
        "travelMode": "DRIVE",
    }
    if inter_idx:
        body["intermediates"] = [_latlng_body(stops[i]) for i in inter_idx]
        if optimize and len(inter_idx) > 1:
            body["optimizeWaypointOrder"] = True
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
            headers={
                "X-Goog-Api-Key": api_key,
                "X-Goog-FieldMask": (
                    "routes.distanceMeters,routes.duration,"
                    "routes.optimizedIntermediateWaypointIndex,"
                    "routes.legs.distanceMeters,routes.legs.duration,"
                    "routes.legs.polyline.encodedPolyline"),
            },
            json=body,
        )
    if r.status_code != 200:
        logger.warning("[routing] multi-stop Routes API HTTP %s", r.status_code)
        return None
    g = ((r.json().get("routes")) or [{}])[0]
    legs_raw = g.get("legs") or []
    opt = g.get("optimizedIntermediateWaypointIndex")
    visit_inter = ([inter_idx[i] for i in opt]
                   if opt is not None and len(opt) == len(inter_idx) else inter_idx)
    order = visit_inter + [idx_far]
    if len(legs_raw) != len(order):
        return None
    legs, full = [], []
    for l in legs_raw:
        pts = _thin(decode_polyline(((l.get("polyline") or {}).get("encodedPolyline")) or ""))
        legs.append({
            "distance_km": round((l.get("distanceMeters") or 0) / 1000.0, 1),
            "duration_min": round(float(str(l.get("duration") or "0s").rstrip("s") or 0) / 60),
            "polyline": pts,
        })
        full.extend(pts)
    return {
        "order": order, "legs": legs,
        "total_km": round(sum(l["distance_km"] for l in legs), 1),
        "total_min": sum(l["duration_min"] for l in legs),
        "polyline": full, "source": "google",
    }


def _multi_stop_estimate(origin: LatLng, stops: List[LatLng],
                         optimize: bool) -> Dict:
    """Nearest-neighbour fallback when the Routes API is unavailable."""
    if optimize:
        order, remaining, cur = [], list(range(len(stops))), origin
        while remaining:
            nxt = min(remaining, key=lambda i: haversine_km(cur, stops[i]))
            order.append(nxt)
            remaining.remove(nxt)
            cur = stops[nxt]
    else:
        order = list(range(len(stops)))
    legs, full, cur = [], [], origin
    for idx in order:
        est = _estimate_route(cur, stops[idx])
        legs.append({"distance_km": est["distance_km"],
                     "duration_min": est["duration_min"],
                     "polyline": est["polyline"]})
        full.extend(est["polyline"])
        cur = stops[idx]
    return {
        "order": order, "legs": legs,
        "total_km": round(sum(l["distance_km"] for l in legs), 1),
        "total_min": sum(l["duration_min"] for l in legs),
        "polyline": full, "source": "estimate",
    }


async def get_multi_stop_route(origin: LatLng, stops: List[LatLng],
                               optimize: bool = True) -> Dict:
    """Multi-stop road route with optional stop-sequence optimization.

    Returns {order, legs[{distance_km, duration_min, polyline}], total_km,
    total_min, polyline, source}. `order` maps visit position → index into
    the input stops list. Not cached (combinatorial keyspace).
    """
    if not stops:
        raise ValueError("stops required")
    if len(stops) == 1:
        r = await get_route(origin, stops[0])
        leg = {k: r[k] for k in ("distance_km", "duration_min", "polyline")}
        return {"order": [0], "legs": [leg], "total_km": r["distance_km"],
                "total_min": r["duration_min"], "polyline": r["polyline"],
                "source": r["source"]}
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if api_key:
        try:
            result = await _multi_stop_google(origin, stops, optimize, api_key)
            if result:
                return result
        except Exception as e:
            logger.warning("[routing] multi-stop Routes API failed (%s) — estimating", e)
    return _multi_stop_estimate(origin, stops, optimize)


def point_along(polyline: List[List[float]], progress: float) -> LatLng:
    """Interpolate a position at `progress` (0..1) of the path length."""
    if not polyline:
        return (6.5244, 3.3792)
    if progress <= 0:
        return tuple(polyline[0])
    if progress >= 1:
        return tuple(polyline[-1])
    seg_lens = [haversine_km(tuple(polyline[i]), tuple(polyline[i + 1]))
                for i in range(len(polyline) - 1)]
    total = sum(seg_lens) or 1e-9
    target = progress * total
    acc = 0.0
    for i, seg in enumerate(seg_lens):
        if acc + seg >= target:
            t = (target - acc) / (seg or 1e-9)
            a, b = polyline[i], polyline[i + 1]
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        acc += seg
    return tuple(polyline[-1])
