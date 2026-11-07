"""Live updates (spec 7.5): injury reports, admin overrides and weather forecasts.

The watchers post what they find to the site; re-predictions apply the site's admin
overrides and stored forecasts to the model inputs before building features, so a
"QB out" override changes the pick the same way a real injury report would.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pandas as pd

from endzoneiq_pipeline import reference
from endzoneiq_pipeline.model.features import kickoff_utc

REPORT_STATUS = {"Out": "out", "Doubtful": "doubtful", "Questionable": "questionable"}
NFLVERSE_STATUS = {v: k for k, v in REPORT_STATUS.items()}
BACKUP_QB = "override-backup-qb"


def with_kickoff(schedules: pd.DataFrame) -> pd.DataFrame:
    s = schedules.copy()
    s["kickoff"] = [kickoff_utc(d, t) for d, t in zip(s["gameday"], s["gametime"], strict=True)]
    return s


def upcoming_week(schedules: pd.DataFrame, now: datetime) -> pd.DataFrame:
    """The games of the next week that has a game after `now`."""
    s = with_kickoff(schedules)
    future = s[s["kickoff"] > now].sort_values("kickoff")
    if future.empty:
        return future
    first = future.iloc[0]
    return future[(future["season"] == first["season"]) & (future["week"] == first["week"])]


# --- Injury reports -------------------------------------------------------------------


def players_injuries_payload(week: pd.DataFrame, injuries: pd.DataFrame) -> dict[str, Any]:
    """POST /api/internal/ingest/players-injuries body for one week's games."""
    players: dict[str, dict[str, str]] = {}
    rows: list[dict[str, str]] = []
    by_team: dict[tuple[int, int, str], str] = {}
    for g in week.to_dict("records"):
        for side in ("home", "away"):
            team = g[f"{side}_team"]
            by_team[(int(g["season"]), int(g["week"]), team)] = g["game_id"]
            qb_id, qb_name = g.get(f"{side}_qb_id"), g.get(f"{side}_qb_name")
            if isinstance(qb_id, str) and qb_id:
                name = qb_name if isinstance(qb_name, str) and qb_name else f"{team} QB"
                players[qb_id] = {"gsisId": qb_id, "name": name, "position": "QB", "team": team}
    if not injuries.empty:
        inj = injuries[injuries["report_status"].isin(REPORT_STATUS)]
        for r in inj.to_dict("records"):
            game_id = by_team.get((int(r["season"]), int(r["week"]), r["team"]))
            gsis = r.get("gsis_id")
            if not game_id or not isinstance(gsis, str):
                continue
            name = r.get("full_name") if isinstance(r.get("full_name"), str) else gsis
            pos = r.get("position") if isinstance(r.get("position"), str) else ""
            players.setdefault(
                gsis, {"gsisId": gsis, "name": name, "position": pos[:8], "team": r["team"]}
            )
            rows.append(
                {"gameId": game_id, "gsisId": gsis, "status": REPORT_STATUS[r["report_status"]]}
            )
    # One row per (game, player): the last report wins.
    latest = {(r["gameId"], r["gsisId"]): r for r in rows}
    return {
        "games": sorted(by_team.values()),
        "players": list(players.values()),
        "injuries": list(latest.values()),
    }


