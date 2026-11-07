"""Live updates: injury payloads, admin overrides (QB out) and forecasts as model inputs."""

from datetime import timedelta

import pandas as pd
import pytest
from model_fixtures import synthetic

from endzoneiq_pipeline.jobs.backtest import assert_no_leakage
from endzoneiq_pipeline.live import (
    BACKUP_QB,
    apply_forecasts,
    apply_overrides,
    condition,
    players_injuries_payload,
    upcoming_week,
    with_kickoff,
)
from endzoneiq_pipeline.model.features import build_features


@pytest.fixture(scope="module")
def inputs():
    return synthetic(seasons=(2011, 2012, 2013), weeks=8)


def _target(sched):
    s = with_kickoff(sched)
    g = s[(s["season"] == 2013) & (s["week"] == 6)].iloc[0]
    return g, g["kickoff"].to_pydatetime() - timedelta(days=1)


def test_qb_out_override_changes_the_model_inputs(inputs):
    sched, team, qb, inj = inputs
    g, now = _target(sched)
    before = build_features(sched, team, qb, inj).set_index("game_id").loc[g["game_id"]]

    override = {
        "gameId": g["game_id"],
        "gsisId": g["home_qb_id"],
        "status": "out",
        "team": g["home_team"],
        "position": "QB",
        "name": "Starter QB",
    }
    s2, i2 = apply_overrides(sched, inj, [override], now)
    assert s2.loc[s2["game_id"] == g["game_id"], "home_qb_id"].iloc[0] == BACKUP_QB
    feats = build_features(s2, team, qb, i2)
    assert_no_leakage(feats)  # the override is dated before kickoff
    after = feats.set_index("game_id").loc[g["game_id"]]

    assert after["qb_delta_diff"] < before["qb_delta_diff"]  # the home side lost its QB
    # A QB counts through qb_delta only (weight 0 in the injury load: no double count).
    assert after["injury_diff"] == before["injury_diff"]

    tackle = {**override, "gsisId": "T-HOME", "position": "T", "name": "Left Tackle"}
    s3, i3 = apply_overrides(sched, inj, [tackle], now)
    with_tackle = build_features(s3, team, qb, i3).set_index("game_id").loc[g["game_id"]]
    assert with_tackle["injury_diff"] == before["injury_diff"] + 1.0  # T weight 1.0
    # Other games are untouched.
    other = feats.set_index("game_id").drop(index=g["game_id"])
    base = build_features(sched, team, qb, inj).set_index("game_id").drop(index=g["game_id"])
    pd.testing.assert_series_equal(other["qb_delta_diff"], base["qb_delta_diff"])


def test_clearing_an_override_removes_the_report(inputs):
    sched, _, _, inj = inputs
    g, now = _target(sched)
    active = {
        "gameId": g["game_id"],
        "gsisId": "SOMEONE",
        "status": "active",
        "team": g["home_team"],
    }
    s2, i2 = apply_overrides(sched, inj, [active], now)
    assert not ((i2["gsis_id"] == "SOMEONE") & (i2["week"] == 6)).any()
    assert s2.equals(sched)
    assert apply_overrides(sched, inj, [], now) == (sched, inj)


def test_players_injuries_payload(inputs):
    sched, _, _, inj = inputs
    week = with_kickoff(sched)
    week = week[(week["season"] == 2013) & (week["week"] == 3)]
    payload = players_injuries_payload(week, inj)
    assert set(payload["games"]) == set(week["game_id"])
    qbs = [p for p in payload["players"] if p["position"] == "QB"]
    assert len(qbs) == 2 * len(week)  # each team's listed starter
    assert all(i["status"] in {"out", "doubtful", "questionable"} for i in payload["injuries"])
    assert {i["gameId"] for i in payload["injuries"]} <= set(payload["games"])


def test_upcoming_week(inputs):
    sched = inputs[0]
    s = with_kickoff(sched)
    cut = s[(s["season"] == 2013) & (s["week"] == 4)]["kickoff"].min() - timedelta(hours=1)
    week = upcoming_week(sched, cut.to_pydatetime())
    assert set(week["week"]) == {4} and set(week["season"]) == {2013}


def test_forecasts_become_nflverse_units(inputs):
    sched = inputs[0]
    gid = sched["game_id"].iloc[0]
    out = apply_forecasts(sched, [{"gameId": gid, "tempC": 0.0, "windKph": 16.09344}])
    row = out.set_index("game_id").loc[gid]
    assert row["temp"] == pytest.approx(32.0)
    assert row["wind"] == pytest.approx(10.0)


def test_weather_codes():
    assert condition(0) == "clear"
    assert condition(2) == "cloudy"
    assert condition(63) == "rain"
    assert condition(75) == "snow"
    assert condition(95) == "thunderstorm"
    assert condition(None) is None
