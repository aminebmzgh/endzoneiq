"""Stadium geography: travel distance and time zones crossed.

Stadium data comes from db/seed/stadiums.json, the same file the site seeds
its `stadiums` table from, so the two can never disagree.
"""

from __future__ import annotations

import math
from datetime import datetime
from zoneinfo import ZoneInfo

from endzoneiq_pipeline import reference

EARTH_RADIUS_KM = 6371.0


def stadiums() -> dict[str, dict]:
    return reference.stadiums()


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def distance_km(from_stadium: str | None, to_stadium: str | None) -> float | None:
    s = stadiums()
    a, b = s.get(from_stadium or ""), s.get(to_stadium or "")
    if a is None or b is None:
        return None
    return haversine_km(a["lat"], a["lon"], b["lat"], b["lon"])


def utc_offset_h(stadium: str | None, at: datetime) -> float | None:
    st = stadiums().get(stadium or "")
    if st is None:
        return None
    off = at.astimezone(ZoneInfo(st["timezone"])).utcoffset()
    return None if off is None else off.total_seconds() / 3600


def tz_shift_h(from_stadium: str | None, to_stadium: str | None, at: datetime) -> float | None:
    """Hours the team's body clock moves (positive = travelling east)."""
    a, b = utc_offset_h(from_stadium, at), utc_offset_h(to_stadium, at)
    return None if a is None or b is None else b - a


def is_indoor(stadium: str | None, game_roof: str | None) -> bool:
    """Game-level roof from nflverse wins (retractables report open/closed); else the seed."""
    if game_roof in ("dome", "closed"):
        return True
    if game_roof in ("outdoors", "open"):
        return False
    st = stadiums().get(stadium or "")
    return bool(st and st["roofType"] == "dome")
