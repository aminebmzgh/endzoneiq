"""Grade finished games and refresh the team pages' ratings.

    python -m endzoneiq_pipeline.jobs.grade_picks            # current season
    python -m endzoneiq_pipeline.jobs.grade_picks --dry-run  # compute, post nothing

Run after refresh_games (which stores the final scores). Grading itself happens on
the site from those stored scores, so the record can never disagree with the scores
it shows; this job triggers it (POST /api/internal/ingest/results) and posts the
team snapshot (Elo + season-to-date EPA ranks) to /api/internal/ingest/team-stats.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from endzoneiq_pipeline.config import Settings
from endzoneiq_pipeline.model.data import load_all
from endzoneiq_pipeline.model.team_stats import team_snapshot
from endzoneiq_pipeline.run_report import reported_run
from endzoneiq_pipeline.site_client import SiteClient
from endzoneiq_pipeline.sources.nflverse import NflverseSchedules

log = logging.getLogger("grade_picks")
JOB = "grade_picks"


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--season", type=int, help="default: the current season")
    p.add_argument("--dry-run", action="store_true", help="compute the team snapshot, post nothing")
    args = p.parse_args(argv)

    settings = Settings.from_env()
    if not args.dry_run and not settings.ingest_secret:
        p.error("INGEST_SECRET is required (or use --dry-run)")
    season = args.season or NflverseSchedules().current_season()

    def run(client: SiteClient | None) -> int:
        if client is not None:
            graded = client.post("/api/internal/ingest/results", {"seasons": [season]})
            log.info("graded %s new games: %s", graded["graded"], graded["gameIds"])
        data = load_all(season)
        snap = team_snapshot(data["schedules"], data["team_games"], season)
        if snap is None:
            log.info("season %s has no completed games yet: no team snapshot", season)
            return 0
        week, rows = snap
        log.info("team snapshot %s week %s: %s teams", season, week, len(rows))
        if client is None:
            print(json.dumps({"season": season, "week": week, "teams": rows}, indent=1))
            return 0
        res = client.post(
            "/api/internal/ingest/team-stats", {"season": season, "week": week, "teams": rows}
        )
        log.info("team stats: %s", res)
        return 0

    if args.dry_run:
        return run(None)
    with SiteClient(settings.site_url, settings.ingest_secret) as client, reported_run(client, JOB):
        return run(client)


if __name__ == "__main__":
    sys.exit(main())
