"""Walk-forward backtest; writes docs/backtest.md.

python -m endzoneiq_pipeline.jobs.backtest --out ../docs/backtest.md
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd

from endzoneiq_pipeline.model.backtest import FIRST_TEST_SEASON, render_markdown, walk_forward
from endzoneiq_pipeline.model.data import load_all
from endzoneiq_pipeline.model.features import build_features
from endzoneiq_pipeline.sources.nflverse import NflverseSchedules

log = logging.getLogger("backtest")


def assert_no_leakage(features: pd.DataFrame) -> None:
    """Every feature row must only use data timestamped before its kickoff."""
    asof = pd.to_datetime(features["data_asof"], utc=True)
    kickoff = pd.to_datetime(features["kickoff"], utc=True)
    bad = features[asof.notna() & (asof >= kickoff)]
    if not bad.empty:
        raise AssertionError(
            f"{len(bad)} feature rows use data from after kickoff: {bad['game_id'].head().tolist()}"
        )


def build(current: int) -> pd.DataFrame:
    data = load_all(current)
    features = build_features(
        data["schedules"], data["team_games"], data["qb_games"], data["injuries"]
    )
    assert_no_leakage(features)
    return features


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", type=Path, default=Path("../docs/backtest.md"))
    p.add_argument("--first-test-season", type=int, default=FIRST_TEST_SEASON)
    args = p.parse_args(argv)

    current = NflverseSchedules().current_season()
    features = build(current)
    seasons = list(range(args.first_test_season, current + 1))
    results = walk_forward(features, seasons)
    generated = datetime.now(UTC).strftime("%Y-%m-%d")
    last_result = features.loc[features["margin"].notna(), "kickoff"].max()
    note = f"Data: nflverse through {last_result:%Y-%m-%d}."
    args.out.write_text(render_markdown(results, generated, note), encoding="utf-8")
    log.info("wrote %s", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
