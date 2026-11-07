"""refresh_games against an in-memory fake of the site's internal API."""

import json
from datetime import UTC, datetime

import httpx
import pytest

from endzoneiq_pipeline.games import GameRecord, games_digest
from endzoneiq_pipeline.jobs.refresh_games import run
from endzoneiq_pipeline.run_report import reported_run, run_identity
from endzoneiq_pipeline.site_client import SiteClient, sign
from endzoneiq_pipeline.sources.nflverse import game_from_row

SECRET = "x" * 40


class FakeSite:
    """Mimics the site: verifies signatures, upserts by id, serves digests."""

    def __init__(self, corrupt_season: int | None = None):
        self.games: dict[str, GameRecord] = {}
        self.runs: list[dict] = []
        self.posts = 0
        self.corrupt_season = corrupt_season

    def handler(self, req: httpx.Request) -> httpx.Response:
        path = req.url.raw_path.decode()
        body = req.content.decode()
        ts = req.headers["x-ez-timestamp"]
        if req.headers["x-ez-signature"] != sign(SECRET, ts, req.method, path, body):
            return httpx.Response(401, json={"error": "unauthorized: bad-signature"})

        if path == "/api/internal/ingest/games":
            self.posts += 1
            payload = json.loads(body)
            assert len(payload["games"]) <= 500
            counts = {"inserted": 0, "updated": 0, "unchanged": 0}
            for raw in payload["games"]:
                g = from_api(raw)
                old = self.games.get(g.id)
                key = "inserted" if old is None else ("unchanged" if old == g else "updated")
                counts[key] += 1
                self.games[g.id] = g
            return httpx.Response(200, json={**counts, "unknownStadiums": []})

        if path.startswith("/api/internal/games/digest"):
            season = int(req.url.params["season"])
            rows = [g for g in self.games.values() if g.season == season]
            if season == self.corrupt_season:
                rows = rows[1:]
            return httpx.Response(200, json={"season": season, **games_digest(rows)})

        if path == "/api/internal/pipeline-run":
            self.runs.append(json.loads(body))
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)


def from_api(d: dict) -> GameRecord:
    return GameRecord(
        id=d["id"],
        season=d["season"],
        week=d["week"],
        game_type=d["gameType"],
        home_team=d["homeTeam"],
        away_team=d["awayTeam"],
        stadium_id=d["stadiumId"],
        neutral_site=d["neutralSite"],
        kickoff_at=datetime.fromisoformat(d["kickoffAt"].replace("Z", "+00:00")),
        status=d["status"],
        home_score=d["homeScore"],
        away_score=d["awayScore"],
        overtime=d["overtime"],
    )


class FakeSource:
    name = "fake"

    def __init__(self, games):
        self.games = games

    def load_games(self, seasons):
        return [g for g in self.games if g.season in seasons]

    def current_season(self):
        return max(g.season for g in self.games)


def nfl_row(season: int, n: int) -> dict:
    return {
        "game_id": f"{season}_01_T{n:02d}_KC"[:15],
        "season": season,
        "game_type": "REG",
        "week": 1,
        "gameday": f"{season}-09-10",
        "gametime": "13:00",
        "away_team": "BAL",
        "home_team": "KC",
        "home_score": 21,
        "away_score": 14,
        "location": "Home",
        "overtime": 0,
        "stadium_id": "KAN00",
    }


def source_with(seasons: dict[int, int]) -> FakeSource:
    games = []
    for season, count in seasons.items():
        for n in range(count):
            r = nfl_row(season, n)
            r["game_id"] = f"{season}_01_A{n:02d}_KC" if n < 100 else f"{season}_02_B{n:02d}_KC"
            games.append(game_from_row(r))
    return FakeSource(games)


@pytest.fixture
def site():
    return FakeSite()


def client_for(site: FakeSite) -> SiteClient:
    return SiteClient(
        "https://endzoneiq.test",
        SECRET,
        transport=httpx.MockTransport(site.handler),
        sleep=lambda s: None,
    )


NOW = datetime(2026, 11, 7, tzinfo=UTC)


def test_backfill_then_rerun_is_idempotent(site):
    source = source_with({2023: 3, 2024: 2})
    with client_for(site) as c:
        first = run(c, source, [2023, 2024], now=NOW)
        second = run(c, source, [2023, 2024], now=NOW)
    assert [(r.season, r.inserted, r.digest_ok) for r in first] == [
        (2023, 3, True),
        (2024, 2, True),
    ]
    assert [(r.inserted, r.updated, r.unchanged) for r in second] == [(0, 0, 3), (0, 0, 2)]
    assert len(site.games) == 5


def test_large_seasons_are_chunked(site):
    with client_for(site) as c:
        [r] = run(c, source_with({2021: 120}), [2021], now=NOW)
    assert r.games == 120 and r.digest_ok


def test_digest_mismatch_is_reported():
    site = FakeSite(corrupt_season=2024)
    with client_for(site) as c:
        reports = run(c, source_with({2024: 2}), [2024], now=NOW)
    assert reports[0].digest_ok is False


def test_dry_run_posts_nothing(site):
    reports = run(None, source_with({2024: 2}), [2024], now=NOW)
    assert reports[0].games == 2 and site.posts == 0


def test_reported_run_records_success_and_failure(site, monkeypatch):
    monkeypatch.setenv("GITHUB_RUN_ID", "42")
    monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "2")
    with client_for(site) as c:
        with reported_run(c, "refresh_games"):
            pass
        with pytest.raises(RuntimeError), reported_run(c, "refresh_games"):
            raise RuntimeError("boom")
    statuses = [(r["id"], r["status"]) for r in site.runs]
    assert statuses == [
        ("42-2-refresh_games", "running"),
        ("42-2-refresh_games", "success"),
        ("42-2-refresh_games", "running"),
        ("42-2-refresh_games", "failure"),
    ]
    assert "boom" in site.runs[-1]["error"]


def test_run_identity_links_to_github():
    env = {
        "GITHUB_RUN_ID": "7",
        "GITHUB_SERVER_URL": "https://github.com",
        "GITHUB_REPOSITORY": "aminebmzgh/endzoneiq",
    }
    assert run_identity("j", env) == (
        "7-1-j",
        "https://github.com/aminebmzgh/endzoneiq/actions/runs/7",
    )
    assert run_identity("j", {})[0].startswith("local-")
