"""City-centroid lookup for Nigerian wholesaler / distributor locations.

The seed organizations only carry `city` / `state` — no lat/lng. The
control-tower map uses this table as a deterministic fallback so the
visualization works without hitting an external geocoding API.

Add a new entry here whenever a new seed city is introduced. Match is
case-insensitive and tolerant of minor formatting (whitespace, suffixes
like ' City' or ' Town').
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

# Nigerian cities + select districts. Coordinates are approximate centroids
# (degrees) sourced from open geo references.
_CENTROIDS: Dict[str, Tuple[float, float]] = {
    # Lagos State & districts
    "lagos": (6.5244, 3.3792),
    "ikeja": (6.6018, 3.3515),
    "lekki": (6.4474, 3.4548),
    "ajah": (6.4660, 3.5560),
    "ogba": (6.6320, 3.3380),
    "apapa": (6.4485, 3.3669),
    "victoria island": (6.4281, 3.4218),
    "yaba": (6.5176, 3.3792),
    "surulere": (6.4925, 3.3588),
    "ikorodu": (6.6194, 3.5106),
    "agege": (6.6150, 3.3220),
    "epe": (6.5840, 3.9831),
    "badagry": (6.4318, 2.8876),
    # Other South-West
    "ibadan": (7.3775, 3.9470),
    "abeokuta": (7.1557, 3.3451),
    "ilorin": (8.4799, 4.5418),
    "akure": (7.2526, 5.1931),
    "oshogbo": (7.7714, 4.5667),
    # South-South
    "port harcourt": (4.8156, 7.0498),
    "warri": (5.5160, 5.7500),
    "uyo": (5.0377, 7.9128),
    "benin city": (6.3350, 5.6037),
    "benin": (6.3350, 5.6037),
    "calabar": (4.9589, 8.3269),
    # South-East
    "enugu": (6.5244, 7.5188),
    "onitsha": (6.1397, 6.7891),
    "aba": (5.1066, 7.3667),
    "owerri": (5.4836, 7.0331),
    # North-Central
    "abuja": (9.0820, 7.3947),
    "jos": (9.8965, 8.8583),
    "lokoja": (7.8023, 6.7333),
    "makurdi": (7.7322, 8.5391),
    "minna": (9.6139, 6.5569),
    # North-East
    "maiduguri": (11.8333, 13.1500),
    "bauchi": (10.3158, 9.8442),
    "yola": (9.2035, 12.4954),
    "gombe": (10.2904, 11.1717),
    # North-West
    "kano": (12.0022, 8.5919),
    "kaduna": (10.5222, 7.4383),
    "sokoto": (13.0059, 5.2476),
    "katsina": (12.9908, 7.6018),
    "zaria": (11.0855, 7.7199),
}

# State-level centroids as a secondary fallback when only `state` is known.
_STATE_CENTROIDS: Dict[str, Tuple[float, float]] = {
    "lagos": (6.5244, 3.3792),
    "ogun": (7.1557, 3.3451),
    "oyo": (7.3775, 3.9470),
    "ondo": (7.2526, 5.1931),
    "edo": (6.3350, 5.6037),
    "delta": (5.5160, 5.7500),
    "rivers": (4.8156, 7.0498),
    "abia": (5.1066, 7.3667),
    "imo": (5.4836, 7.0331),
    "enugu": (6.5244, 7.5188),
    "anambra": (6.1397, 6.7891),
    "fct": (9.0820, 7.3947),
    "fct-abuja": (9.0820, 7.3947),
    "kano": (12.0022, 8.5919),
    "kaduna": (10.5222, 7.4383),
    "borno": (11.8333, 13.1500),
    "plateau": (9.8965, 8.8583),
}

# Region-level centroids (rough Nigerian zone midpoints) for demand overlays.
_REGION_CENTROIDS: Dict[str, Tuple[float, float]] = {
    "south west":    (7.0,  4.0),
    "south-west":    (7.0,  4.0),
    "south south":   (5.0,  6.5),
    "south-south":   (5.0,  6.5),
    "south east":    (5.8,  7.4),
    "south-east":    (5.8,  7.4),
    "north central": (8.8,  7.5),
    "north-central": (8.8,  7.5),
    "north east":    (10.5, 12.0),
    "north-east":    (10.5, 12.0),
    "north west":    (12.0, 7.5),
    "north-west":    (12.0, 7.5),
}


def _norm(value: Optional[str]) -> str:
    if not value:
        return ""
    out = value.strip().lower()
    for suffix in (" lga", " local government", " city", " town", " metropolis"):
        if out.endswith(suffix):
            out = out[: -len(suffix)].strip()
    return out


def lookup_coords(city: Optional[str] = None,
                  state: Optional[str] = None,
                  default: Tuple[float, float] = (9.0820, 7.3947)) -> Tuple[float, float]:
    """Return (lat, lng) for a Nigerian location.

    Order of preference: exact city centroid → state centroid → default
    (Abuja). All matches are normalised (lowercased, suffixes stripped).
    """
    norm_city = _norm(city)
    if norm_city in _CENTROIDS:
        return _CENTROIDS[norm_city]
    norm_state = _norm(state)
    if norm_state in _STATE_CENTROIDS:
        return _STATE_CENTROIDS[norm_state]
    return default


def lookup_region(region: Optional[str]) -> Optional[Tuple[float, float]]:
    if not region:
        return None
    return _REGION_CENTROIDS.get(region.strip().lower())


# State → region mapping (Nigerian geopolitical zones).
_STATE_TO_REGION: Dict[str, str] = {
    # South West
    "lagos": "south west", "ogun": "south west", "oyo": "south west",
    "ondo": "south west", "ekiti": "south west", "osun": "south west",
    # South South
    "edo": "south south", "delta": "south south", "rivers": "south south",
    "bayelsa": "south south", "akwa ibom": "south south", "cross river": "south south",
    # South East
    "abia": "south east", "imo": "south east", "enugu": "south east",
    "anambra": "south east", "ebonyi": "south east",
    # North Central
    "fct": "north central", "fct-abuja": "north central", "abuja": "north central",
    "kogi": "north central", "kwara": "north central", "nasarawa": "north central",
    "benue": "north central", "niger": "north central", "plateau": "north central",
    # North East
    "borno": "north east", "yobe": "north east", "adamawa": "north east",
    "taraba": "north east", "bauchi": "north east", "gombe": "north east",
    # North West
    "kano": "north west", "kaduna": "north west", "katsina": "north west",
    "kebbi": "north west", "sokoto": "north west", "zamfara": "north west",
    "jigawa": "north west",
}


def region_for_state(state: Optional[str]) -> Optional[str]:
    if not state:
        return None
    return _STATE_TO_REGION.get(state.strip().lower())
