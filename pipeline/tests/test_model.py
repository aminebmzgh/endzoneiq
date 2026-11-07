"""Elo, training, explanations and backtest metrics."""

import math

import numpy as np
import pandas as pd
import pytest
from model_fixtures import synthetic

from endzoneiq_pipeline.model import elo
from endzoneiq_pipeline.model.backtest import accuracy, ats, brier, log_loss, walk_forward
from endzoneiq_pipeline.model.explain import CONCEPTS, contributions, explain
from endzoneiq_pipeline.model.features import WIN_FEATURES, build_features
from endzoneiq_pipeline.model.train import ModelBundle, fit_bundle, tier

# --- Elo -------------------------------------------------------------------


def test_elo_expected_and_mov():
    assert elo.expected(0) == 0.5
    assert elo.expected(400) == pytest.approx(10 / 11)
    # Blowouts count more, but less so when the favourite wins.
    assert elo.mov_multiplier(21, 0) > elo.mov_multiplier(3, 0)
    assert elo.mov_multiplier(21, 200) < elo.mov_multiplier(21, -200)


def test_elo_update_is_zero_sum_and_rewards_the_winner():
    book = elo.EloBook()
    book.start_season(2020)
    book.update("KC", "BUF", 30, 10, neutral=False)
    assert book.rating("KC") > elo.MEAN > book.rating("BUF")
    assert book.rating("KC") + book.rating("BUF") == pytest.approx(2 * elo.MEAN)


def test_elo_regresses_to_the_mean_between_seasons():
    book = elo.EloBook(ratings={"KC": 1700.0})
    book.season = 2020
    book.start_season(2021)
    assert book.rating("KC") == pytest.approx(1700 - (1700 - elo.MEAN) / 3)


# --- Training, prediction, persistence -------------------------------------


@pytest.fixture(scope="module")
def features():
    return build_features(*synthetic(seasons=(2011, 2012, 2013, 2014, 2015), weeks=12))


@pytest.fixture(scope="module")
def bundle(features):
    return fit_bundle(features, [2012, 2013, 2014])


def test_predictions_are_probabilities_with_tiers(bundle, features):
    test = features[features["season"] == 2015]
    pred = bundle.predict(test)
    assert pred["win_prob"].between(0, 1).all()
    assert set(pred["tier"]) <= {"lean", "solid", "strong"}
    assert np.isfinite(pred["pred_margin"]).all() and np.isfinite(pred["pred_total"]).all()
    assert bundle.sigma_margin > 0 and bundle.sigma_total > 0
    assert bundle.meta["train_seasons"] == [2012, 2014]


def test_cover_probability_uses_the_margin_distribution(bundle):
    p = bundle.cover_prob(np.array([3.0, 3.0]), np.array([3.0, -10.0]))
    assert p[0] == pytest.approx(0.5)
    assert p[1] > 0.5


def test_bundle_round_trips_through_disk(bundle, features, tmp_path):
    bundle.save(tmp_path)
    loaded = ModelBundle.load(tmp_path)
    test = features[features["season"] == 2015]
    pd.testing.assert_frame_equal(bundle.predict(test), loaded.predict(test))


def test_tiers():
    assert tier(0.55) == "lean" and tier(0.45) == "lean"
    assert tier(0.60) == "solid" and tier(0.35) == "solid"
    assert tier(0.70) == "strong" and tier(0.20) == "strong"


def test_needs_two_seasons(features):
    with pytest.raises(ValueError):
        fit_bundle(features, [2012])


# --- Explanations ----------------------------------------------------------


def test_shap_values_add_up_to_the_raw_prediction(bundle, features):
    test = features[features["season"] == 2015]
    contrib = contributions(bundle, test)
    np.testing.assert_allclose(
        contrib.sum(axis=1).to_numpy(), bundle.win_logit(test), rtol=1e-6, atol=1e-6
    )
    # The Elo anchor makes team strength count even where the trees add nothing.
    assert (contrib["elo_diff"] != 0).any()


def test_shap_json_is_signed_toward_the_pick(bundle, features):
    test = features[features["season"] == 2015].head(10)
    prob = bundle.predict(test)["win_prob"].to_numpy()
    for p, s in zip(prob, explain(bundle, test, prob), strict=True):
        assert s["pick"] == ("home" if p >= 0.5 else "away")
        assert all(d["impact"] > 0 for d in s["for"])
        assert all(d["impact"] < 0 for d in s["against"])
        assert len(s["for"]) <= 3 and len(s["against"]) <= 2
        for d in s["for"] + s["against"]:
            assert (d["concept"] in CONCEPTS or d["concept"] == "home_field") and d["label"]


def test_neutral_factors_are_never_shown_as_reasons(bundle, features):
    test = features[features["season"] == 2015]
    prob = bundle.predict(test)["win_prob"].to_numpy()
    shown = 0
    for (_, row), s in zip(test.iterrows(), explain(bundle, test, prob), strict=True):
        for d in s["for"] + s["against"]:
            if d["concept"] == "qb_change":
                assert row["qb_delta_diff"] != 0
            if d["concept"] == "injuries":
                assert row["injury_diff"] != 0
            if d["concept"] == "rivalry":
                assert row["div_game"] == 1
            if d["concept"] == "home_field":
                shown += 1
                assert row["neutral"] == 0
                assert (d in s["for"]) == (s["pick"] == "home")
    assert shown > 0  # home field is surfaced as a driver


def test_every_win_feature_has_a_concept():
    mapped = [f for _, feats in CONCEPTS.values() for f in feats]
    assert sorted(mapped) == sorted(WIN_FEATURES)


# --- Metrics and walk-forward ----------------------------------------------


def test_metrics():
    y = np.array([1.0, 0.0, 1.0, 0.0])
    p = np.array([0.8, 0.3, 0.4, 0.5])
    assert log_loss(y, np.full(4, 0.5)) == pytest.approx(math.log(2))
    assert brier(y, y) == 0.0
    assert accuracy(y, p) == 0.75  # 0.4 picks away but home won
    # Home favoured by 3 (spread_line=3). Margins 7 (cover), 3 (push), -1 (no cover).
    pct, n = ats(np.array([7.0, 3.0, -1.0]), np.array([5.0, 5.0, 5.0]), np.array([3.0, 3.0, 3.0]))
    assert (pct, n) == (0.5, 2)


def test_walk_forward_trains_only_on_earlier_seasons(features, monkeypatch):
    seen = []
    import endzoneiq_pipeline.model.backtest as bt

    real = bt.fit_bundle

    def spy(df, seasons):
        seen.append(list(seasons))
        return real(df, seasons)

    monkeypatch.setattr(bt, "fit_bundle", spy)
    results = walk_forward(features, [2015])
    assert seen == [[2011, 2012, 2013, 2014]] or seen == [[2012, 2013, 2014]]
    assert all(max(s) < 2015 for s in seen)
    assert results[0].frame["p_model"].between(0, 1).all()
