"""Source protocols."""

from __future__ import annotations

from typing import Protocol

from endzoneiq_pipeline.games import GameRecord


class ScheduleSource(Protocol):
    """Schedules, kickoff times, results."""

    name: str

    def load_games(self, seasons: list[int]) -> list[GameRecord]: ...

    def current_season(self) -> int: ...
