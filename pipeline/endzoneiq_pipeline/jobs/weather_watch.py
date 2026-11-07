"""Post kickoff-hour forecasts for outdoor games in the next 72 hours (spec 12.1).

    python -m endzoneiq_pipeline.jobs.weather_watch            # post to the site
    python -m endzoneiq_pipeline.jobs.weather_watch --dry-run  # print the forecasts

Forecasts come from Open-Meteo (free, no key). Domes are skipped. The workflow then
runs publish_week, which uses the stored forecasts for wind and temperature.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, datetime

import httpx

from endzoneiq_pipeline.config import Settings
from endzoneiq_pipeline.live import outdoor_games_within, weather_payload
from endzoneiq_pipeline.model.data import load_schedules
from endzoneiq_pipeline.run_report import reported_run
from endzoneiq_pipeline.site_client import SiteClient

log = logging.getLogger("weather_watch")
JOB = "weather_watch"


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--hours", type=int, default=72)
    args = p.parse_args(argv)
    settings = Settings.from_env()
    if not args.dry_run and not settings.ingest_secret:
        p.error("INGEST_SECRET is required (or use --dry-run)")

    def run(client: SiteClient | None) -> int:
        games = outdoor_games_within(load_schedules(), datetime.now(UTC), args.hours)
        if games.empty:
            log.info("no outdoor games in the next %s hours", args.hours)
            return 0
        with httpx.Client(headers={"User-Agent": "endzoneiq-pipeline"}) as http:
            forecasts = weather_payload(games, http)
        log.info("%s forecasts", len(forecasts))
        if client is None:
            print(json.dumps(forecasts, indent=1))
            return 0
        for i in range(0, len(forecasts), 64):
            res = client.post("/api/internal/ingest/weather", {"forecasts": forecasts[i : i + 64]})
            log.info("site: %s", res)
        return 0

    if args.dry_run:
        return run(None)
    with SiteClient(settings.site_url, settings.ingest_secret) as client, reported_run(client, JOB):
        return run(client)


if __name__ == "__main__":
    sys.exit(main())
