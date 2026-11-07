# Internal API (pipeline ↔ site)

Everything under `/api/internal/*` is for the GitHub Actions pipeline only. It is the
**only** way data gets into the site: the pipeline never connects to MySQL.

## Rules for every endpoint

| Rule           | Behaviour                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTPS only     | Plain HTTP is refused with `403` (localhost excepted, for development).                                                                                                                          |
| Signature      | `X-EZ-Timestamp` = unix seconds; `X-EZ-Signature` = `v1=` + hex HMAC-SHA256 with `INGEST_SECRET` over `"<ts>.<METHOD>.<path+query>.<raw body>"`. Missing, malformed or wrong signatures → `401`. |
| Replay window  | Timestamps more than **5 minutes** from server time → `401 unauthorized: expired`. Ingest endpoints are idempotent, so a replay inside the window changes nothing.                               |
| Rate limit     | 120 requests per minute per endpoint and client → `429` with `Retry-After`.                                                                                                                      |
| Size           | Bodies over 2 MB → `413`. Send at most 500 rows per request.                                                                                                                                     |
| Validation     | Bad JSON → `400`; schema errors → `422` with `issues`.                                                                                                                                           |
| Time budget    | Each call must finish in under 30 s (a 285-game season takes about 0.3 s).                                                                                                                       |
| Logging        | Every call, including rejections, writes a row to `ingest_log`.                                                                                                                                  |
| Caching        | Responses are `Cache-Control: no-store`. Successful ingests call `revalidateTag(tag, "max")`.                                                                                                    |
| Not configured | Without `INGEST_SECRET` the API answers `503`.                                                                                                                                                   |

Implementations: `lib/internal/signature.ts` (site) and
`pipeline/endzoneiq_pipeline/site_client.py` (pipeline). Both test suites assert the same
test vector, so the two stay compatible.

## Endpoints (Phase 1)

### `POST /api/internal/ingest/games`

```json
{
  "games": [
    {
      "id": "2024_01_BAL_KC",
      "season": 2024,
      "week": 1,
      "gameType": "REG",
      "homeTeam": "KC",
      "awayTeam": "BAL",
      "stadiumId": "KAN00",
      "neutralSite": false,
      "kickoffAt": "2024-09-06T00:20:00Z",
      "status": "final",
      "homeScore": 27,
      "awayScore": 20,
      "overtime": false
    }
  ],
  "seasons": [{ "year": 2024, "currentWeek": 22, "phase": "offseason" }]
}
```

- Keyed by the nflverse `game_id`. Legacy abbreviations (OAK, SD, STL) map to the current
  franchise. Unknown teams → `422` and nothing is written.
- Stadium ids that aren't in the seed are stored as `NULL` and listed in `unknownStadiums`.
- Rows are compared with what is stored, and only new or changed rows are written.
- Response: `{ received, inserted, updated, unchanged, unknownStadiums, changedSeasons, seasonsChanged }`.

### `GET /api/internal/games/digest?season=YYYY`

`{ season, count, digest }`, where `digest` is the SHA-256 of one line per game, sorted:
`<id>|<HOME>|<AWAY>|<home score>|<away score>|<status>|<kickoff ISO, seconds, Z>`.
The pipeline computes the same digest from nflverse and fails the run on a mismatch.

### `POST /api/internal/pipeline-run`

`{ id, job, status: running|success|failure|cancelled, startedAt?, finishedAt?, error?, runUrl? }`
Upserted by `id` (`<github run id>-<attempt>-<job>`).

### `GET /api/internal/export`

`{ generatedAt, featureFlags: { odds }, seasons, injuryOverrides, currentPicks }`: the state
the pipeline needs before predicting (overrides and picks only for games not yet kicked off).

## Coming in later phases

`ingest/players-injuries`, `ingest/weather`, `ingest/odds` (Phase 7), `ingest/model-version`
(Phase 2), `ingest/picks` and `ingest/results` (Phase 3), and `cron/*` with `CRON_SECRET`
(Phase 7). They reuse `internalRoute()` from `lib/internal/route.ts`.
