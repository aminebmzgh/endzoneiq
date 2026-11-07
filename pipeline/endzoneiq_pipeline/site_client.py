"""Signed client for the site's internal API (spec Section 8).

The pipeline never touches MySQL: everything goes through /api/internal/*,
signed with INGEST_SECRET. Must stay byte-for-byte compatible with
lib/internal/signature.ts (both test suites share one test vector):

    X-EZ-Timestamp: <unix seconds>
    X-EZ-Signature: v1=<hex HMAC-SHA256(secret, "<ts>.<METHOD>.<path+query>.<raw body>")>
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlencode

import httpx

log = logging.getLogger(__name__)

TIMESTAMP_HEADER = "X-EZ-Timestamp"
SIGNATURE_HEADER = "X-EZ-Signature"
RETRY_STATUSES = {429, 500, 502, 503, 504}


def sign(secret: str, ts: str, method: str, path_with_query: str, body: str) -> str:
    payload = f"{ts}.{method.upper()}.{path_with_query}.{body}".encode()
    return "v1=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


def encode_body(payload: Any) -> str:
    """Compact JSON. The exact string sent is the string signed."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


class SiteApiError(RuntimeError):
    def __init__(self, status: int, body: str, path: str):
        super().__init__(f"{path} answered HTTP {status}: {body[:500]}")
        self.status = status
        self.body = body


class SiteClient:
    def __init__(
        self,
        base_url: str,
        secret: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout_s: float = 30.0,
        max_attempts: int = 4,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not secret:
            raise ValueError("INGEST_SECRET is required to call the internal API")
        self._base = base_url.rstrip("/")
        self._secret = secret
        self._max_attempts = max_attempts
        self._clock = clock
        self._sleep = sleep
        self._http = httpx.Client(
            transport=transport,
            timeout=timeout_s,
            headers={"User-Agent": "endzoneiq-pipeline/1.0"},
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> SiteClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, payload: Any) -> Any:
        return self.request("POST", path, payload=payload)

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: Any = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        path_with_query = path + (f"?{urlencode(params)}" if params else "")
        body = "" if payload is None else encode_body(payload)
        last_error: Exception | None = None

        for attempt in range(1, self._max_attempts + 1):
            ts = str(int(self._clock()))  # re-signed on every attempt
            headers = {
                TIMESTAMP_HEADER: ts,
                SIGNATURE_HEADER: sign(self._secret, ts, method, path_with_query, body),
            }
            if payload is not None:
                headers["Content-Type"] = "application/json"
            try:
                res = self._http.request(
                    method,
                    self._base + path_with_query,
                    content=body.encode() if body else None,
                    headers=headers,
                )
            except httpx.TransportError as err:
                last_error = err
                wait = 2.0**attempt
                log.warning("%s %s failed (%s), retry in %.0fs", method, path, err, wait)
            else:
                if res.status_code < 400:
                    return res.json()
                if res.status_code not in RETRY_STATUSES:
                    raise SiteApiError(res.status_code, res.text, path)
                last_error = SiteApiError(res.status_code, res.text, path)
                wait = float(res.headers.get("Retry-After") or 2.0**attempt)
                log.warning("%s %s -> HTTP %s, retry in %.0fs", method, path, res.status_code, wait)
            if attempt < self._max_attempts:
                self._sleep(min(wait, 60.0))

        assert last_error is not None
        raise last_error
