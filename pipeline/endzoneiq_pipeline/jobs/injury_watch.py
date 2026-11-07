"""Post the latest nflverse injury reports for the upcoming week (spec 12.1 injury_watch).

    python -m endzoneiq_pipeline.jobs.injury_watch            # post to the site
    python -m endzoneiq_pipeline.jobs.injury_watch --dry-run  # print the payload

Sends every listed Out/Doubtful/Questionable player and each team's listed starting QB
(so the admin screen can mark a QB out). The workflow then runs publish_week, which
re-predicts the week; the site only creates a new pick version on a material change.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, datetime

from endzoneiq_pipeline.config import Settings
from endzoneiq_pipeline.live import players_injuries_payload, upcoming_week
from endzoneiq_pipeline.model.data import load_injuries, load_schedules
from endzoneiq_pipeline.run_report import reported_run
from endzoneiq_pipeline.site_client import SiteClient

log = logging.getLogger("injury_watch")
JOB = "injury_watch"


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)
    settings = Settings.from_env()
    if not args.dry_run and not settings.ingest_secret:
        p.error("INGEST_SECRET is required (or use --dry-run)")

    def run(client: SiteClient | None) -> int:
        week = upcoming_week(load_schedules(), datetime.now(UTC))
        if week.empty:
            log.info("no upcoming games")
            return 0
        season = int(week["season"].iloc[0])
        payload = players_injuries_payload(week, load_injuries([season]))
        log.info(
            "season %s week %s: %s games, %s players, %s reports",
            season,
            int(week["week"].iloc[0]),
            len(payload["games"]),
            len(payload["players"]),
            len(payload["injuries"]),
        )
        if client is None:
            print(json.dumps(payload, indent=1)[:4000])
            return 0
        log.info("site: %s", client.post("/api/internal/ingest/players-injuries", payload))
        return 0

    if args.dry_run:
        return run(None)
    with SiteClient(settings.site_url, settings.ingest_secret) as client, reported_run(client, JOB):
        return run(client)


if __name__ == "__main__":
    sys.exit(main())
