# Build EndzoneIQ: NFL Game Predictions & Analysis SaaS

> **How to use this file:** Put it in an empty project folder and tell Claude Code:
> *"Read `endzoneiq-claude-code-prompt.md` and build the project phase by phase. Start with Phase 0."*

---

## 0. Your role and how to work

You are the lead full-stack engineer and data scientist building **EndzoneIQ** (endzoneiq.com) from scratch.

Working rules:

1. **Work in phases** (Section 13). Finish one phase, run its checks, commit, give me a short summary, then move to the next one.
2. **Create a `CLAUDE.md`** at the repo root in Phase 0. It records the project overview, stack, commands, conventions, hosting constraints (Section 5) and decisions. Keep it updated as you go.
3. **Ask me only when you're truly blocked** (for example, missing credentials or a choice that is expensive to undo). Otherwise pick a sensible default, note it in `CLAUDE.md` under "Decisions", and keep going.
4. **Never hardcode secrets.** Use `.env.local`, keep `.env.example` up to date, and make sure `.gitignore` excludes all env files.
5. **Write tests** for the model pipeline, pick grading, authorization, internal API endpoints and payment webhooks.
6. **Keep it simple.** If a feature isn't in the MVP scope, don't build it. Add it to `BACKLOG.md` instead.
7. **Respect the hosting limits in Section 5 in every design decision.** If a feature can't work within them, tell me before building a workaround.

---

## 1. Product summary

**EndzoneIQ helps NFL fans understand every game in 60 seconds.**

Every NFL game gets:
- A **pick** (who wins), with a **win probability** and a **confidence tier**
- A **predicted spread and total** (Pro)
- **Three plain-English reasons** for the pick, generated from real model data
- **Key matchups, injuries and weather**, one tap deeper
- **Automatic updates** when major news hits (for example, the starting QB is ruled out)

Plus:
- A **public, verifiable track record** of every pick ever published
- An **AI assistant** that answers questions using EndzoneIQ's own data
- Content in **English, French and Spanish** from day one

**Positioning:** this is a fan-first analysis app, not a betting app. Betting lines are optional context, never the focus.

**Inspiration:** Visifoot (an AI football-match analysis app for soccer), rebuilt for the NFL. It should be simpler, more honest, and built around explanations.

---

## 2. Product principles (non-negotiable)

1. **Answer first, stats second.** Each game card shows pick, probability and the top reason without scrolling. Everything else is one tap deeper.
2. **Radical transparency.** Every published pick is stored permanently with a timestamp. Picks lock at kickoff and can never be edited afterwards. The record page shows all wins and losses.
3. **Explain everything.** No pick ships without reasons. Reasons must come only from real data the model used. No invented facts.
4. **Honest claims only.** Never show inflated accuracy numbers or "guaranteed" language. Show the real season record, Brier score and calibration.
5. **Fast and mobile-first.** Target a Lighthouse mobile score of at least 90. The home page should load in under 2 seconds on 4G.
6. **No wall.** Visitors see this week's picks without signing up. Ask for an account only for Pro features, alerts and chat.

---

## 3. Target users

- **Casual NFL fans** (main audience) who want to know who will win and why before Sunday
- **Fantasy football players** who want matchup context
- **French- and Spanish-speaking NFL fans**, an underserved and fast-growing audience
- **Bettors** (secondary audience) who want a model view compared with the market line

---

## 4. Tech stack