def apply_overrides(
    schedules: pd.DataFrame,
    injuries: pd.DataFrame,
    overrides: list[dict[str, Any]],
    now: datetime,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Admin injury overrides from /api/internal/export, applied to the model inputs.

    - The player's report rows for that game week are replaced by the override
      (dated now, which is before kickoff: overrides only exist for upcoming games).
    - A listed starting QB marked out is replaced by an unknown backup, which is what
      the QB feature measures for a real backup start.
    """
    if not overrides:
        return schedules, injuries
    sched = schedules.copy()
    inj = injuries.copy()
    by_id = sched.set_index("game_id")
    added = []
    for o in overrides:
        gid, gsis, status = o["gameId"], o["gsisId"], o["status"]
        if gid not in by_id.index:
            continue
        g = by_id.loc[gid]
        season, week = int(g["season"]), int(g["week"])
        team = o.get("team") or None
        if not inj.empty:
            inj = inj[
                ~((inj["season"] == season) & (inj["week"] == week) & (inj["gsis_id"] == gsis))
            ]
        if status in NFLVERSE_STATUS:
            added.append(
                {
                    "season": season,
                    "game_type": g["game_type"],
                    "team": team,
                    "week": week,
                    "gsis_id": gsis,
                    "position": o.get("position") or "",
                    "full_name": o.get("name") or gsis,
                    "report_status": NFLVERSE_STATUS[status],
                    "date_modified": pd.Timestamp(now),
                }
            )
        if status == "out":
            for side in ("home", "away"):
                if sched.loc[sched["game_id"] == gid, f"{side}_qb_id"].eq(gsis).any():
                    mask = sched["game_id"] == gid
                    sched.loc[mask, f"{side}_qb_id"] = BACKUP_QB
                    if f"{side}_qb_name" in sched.columns:
                        sched.loc[mask, f"{side}_qb_name"] = "Backup QB"
    if added:
        extra = pd.DataFrame(added)
        if "date_modified" in inj.columns:
            inj["date_modified"] = pd.to_datetime(inj["date_modified"], utc=True)
        inj = pd.concat([inj, extra], ignore_index=True)
    return sched, inj


def apply_forecasts(schedules: pd.DataFrame, forecasts: list[dict[str, Any]]) -> pd.DataFrame:
    """Stored forecasts (deg C, km/h) as nflverse-style temp (deg F) and wind (mph)."""
    if not forecasts:
        return schedules
    sched = schedules.copy()
    for f in forecasts:
        mask = sched["game_id"] == f["gameId"]
        if f.get("tempC") is not None:
            sched.loc[mask, "temp"] = f["tempC"] * 9 / 5 + 32
        if f.get("windKph") is not None:
            sched.loc[mask, "wind"] = f["windKph"] / 1.609344
    return sched


# --- Weather forecasts ----------------------------------------------------------------

WMO = [
    (0, "clear"),
    (3, "cloudy"),
    (48, "fog"),
    (57, "drizzle"),
    (67, "rain"),
    (77, "snow"),
    (82, "showers"),
    (86, "snow showers"),
    (99, "thunderstorm"),
]


def condition(code: int | None) -> str | None:
    if code is None:
        return None
    if code == 0:
        return "clear"
    for upper, name in WMO:
        if code <= upper:
            return name
    return None


def outdoor_games_within(schedules: pd.DataFrame, now: datetime, hours: int = 72) -> pd.DataFrame:
    s = with_kickoff(schedules)
    soon = s[(s["kickoff"] > now) & (s["kickoff"] <= now + timedelta(hours=hours))]
    stadiums = reference.stadiums()
    keep = [
        stadiums.get(str(sid), {}).get("roofType") != "dome"
        for sid in soon.get("stadium_id", pd.Series([None] * len(soon)))
    ]
    return soon[keep]


def fetch_forecast(
    client: httpx.Client, lat: float, lon: float, kickoff: datetime
) -> dict[str, Any]:
    """Open-Meteo hourly forecast at the kickoff hour (free, no key)."""
    day = kickoff.astimezone(UTC).date().isoformat()
    res = client.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,wind_speed_10m,precipitation,weather_code",
            "timezone": "UTC",
            "start_date": day,
            "end_date": day,
        },
        timeout=20,
    )
    res.raise_for_status()
    h = res.json()["hourly"]
    hour = kickoff.astimezone(UTC).strftime("%Y-%m-%dT%H:00")
    i = h["time"].index(hour) if hour in h["time"] else 0
    return {
        "tempC": h["temperature_2m"][i],
        "windKph": h["wind_speed_10m"][i],
        "precipMm": h["precipitation"][i],
        "condition": condition(h["weather_code"][i]),
    }


def weather_payload(games: pd.DataFrame, client: httpx.Client) -> list[dict[str, Any]]:
    stadiums = reference.stadiums()
    out = []
    for g in games.to_dict("records"):
        st = stadiums.get(str(g.get("stadium_id")))
        if not st:
            continue
        out.append(
            {"gameId": g["game_id"], **fetch_forecast(client, st["lat"], st["lon"], g["kickoff"])}
        )
    return out
