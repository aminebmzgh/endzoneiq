"""Raw inputs for the model, from nflverse, reduced to small team/QB game summaries.

Raw play-by-play is about 100 MB per season and never leaves the runner: each
season is aggregated right after download and only the aggregates are cached
(parquet, in PIPELINE_CACHE_DIR, persisted between runs with actions/cache).
Completed seasons are cached for good; the current season is refreshed when
its cache is older than CURRENT_SEASON_TTL_H hours.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import pandas as pd

from endzoneiq_pipeline.sources.nflverse import LEGACY_ABBR

log = logging.getLogger(__name__)

ELO_FIRST_SEASON = 1999  # Elo needs history before the 2012 training window
PBP_FIRST_SEASON = 2011  # rolling stats for 2012 week 1 start from 2011
CURRENT_SEASON_TTL_H = 12

PBP_COLUMNS = [
    "game_id",
    "posteam",
    "defteam",
    "epa",
    "success",
    "pass",
    "rush",
    "qb_dropback",
    "passer_player_id",
    "rusher_player_id",
    "yards_gained",
    "interception",
    "fumble_lost",
    "qb_kneel",
    "qb_spike",
    "two_point_attempt",
]


ZERO_FILL = [
    "pass",
    "rush",
    "qb_dropback",
    "interception",
    "fumble_lost",
    "qb_kneel",
    "qb_spike",
    "two_point_attempt",
    "success",
    "yards_gained",
]
INJURY_COLUMNS = [
    "season",
    "game_type",
    "team",
    "week",
    "gsis_id",
    "position",
    "report_status",
    "date_modified",
]


def cache_dir() -> Path:
    d = Path(os.environ.get("PIPELINE_CACHE_DIR", ".cache/nflverse"))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _fresh(path: Path, season: int, current: int) -> bool:
    if not path.exists():
        return False
    if season < current:
        return True
    return (time.time() - path.stat().st_mtime) < CURRENT_SEASON_TTL_H * 3600


def _norm_team(s: pd.Series) -> pd.Series:
    return s.replace(LEGACY_ABBR)


def aggregate_pbp(pbp):  # polars DataFrame -> (team, qb) polars DataFrames
    """Per team-game offense totals and per QB-game dropback totals."""
    import polars as pl

    p = pbp.select(PBP_COLUMNS).with_columns(pl.col(c).fill_null(0) for c in ZERO_FILL)
    plays = p.filter(
        ((pl.col("pass") == 1) | (pl.col("rush") == 1))
        & pl.col("epa").is_not_null()
        & pl.col("posteam").is_not_null()
        & (pl.col("qb_kneel") == 0)
        & (pl.col("qb_spike") == 0)
        & (pl.col("two_point_attempt") == 0)
    ).with_columns(
        explosive=(
            ((pl.col("pass") == 1) & (pl.col("yards_gained") >= 20))
            | ((pl.col("rush") == 1) & (pl.col("pass") == 0) & (pl.col("yards_gained") >= 10))
        ).cast(pl.Int32),
        turnover=(pl.col("interception") + pl.col("fumble_lost")).cast(pl.Int32),
        is_pass=(pl.col("pass") == 1).cast(pl.Int32),
        is_rush=((pl.col("rush") == 1) & (pl.col("pass") == 0)).cast(pl.Int32),
    )
    team = plays.group_by("game_id", "posteam").agg(
        plays=pl.len(),
        epa=pl.col("epa").sum(),
        pass_plays=pl.col("is_pass").sum(),
        pass_epa=(pl.col("epa") * pl.col("is_pass")).sum(),
        rush_plays=pl.col("is_rush").sum(),
        rush_epa=(pl.col("epa") * pl.col("is_rush")).sum(),
        success=pl.col("success").sum(),
        explosive=pl.col("explosive").sum(),
        turnovers=pl.col("turnover").sum(),
    )
    qb = (
        plays.filter(pl.col("qb_dropback") == 1)
        .with_columns(qb_id=pl.coalesce("passer_player_id", "rusher_player_id"))
        .filter(pl.col("qb_id").is_not_null())
        .group_by("game_id", "posteam", "qb_id")
        .agg(dropbacks=pl.len(), epa=pl.col("epa").sum())
    )
    return team, qb


def load_pbp_aggregates(seasons: list[int], current: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    import nflreadpy
    import polars as pl

    teams, qbs = [], []
    for season in seasons:
        tp, qp = cache_dir() / f"team_{season}.parquet", cache_dir() / f"qb_{season}.parquet"
        if not (_fresh(tp, season, current) and _fresh(qp, season, current)):
            t0 = time.time()
            team, qb = aggregate_pbp(nflreadpy.load_pbp(season))
            team.write_parquet(tp)
            qb.write_parquet(qp)
            log.info("pbp %s aggregated in %.0fs", season, time.time() - t0)
        teams.append(pl.read_parquet(tp).to_pandas())
        qbs.append(pl.read_parquet(qp).to_pandas())
    team_df, qb_df = pd.concat(teams, ignore_index=True), pd.concat(qbs, ignore_index=True)
    team_df["posteam"] = _norm_team(team_df["posteam"])
    qb_df["posteam"] = _norm_team(qb_df["posteam"])
    return team_df, qb_df


def load_schedules() -> pd.DataFrame:
    import nflreadpy

    s = nflreadpy.load_schedules(True).to_pandas()
    s = s[s["season"] >= ELO_FIRST_SEASON].copy()
    for c in ("home_team", "away_team"):
        s[c] = _norm_team(s[c])
    return s


def load_injuries(seasons: list[int]) -> pd.DataFrame:
    import nflreadpy

    frames = []
    for season in seasons:
        try:
            frames.append(nflreadpy.load_injuries(season).to_pandas())
        except Exception as err:  # a season not published yet
            log.warning("injuries %s unavailable: %s", season, err)
    if not frames:
        return pd.DataFrame(columns=INJURY_COLUMNS)
    inj = pd.concat(frames, ignore_index=True)
    inj["team"] = _norm_team(inj["team"])
    return inj


def load_all(current: int) -> dict[str, pd.DataFrame]:
    seasons = list(range(PBP_FIRST_SEASON, current + 1))
    team, qb = load_pbp_aggregates(seasons, current)
    return {
        "schedules": load_schedules(),
        "team_games": team,
        "qb_games": qb,
        "injuries": load_injuries(seasons),
    }
