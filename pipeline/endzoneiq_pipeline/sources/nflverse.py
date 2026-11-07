"""nflverse schedules via nflreadpy (free, updated daily during the season).

nflverse quirks handled here:
- `gametime` is US Eastern wall-clock time for every game, wherever it is played.
- Relocated franchises keep their old abbreviation in older seasons
  (OAK -> LV, SD -> LAC, STL -> LA); the site stores one id per franchise.
- Cancelled games are removed from the schedule (2022 BUF@CIN), not flagged.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from endzoneiq_pipeline.games import GameRecord

EASTERN = ZoneInfo("America/New_York")
LEGACY_ABBR = {"OAK": "LV", "SD": "LAC", "STL": "LA"}
GAME_TYPES = {"REG", "WC", "DIV", "CON", "SB"}
FIRST_SEASON = 2012


def team(abbr: str) -> str:
    return LEGACY_ABBR.get(abbr, abbr)


def kickoff_utc(gameday: str, gametime: str) -> datetime:
    local = datetime.strptime(f"{gameday} {gametime}", "%Y-%m-%d %H:%M").replace(tzinfo=EASTERN)
    return local.astimezone(UTC)


def _score(v: Any) -> int | None:
    return None if v is None else int(v)


def game_from_row(row: Mapping[str, Any]) -> GameRecord:
    game_type = row["game_type"]
    if game_type not in GAME_TYPES:
        raise ValueError(f"{row['game_id']}: unexpected game_type {game_type!r}")
    home_score, away_score = _score(row.get("home_score")), _score(row.get("away_score"))
    if (home_score is None) != (away_score is None):
        raise ValueError(f"{row['game_id']}: only one score present")
    return GameRecord(
        id=row["game_id"],
        season=int(row["season"]),
        week=int(row["week"]),
        game_type=game_type,
        home_team=team(row["home_team"]),
        away_team=team(row["away_team"]),
        stadium_id=row.get("stadium_id") or None,
        neutral_site=row.get("location") == "Neutral",
        kickoff_at=kickoff_utc(row["gameday"], row["gametime"]),
        status="final" if home_score is not None else "scheduled",
        home_score=home_score,
        away_score=away_score,
        overtime=bool(row.get("overtime") or 0),
    )


class NflverseSchedules:
    name = "nflverse"

    def load_games(self, seasons: list[int]) -> list[GameRecord]:
        import nflreadpy  # heavy (polars); imported only when actually loading data

        frame = nflreadpy.load_schedules(seasons)
        return [game_from_row(r) for r in frame.to_dicts()]

    def current_season(self) -> int:
        import nflreadpy

        return int(nflreadpy.get_current_season())
