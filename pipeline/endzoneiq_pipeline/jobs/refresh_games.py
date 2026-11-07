"""Ingest schedules and results, then prove the site's data matches the source.

    python -m endzoneiq_pipeline.jobs.refresh_games                     # current season
    python -m endzoneiq_pipeline.jobs.refresh_games --from-season 2012  # backfill
    python -m endzoneiq_pipeline.jobs.refresh_games --dry-run           # no network writes

For every season: post the games in chunks (<= 500 rows, one request well under
the site's 30 s budget), then compare the site's season digest with one computed
locally from the source. Any mismatch fails the job.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from endzoneiq_pipeline.config import Settings
from endzoneiq_pipeline.games import GameRecord, chunked, games_digest, season_states
from endzoneiq_pipeline.run_report import reported_run
from endzoneiq_pipeline.site_client import SiteClient
from endzoneiq_pipeline.sources.base import ScheduleSource
from endzoneiq_pipeline.sources.nflverse import FIRST_SEASON, NflverseSchedules

log = logging.getLogger("refresh_games")
CHUNK_SIZE = 500
JOB = "refresh_games"


@dataclass
class SeasonReport:
    season: int
    games: int
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    unknown_stadiums: tuple[str, ...] = ()
    digest_ok: bool | None = None


def sync_season(
    client: SiteClient,
    season: int,
    games: Sequence[GameRecord],
    now: datetime,
    *,
    verify: bool = True,
) -> SeasonReport:
    report = SeasonReport(season=season, games=len(games))
    states = [s.to_api() for s in season_states(games, now)]
    unknown: set[str] = set()
    for i, chunk in enumerate(chunked(games, CHUNK_SIZE)):
        res = client.post(
            "/api/internal/ingest/games",
            {"games": [g.to_api() for g in chunk], "seasons": states if i == 0 else []},
        )
        report.inserted += res["inserted"]
        report.updated += res["updated"]
        report.unchanged += res["unchanged"]
        unknown.update(res.get("unknownStadiums", []))
    report.unknown_stadiums = tuple(sorted(unknown))
    if verify:
        remote = client.get("/api/internal/games/digest", {"season": season})
        local = games_digest(games)
        report.digest_ok = remote["count"] == local["count"] and remote["digest"] == local["digest"]
        if not report.digest_ok:
            log.error("season %s digest mismatch: site=%s source=%s", season, remote, local)
    return report


def run(
    client: SiteClient | None,
    source: ScheduleSource,
    seasons: list[int],
    *,
    verify: bool = True,
    now: datetime | None = None,
) -> list[SeasonReport]:
    now = now or datetime.now(UTC)
    games = source.load_games(seasons)
    by_season: dict[int, list[GameRecord]] = {s: [] for s in seasons}
    for g in games:
        if g.season in by_season:
            by_season[g.season].append(g)

    reports = []
    for season in seasons:
        season_games = sorted(by_season[season], key=lambda g: g.id)
        if not season_games:
            log.warning("season %s: source has no games, skipping", season)
            continue
        if client is None:
            reports.append(SeasonReport(season=season, games=len(season_games)))
            continue
        r = sync_season(client, season, season_games, now, verify=verify)
        log.info(
            "season %s: %s games (+%s new, %s updated, %s unchanged)%s%s",
            season,
            r.games,
            r.inserted,
            r.updated,
            r.unchanged,
            "" if r.digest_ok is None else (", digest OK" if r.digest_ok else ", DIGEST MISMATCH"),
            f", unknown stadiums {list(r.unknown_stadiums)}" if r.unknown_stadiums else "",
        )
        reports.append(r)
    return reports


def write_step_summary(reports: list[SeasonReport]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = [
        "| Season | Games | New | Updated | Unchanged | Digest |",
        "|---|---|---|---|---|---|",
    ]
    for r in reports:
        digest = "n/a" if r.digest_ok is None else ("✅" if r.digest_ok else "❌")
        lines.append(
            f"| {r.season} | {r.games} | {r.inserted} | {r.updated} | {r.unchanged} | {digest} |"
        )
    with open(path, "a", encoding="utf-8") as f:
        f.write("### Games ingest\n\n" + "\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--from-season", type=int, help=f"first season (>= {FIRST_SEASON})")
    p.add_argument("--to-season", type=int, help="last season (default: current)")
    p.add_argument("--dry-run", action="store_true", help="load and validate only")
    p.add_argument("--no-verify", action="store_true", help="skip the digest comparison")
    args = p.parse_args(argv)

    source = NflverseSchedules()
    to_season = args.to_season or source.current_season()
    from_season = max(FIRST_SEASON, args.from_season or to_season)
    seasons = list(range(from_season, to_season + 1))
    log.info("seasons %s-%s from %s", from_season, to_season, source.name)

    if args.dry_run:
        reports = run(None, source, seasons)
        log.info("dry run: %s games loaded", sum(r.games for r in reports))
        return 0

    settings = Settings.from_env()
    client = SiteClient(settings.site_url, settings.ingest_secret or "")
    with client, reported_run(client, JOB):
        reports = run(client, source, seasons, verify=not args.no_verify)
        write_step_summary(reports)
        bad = [r.season for r in reports if r.digest_ok is False]
        if bad:
            raise RuntimeError(f"site data does not match the source for seasons {bad}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
