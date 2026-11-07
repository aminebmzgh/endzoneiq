"""Spec 7.3: no feature row may use data timestamped after its kickoff."""

from datetime import timedelta

import numpy as np
import pandas as pd
import pytest
from model_fixtures import synthetic

from endzoneiq_pipeline.jobs.backtest import assert_no_leakage
from endzoneiq_pipeline.model.features import FEATURES, GAME_DATA_DELAY, build_features


@pytest.fixture(scope="module")
def inputs():
    return synthetic()


@pytest.fixture(scope="module")
def features(inputs):
    return build_features(*inputs)


def test_every_row_uses_only_data_from_before_kickoff(features):
    asof = pd.to_datetime(features["data_asof"], utc=True)
    kickoff = pd.to_datetime(features["kickoff"], utc=True)
    assert asof.notna().all()
    assert (asof < kickoff).all()
    assert_no_leakage(features)  # the guard the backtest/training jobs run on real data


def test_guard_fails_on_a_leaky_row(features):
    leaky = features.copy()
    leaky.loc[leaky.index[3], "data_asof"] = leaky.loc[leaky.index[3], "kickoff"] + timedelta(
        minutes=1
    )
    with pytest.raises(AssertionError, match="after kickoff"):
        assert_no_leakage(leaky)


def _feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    return df.set_index("game_id")[FEATURES].sort_index()


def test_changing_the_future_does_not_change_past_features(inputs, features):
    sched, team, qb, inj = (x.copy() for x in inputs)
    kick = features.set_index("game_id")["kickoff"]
    cutoff = kick.sort_values().iloc[len(kick) // 2]
    future = set(kick[kick >= cutoff].index)  # includes the cutoff game itself

    sched.loc[sched["game_id"].isin(future), ["home_score", "away_score"]] = [0, 55]
    team.loc[team["game_id"].isin(future), "epa"] = -40.0
    qb.loc[qb["game_id"].isin(future), "epa"] = -40.0
    mutated = build_features(sched, team, qb, inj)

    before = _feature_frame(features)
    after = _feature_frame(mutated)
    past = [g for g in before.index if kick[g] <= cutoff]
    pd.testing.assert_frame_equal(before.loc[past], after.loc[past])
    # Sanity: the mutation does reach games after the cutoff + data delay.
    later = [g for g in before.index if kick[g] > cutoff + GAME_DATA_DELAY + timedelta(days=1)]
    assert not np.allclose(before.loc[later, "epa_edge"], after.loc[later, "epa_edge"])


def test_a_game_never_sees_its_own_or_a_concurrent_result(inputs, features):
    sched, team, qb, inj = (x.copy() for x in inputs)
    # 13:00 and 16:25 games on the same day: the 16:25 game starts before the
    # 13:00 result counts (4h delay), so flipping either changes neither.
    day = sched[sched["season"] == 2013]["gameday"].iloc[0]
    same_day = set(sched.loc[sched["gameday"] == day, "game_id"])
    sched.loc[sched["game_id"].isin(same_day), ["home_score", "away_score"]] = [99, 0]
    team.loc[team["game_id"].isin(same_day), "epa"] = 50.0
    mutated = build_features(sched, team, qb, inj)
    pd.testing.assert_frame_equal(
        _feature_frame(features).loc[sorted(same_day)],
        _feature_frame(mutated).loc[sorted(same_day)],
    )


def test_injury_reports_after_kickoff_are_ignored(inputs):
    sched, team, qb, inj = inputs
    feats = build_features(sched, team, qb, inj).set_index("game_id")
    # Fixture: home teams have a CB out (reported 2 days early) and away teams a T out
    # reported the day AFTER kickoff, so only the home injury may count.
    assert (feats["injury_diff"] == 1.0).all()


def test_backup_qb_start_is_flagged(features):
    wk5 = features[(features["week"] == 5) & (features["season"] > 2011)]
    assert (wk5["qb_delta_diff"] != 0).all()
    others = features[(features["week"] != 5)]
    assert (others["qb_delta_diff"] == 0).all()


def test_undated_injury_reports_count_as_pre_game(inputs):
    # nflverse dropped `date_modified` from 2025 on. Undated Out/Doubtful rows are the
    # final pre-game report, dated 24h before kickoff: both teams' players now count.
    sched, team, qb, inj = inputs
    undated = inj.drop(columns=["date_modified"])
    feats = build_features(sched, team, qb, undated)
    assert (feats["injury_diff"] == 0.0).all()  # CB out (1.0) vs T out (1.0)
    asof = pd.to_datetime(feats["data_asof"], utc=True)
    assert (asof < pd.to_datetime(feats["kickoff"], utc=True)).all()
