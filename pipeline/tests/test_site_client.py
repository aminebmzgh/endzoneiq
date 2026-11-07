import json

import httpx
import pytest

from endzoneiq_pipeline.site_client import SiteApiError, SiteClient, encode_body, sign

# Shared with lib/internal/signature.test.ts. Change both or neither.
SECRET = "ez-test-secret-0123456789abcdef0123456789"
TS = "1794040000"


def test_sign_matches_shared_vector():
    assert (
        sign(SECRET, TS, "POST", "/api/internal/ingest/games", '{"games":[],"seasons":[]}')
        == "v1=79c6880dde6c660e240d5e3795ec48cf03c96f14c7509df7f801df32abf8ae88"
    )
    assert (
        sign(SECRET, TS, "get", "/api/internal/games/digest?season=2024", "")
        == "v1=f111ade2073e728268d13852e10e0b84d822ab8656dcd85c1756080be75b05b9"
    )


def test_encode_body_is_compact():
    assert encode_body({"games": [], "seasons": []}) == '{"games":[],"seasons":[]}'


def make_client(handler, **kw):
    return SiteClient(
        "https://endzoneiq.test/",
        SECRET,
        transport=httpx.MockTransport(handler),
        clock=lambda: int(TS),
        sleep=lambda s: None,
        **kw,
    )


def test_signs_exactly_what_it_sends():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        body = req.content.decode()
        path = req.url.raw_path.decode()
        seen.update(path=path, body=body)
        expected = sign(SECRET, req.headers["x-ez-timestamp"], req.method, path, body)
        assert req.headers["x-ez-signature"] == expected
        return httpx.Response(200, json={"ok": True})

    with make_client(handler) as c:
        assert c.post("/api/internal/ingest/games", {"games": [], "seasons": []}) == {"ok": True}
        assert seen == {"path": "/api/internal/ingest/games", "body": '{"games":[],"seasons":[]}'}
        c.get("/api/internal/games/digest", {"season": 2024})
        assert seen == {"path": "/api/internal/games/digest?season=2024", "body": ""}


def test_retries_transient_errors_then_succeeds():
    calls = []

    def handler(req):
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(503, text="busy")
        return httpx.Response(200, json={"ok": True})

    with make_client(handler) as c:
        assert c.post("/x", {}) == {"ok": True}
    assert len(calls) == 3


def test_does_not_retry_client_errors():
    calls = []

    def handler(req):
        calls.append(1)
        return httpx.Response(401, json={"error": "unauthorized: expired"})

    with make_client(handler) as c, pytest.raises(SiteApiError) as err:
        c.post("/x", {})
    assert err.value.status == 401
    assert "expired" in str(err.value)
    assert len(calls) == 1


def test_gives_up_after_max_attempts():
    def handler(req):
        return httpx.Response(502, text="bad gateway")

    with make_client(handler, max_attempts=2) as c, pytest.raises(SiteApiError):
        c.get("/x")


def test_requires_a_secret():
    with pytest.raises(ValueError):
        SiteClient("https://endzoneiq.test", "")


def test_payload_round_trips_unicode():
    def handler(req):
        return httpx.Response(200, json=json.loads(req.content))

    with make_client(handler) as c:
        assert c.post("/x", {"name": "Maracanã"}) == {"name": "Maracanã"}
