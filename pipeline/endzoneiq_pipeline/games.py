"""Game records as the site's ingest API expects them, plus season state."""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

GameType = Literal["REG", "WC", "DIV", "CON", "SB"]
GameStatus = Literal["scheduled", "in_progress", "final", "postponed", "canceled"]
Phase = Literal["preseason", "regular", "postseason", "offseason"]


@dataclass(frozen=True)
class GameRecord:
    id: str
    season: int
    week: int
    game_type: GameType
    home_team: str
    away_team: str
    stadium_id: str | None
    neutral_site: bool
    kickoff_at: datetime  # timezone-aware, UTC
    status: GameStatus
    home_score: int | None
    away_score: int | None
    overtime: bool

    def to_api(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "season": self.season,
            "week": self.week,
            "gameType": self.game_type,
            "homeTeam": self.home_team,
            "awayTeam": self.away_team,
            "stadiumId": self.stadium_id,
            "neutralSite": self.neutral_site,
            "kickoffAt": iso_seconds(self.kickoff_at),
            "status": self.status,
            "homeScore": self.home_score,
            "awayScore": self.away_score,
            "overtime": self.overtime,
        }


@dataclass(frozen=True)
class SeasonState:
    year: int
    current_week: int
    phase: Phase

    def to_api(self) -> dict[str, Any]:
        return {"year": self.year, "currentWeek": self.current_week, "phase": self.phase}


def iso_seconds(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def season_states(games: Iterable[GameRecord], now: datetime) -> list[SeasonState]:
    """Phase and current week per season, derived from the schedule itself.

    current_week is the week of the next unfinished game. A season whose games
    are all final is in the offseason once its Super Bowl is in; before that
    (between rounds, when the next playoff games aren't scheduled yet) it is
    still postseason.
    """
    by_season: dict[int, list[GameRecord]] = {}
    for g in games:
        by_season.setdefault(g.season, []).append(g)

    states = []
    for year in sorted(by_season):
        gs = by_season[year]
        regular = [g for g in gs if g.game_type == "REG"]
        unfinished = sorted(
            (g for g in gs if g.status not in ("final", "canceled")),
            key=lambda g: g.kickoff_at,
        )
        if regular and now < min(g.kickoff_at for g in regular):
            states.append(SeasonState(year, 1, "preseason"))
        elif unfinished:
            nxt = unfinished[0]
            phase: Phase = "regular" if nxt.game_type == "REG" else "postseason"
            states.append(SeasonState(year, nxt.week, phase))
        elif any(g.game_type == "SB" for g in gs):
            states.append(SeasonState(year, max(g.week for g in gs), "offseason"))
        else:
            states.append(SeasonState(year, max(g.week for g in gs) + 1, "postseason"))
    return states


def digest_line(g: GameRecord) -> str:
    return "|".join(
        [
            g.id,
            g.home_team,
            g.away_team,
            "" if g.home_score is None else str(g.home_score),
            "" if g.away_score is None else str(g.away_score),
            g.status,
            iso_seconds(g.kickoff_at),
        ]
    )


def games_digest(games: Sequence[GameRecord]) -> dict[str, Any]:
    """Same digest as lib/games/digest.ts (shared test vector in both suites)."""
    lines = sorted(digest_line(g) for g in games)
    return {"count": len(games), "digest": hashlib.sha256("\n".join(lines).encode()).hexdigest()}


def chunked[T](items: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]
