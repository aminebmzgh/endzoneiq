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

## Endpoints

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

### `POST /api/internal/ingest/model-version`

`{ name, trainedAt, metrics, artifactUrl?, activate? }`. Registers a trained model (the files
themselves live in a GitHub Release, never in MySQL).

- Names are content hashes (`lgbm-v1-<hash>`), so an existing name is never overwritten.
  Sending it again only (re)activates it when `activate` is true.
- Activation leaves exactly one active version.
- Response: `{ id, name, created, activated }`.

### `POST /api/internal/ingest/picks`

`{ modelVersion, picks: [{ gameId, homeWinProb, tier, predMargin, predTotal, features, shap, changeReason?, explanations: { en, fr, es } }] }`.
At most 64 picks per request. Each explanation is `{ headline, reasons[3], matchupNotes[1-3], source: "claude" | "template" }`.
Each reason has at most 20 words; the zod schema enforces this again after the pipeline's pydantic checks.

The site decides, per game:

| Result         | When                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created`      | No pick yet (version 1), or the winner changed, or the win probability moved by 5 points or more. The previous version is marked superseded and a new row is appended. |
| `unchanged`    | Smaller moves. Sending the same payload twice is a no-op.                                                                                                              |
| `locked`       | The game has kicked off (`kickoff_at <= now`). Its pick can never change.                                                                                              |
| `unknown_game` | The game id isn't in `games`.                                                                                                                                          |

The response is `{ created, unchanged, locked, unknownGames, chainHead, results }`.

**Hash chain.** `content_hash` = SHA-256 of a canonical JSON of the pick plus `"|"` plus
the previous pick's hash, across all games.

- Canonical JSON means keys sorted recursively and no whitespace.
- The hashed fields are `game_id`, `model_version`, `version_no`, `published_at`,
  `winner`, `win_prob`, `confidence_tier`, `pred_spread`, `pred_total`, `features`,
  `shap` and `change_reason`.

The code is in `lib/picks/hash.ts`. `verifyChain()` re-checks the whole history.

### `POST /api/internal/ingest/results`

`{ seasons?: number[] }`. Grades every final game whose current pick has no result yet
(all seasons, or only the listed ones). Response: `{ graded, gameIds, seasons }`. Idempotent.

- Grading is done **on the site, from the stored scores**, so the track record can never
  disagree with the scores the site shows. It also runs after every `ingest/games` call that
  changes a season, so final scores are graded as soon as they arrive.
- The pick graded is the one current at kickoff. Picks lock at kickoff, so that's the current
  version. `correct_winner` is false for a tie; the record shows ties separately.
- `covered_spread` and `total_result` stay `NULL`. They only mean something against a market
  line, and EndzoneIQ doesn't use betting lines unless `FEATURE_ODDS` is enabled.

### `POST /api/internal/ingest/team-stats`

`{ season, week, teams: [{ abbr, elo, offEpa, defEpa, offPassEpa, offRunEpa, defPassEpa, defRunEpa, offEpaRank, defEpaRank }] }`
(at most 32 teams). This is the team pages' snapshot after the last completed week: the
model's Elo and season-to-date EPA per play, ranked 1–32 (1 = best offense or stingiest
defense). Rows are compared with what is stored and only changes are written.
Response: `{ received, changed }`.

## Cache revalidation

Public pages are static entries that live in the server's cache (see CLAUDE.md, decision
"Public pages"). Each ingest revalidates the tags of what it changed (`lib/cache-tags.ts`):

| Endpoint               | Tags                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `ingest/games`         | `games`, `season-<year>`, `seasons`, plus the grading tags |
| `ingest/picks`         | `picks`, `game-<id>`                                       |
| `ingest/results`       | `results`, `game-<id>`                                     |
| `ingest/team-stats`    | `teams`                                                    |
| `ingest/model-version` | `model`                                                    |

## Coming in later phases

`ingest/players-injuries`, `ingest/weather`, `ingest/odds` and `cron/*` with `CRON_SECRET`
(Phase 7). They reuse `internalRoute()` from `lib/internal/route.ts`.
