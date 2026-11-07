import pytest

from endzoneiq_pipeline.config import Settings


def test_defaults_to_local_site():
    s = Settings.from_env({})
    assert s.site_url == "http://localhost:3000"
    assert s.ingest_secret is None


def test_strips_trailing_slash_and_reads_secrets():
    s = Settings.from_env({"SITE_URL": "https://endzoneiq.com/", "INGEST_SECRET": "x" * 32})
    assert s.site_url == "https://endzoneiq.com"
    assert s.ingest_secret == "x" * 32


def test_rejects_plain_http_in_production():
    with pytest.raises(ValueError):
        Settings.from_env({"SITE_URL": "http://endzoneiq.com"})
