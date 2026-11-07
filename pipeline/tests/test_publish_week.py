"""publish_week: target games, change rule, and end-to-end payloads on synthetic data."""

from datetime import UTC, datetime

import pytest
from model_fixtures import synthetic

from endzoneiq_pipeline.jobs.publish_week import (
    build_picks,
    needs_new_version,
    release_asset_url,
    target_games,
)
from endzoneiq_pipeline.model.features import build_features
from endzoneiq_pipeline.model.train import fit_bundle


def test_release_asset_url():
    assert (
        release_asset_url("https://github.com/o/r/releases/tag/model-lgbm-v1-abc")
        == "https://github.com/o/r/releases/download/model-lgbm-v1-abc/model-lgbm-v1-abc.tar.gz"
    )


def test_needs_new_version_mirrors_the_site_rule():
    cur = {"winner": "KC", "winProb": 0.62}
    assert needs_new_version(None, "KC", 0.6)
    assert not needs_new_version(cur, "KC", 0.66)
    assert needs_new_version(cur, "KC", 0.67)
    assert needs_new_version(cur, "KC", 0.45)  # winner flips
    away = {"winner": "BUF", "winProb": 0.6}  # home KC at 0.40
    assert not needs_new_version(away, "KC", 0.42)
    assert needs_new_version(away, "KC", 0.46)


@pytest.fixture(scope="module")
def setup():
    sched, team, qb, inj = synthetic(seasons=(2011, 2012, 2013, 2014, 2015), weeks=12)
    feats = build_features(sched, team, qb, inj)
    bundle = fit_bundle(feats, [2012, 2013, 2014])
    return sched, inj, feats, bundle


def test_target_games(setup):
    _, _, feats, _ = setup
    week = target_games(feats, datetime(2015, 10, 1, tzinfo=UTC), None, None)
    assert week["season"].nunique() == 1 and week["week"].nunique() == 1
    assert (week["kickoff"] > datetime(2015, 10, 1, tzinfo=UTC)).all()
    explicit = target_games(feats, datetime(2030, 1, 1, tzinfo=UTC), 2015, 3)
    assert len(explicit) == 2
    assert target_games(feats, datetime(2030, 1, 1, tzinfo=UTC), None, None).empty


def test_build_picks_produces_valid_payloads_and_skips_unchanged(setup):
    sched, inj, feats, bundle = setup
    games = target_games(feats, datetime(2030, 1, 1, tzinfo=UTC), 2015, 3)
    picks, skipped = build_picks(bundle, games, sched, inj, {}, writer=None)
    assert len(picks) == 2 and skipped == []
    for p in picks:
        assert 0 <= p["homeWinProb"] <= 1
        assert set(p["explanations"]) == {"en", "fr", "es"}
        for e in p["explanations"].values():
            assert len(e["reasons"]) == 3 and e["source"] == "template"
            assert all(len(r.split()) <= 20 for r in e["reasons"])
        assert p["shap"]["pick"] in ("home", "away")
        assert all(v is None or isinstance(v, float) for v in p["features"].values())

    # Same predictions already published: nothing to write.
    current = {}
    for p, (_, g) in zip(picks, games.iterrows(), strict=True):
        home_win = p["homeWinProb"] >= 0.5
        current[p["gameId"]] = {
            "winner": g["home_team"] if home_win else g["away_team"],
            "winProb": p["homeWinProb"] if home_win else 1 - p["homeWinProb"],
        }
    again, skipped = build_picks(bundle, games, sched, inj, current, writer=None)
    assert again == [] and len(skipped) == 2
