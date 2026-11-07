from datetime import UTC, datetime

import pytest

from endzoneiq_pipeline.sources.nflverse import game_from_row, kickoff_utc


def row(**kw):
    base = {
        "game_id": "2024_01_BAL_KC",
        "season": 2024,
        "game_type": "REG",
        "week": 1,
        "gameday": "2024-09-05",
        "gametime": "20:20",
        "away_team": "BAL",
        "away_score": 20,
        "home_team": "KC",
        "home_score": 27,
        "location": "Home",
        "overtime": 0,
        "stadium_id": "KAN00",
    }
    base.update(kw)
    return base


def test_eastern_kickoff_to_utc_across_daylight_saving():
    # September: EDT (UTC-4). January: EST (UTC-5).
    assert kickoff_utc("2024-09-05", "20:20") == datetime(2024, 9, 6, 0, 20, tzinfo=UTC)
    assert kickoff_utc("2025-01-12", "13:00") == datetime(2025, 1, 12, 18, 0, tzinfo=UTC)
    # London game listed at 09:30 Eastern.
    assert kickoff_utc("2024-10-13", "09:30") == datetime(2024, 10, 13, 13, 30, tzinfo=UTC)


def test_final_game():
    g = game_from_row(row())
    assert (g.home_team, g.away_team, g.home_score, g.away_score) == ("KC", "BAL", 27, 20)
    assert g.status == "final"
    assert g.neutral_site is False and g.overtime is False


def test_scheduled_game_has_no_scores():
    g = game_from_row(row(home_score=None, away_score=None, overtime=None))
    assert g.status == "scheduled"
    assert g.home_score is None and g.overtime is False


def test_relocated_franchises_use_current_abbreviation():
    g = game_from_row(row(game_id="2016_01_SD_KC", away_team="SD"))
    assert g.away_team == "LAC"
    assert g.id == "2016_01_SD_KC"  # nflverse id is kept as-is
    assert game_from_row(row(home_team="OAK")).home_team == "LV"
    assert game_from_row(row(home_team="STL")).home_team == "LA"


def test_neutral_site_and_overtime():
    g = game_from_row(row(location="Neutral", overtime=1, stadium_id="LON02"))
    assert g.neutral_site is True and g.overtime is True and g.stadium_id == "LON02"


def test_rejects_inconsistent_rows():
    with pytest.raises(ValueError, match="one score"):
        game_from_row(row(away_score=None))
    with pytest.raises(ValueError, match="game_type"):
        game_from_row(row(game_type="PRE"))
