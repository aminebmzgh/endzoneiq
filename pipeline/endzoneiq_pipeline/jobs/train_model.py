"""Train the production model on every finished game since 2012.

    python -m endzoneiq_pipeline.jobs.train_model --out model-out
    python -m endzoneiq_pipeline.jobs.train_model --out model-out --only-offseason  # schedule

The model files (LightGBM text + model.json) go to --out; the workflow publishes
them as a GitHub Release (never MySQL), then jobs.register_model registers the
version through /api/internal/ingest/model-version. The version name is a hash of
the training data and settings, so retraining on unchanged data re-registers the
same name (idempotent) instead of creating a new version.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from endzoneiq_pipeline.games import iso_seconds, season_states
from endzoneiq_pipeline.jobs.backtest import build
from endzoneiq_pipeline.model import train as train_mod
from endzoneiq_pipeline.model.backtest import log_loss
from endzoneiq_pipeline.model.features import FEATURES, FIRST_FEATURE_SEASON, MODEL_FEATURES
from endzoneiq_pipeline.model.train import finished, fit_bundle
from endzoneiq_pipeline.sources.nflverse import NflverseSchedules

log = logging.getLogger("train_model")
MODEL_FAMILY = "lgbm-v1"


def version_name(train_df) -> str:
    h = hashlib.sha256()
    h.update(MODEL_FAMILY.encode())
    h.update(json.dumps(MODEL_FEATURES, sort_keys=True).encode())
    h.update(json.dumps(train_mod.BASE_PARAMS, sort_keys=True).encode())
    cols = [*FEATURES, "margin", "total", "home_win"]
    ordered = train_df.sort_values("game_id")
    h.update("\n".join(ordered["game_id"]).encode())
    h.update(np.ascontiguousarray(ordered[cols].to_numpy(dtype=float)).tobytes())
    return f"{MODEL_FAMILY}-{h.hexdigest()[:10]}"


def in_season() -> bool:
    """True from week 1 kickoff until the Super Bowl is final (same rule the site uses)."""
    source = NflverseSchedules()
    current = source.current_season()
    states = season_states(source.load_games([current]), datetime.now(UTC))
    return any(s.phase in ("regular", "postseason") for s in states)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--only-offseason", action="store_true", help="skip during the season")
    args = p.parse_args(argv)

    if args.only_offseason and in_season():
        log.info("in season: Elo and rolling features update at prediction time; no retrain")
        return 0

    current = NflverseSchedules().current_season()
    features = build(current)
    seasons = list(range(FIRST_FEATURE_SEASON, current + 1))
    train_df = finished(features[features["season"].isin(seasons)])
    name = version_name(train_df)
    log.info("training %s on %s games (%s-%s)", name, len(train_df), seasons[0], seasons[-1])

    bundle = fit_bundle(features, seasons)
    trained_at = iso_seconds(datetime.now(UTC))
    # In-sample fit quality is only a sanity check; honest numbers are in docs/backtest.md.
    known = train_df[train_df["home_win"].notna()]
    in_sample = log_loss(known["home_win"].to_numpy(), bundle.predict(known)["win_prob"].to_numpy())
    metrics = {
        "train_games": len(train_df),
        "train_seasons": [seasons[0], seasons[-1]],
        "data_through": iso_seconds(train_df["kickoff"].max()),
        "rounds": bundle.meta["rounds"],
        "calibration_games": bundle.meta["calibration_games"],
        "platt": list(bundle.platt),
        "sigma_margin": round(bundle.sigma_margin, 3),
        "sigma_total": round(bundle.sigma_total, 3),
        "in_sample_log_loss": round(in_sample, 4),
        "backtest": "docs/backtest.md",
    }
    bundle.meta.update({"name": name, "trained_at": trained_at, "metrics": metrics})
    bundle.save(args.out)
    (args.out / "VERSION").write_text(name + "\n")
    log.info("saved %s to %s", name, args.out)

    return 0


if __name__ == "__main__":
    sys.exit(main())
