"""Team snapshot for the team pages: current Elo and season-to-date efficiency.

Elo replays every completed game with the same EloBook the model uses, so the
rating on the site is the one the model saw (plus the latest results). Efficiency
is plain season-to-date EPA per play (offense: own plays; defense: opponents'
plays), ranked 1-32 (1 = best offense / stingiest defense).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from endzoneiq_pipeline.model.elo import EloBook
from endzoneiq_pipeline.model.features import kickoff_utc


def _completed(schedules: pd.DataFrame) -> pd.DataFrame:
    s = schedules[schedules["home_score"].notna() & schedules["away_score"].notna()].copy()
    s["kickoff"] = [kickoff_utc(d, t) for d, t in zip(s["gameday"], s["gametime"], strict=True)]
    return s.sort_values(["kickoff", "game_id"])


def current_elo(schedules: pd.DataFrame) -> dict[str, float]:
    elo = EloBook()
    for g in _completed(schedules).to_dict("records"):
        elo.start_season(int(g["season"]))
        elo.update(
            g["home_team"],
            g["away_team"],
            int(g["home_score"]),
            int(g["away_score"]),
            g.get("location") == "Neutral",
        )
    return dict(elo.ratings)


def _rate(num: float, den: float) -> float | None:
    return round(num / den, 4) if den else None


def _ranks(values: dict[str, float | None], best_high: bool) -> dict[str, int]:
    known = sorted(
        ((t, v) for t, v in values.items() if v is not None),
        key=lambda tv: -tv[1] if best_high else tv[1],
    )
    return {t: i + 1 for i, (t, _) in enumerate(known)}


def team_snapshot(
    schedules: pd.DataFrame, team_games: pd.DataFrame, season: int
) -> tuple[int, list[dict[str, Any]]] | None:
    """(last completed week, one row per team) for `season`, or None before week 1."""
    done = _completed(schedules)
    played = done[done["season"] == season]
    if played.empty:
        return None
    week = int(played["week"].max())
    ratings = current_elo(schedules)

    opp: dict[tuple[str, str], str] = {}
    for g in played.to_dict("records"):
        opp[(g["game_id"], g["home_team"])] = g["away_team"]
        opp[(g["game_id"], g["away_team"])] = g["home_team"]
    tg = team_games[team_games["game_id"].isin(set(played["game_id"]))]

    cols = ["plays", "epa", "pass_plays", "pass_epa", "rush_plays", "rush_epa"]
    off: dict[str, dict[str, float]] = {}
    deff: dict[str, dict[str, float]] = {}
    for r in tg.to_dict("records"):
        team = r["posteam"]
        other = opp.get((r["game_id"], team))
        if other is None:
            continue
        for book, key in ((off, team), (deff, other)):
            acc = book.setdefault(key, dict.fromkeys(cols, 0.0))
            for c in cols:
                acc[c] += float(r[c])

    teams = sorted(set(played["home_team"]) | set(played["away_team"]))

    def epa(book: dict, t: str, num: str, den: str) -> float | None:
        b = book.get(t)
        return _rate(b[num], b[den]) if b else None

    off_epa = {t: epa(off, t, "epa", "plays") for t in teams}
    def_epa = {t: epa(deff, t, "epa", "plays") for t in teams}
    off_rank = _ranks(off_epa, best_high=True)
    def_rank = _ranks(def_epa, best_high=False)
    rows = [
        {
            "abbr": t,
            "elo": round(ratings.get(t, 1505.0), 1),
            "offEpa": off_epa[t],
            "defEpa": def_epa[t],
            "offPassEpa": epa(off, t, "pass_epa", "pass_plays"),
            "offRunEpa": epa(off, t, "rush_epa", "rush_plays"),
            "defPassEpa": epa(deff, t, "pass_epa", "pass_plays"),
            "defRunEpa": epa(deff, t, "rush_epa", "rush_plays"),
            "offEpaRank": off_rank.get(t),
            "defEpaRank": def_rank.get(t),
        }
        for t in teams
    ]
    return week, rows
