"""Reference data shared with the site: db/seed/teams.json and stadiums.json."""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path


def seed_dir() -> Path:
    override = os.environ.get("SEED_DIR")
    if override:
        return Path(override)
    # pipeline/endzoneiq_pipeline/reference.py -> repo root
    return Path(__file__).resolve().parents[2] / "db" / "seed"


@cache
def teams() -> dict[str, dict]:
    """abbr -> {id, abbr, name (nickname), city, conference, division, colors}."""
    with open(seed_dir() / "teams.json", encoding="utf-8") as f:
        return {t["abbr"]: t for t in json.load(f)}


@cache
def stadiums() -> dict[str, dict]:
    with open(seed_dir() / "stadiums.json", encoding="utf-8") as f:
        return {s["id"]: s for s in json.load(f)}


def full_name(abbr: str) -> str:
    t = teams()[abbr]
    return f"{t['city']} {t['name']}"
