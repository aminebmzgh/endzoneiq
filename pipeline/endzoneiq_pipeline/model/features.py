"""Pre-kickoff features for every game (spec 7.2), one row per game.

No look-ahead: games are processed in kickoff order and a finished game only
becomes data GAME_DATA_DELAY after its kickoff (results, play-by-play, Elo).
Every row carries `data_asof`, the latest timestamp of anything it used; the
leakage tests assert data_asof < kickoff for every row.

Team strength uses exponentially decayed sums of per-play stats (DECAY per game,
SEASON_CARRY at each new season), shrunk toward the league mean with a prior
worth K plays, so early-season numbers lean on the league average. Matchup
features are home-minus-away "edges"; positive always favours the home team,
except injury_diff (positive = home more hurt).
"""

from __future__ import annotations

import heapq
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from endzoneiq_pipeline.model import geo
from endzoneiq_pipeline.model.elo import EloBook

FIRST_FEATURE_SEASON = 2012
GAME_DATA_DELAY = timedelta(hours=4)  # a result counts as known 4h after kickoff
EASTERN = ZoneInfo("America/New_York")

DECAY = 0.92  # per team game (half-life about 8.3 games)
SEASON_CARRY = 0.4  # share of last season's evidence kept at a new season
QB_DECAY = 0.95  # per game the QB plays
USUAL_DECAY = 0.85  # for "who usually starts for this team"

# Shrinkage priors (in plays/dropbacks/games): bigger = noisier stat, leaned on the mean longer.
K = {
    "epa": 400,
    "pass_epa": 250,
    "rush_epa": 200,
    "success": 400,
    "explosive": 600,
    "turnovers": 2000,  # turnovers are noisy: regress hard
}
K_GAMES = 3.0
K_QB = 200.0
QB_PRIOR_EPA = -0.05  # unknown/backup QB: below league average per dropback

INJURY_STATUS_WEIGHT = {"Out": 1.0, "Doubtful": 0.75}
# QB is 0 here because a QB change is measured directly by qb_delta.
POSITION_WEIGHT = {
    "T": 1.0, "OT": 1.0, "LT": 1.0, "RT": 1.0,
    "DE": 1.0, "EDGE": 1.0, "OLB": 0.9, "CB": 1.0,
    "WR": 0.8, "DT": 0.7, "NT": 0.7, "DL": 0.7,
    "S": 0.6, "FS": 0.6, "SS": 0.6, "DB": 0.6,
    "G": 0.6, "OG": 0.6, "C": 0.6, "OL": 0.6,
    "LB": 0.5, "ILB": 0.5, "MLB": 0.5,
    "TE": 0.5, "RB": 0.4, "FB": 0.2,
    "K": 0.3, "P": 0.2, "LS": 0.1, "QB": 0.0,
}  # fmt: skip
DEFAULT_POSITION_WEIGHT = 0.3

FEATURES = [
    "elo_diff",
    "qb_delta_diff",
    "epa_edge",
    "pass_edge",
    "rush_edge",
    "success_edge",
    "explosive_edge",
    "turnover_edge",
    "points_diff",
    "injury_diff",
    "rest_diff",
    "home_short_week",
    "away_short_week",
    "home_off_bye",
    "away_off_bye",
    "travel_away_km",
    "travel_home_km",
    "tz_shift_away",
    "neutral",
    "div_game",
    "playoff",
    "indoor",
    "wind_kph",
    "temp_c",
    "off_epa_sum",
    "def_epa_sum",
    "pace_sum",
    "points_for_sum",
    "points_against_sum",
]

# Symmetric "how many points will both teams score" features say nothing about who
# wins, so only the total-points model sees them.
TOTAL_ONLY = ["off_epa_sum", "def_epa_sum", "pace_sum", "points_for_sum", "points_against_sum"]
WIN_FEATURES = [f for f in FEATURES if f not in TOTAL_ONLY]
MODEL_FEATURES = {"win": WIN_FEATURES, "margin": WIN_FEATURES, "total": FEATURES}

STATS = [
    "plays",
    "epa",
    "pass_plays",
    "pass_epa",
    "rush_plays",
    "rush_epa",
    "success",
    "explosive",
    "turnovers",
]


@dataclass
class TeamBook:
    off: dict[str, float] = field(default_factory=lambda: dict.fromkeys(STATS, 0.0))
    deff: dict[str, float] = field(default_factory=lambda: dict.fromkeys(STATS, 0.0))
    games: float = 0.0
    points_for: float = 0.0
    points_against: float = 0.0
    usual_qb: dict[str, float] = field(default_factory=dict)

    def scale(self, f: float) -> None:
        for d in (self.off, self.deff):
            for k in d:
                d[k] *= f
        self.games *= f
        self.points_for *= f
        self.points_against *= f


