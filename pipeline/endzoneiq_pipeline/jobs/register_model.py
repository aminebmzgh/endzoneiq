"""Register a trained model directory with the site (after its GitHub Release exists).

    python -m endzoneiq_pipeline.jobs.register_model model-out \
        --artifact-url https://github.com/<repo>/releases/tag/model-<name> [--no-activate]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from endzoneiq_pipeline.config import Settings
from endzoneiq_pipeline.run_report import reported_run
from endzoneiq_pipeline.site_client import SiteClient

log = logging.getLogger("register_model")
JOB = "train_model"


def payload(model_dir: Path, artifact_url: str | None, activate: bool) -> dict:
    meta = json.loads((model_dir / "model.json").read_text())
    return {
        "name": meta["name"],
        "trainedAt": meta["trained_at"],
        "metrics": meta["metrics"],
        "artifactUrl": artifact_url,
        "activate": activate,
    }


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("model_dir", type=Path)
    p.add_argument("--artifact-url")
    p.add_argument("--no-activate", action="store_true")
    args = p.parse_args(argv)

    body = payload(args.model_dir, args.artifact_url, not args.no_activate)
    settings = Settings.from_env()
    client = SiteClient(settings.site_url, settings.ingest_secret or "")
    with client, reported_run(client, JOB):
        res = client.post("/api/internal/ingest/model-version", body)
    log.info("registered %s: %s", body["name"], res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
