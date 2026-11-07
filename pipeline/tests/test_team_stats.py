"""Team snapshot for the team pages: Elo replay and season-to-date EPA ranks."""

import pandas as pd
from model_fixtures import synthetic

from endzoneiq_pipeline.model.team_stats import current_elo, team_snapshot


def test_snapshot_covers_every_team_with_valid_ranks():
    sched, team, _, _ = synthetic(seasons=(2012, 2013), weeks=6)
    week, rows = team_snapshot(sched, team, 2013)
    assert week == 6
    teams = set(sched["home_team"]) | set(sched["away_team"])
    assert {r["abbr"] for r in rows} == teams
    n = len(teams)
    assert sorted(r["offEpaRank"] for r in rows) == list(range(1, n + 1))
    assert sorted(r["defEpaRank"] for r in rows) == list(range(1, n + 1))
    best_off = min(rows, key=lambda r: r["offEpaRank"])
    assert best_off["offEpa"] == max(r["offEpa"] for r in rows)
    best_def = min(rows, key=lambda r: r["defEpaRank"])
    assert best_def["defEpa"] == min(r["defEpa"] for r in rows)
    assert all(800 < r["elo"] < 2200 for r in rows)


def test_defense_is_what_opponents_did():
    sched = pd.DataFrame(
        [
            {"game_id": "g1", "season": 2030, "week": 1, "gameday": "2030-09-08",
             "gametime": "13:00", "home_team": "KC", "away_team": "BUF",
             "home_score": 24, "away_score": 20, "location": "Home"},
        ]
    )  # fmt: skip
    team = pd.DataFrame(
        [
            {"game_id": "g1", "posteam": "KC", "plays": 60, "epa": 6.0, "pass_plays": 30,
             "pass_epa": 6.0, "rush_plays": 30, "rush_epa": 0.0},
            {"game_id": "g1", "posteam": "BUF", "plays": 50, "epa": -5.0, "pass_plays": 25,
             "pass_epa": -5.0, "rush_plays": 25, "rush_epa": 0.0},
        ]
    )  # fmt: skip
    week, rows = team_snapshot(sched, team, 2030)
    by = {r["abbr"]: r for r in rows}
    assert week == 1
    assert by["KC"]["offEpa"] == 0.1 and by["KC"]["defEpa"] == -0.1
    assert by["BUF"]["defEpa"] == 0.1
    assert by["KC"]["offEpaRank"] == 1 and by["KC"]["defEpaRank"] == 1
    assert by["KC"]["elo"] > by["BUF"]["elo"]


def test_no_snapshot_before_the_first_game():
    sched, team, _, _ = synthetic(seasons=(2012,), weeks=3)
    assert team_snapshot(sched, team, 2013) is None
    assert len(current_elo(sched)) > 0
