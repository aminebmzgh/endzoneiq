from dataclasses import replace
from datetime import UTC, datetime

from endzoneiq_pipeline.games import GameRecord, chunked, games_digest, season_states


def g(id: str, week: int, kickoff: str, **kw) -> GameRecord:
    base = dict(
        id=id,
        season=int(id[:4]),
        week=week,
        game_type="REG",
        home_team="KC",
        away_team="BAL",
        stadium_id="KAN00",
        neutral_site=False,
        kickoff_at=datetime.fromisoformat(kickoff),
        status="scheduled",
        home_score=None,
        away_score=None,
        overtime=False,
    )
    base.update(kw)
    return GameRecord(**base)


def final(game: GameRecord, home: int = 20, away: int = 17) -> GameRecord:
    return replace(game, status="final", home_score=home, away_score=away)


def test_digest_matches_shared_vector():
    # Shared with lib/games/games.test.ts. Change both or neither.
    rows = [
        g("2026_18_TB_NO", 18, "2027-01-10T18:00:00+00:00", home_team="NO", away_team="TB"),
        final(g("2024_01_BAL_KC", 1, "2024-09-06T00:20:00+00:00"), 27, 20),
    ]
    expected = {
        "count": 2,
        "digest": "a73e87c515792db0a4b39d58203ac51b8851e7b1365b81598ed66a848c91764b",
    }
    assert games_digest(rows) == expected
    assert games_digest(list(reversed(rows))) == expected


def test_to_api_uses_camel_case_and_utc_seconds():
    api = g("2024_01_BAL_KC", 1, "2024-09-05T20:20:00-04:00").to_api()
    assert api["kickoffAt"] == "2024-09-06T00:20:00Z"
    assert api["homeTeam"] == "KC" and api["gameType"] == "REG"
    assert api["homeScore"] is None


W1 = g("2024_01_BAL_KC", 1, "2024-09-06T00:20:00+00:00")
W2 = g("2024_02_KC_CIN", 2, "2024-09-15T20:25:00+00:00")
WC = g("2024_19_PIT_BAL", 19, "2025-01-12T01:00:00+00:00", game_type="WC")
SB = g("2024_22_KC_PHI", 22, "2025-02-09T23:30:00+00:00", game_type="SB")


def state(games, now):
    [s] = season_states(games, datetime.fromisoformat(now))
    return (s.phase, s.current_week)


def test_preseason_before_first_kickoff():
    assert state([W1, W2], "2024-08-20T00:00:00+00:00") == ("preseason", 1)


def test_regular_season_week_is_next_unfinished_game():
    assert state([final(W1), W2], "2024-09-10T00:00:00+00:00") == ("regular", 2)
    # A game that kicked off but has no score yet keeps its week current.
    assert state([W1, W2], "2024-09-06T01:00:00+00:00") == ("regular", 1)


def test_between_rounds_is_postseason_until_the_super_bowl_is_final():
    assert state([final(W1), final(W2)], "2025-01-07T00:00:00+00:00") == ("postseason", 3)
    assert state([final(W1), final(W2), WC], "2025-01-10T00:00:00+00:00") == ("postseason", 19)
    done = [final(W1), final(W2), final(WC), final(SB)]
    assert state(done, "2025-03-01T00:00:00+00:00") == ("offseason", 22)


def test_states_cover_each_season():
    other = g("2023_01_DET_KC", 1, "2023-09-08T00:20:00+00:00")
    states = season_states([W1, final(other)], datetime(2024, 8, 1, tzinfo=UTC))
    assert [s.year for s in states] == [2023, 2024]


def test_chunked():
    assert [list(c) for c in chunked([1, 2, 3, 4, 5], 2)] == [[1, 2], [3, 4], [5]]
    assert list(chunked([], 500)) == []