@dataclass
class QbBook:
    dropbacks: float = 0.0
    epa: float = 0.0


def kickoff_utc(gameday: str, gametime: str | None) -> datetime:
    t = gametime if isinstance(gametime, str) and gametime else "13:00"
    local = datetime.strptime(f"{gameday} {t}", "%Y-%m-%d %H:%M").replace(tzinfo=EASTERN)
    return local.astimezone(UTC)


def _rate(book: dict[str, float], num: str, den: str, k: float, prior: float) -> float:
    return (book[num] + k * prior) / (book[den] + k)


def league_priors(team_games: pd.DataFrame, game_season: dict[str, int]) -> dict[int, dict]:
    """Per-play league means by season; season S uses season S-1 (no look-ahead)."""
    tg = team_games.assign(season=team_games["game_id"].map(game_season))
    by = tg.groupby("season")[STATS].sum()
    out: dict[int, dict] = {}
    for season in by.index:
        src = by.loc[season - 1] if (season - 1) in by.index else by.loc[season]
        games = len(tg[tg["season"] == (season - 1 if (season - 1) in by.index else season)])
        out[int(season)] = {
            "epa": src["epa"] / src["plays"],
            "pass_epa": src["pass_epa"] / src["pass_plays"],
            "rush_epa": src["rush_epa"] / src["rush_plays"],
            "success": src["success"] / src["plays"],
            "explosive": src["explosive"] / src["plays"],
            "turnovers": src["turnovers"] / src["plays"],
            "pace": src["plays"] / max(games, 1),
        }
    return out


def home_stadiums(schedules: pd.DataFrame) -> dict[tuple[int, str], str]:
    """(season, team) -> the stadium where the team played most home games."""
    home = schedules[schedules["location"] != "Neutral"]
    mode = home.groupby(["season", "home_team"])["stadium_id"].agg(
        lambda s: s.value_counts().index[0]
    )
    out = {(int(season), team): sid for (season, team), sid in mode.items()}
    # Seasons with no home game yet (or a future season) fall back to the previous one.
    teams = set(schedules["home_team"]) | set(schedules["away_team"])
    for season in sorted(schedules["season"].unique()):
        for t in teams:
            if (int(season), t) not in out and (int(season) - 1, t) in out:
                out[(int(season), t)] = out[(int(season) - 1, t)]
    return out


def _injury_index(injuries: pd.DataFrame) -> dict[tuple[int, int, str], list[tuple]]:
    idx: dict[tuple[int, int, str], list[tuple]] = defaultdict(list)
    if injuries.empty:
        return idx
    inj = injuries[injuries["report_status"].isin(INJURY_STATUS_WEIGHT)]
    for r in inj.itertuples(index=False):
        when = pd.Timestamp(r.date_modified)
        if pd.isna(when):
            continue
        when = when.tz_localize(UTC) if when.tzinfo is None else when.tz_convert(UTC)
        weight = INJURY_STATUS_WEIGHT[r.report_status] * POSITION_WEIGHT.get(
            str(r.position), DEFAULT_POSITION_WEIGHT
        )
        idx[(int(r.season), int(r.week), r.team)].append((when.to_pydatetime(), r.gsis_id, weight))
    return idx


def _injury_load(entries: list[tuple], kickoff: datetime) -> tuple[float, datetime | None]:
    """Weighted players out, from the latest report row per player before kickoff."""
    latest: dict[str, tuple[datetime, float]] = {}
    for when, pid, weight in entries:
        if when < kickoff and (pid not in latest or when > latest[pid][0]):
            latest[pid] = (when, weight)
    if not latest:
        return 0.0, None
    return sum(w for _, w in latest.values()), max(t for t, _ in latest.values())


