"""Report each job's start and end to /api/internal/pipeline-run."""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime

from endzoneiq_pipeline.games import iso_seconds
from endzoneiq_pipeline.site_client import SiteClient

log = logging.getLogger(__name__)


def run_identity(job: str, env: Mapping[str, str] | None = None) -> tuple[str, str | None]:
    """(run id, GitHub run URL). Stable across re-reports of the same run."""
    e = os.environ if env is None else env
    run_id = e.get("GITHUB_RUN_ID")
    if not run_id:
        return f"local-{uuid.uuid4().hex[:12]}-{job}", None
    attempt = e.get("GITHUB_RUN_ATTEMPT", "1")
    url = None
    if e.get("GITHUB_SERVER_URL") and e.get("GITHUB_REPOSITORY"):
        url = f"{e['GITHUB_SERVER_URL']}/{e['GITHUB_REPOSITORY']}/actions/runs/{run_id}"
    return f"{run_id}-{attempt}-{job}", url


@contextmanager
def reported_run(client: SiteClient, job: str) -> Iterator[None]:
    """Report running -> success/failure. Reporting problems never hide the job's own error."""
    run_id, run_url = run_identity(job)
    started = iso_seconds(datetime.now(UTC))
    base = {"id": run_id, "job": job, "startedAt": started}
    if run_url:
        base["runUrl"] = run_url

    def report(**fields: str) -> None:
        try:
            client.post("/api/internal/pipeline-run", {**base, **fields})
        except Exception as err:
            log.warning("could not report pipeline run %s: %s", run_id, err)

    report(status="running")
    try:
        yield
    except BaseException as err:
        report(status="failure", error=f"{type(err).__name__}: {err}"[:10_000])
        raise
    report(status="success")
