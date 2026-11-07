"""Predict a week, write EN/FR/ES explanations, and publish the picks (spec 12.1).

    python -m endzoneiq_pipeline.jobs.publish_week                       # next week
    python -m endzoneiq_pipeline.jobs.publish_week --season 2026 --week 8 --dry-run \\
        --model-dir model-out --out picks.json                           # past week, no posting

Steps: active model (GitHub Release named by /api/internal/export, or --model-dir)
-> pre-kickoff features -> predictions + SHAP drivers -> explanations only for
picks that are new or materially changed (same rule as the site: winner changed or
win probability moved >= 5 points) -> POST /api/internal/ingest/picks. The site
locks games that have kicked off, so re-running a past week publishes nothing.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import math
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pandas as pd

from endzoneiq_pipeline.config import Settings
from endzoneiq_pipeline.games import chunked
from endzoneiq_pipeline.jobs.backtest import assert_no_leakage
from endzoneiq_pipeline.model.data import load_all
from endzoneiq_pipeline.model.explain import explain
from endzoneiq_pipeline.model.features import FEATURES, build_features
from endzoneiq_pipeline.model.train import ModelBundle
from endzoneiq_pipeline.narrative import build_facts
from endzoneiq_pipeline.narrative_claude import ExplanationWriter, explain_pick, writer_from_env
from endzoneiq_pipeline.run_report import reported_run
from endzoneiq_pipeline.site_client import SiteClient
from endzoneiq_pipeline.sources.nflverse import NflverseSchedules

log = logging.getLogger("publish_week")
JOB = "publish_week"
MATERIAL_PROB_CHANGE = 0.05  # keep in sync with lib/picks/repository.ts
POST_CHUNK = 16
MAX_INJURED_LISTED = 8


# --- Model ------------------------------------------------------------------


def release_asset_url(artifact_url: str) -> str:
    """.../releases/tag/model-X -> .../releases/download/model-X/model-X.tar.gz"""
    tag = artifact_url.rstrip("/").rsplit("/", 1)[-1]
    base = artifact_url.rsplit("/releases/tag/", 1)[0]
    return f"{base}/releases/download/{tag}/{tag}.tar.gz"


def download_model(artifact_url: str, dest: Path) -> Path:
    url = release_asset_url(artifact_url)
    log.info("downloading model %s", url)
    res = httpx.get(url, follow_redirects=True, timeout=120)
    res.raise_for_status()
    with tarfile.open(fileobj=io.BytesIO(res.content), mode="r:gz") as tar:
        tar.extractall(dest, filter="data")  # refuses absolute paths and links outside dest
    return dest


# --- Target games -------------------------------------------------------------


def target_games(
    features: pd.DataFrame, now: datetime, season: int | None, week: int | None
) -> pd.DataFrame:
    if season is not None and week is not None:
        return features[(features["season"] == season) & (features["week"] == week)]
    upcoming = features[pd.to_datetime(features["kickoff"], utc=True) > pd.Timestamp(now)]
    if upcoming.empty:
        return upcoming
    first = upcoming.sort_values("kickoff").iloc[0]
    return upcoming[(upcoming["season"] == first["season"]) & (upcoming["week"] == first["week"])]


def needs_new_version(current: dict | None, home_abbr: str, home_prob: float) -> bool:
    """Mirror of the site's rule, so explanations are only written when they'll be used."""
    if current is None:
        return True
    cur_home_prob = current["winProb"] if current["winner"] == home_abbr else 1 - current["winProb"]
    if (cur_home_prob >= 0.5) != (home_prob >= 0.5):
        return True
    return abs(home_prob - cur_home_prob) >= MATERIAL_PROB_CHANGE - 1e-9


# --- Facts helpers ------------------------------------------------------------


def injured_players(
    injuries: pd.DataFrame, season: int, week: int, team: str, kickoff: datetime
) -> list[dict[str, str]]:
    if injuries.empty:
        return []
    inj = injuries[
        (injuries["season"] == season)
        & (injuries["week"] == week)
        & (injuries["team"] == team)
        & injuries["report_status"].isin(["Out", "Doubtful"])
    ]
    if "date_modified" in inj.columns:  # undated rows are pre-game reports (see features)
        when = pd.to_datetime(inj["date_modified"], utc=True)
        inj = inj[when.isna() | (when < pd.Timestamp(kickoff))]
    inj = inj.drop_duplicates("gsis_id", keep="last")
    return [
        {"name": r.full_name, "position": r.position, "status": r.report_status}
        for r in inj.head(MAX_INJURED_LISTED).itertuples()
    ]


def clean_features(row: pd.Series) -> dict[str, float | None]:
    out = {}
    for f in FEATURES:
        v = row[f]
        out[f] = None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
    return out


# --- Main -----------------------------------------------------------------------


def build_picks(
    bundle: ModelBundle,
    games: pd.DataFrame,
    schedules: pd.DataFrame,
    injuries: pd.DataFrame,
    current: dict[str, dict],
    writer: ExplanationWriter | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Payloads for new/changed picks, and the ids skipped as unchanged."""
    pred = bundle.predict(games)
    shaps = explain(bundle, games, pred["win_prob"].to_numpy())
    sched = schedules.set_index("game_id")
    picks, skipped = [], []
    for (idx, g), shap in zip(games.iterrows(), shaps, strict=True):
        p = pred.loc[idx]
        home_prob = float(p["win_prob"])
        if not needs_new_version(current.get(g["game_id"]), g["home_team"], home_prob):
            skipped.append(g["game_id"])
            continue
        s = sched.loc[g["game_id"]]
        game = {
            "game_id": g["game_id"],
            "season": int(g["season"]),
            "week": int(g["week"]),
            "game_type": g["game_type"],
            "home_team": g["home_team"],
            "away_team": g["away_team"],
            "stadium_id": s.get("stadium_id"),
            "home_qb_name": s.get("home_qb_name") or None,
            "away_qb_name": s.get("away_qb_name") or None,
        }
        prediction = {
            "win_prob": home_prob,
            "pred_margin": float(p["pred_margin"]),
            "pred_total": float(p["pred_total"]),
            "tier": p["tier"],
        }
        feats = clean_features(g)
        kickoff = g["kickoff"]
        injuries_by_team = {
            t: injured_players(injuries, game["season"], game["week"], t, kickoff)
            for t in (g["home_team"], g["away_team"])
        }
        facts = build_facts(game, prediction, shap, feats, injuries_by_team)
        texts = explain_pick(facts, writer)
        picks.append(
            {
                "gameId": g["game_id"],
                "homeWinProb": round(home_prob, 4),
                "tier": p["tier"],
                "predMargin": round(prediction["pred_margin"], 2),
                "predTotal": round(prediction["pred_total"], 2),
                "features": feats,
                "shap": shap,
                "explanations": {
                    loc: {**le.explanation.to_api(), "source": le.source}
                    for loc, le in texts.items()
                },
            }
        )
    return picks, skipped


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--season", type=int)
    p.add_argument("--week", type=int)
    p.add_argument("--model-dir", type=Path, help="use local model files instead of the release")
    p.add_argument("--dry-run", action="store_true", help="build picks, don't post them")
    p.add_argument("--out", type=Path, default=Path("picks.json"))
    args = p.parse_args(argv)
    if (args.season is None) != (args.week is None):
        p.error("--season and --week go together")

    settings = Settings.from_env()
    client = (
        SiteClient(settings.site_url, settings.ingest_secret) if settings.ingest_secret else None
    )
    if client is None and not (args.dry_run and args.model_dir):
        p.error("INGEST_SECRET is required (or use --dry-run with --model-dir)")

    def run() -> int:
        export = client.get("/api/internal/export") if client else {"currentPicks": []}
        with tempfile.TemporaryDirectory() as tmp:
            if args.model_dir:
                model_dir = args.model_dir
            else:
                active = export.get("activeModel")
                if not active or not active.get("artifactUrl"):
                    raise RuntimeError("no active model registered (run the Retrain workflow)")
                model_dir = download_model(active["artifactUrl"], Path(tmp))
            bundle = ModelBundle.load(model_dir)
        model_name = bundle.meta.get("name") or model_dir.name
        log.info("model %s", model_name)

        now = datetime.now(UTC)
        current_season = NflverseSchedules().current_season()
        data = load_all(max(current_season, args.season or 0))
        features = build_features(
            data["schedules"], data["team_games"], data["qb_games"], data["injuries"]
        )
        assert_no_leakage(features)
        games = target_games(features, now, args.season, args.week)
        if games.empty:
            log.info("no games to predict")
            return 0
        season, week = int(games["season"].iloc[0]), int(games["week"].iloc[0])
        log.info("season %s week %s: %s games", season, week, len(games))

        current = {c["gameId"]: c for c in export.get("currentPicks", [])}
        writer = writer_from_env()
        picks, skipped = build_picks(
            bundle, games, data["schedules"], data["injuries"], current, writer
        )
        sources = [e["source"] for pk in picks for e in pk["explanations"].values()]
        log.info(
            "%s new/changed picks, %s unchanged; explanations: %s by Claude, %s templates",
            len(picks),
            len(skipped),
            sources.count("claude"),
            sources.count("template"),
        )
        args.out.write_text(
            json.dumps(
                {"modelVersion": model_name, "season": season, "week": week, "picks": picks},
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        log.info("wrote %s", args.out)

        if args.dry_run or not picks:
            return 0
        totals = {"created": 0, "unchanged": 0, "locked": 0, "unknownGames": 0}
        for chunk in chunked(picks, POST_CHUNK):
            res = client.post(
                "/api/internal/ingest/picks", {"modelVersion": model_name, "picks": list(chunk)}
            )
            for k in totals:
                totals[k] += res.get(k, 0)
        log.info("site: %s", totals)
        return 0

    if client is None:
        return run()
    with client, reported_run(client, JOB):
        return run()


if __name__ == "__main__":
    sys.exit(main())