Everything user-facing runs on **my existing Hostinger "Unlimited" web hosting plan** (the same Node.js tier as Hostinger's Business plan). **All builds happen on GitHub Actions**, and so does the Python model. Hostinger only runs the finished app.

| Layer | Choice |
|---|---|
| Web app | **Next.js (App Router, latest stable) + TypeScript (strict)**, built with `output: "standalone"` and run on a **Hostinger Node.js Web App** |
| Build and deploy | **GitHub Actions** builds, tests and packages the app, then uploads it to Hostinger through the **Hostinger API** (Section 5A). Hostinger's own GitHub auto-deploy is **not** used |
| UI | **Tailwind CSS + shadcn/ui**, lucide icons, dark mode by default with a light-mode toggle |
| i18n | **next-intl**, with routes `/en`, `/fr`, `/es` (default `en`, detect from browser) |
| Database | **Hostinger managed MySQL/MariaDB** (included in the plan). Check the exact server version in Phase 0 and target it |
| ORM and migrations | **Drizzle ORM** (`mysql2` driver) + **drizzle-kit** migrations |
| Auth | **Better Auth** (or Auth.js if Better Auth doesn't fit) with email magic link and Google sign-in, sessions stored in MySQL |
| Data and model pipeline | **Python 3.12** in `/pipeline`: `nflreadpy` (nflverse data), `pandas`, `scikit-learn`, `lightgbm`, `shap`, `anthropic`. Runs on **GitHub Actions** |
| Pipeline → site connection | The pipeline **never connects to MySQL directly.** It talks to the site only through signed internal HTTPS endpoints (Section 8) |
| Scheduled web tasks | **Hostinger cron jobs** (hPanel → Advanced → Cron Jobs) call protected internal endpoints with `curl` |
| AI | **Anthropic Claude API**. Model names are set in env vars (`CLAUDE_MODEL_CHAT`, `CLAUDE_MODEL_FAST`), never hardcoded |
| Payments | **Stripe** (Checkout + Customer Portal + webhooks) |
| Email | **Resend** (magic links, alerts, weekly picks email) |
| Push notifications | Web Push (VAPID) through a service worker |
| Analytics | **PostHog** (cookie-consent aware) |
| Errors | Sentry |
| Local development | `docker-compose` with a MySQL/MariaDB container matching Hostinger's version |

Repo layout (Next.js at the root, which keeps the CI build simple):

```
/            Next.js app (app/, components/, lib/, db/, messages/)
/db          Drizzle schema + migrations
/pipeline    Python data + model + jobs (ignored by the Next.js build)
/.github     GitHub Actions workflows
/docs        architecture, model card, runbook, deployment guide
```

Because CI does the build, a `/web` + `/pipeline` monorepo is also fine if you prefer it. Note the choice in `CLAUDE.md`.

---

## 5. Hosting constraints (Hostinger Node.js, Unlimited/Business tier)

Design around these limits from day one:

| Limit | What it means for the design |
|---|---|
| **Requests are stopped after 120 seconds** | Every API route and server action must finish well under 120 s. Long work (training, bulk emails, bulk push) happens in GitHub Actions or in small batches |
| **No inbound WebSockets** | Stream AI chat over HTTP (Server-Sent Events or streamed fetch responses). No Socket.io, no Supabase Realtime-style features |
| **No always-running background workers** | No queue workers or `setInterval` jobs. Use Hostinger cron hitting endpoints, or GitHub Actions |
| **Shared process limit (about 120 processes/threads across the whole plan)** | One Next.js app uses about 10–11 threads. Keep it lean: cache aggressively, avoid spawning child processes, and redirect `www` to the apex domain so only one hostname runs the app |
| **5 Node.js apps per plan** | EndzoneIQ uses one |
| **MySQL is local to the server** | The app connects to MySQL locally. **Do not enable "Remote MySQL / Any Host".** External systems (GitHub Actions) go through the internal API instead |

**Performance strategy for Sunday traffic spikes:**
- Statically generate or use ISR (incremental static regeneration) for the home, game, team and record pages.
- Call `revalidatePath` / `revalidateTag` from the ingest endpoint whenever new picks or results arrive, so pages are rebuilt only when data changes.
- Keep database queries per page minimal and indexed.
- Document an upgrade path in `/docs/deployment.md`: Hostinger Cloud Startup (roughly double the limits), then a VPS or Vercel Pro if needed.

---

## 5A. Build and deploy pipeline (GitHub Actions → Hostinger)

**Goal:** Hostinger never compiles the app. GitHub Actions builds and tests it, and Hostinger only receives a ready-to-run package. Builds then don't use the shared plan's CPU and process limits, and a broken build never reaches production.

**Workflow `.github/workflows/deploy.yml`** (runs on push to `main`, plus a manual `workflow_dispatch`):

1. **Checks:** install with `npm ci`, then lint, type-check and run the tests (`npm test`, plus `pytest` for `/pipeline`). If anything fails, stop. Nothing is deployed.
2. **Build:** `next build` with `output: "standalone"`, on `ubuntu-latest`, using the **same Node.js major version** configured on Hostinger (22 or 24). Pin it in `.nvmrc` and `package.json > engines`.
3. **Package** a deploy folder containing:
   - the `.next/standalone/` contents (`server.js` + traced `node_modules`)
   - `.next/static/` copied into `.next/standalone/.next/static/`
   - `public/` copied into `.next/standalone/public/`
   - the compiled migration runner and the `/db/migrations` SQL files
   - `start.js`: the entry file. It runs pending database migrations (with a lock so they run only once), then starts `server.js`
   - a minimal `package.json` with **no dependencies**, `"build": "echo prebuilt"` and `"start": "node start.js"`

   Compress it as `.tar.gz` (or `.zip`) and save it as a GitHub Actions artifact (keep the last 10 for rollbacks).
4. **Upload and activate through the Hostinger API**, authenticated with `HOSTINGER_API_TOKEN`. Check the current endpoints in Hostinger's API docs (docs.hostinger.com, developers.hostinger.com) before coding:
   - **Generate Upload URL** for the website → `PUT` the archive to it
   - **Start Node.js build** (Hostinger unpacks it, and the "build" is a no-op because the package is prebuilt)
   - Poll **List Node.js builds / Get build logs** until it succeeds or fails. Fail the workflow if Hostinger's step fails
   - Call **Restart Node.js application** if needed
5. **Smoke test:** `curl` `https://endzoneiq.com/api/health` (which returns the deployed git SHA and the database status) and confirm it matches the commit. If it fails, alert me and print the rollback steps.
6. **Rollback:** a manual `rollback.yml` workflow that re-uploads a previous artifact by run ID.

**Build-time vs. runtime environment variables:**
- `NEXT_PUBLIC_*` variables are baked in at build time, so they live in **GitHub Actions variables/secrets** and are passed to `next build`.
- Server-only secrets (`DATABASE_URL`, Stripe, Anthropic, auth secrets and so on) stay **only in Hostinger's environment variables** and are read at runtime. Never put them in the build or the archive.
- Add a check that fails the build if a server secret is ever imported into client code.

**Hostinger setup (document it in `/docs/deployment.md`):**
- Create the Node.js Web App by **uploading an archive** (not by connecting GitHub), so Hostinger never auto-builds from the repo.
- In build settings, choose the framework preset that lets you set the **entry file to `start.js`** with no real build step ("Other" or "Express" style), and set the same Node.js version as CI.
- Generate the API token in hPanel and store it only as the GitHub secret `HOSTINGER_API_TOKEN`.

**Verify this in Phase 0:** confirm with a hello-world deploy that Hostinger accepts a prebuilt standalone package without running `next build`. If Hostinger forces its own build or detection breaks the entry file, try these in order and tell me which one worked:
1. Adjust the preset, entry file or archive layout until the prebuilt package runs as-is.
2. Fall back to: GitHub Actions runs all checks, and only a passing commit is pushed to a `deploy` branch that Hostinger builds from. CI still gates every release.

Don't deploy by copying files over SSH or FTP into Hostinger's build folders. Hostinger overwrites them on every deployment, and npm commands can't run over SSH on this plan.

---

## 6. Data sources

Start with free sources. Wrap every source in an adapter interface (in the Python pipeline) so it can be swapped later for a paid feed (for example, SportsDataIO or Sportradar).

| Data | Source (MVP) | Notes |
|---|---|---|
| Schedules, results, play-by-play, EPA | **nflverse** via `nflreadpy` | Main historical and current-season data |
| Rosters, depth charts, injuries | nflverse (`load_rosters`, `load_depth_charts`, `load_injuries`) | Updated regularly but not instantly. See the admin override below |
| Weather | **Open-Meteo** (free, no key) | Uses stadium coordinates. Domes and retractable roofs are flagged in the `stadiums` table |
| Betting lines (optional) | **The Odds API** (free tier) | Used only to show "Model vs Market". Can be switched off with a feature flag |
| Stadiums | Seed file you create: name, lat/lon, roof type, surface, altitude, timezone | |

**Keep the database small.** Never store raw play-by-play in MySQL. The pipeline downloads raw nflverse data on each run (cache it with `actions/cache`), computes features, and sends only **games, team-level stats, picks, explanations and results** to the site.

**Admin override for breaking news:** free injury data lags behind real news. Build an admin screen where I can mark a player OUT, QUESTIONABLE or ACTIVE. Saving the change triggers a re-prediction of that game (Section 7.5 and Section 8).

**Legal and branding:**
- Don't use NFL or team logos, the NFL shield, or official imagery anywhere. Use team names and abbreviations as text, with neutral colored badges.
- Footer on every page: *"EndzoneIQ is an independent analysis service and is not affiliated with or endorsed by the NFL or any team."*
- Respect each data source's terms of use. Don't scrape sites whose terms forbid it.

---

## 7. Prediction model

Work in `/pipeline/model`. Write a **model card** in `/docs/model-card.md` covering features, training window, metrics and known limits.

### 7.1 Targets
1. **Home win** (binary classification) gives `win_prob`.
2. **Home margin** (regression) gives `pred_spread`. Convert it to a cover probability using a normal distribution with σ fitted on residuals (roughly 13–14 points).
3. **Total points** (regression) gives `pred_total`.

### 7.2 Features (computed only from data available *before* kickoff)
- **Elo rating** per team, with a margin-of-victory multiplier, regression to the mean between seasons, and a QB adjustment
- Rolling **EPA/play** for offense and defense, split into pass and run, using exponential decay weights and shrinkage toward the league mean early in the season
- Success rate, explosive play rate, turnover rate (regressed heavily, since turnovers are noisy)
- **QB status:** starter vs. backup, measured as the difference in EPA/dropback between the expected starter and the usual starter
- **Injury impact:** a weighted sum of players who are out, using position-value weights (QB > OT/edge rusher/CB > others)
- Rest days, short week, coming off a bye, travel distance, time zones crossed
- Home-field advantage, learned from data rather than hardcoded
- Weather: wind, temperature, precipitation (it affects totals most), plus a dome flag
- Divisional game flag
- *(Optional, behind a flag)* market spread, as a feature for a separate "market-aware" model. **The main public model must not use betting lines**, so it stays independent.

### 7.3 Training and validation
- Train on regular and postseason games from 2012 to the latest completed season.
- Use **walk-forward validation**: train on seasons before N, test on season N. **No look-ahead leakage.** Add a unit test that fails if any feature row uses data timestamped after kickoff.
- Compare against baselines: home team always wins, Elo only, and (when available) the market favorite.
- Metrics: **log loss, Brier score, accuracy, ATS %** (against the spread, when odds exist), and calibration plots.
- Calibrate probabilities (isotonic or Platt scaling).
- Confidence tiers come from the calibrated win probability: **Lean** (50–58%), **Solid** (58–68%), **Strong** (68%+). Tune the cut-offs after backtesting.
- Save trained model files as **GitHub Actions artifacts or GitHub Releases** (not in MySQL) and register each version through the internal API (`model_versions`).

### 7.4 Explainability
- Compute **SHAP values** for each prediction. Map the raw features to human concepts (for example, `def_pass_epa_diff` becomes "pass defense edge").
- Send the top positive and negative drivers as `shap_json` with each pick. This is the **only** factual input the AI explanation step may use.

### 7.5 Re-prediction triggers
Re-run a game's prediction when:
- An injury status changes for a QB or any player with a large impact weight
- The weather forecast changes enough to matter (for example, wind crosses 25 km/h)
- An admin forces it, or saves an injury override

If the pick changes (a different winner, or the probability moves by 5 points or more), the site creates a new pick version with a `change_reason`, stores the new explanations, rebuilds the affected pages and queues alerts for opted-in users following either team.

---

## 8. Pipeline ↔ site integration (internal API)

The GitHub Actions pipeline and the website talk **only** through these endpoints. All of them live under `/api/internal/*`, reject anything that isn't HTTPS, and require an **HMAC-SHA256 signature** of the request body plus a timestamp header, signed with `INGEST_SECRET`. Reject requests older than 5 minutes (replay protection). Rate-limit the endpoints and log every call to `ingest_log`.

| Endpoint | Direction | Purpose |
|---|---|---|
| `GET /api/internal/export` | site → pipeline | Current season state the pipeline needs: admin injury overrides, current pick versions, feature flags |
| `POST /api/internal/ingest/games` | pipeline → site | Upsert schedule, scores and status (idempotent) |
| `POST /api/internal/ingest/players-injuries` | pipeline → site | Upsert rosters and injury reports (idempotent) |
| `POST /api/internal/ingest/weather` | pipeline → site | Upsert forecasts |
| `POST /api/internal/ingest/odds` | pipeline → site | Upsert lines (only when `FEATURE_ODDS=true`) |
| `POST /api/internal/ingest/picks` | pipeline → site | Submit predictions + SHAP + explanations (all 3 languages). The site decides whether to create a new pick version |
| `POST /api/internal/ingest/results` | pipeline → site | Submit grading results |
| `POST /api/internal/ingest/model-version` | pipeline → site | Register a model version and its metrics |
| `POST /api/internal/pipeline-run` | pipeline → site | Report job start/end/status/error |
| `POST /api/internal/cron/*` | Hostinger cron → site | Batch tasks (Section 12). Protected with `CRON_SECRET` |

Rules:
- Each endpoint must finish in **under 30 seconds**. The pipeline sends large payloads in chunks (for example, one week or 500 rows per request).
- All ingest endpoints are **idempotent**: sending the same payload twice changes nothing.
- The picks endpoint **refuses any change to a game that has kicked off** (`kickoff_at <= now`).
- After a successful ingest, call `revalidatePath`/`revalidateTag` for the affected pages.

**Admin-triggered re-prediction:** when I save an injury override or click "Re-predict", the site calls the GitHub API (`workflow_dispatch` on `repredict.yml`, with `game_id` as input) using a fine-grained `GITHUB_TOKEN` limited to this repository's Actions. The workflow pulls `/api/internal/export`, re-runs that game, and posts to `/api/internal/ingest/picks`. Show the run status on the admin screen.

---

## 9. Database schema (MySQL/MariaDB via Drizzle)

Create the schema in `/db/schema.ts` and migrations in `/db/migrations`. Use `utf8mb4` everywhere, UTC `DATETIME` columns, and `JSON` columns where needed (stored as LONGTEXT on MariaDB; handle that in Drizzle). Use join tables instead of arrays.

- `teams` (id, abbr, name, city, conference, division, primary_color, secondary_color)
- `stadiums` (id, name, team_id, lat, lon, roof_type, surface, altitude_m, timezone)
- `seasons` (year, current_week, phase: preseason | regular | postseason | offseason)
- `games` (id, season, week, game_type, home_team_id, away_team_id, stadium_id, kickoff_at, status, home_score, away_score, slug)
- `players` (id, gsis_id, name, position, team_id, status)
- `injuries` (id, player_id, game_id, report_status, source: nflverse | admin, updated_at)
- `weather` (game_id, temp_c, wind_kph, precip_mm, condition, fetched_at)
- `odds` (game_id, spread_home, total, moneyline_home, moneyline_away, source, fetched_at)
- `team_week_stats` (team_id, season, week, elo, off_epa, def_epa, pass/run splits, ranks): aggregated stats only
- `model_versions` (id, name, trained_at, metrics_json, artifact_url, is_active)
- `picks` (id, game_id, model_version_id, version_no, published_at, winner_team_id, win_prob, confidence_tier, pred_spread, pred_total, features_json, shap_json, change_reason, is_current, content_hash, prev_hash)
  - **Append-only:** a new prediction creates a new row with `version_no + 1` and flips `is_current`. Never update or delete a published row.
  - **Hash chain:** `content_hash` is SHA-256 of the pick's content plus `prev_hash`. Show the latest hash on the track record page so anyone can verify history wasn't rewritten.
  - Enforce append-only with `BEFORE UPDATE` / `BEFORE DELETE` triggers **if Hostinger's MySQL allows triggers**. If it doesn't, enforce it in the data layer (the picks repository has no update or delete functions), add tests, and run a nightly integrity check that re-verifies the hash chain.
- `explanations` (pick_id, locale, headline, reasons_json [3 items], matchup_notes_json, generated_at)
- `pick_results` (pick_id, correct_winner, covered_spread, total_result, graded_at)
- Auth tables created by the auth library (`user`, `session`, `account`, `verification`), plus `profiles` (user_id, role: user | admin, locale, favorite_team_id, plan: free | pro, stripe_customer_id)
- `subscriptions` (user_id, stripe_subscription_id, status, price_id, current_period_end)
- `chat_threads`, `chat_messages` (user_id, role, content, tokens, created_at)
- `alert_prefs` (user_id, notify_pick_change, notify_weekly) + `alert_teams` (user_id, team_id)
- `push_subscriptions` (user_id, endpoint, keys_json)
- `notification_queue` (id, user_id, channel: push | email, payload_json, status, attempts, created_at, sent_at)
- `pipeline_runs` (id, job, started_at, finished_at, status, error)
- `ingest_log` (id, endpoint, status, rows, duration_ms, created_at)
- `audit_log` (actor, action, entity, entity_id, payload, created_at)

**Authorization (replaces database-level row security):**
- All database access happens **server-side only**. Database credentials never reach the browser.
- Put every permission rule in one module (`lib/authz.ts`): `canViewProContent`, `isAdmin`, `ownsResource`, and so on. Every server action and API route calls it.
- Write tests that confirm free users can't get Pro data, users can't read others' chats or alerts, and non-admins can't reach `/admin` or admin actions.

**Migrations on Hostinger:** GitHub Actions can't reach the database (remote MySQL stays off), so migrations run **on Hostinger at startup**. `start.js` applies pending migrations from the bundled SQL files using Drizzle's migrator, with a database lock so only one process runs them, then starts the server. If a migration fails, the app must not start: log the error clearly so the smoke test catches it. Write migrations to be backward-compatible (add first, remove later), so a rollback to the previous build still works. Document a manual fallback in `/docs/deployment.md`.

---

## 10. AI features (Claude API)

### 10.1 Pick explanations (generated in the Python pipeline)
- Input: game facts plus `shap_json`, injuries, weather and predictions, as structured JSON.
- Output: **strict JSON**, validated with pydantic in the pipeline and again with zod in the ingest endpoint:
  ```json
  { "headline": "...", "reasons": ["...", "...", "..."], "matchup_notes": ["...", "..."] }
  ```
- System prompt rules: use **only** the supplied facts. No made-up stats, quotes or news. Each reason is at most 20 words, in plain language. No betting advice, no guarantees, no hype.
- Generate English first, then French and Spanish (use `CLAUDE_MODEL_FAST`). Use natural NFL terminology for each language, not literal translation.
- Generate only when a pick is new or changed. Send the explanations with the pick to the ingest endpoint.
- Fallback: if the API fails, send template-based reasons built from the top 3 SHAP drivers.

### 10.2 AI assistant (`/chat`, Pro; free users get 3 questions per day)
- Runs in the Next.js app. **Stream responses over HTTP** (no WebSockets), and stop any single response before 90 seconds to stay under Hostinger's 120 s limit.
- Use Claude **tool use**, with tools that read from our own database:
  `get_week_games`, `get_game_detail`, `get_team_stats`, `get_player_info`, `get_injuries`, `get_pick_history`, `get_track_record`
- Answer only NFL and EndzoneIQ topics, and politely decline anything else.
- Always cite the data it used ("Based on our model's Week 10 data…").
- Never promise outcomes. Add a short disclaimer when the user asks about betting.
- Reply in the user's chosen language.
- Rate-limit per user and per plan (store counters in MySQL). Log token usage to `chat_messages.tokens`.

---

## 11. Pages and UX

All pages are localized and responsive, designed for phones first.

1. **Home `/[locale]`**: this week's games as cards, sorted by kickoff time.
   Each card shows the teams, kickoff time in the user's local timezone, the pick badge, the win probability bar, the confidence tier, and the top reason (one line). A "Pick updated" badge appears if the pick has changed. A week selector sits at the top.
2. **Game page `/[locale]/game/[slug]`**: headline, pick, probability, 3 reasons, and key matchups. Then an injuries list, a weather widget, and the pick version history ("Updated Sat 3:12 PM: QB ruled out"). **Pro** adds the predicted spread and total, "Model vs Market", and the SHAP driver chart.
3. **Track record `/[locale]/record`**: season and all-time record, record by confidence tier, a calibration chart, ATS record, the latest hash-chain value, and a full filterable table of every pick and its result. Public and indexable.
4. **Team pages `/[locale]/teams/[abbr]`**: current Elo, efficiency ranks, schedule with picks, and how the model has done on this team's games.
5. **Chat `/[locale]/chat`**: the AI assistant.
6. **Pricing `/[locale]/pricing`**: Free vs. Pro comparison table.
7. **Account `/[locale]/account`**: plan, billing portal, language, favorite team, alert preferences.
8. **Admin `/admin`** (admins only): injury overrides, "Re-predict" button with workflow status, recent pipeline runs and ingest log, model versions, feature flags.
9. **Legal**: Terms, Privacy Policy, Cookie Policy, Responsible Gaming, About and Methodology (explain the model in plain language, linking to the model card).

Design notes:
- A clean, modern sports look with plenty of whitespace and big readable numbers. Probability bars use neutral team-color accents. No logos.
- Accessibility: WCAG AA contrast, keyboard navigation, screen-reader labels on charts.
- Empty and loading states for every view. Offseason mode shows the track record, the model card and a "Notify me at kickoff" signup.

---

## 12. Scheduled jobs

GitHub Actions cron runs in **UTC** and can start a few minutes late, so never depend on exact timing. Convert the US Eastern times below to UTC and account for daylight saving time.

### 12.1 GitHub Actions (Python pipeline)

| Workflow | When (US Eastern) | What it does |
|---|---|---|
| `refresh_data.yml` | Daily 06:00 | Pull schedules, results, rosters, injuries and depth charts, then ingest them |
| `grade_picks.yml` | Mon and Tue 02:00, and Fri 02:00 (after Thursday games) | Grade finished games and send results |
| `retrain.yml` | Weekly, Tue 04:00 | Update Elo and rolling features. Full retrain only in the offseason or when triggered manually |
| `publish_week.yml` | Tue 10:00 | Predict the next week, generate explanations, and send picks |
| `injury_watch.yml` | Wed–Sat every 2h. Sun 07:00–13:00 every 15 min | Check injury changes and re-predict affected games |
| `weather_watch.yml` | Every 6h | Refresh forecasts for games within 72h and re-predict if needed |
| `repredict.yml` | On demand (`workflow_dispatch`, input `game_id`) | Triggered by the admin screen |

Every workflow reports to `/api/internal/pipeline-run`. A failed run emails me (via the site's `pipeline-run` endpoint and Resend).

### 12.2 Hostinger cron jobs (call `/api/internal/cron/*` with `CRON_SECRET`)

| Endpoint | When | What it does |
|---|---|---|
| `cron/notifications` | Every 5 min | Send up to N queued push notifications and emails per run (sized to finish in under 60 s) |
| `cron/weekly-email` | Every 5 min on Tuesdays, 12:00–16:00 ET | Queue and send the weekly picks email in batches using Resend's batch API |
| `cron/integrity-check` | Daily 03:00 | Re-verify the picks hash chain and email me if anything is wrong |
| `cron/cleanup` | Daily 04:00 | Delete expired sessions and old logs |

**Pick locking:** no job is needed. A pick is locked when `kickoff_at <= now`, and the ingest endpoint enforces it.

Document the exact hPanel cron commands (for example, `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://endzoneiq.com/api/internal/cron/notifications`) in `/docs/deployment.md`.

---

## 13. Build phases (with acceptance criteria)

### Phase 0: Setup
- Repo structure, `CLAUDE.md`, `.env.example`, linting (ESLint, Prettier, Ruff), CI running tests on every push, `docker-compose` for local MySQL.
- Write `/docs/deployment.md` with step-by-step Hostinger setup: create the MySQL database, create the Node.js Web App from an uploaded archive, set the Node version (22 or 24) and the `start.js` entry file, environment variables, the API token, and the `www` → apex redirect.
- Build the full `deploy.yml` and `rollback.yml` workflows (Section 5A) and the `/api/health` endpoint.
- ✅ `npm run dev` serves a localized hello page at `/en`, `/fr` and `/es` and connects to local MySQL. `pytest` passes. **A push to `main` makes GitHub Actions build, package and upload the app, Hostinger runs it without rebuilding, and the smoke test passes.** A deliberately failing test blocks the deploy. If the prebuilt approach doesn't work, report which fallback from Section 5A you used.

### Phase 1: Data foundation
- Drizzle schema and migrations, team and stadium seed data, the internal API with HMAC verification, and the nflverse ingestion pipeline for 2012 to the present (posting through the internal API).
- ✅ The `games` table contains every game since 2012 with correct scores. Re-running ingestion creates no duplicates. Unsigned or expired requests are rejected (tested).

### Phase 2: Model v1
- Elo baseline, then the LightGBM models, walk-forward backtest, calibration, SHAP, and the model card.
- ✅ Backtest report in `/docs/backtest.md`. The model beats the Elo-only baseline on log loss. The leakage test passes.

### Phase 3: Picks and explanations
- `publish_week` workflow, append-only pick versions with the hash chain, the Claude explanation generator with schema validation and a template fallback, and EN/FR/ES output.
- ✅ Running the workflow for a past week produces picks and valid explanations in all 3 languages. Trying to change a kicked-off game's pick is rejected (tested).

### Phase 4: Public web app
- Home, game, track record and team pages with ISR and on-demand revalidation. SEO: metadata, Open Graph images per game, sitemap, `hreflang` tags, JSON-LD.
- ✅ Lighthouse mobile ≥ 90 on home and game pages. Everything works without logging in. Pages are served from cache under load (test with a simple load test of about 50 concurrent users).

### Phase 5: Accounts and Pro
- Auth (magic link + Google), profiles, `lib/authz.ts`, Stripe integration, and the pricing and account pages.
- ✅ The full purchase, upgrade and cancel flow works in Stripe test mode. Webhook tests and authorization tests pass.

### Phase 6: AI assistant
- Chat UI with HTTP streaming, tool use against our database, rate limits, and localization.
- ✅ The assistant answers "Why do you like the home team in [game]?" using real stored data, refuses off-topic requests, and never runs longer than 90 seconds.

### Phase 7: Live updates and alerts
- Injury and weather watchers, the admin override screen, the `repredict.yml` dispatch, the notification queue, Hostinger cron endpoints, web push and email alerts.
- ✅ An admin "QB OUT" override creates a new pick version, updates the explanations, shows "Pick updated" on the site, and delivers a push notification **within 10 minutes**.

### Phase 8: Polish and launch
- Legal pages, cookie consent (GDPR-compliant, since the site serves EU users), PostHog events, Sentry, offseason mode, a 404 page, and a runbook in `/docs/runbook.md`.
- ✅ Production running on Hostinger at endzoneiq.com with HTTPS, deployed only through GitHub Actions, cron jobs configured, and GitHub Actions secrets set. A rollback has been tested once. A launch checklist in `/docs/launch.md` with every item checked.

---

## 14. Environment variables

**Website runtime (`.env.example`, set in hPanel for production, never in GitHub). `NEXT_PUBLIC_*` values must also be set as GitHub Actions variables, because they're baked in at build time:**

```
NEXT_PUBLIC_SITE_URL=https://endzoneiq.com
DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/DBNAME
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://endzoneiq.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ANTHROPIC_API_KEY=
CLAUDE_MODEL_CHAT=
CLAUDE_MODEL_FAST=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_SEASON=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
RESEND_API_KEY=
EMAIL_FROM=hello@endzoneiq.com
INGEST_SECRET=
CRON_SECRET=
GITHUB_TOKEN=
GITHUB_REPO=owner/endzoneiq
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
SENTRY_DSN=
ADMIN_EMAILS=
FEATURE_ODDS=false
```

**GitHub Actions secrets and variables:**

```
# Build and deploy (deploy.yml, rollback.yml)
HOSTINGER_API_TOKEN=
HOSTINGER_WEBSITE=endzoneiq.com      # or the website ID the API expects
NEXT_PUBLIC_SITE_URL=https://endzoneiq.com
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_POSTHOG_KEY=
SENTRY_AUTH_TOKEN=                   # optional, for source-map upload

# Data and model pipeline
SITE_URL=https://endzoneiq.com
INGEST_SECRET=
ANTHROPIC_API_KEY=
CLAUDE_MODEL_FAST=
ODDS_API_KEY=
```

---

## 15. Plans and payments

| | **Free** | **Pro** |
|---|---|---|
| Picks + win probability + top reason | ✅ all games | ✅ |
| All 3 reasons + matchup notes | 3 games/week | ✅ |
| Predicted spread and total, Model vs Market | — | ✅ |
| Pick-change alerts | — | ✅ |
| AI assistant | 3 questions/day | Generous fair-use limit |
| Track record | ✅ | ✅ |

- Suggested prices: **Pro $7.99/month** or **$39.99/season** (make both configurable through Stripe price IDs in env vars). Offer a 7-day free trial.
- Stripe Checkout, Customer Portal, and webhooks (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`) sync to `subscriptions` and `profiles.plan`. Webhooks must be idempotent, finish quickly, and be tested.
- Gate Pro features **on the server** through `lib/authz.ts`, not only in the UI.

---

## 16. Compliance and trust checklist

- [ ] No NFL or team logos or official imagery. Non-affiliation notice in the footer
- [ ] "For entertainment and informational purposes. Not betting advice." shown on picks and in chat
- [ ] Betting-line content behind the `FEATURE_ODDS` flag, with an 18+ notice and a responsible-gaming page that links to help resources
- [ ] Track record shows **all** picks, losses included. Locked picks are immutable, the hash chain is verified daily, and both are covered by tests
- [ ] No unverifiable accuracy claims anywhere in the marketing copy
- [ ] Privacy policy, GDPR cookie consent, account deletion and data export
- [ ] Remote MySQL access stays **disabled**. Internal endpoints are signed and rate-limited
- [ ] Data-source terms of use respected. Attribution to nflverse where required

---

## 17. Out of scope for the MVP (put in `BACKLOG.md`)

Native mobile apps, live in-game win probability, player prop predictions, fantasy start/sit tool, college football, social features and comments, a public API, more languages, and moving to Cloud/VPS hosting (only when traffic requires it).

---

**Start now with Phase 0.** When it's done, show me the repo tree, the commands to run, and the list of accounts, credentials and hPanel settings you need from me before Phase 1.