def build_features(
    schedules: pd.DataFrame,
    team_games: pd.DataFrame,
    qb_games: pd.DataFrame,
    injuries: pd.DataFrame,
    *,
    first_season: int = FIRST_FEATURE_SEASON,
) -> pd.DataFrame:
    sched = schedules.copy()
    sched["kickoff"] = [
        kickoff_utc(d, t) for d, t in zip(sched["gameday"], sched["gametime"], strict=True)
    ]
    sched = sched.sort_values(["kickoff", "game_id"]).reset_index(drop=True)
    game_season = dict(zip(sched["game_id"], sched["season"], strict=True))
    priors = league_priors(team_games, game_season) if not team_games.empty else {}
    stadium_home = home_stadiums(sched)
    inj_idx = _injury_index(injuries)

    stats_by: dict[tuple[str, str], dict] = {
        (r["game_id"], r["posteam"]): r for r in team_games.to_dict("records")
    }
    qbs_by: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in qb_games.to_dict("records"):
        qbs_by[(r["game_id"], r["posteam"])].append(r)

    elo = EloBook()
    books: dict[str, TeamBook] = defaultdict(TeamBook)
    qb_books: dict[str, QbBook] = defaultdict(QbBook)
    pending: list[tuple[datetime, int, dict]] = []  # (available_at, seq, game) min-heap
    seq = 0
    data_asof: datetime | None = None
    current_season: int | None = None
    rows = []

    def apply(game: dict) -> None:
        h, a = game["home_team"], game["away_team"]
        hs, as_ = int(game["home_score"]), int(game["away_score"])
        elo.update(h, a, hs, as_, game["location"] == "Neutral")
        for team, opp, pf, pa in ((h, a, hs, as_), (a, h, as_, hs)):
            b = books[team]
            b.scale(DECAY)
            b.games += 1
            b.points_for += pf
            b.points_against += pa
            off, deff = stats_by.get((game["game_id"], team)), stats_by.get((game["game_id"], opp))
            if off is not None and deff is not None:
                for s in STATS:
                    b.off[s] += off[s]
                    b.deff[s] += deff[s]
            for k in b.usual_qb:
                b.usual_qb[k] *= USUAL_DECAY
            for q in qbs_by.get((game["game_id"], team), []):
                b.usual_qb[q["qb_id"]] = b.usual_qb.get(q["qb_id"], 0.0) + q["dropbacks"]
                qb = qb_books[q["qb_id"]]
                qb.dropbacks = qb.dropbacks * QB_DECAY + q["dropbacks"]
                qb.epa = qb.epa * QB_DECAY + q["epa"]

    def qb_value(qb_id: str | None) -> float:
        qb = qb_books.get(qb_id or "")
        if qb is None:
            return QB_PRIOR_EPA
        return (qb.epa + K_QB * QB_PRIOR_EPA) / (qb.dropbacks + K_QB)

    def qb_delta(team: str, starter: object) -> float:
        usual = books[team].usual_qb
        if not isinstance(starter, str) or not starter or not usual:
            return 0.0
        usual_id = max(usual, key=usual.__getitem__)
        return 0.0 if starter == usual_id else qb_value(starter) - qb_value(usual_id)

    def team_rates(team: str, p: dict) -> dict[str, float]:
        b = books[team]
        out = {}
        for side, d in (("off", b.off), ("def", b.deff)):
            out[f"{side}_epa"] = _rate(d, "epa", "plays", K["epa"], p["epa"])
            out[f"{side}_pass_epa"] = _rate(
                d, "pass_epa", "pass_plays", K["pass_epa"], p["pass_epa"]
            )
            out[f"{side}_rush_epa"] = _rate(
                d, "rush_epa", "rush_plays", K["rush_epa"], p["rush_epa"]
            )
            out[f"{side}_success"] = _rate(d, "success", "plays", K["success"], p["success"])
            out[f"{side}_explosive"] = _rate(
                d, "explosive", "plays", K["explosive"], p["explosive"]
            )
            out[f"{side}_turnovers"] = _rate(
                d, "turnovers", "plays", K["turnovers"], p["turnovers"]
            )
        league_ppg = 22.0
        out["pf"] = (b.points_for + K_GAMES * league_ppg) / (b.games + K_GAMES)
        out["pa"] = (b.points_against + K_GAMES * league_ppg) / (b.games + K_GAMES)
        out["pace"] = (b.off["plays"] + K_GAMES * p["pace"]) / (b.games + K_GAMES)
        return out

    for kickoff, group in sched.groupby("kickoff", sort=True):
        kickoff = kickoff.to_pydatetime() if hasattr(kickoff, "to_pydatetime") else kickoff
        while pending and pending[0][0] < kickoff:
            available_at, _, game = heapq.heappop(pending)
            apply(game)
            data_asof = available_at if data_asof is None else max(data_asof, available_at)

        for g in group.to_dict("records"):
            season = int(g["season"])
            if season != current_season:
                elo.start_season(season)
                if current_season is not None:
                    for b in books.values():
                        b.scale(SEASON_CARRY)
                current_season = season

            if season >= first_season:
                rows.append(
                    _row(
                        g,
                        kickoff,
                        elo,
                        team_rates,
                        qb_delta,
                        priors,
                        stadium_home,
                        inj_idx,
                        data_asof,
                    )
                )

            if not (pd.isna(g["home_score"]) or pd.isna(g["away_score"])):
                seq += 1
                heapq.heappush(pending, (kickoff + GAME_DATA_DELAY, seq, g))

    return pd.DataFrame(rows)


