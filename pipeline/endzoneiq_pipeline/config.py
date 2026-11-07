"""Pipeline settings, read from the environment (GitHub Actions secrets/variables)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    site_url: str
    ingest_secret: str | None
    anthropic_api_key: str | None
    claude_model_fast: str | None
    odds_api_key: str | None

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> Settings:
        e = os.environ if env is None else env
        site_url = e.get("SITE_URL", "http://localhost:3000").rstrip("/")
        if not site_url.startswith("https://") and not site_url.startswith(
            ("http://localhost", "http://127.0.0.1")
        ):
            # The internal API rejects anything that is not HTTPS (local dev excepted).
            raise ValueError("SITE_URL must use https:// outside local development")
        return cls(
            site_url=site_url,
            ingest_secret=e.get("INGEST_SECRET") or None,
            anthropic_api_key=e.get("ANTHROPIC_API_KEY") or None,
            claude_model_fast=e.get("CLAUDE_MODEL_FAST") or None,
            odds_api_key=e.get("ODDS_API_KEY") or None,
        )