def _num(v: object) -> float:
    return float("nan") if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)


def _row(g, kickoff, elo, team_rates, qb_delta, priors, stadium_home, inj_idx, data_asof) -> dict:
    season, h, a = int(g["season"]), g["home_team"], g["away_team"]
    p = priors.get(season) or priors.get(max(priors)) if priors else None
    if p is None:
        raise ValueError("no play-by-play aggregates available to build features")
    rh, ra = elo.pregame(h, a)
    th, ta = team_rates(h, p), team_rates(a, p)
    venue = g.get("stadium_id")
    home_base, away_base = stadium_home.get((season, h)), stadium_home.get((season, a))
    inj_h, t_h = _injury_load(inj_idx.get((season, int(g["week"]), h), []), kickoff)
    inj_a, t_a = _injury_load(inj_idx.get((season, int(g["week"]), a), []), kickoff)
    asof_candidates = [t for t in (data_asof, t_h, t_a) if t is not None]
    indoor = geo.is_indoor(venue, g.get("roof"))
    wind, temp = _num(g.get("wind")), _num(g.get("temp"))
    home_rest, away_rest = _num(g.get("home_rest")), _num(g.get("away_rest"))
    hs, as_ = g.get("home_score"), g.get("away_score")
    margin = float("nan") if pd.isna(hs) or pd.isna(as_) else float(hs) - float(as_)

    def edge(stat: str) -> float:
        return (th[f"off_{stat}"] + ta[f"def_{stat}"]) - (ta[f"off_{stat}"] + th[f"def_{stat}"])

    return {
        "game_id": g["game_id"],
        "season": season,
        "week": int(g["week"]),
        "game_type": g["game_type"],
        "kickoff": kickoff,
        "data_asof": max(asof_candidates) if asof_candidates else None,
        "home_team": h,
        "away_team": a,
        "home_elo": rh,
        "away_elo": ra,
        "elo_diff": rh - ra,
        "qb_delta_diff": qb_delta(h, g.get("home_qb_id")) - qb_delta(a, g.get("away_qb_id")),
        "epa_edge": edge("epa"),
        "pass_edge": edge("pass_epa"),
        "rush_edge": edge("rush_epa"),
        "success_edge": edge("success"),
        "explosive_edge": edge("explosive"),
        # Turnovers: home forcing them and the away offense coughing them up are both good.
        "turnover_edge": (th["def_turnovers"] + ta["off_turnovers"])
        - (ta["def_turnovers"] + th["off_turnovers"]),
        "points_diff": (th["pf"] - th["pa"]) - (ta["pf"] - ta["pa"]),
        "injury_diff": inj_h - inj_a,
        "rest_diff": home_rest - away_rest,
        "home_short_week": float(home_rest <= 5),
        "away_short_week": float(away_rest <= 5),
        "home_off_bye": float(home_rest >= 13),
        "away_off_bye": float(away_rest >= 13),
        "travel_away_km": _num(geo.distance_km(away_base, venue)),
        "travel_home_km": _num(geo.distance_km(home_base, venue)),
        "tz_shift_away": _num(geo.tz_shift_h(away_base, venue, kickoff)),
        "neutral": float(g.get("location") == "Neutral"),
        "div_game": float(bool(g.get("div_game"))),
        "playoff": float(g["game_type"] != "REG"),
        "indoor": float(indoor),
        "wind_kph": 0.0 if indoor else wind * 1.609344,
        "temp_c": 21.0 if indoor else (temp - 32.0) * 5.0 / 9.0,
        "off_epa_sum": th["off_epa"] + ta["off_epa"],
        "def_epa_sum": th["def_epa"] + ta["def_epa"],
        "pace_sum": th["pace"] + ta["pace"],
        "points_for_sum": th["pf"] + ta["pf"],
        "points_against_sum": th["pa"] + ta["pa"],
        # Targets and market line (evaluation only, never a feature).
        "margin": margin,
        "total": float("nan") if np.isnan(margin) else float(hs) + float(as_),
        "home_win": float("nan") if np.isnan(margin) or margin == 0 else float(margin > 0),
        "spread_line": _num(g.get("spread_line")),
        "total_line": _num(g.get("total_line")),
    }
