# EndzoneIQ — project memory for Claude Code

**EndzoneIQ** (endzoneiq.com) helps NFL fans understand every game in 60 seconds: a pick, a
win probability, a confidence tier and three plain-English reasons built only from real model
data. It has a public, hash-chained track record, an AI assistant, and English/French/Spanish
from day one. Fan-first analysis, **not** a betting app.

Full spec: `endzoneiq-claude-code-prompt.md` (Section 13 = build phases). Out-of-scope ideas go
in `BACKLOG.md`, never into the code.

@AGENTS.md

## Status

| Phase              | Status                                                                            |
| ------------------ | --------------------------------------------------------------------------------- |
| 0 Setup            | ✅ Done 2026-11-07. Live at https://endzoneiq.com, deployed by GitHub Actions     |
| 1 Data foundation  | ✅ Done 2026-11-07. Schema, seeds, signed internal API, 2012+ games ingested      |
| 2 Model v1         | ✅ Done 2026-11-07. Elo-anchored LightGBM beats Elo-only (backtest.md)            |
| 3 Picks            | ✅ Done 2026-11-07. Append-only hash-chained picks, EN/FR/ES explanations         |
| 4 Public web app   | ✅ 2026-11-07 (Lighthouse ≥ 90 not yet confirmed on stable hardware, see below)   |
| 5 Accounts and Pro | ✅ Sign-in live 2026-11-07. Payments deferred: provider may change (see below)    |
| 6 AI assistant     | ✅ Done 2026-11-07. Streaming chat with tools on our data, quota, EN/FR/ES        |
| 7 Live and alerts  | ✅ Code done 2026-11-07. Watchers, admin overrides, re-predict, push/email alerts |
| 8                  | Not started                                                                       |

## Stack

- **Web:** Next.js 16 (App Router, `cacheComponents`, `output: "standalone"`), React 19,
  TypeScript strict, Tailwind CSS 4 (shadcn/ui-compatible tokens in `app/globals.css`),
  lucide-react, next-themes (dark by default), next-intl 4 (`/en`, `/fr`, `/es`).
- **DB:** Hostinger MariaDB (local: `mariadb:11.8` in docker). Drizzle ORM (`mysql2`) +
  drizzle-kit migrations.
- **Pipeline:** Python 3.12 in `/pipeline`, managed with **uv**. Runs on GitHub Actions only.
  Talks to the site only through signed `/api/internal/*` endpoints.
- **Hosting:** one Hostinger Node.js Web App (Unlimited/Business tier). Built on GitHub
  Actions, uploaded via the Hostinger API.

## Layout

```
app/[locale]/        localized pages (root layout lives here; html lang = locale):
                     game/[slug], weeks/[season]/[week], teams, teams/[abbr], and
                     ez-view/[view] (internal: home + record, reached via proxy.ts rewrite)
app/sitemap.ts, app/robots.ts, app/[locale]/**/opengraph-image.tsx   SEO
app/api/             route handlers (/api/health; /api/internal/* re-export lib/internal/handlers)
components/          UI components (picks/: game card, badges, week view; views/: home,
                     record; record/: filter table; local-time, after-kickoff; pro/: Pro
                     panel; auth/, account/, pricing/: client forms; account-button)
i18n/                next-intl routing, request config, navigation helpers
messages/            en.json, fr.json, es.json (keys must match; tested)
lib/                 server code: env.ts (zod, server-only), db/, health.ts, cache-tags.ts,
                     internal/ (HMAC, rate limit, internalRoute wrapper, handlers), games/,
                     picks/ (append-only repository, hash chain, grading),
                     site/ (cached public reads `data.ts`, record stats, labels, SEO,
                     free-games), auth.ts (Better Auth), authz.ts (every permission rule),
                     billing/ (Stripe checkout, portal, webhook sync), pro/ (gated API),
                     account.ts, email.ts (Resend)
db/                  schema.ts, migrator.ts, triggers.ts, seed/ (teams.json, stadiums.json),
                     migrations/ (generated SQL, committed)
deploy/              start.js + package.json shipped in the deploy archive
scripts/             packaging, Hostinger deploy, smoke test, secret scan, local migrate
pipeline/            Python package endzoneiq_pipeline (site_client, games, sources/, jobs/,
                     model/: data, elo, features, train, backtest, explain;
                     narrative*.py: explanations) + tests
docs/                deployment.md, internal-api.md, model-card.md, backtest.md (generated)
.github/workflows/   ci.yml, deploy.yml, rollback.yml, refresh_data.yml, retrain.yml, grade_picks.yml,
                     publish_week.yml, repredict.yml, injury_watch.yml, weather_watch.yml,
                     lighthouse.yml
app/admin/           admin screen (English, own root layout, 404 for non-admins)
proxy.ts             next-intl locale detection/redirect (Next 16 renamed middleware → proxy)
```

## Commands

```bash
docker compose up -d          # local MariaDB on 127.0.0.1:3306 (endzoneiq/endzoneiq)
cp .env.example .env.local    # then fill in as needed
npm run db:migrate            # apply migrations locally
npm run dev                   # http://localhost:3000 → /en

npm run lint && npm run format:check && npm run typecheck && npm test
npm run db:generate           # after editing db/schema.ts; commit db/migrations/*
npm run db:seed-sql           # re-render the teams/stadiums seed migration (see docs/deployment.md §5)

# Production package, same as CI:
npm run build && npm run check:client-secrets && npm run build:migrator && npm run package

cd pipeline && uv sync && uv run pytest && uv run ruff check . && uv run ruff format --check .

# Ingest games into a running site (local: SITE_URL=http://localhost:3000 + INGEST_SECRET from .env.local)
cd pipeline && uv run python -m endzoneiq_pipeline.jobs.refresh_games --from-season 2012

# Model (first run downloads ~16 seasons of play-by-play, ~8 min; aggregates cached in pipeline/.cache)
cd pipeline && uv run python -m endzoneiq_pipeline.jobs.backtest --out ../docs/backtest.md
cd pipeline && uv run python -m endzoneiq_pipeline.jobs.train_model --out model-out
cd pipeline && uv run python -m endzoneiq_pipeline.jobs.publish_week --season 2026 --week 8   --dry-run --model-dir model-out --out picks.json     # past week, nothing published
cd pipeline && uv run python -m endzoneiq_pipeline.jobs.grade_picks --dry-run   # team snapshot only

# Live assistant check: real Claude + the local dev DB (opt-in, costs a few cents)
LIVE_CLAUDE=1 ANTHROPIC_API_KEY=... CLAUDE_MODEL_CHAT=... DATABASE_URL=<dev db> npx vitest run tests/chat.live.test.ts --reporter=verbose

# Load test (spec Phase 4: ~50 concurrent users); exits 1 on errors or p95 > 2 s
node scripts/load-test.mjs https://endzoneiq.com 50 30
```

Test a production build locally: `npm run build && npx next start -p 3100` (needs the local
DB for data pages). Pages are cached after their first visit, so check `x-nextjs-cache: HIT`.

Polars (via nflreadpy) needs AVX2, which this dev machine lacks. Locally run pipeline jobs that
load nflverse data with `uv run --with polars-runtime-compat ...`. CI runners don't need it.

`npm test` includes DB integration tests that skip themselves when no database is reachable.
Locally they use `TEST_DATABASE_URL` (`endzoneiq_test`, created by `docker/initdb`), never the
dev DB, because the picks tests reset append-only tables. CI uses a throwaway MariaDB container.

## Conventions

- **Secrets:** never hardcoded. `.env.local` locally, hPanel env vars in production, GitHub
  secrets for the pipeline/deploy. Keep `.env.example` current. Server-only modules start with
  `import "server-only"`. `npm run check:client-secrets` scans client bundles in CI.
- **Env access:** server code reads env through `lib/env.ts` (`serverEnv()`), lazily, so
  `next build` never needs production secrets.
- **DB:** all access is server-side. Use `getDb()` / `getPool()` from `lib/db`. UTC
  everywhere (`timezone: "Z"`), utf8mb4. Migrations must be backward-compatible (add first,
  remove later).
- **i18n:** every user-facing string goes in `messages/*.json` (all 3 locales). Pages call
  `setRequestLocale(locale)` so they can be statically rendered.
- **Next 16:** read `node_modules/next/dist/docs/` before using an API (see AGENTS.md).
  Middleware is `proxy.ts`. Route types come from `next typegen` (`LayoutProps`, `PageProps`).
- **Branding/legal:** no NFL or team logos or imagery. Team names/abbreviations as text only.
  The footer carries the non-affiliation notice and "not betting advice" on every page.
- **Copy:** no accuracy claims we can't verify, no "guaranteed" language.
- **Tests:** vitest (`*.test.ts`) for web; pytest for pipeline. Required for: model pipeline,
  pick grading, authorization, internal API endpoints, payment webhooks.
- **Formatting:** Prettier (+ tailwind class sorting), ESLint (next + prettier), Ruff.

## Hosting constraints (Hostinger shared Node.js) — respect in every design decision

- Requests are killed after **120 s**. Every route finishes well under; internal endpoints
  under **30 s**; chat responses stop before **90 s**.
- **No WebSockets.** Stream AI chat over HTTP (SSE / streamed fetch).
- **No background workers**, no `setInterval` jobs. Use Hostinger cron → `/api/internal/cron/*`,
  or GitHub Actions.
- **About 120 processes/threads for the whole plan**; Next uses about 10–11. Don't spawn child
  processes. Keep the DB pool small (5). Cache aggressively (static/ISR + `revalidateTag`).
- **5 Node.js apps per plan**; EndzoneIQ uses one.
- **MySQL is local only.** Remote MySQL stays **off**. GitHub Actions never connects to the DB.
- Deploy archives must be **under 50 MB** (the package script fails at 48 MB).

## Deploy pipeline (summary; details in docs/deployment.md)

`deploy.yml` on push to `main`: ci.yml checks → `next build` → secret scan → bundle migrator →
`scripts/package-standalone.sh` → artifact (last 10 kept) → `scripts/hostinger-deploy.sh`
(upload URL → TUS upload → start build with preset `other`, entry `start.js`, Node 24 →
poll → restart) → `scripts/smoke-test.sh` (`/api/health` must show the commit SHA and
`db.ok`). The upload is gated by repo variable `DEPLOY_ENABLED=true`. `rollback.yml`
re-uploads a previous run's artifact.

## Decisions

- **2026-11-07 Repo layout:** Next.js at the repo root, Python in `/pipeline` (spec default).
- **2026-11-07 Next.js 16.4 with `cacheComponents`** (the create-next-app default). Static
  pages plus `revalidateTag` replace classic ISR.
- **2026-11-07 Node.js 24** (LTS) pinned in `.nvmrc`, `engines`, CI and the Hostinger build
  settings. Local dev on newer Node works but isn't what we ship.
- **2026-11-07 DB version: MariaDB 11.8** (production reports `11.8.9-MariaDB-log` via
  `/api/health`); local docker and CI use `mariadb:11.8`.
- **2026-11-07 Production DB** is the existing `u701027769_endzoneiq` (it has the TRIGGER
  privilege, so Phase 1 can enforce append-only picks with triggers). Connect via `127.0.0.1`.
- **2026-11-07 Deploy package layout:** the standalone server goes in `server/` with a
  dependency-free root `package.json`, so a Hostinger `npm install` can't prune the traced
  `node_modules`. `start.js` migrates then `require`s the server in the same process.
- **2026-11-07 Migrations:** `db/migrator.ts` is bundled by esbuild into `migrate.cjs`
  (drizzle-orm + mysql2 inlined), guarded by `GET_LOCK('endzoneiq_migrations')`. The app
  refuses to start if a migration fails. `SKIP_MIGRATIONS=true` is the manual escape hatch.
- **2026-11-07 Hostinger deploy via plain `curl` + `jq`** against the REST API
  (`POST /api/hosting/v1/files/upload-urls` → TUS upload →
  `POST /api/hosting/v1/accounts/{user}/websites/{domain}/nodejs/builds` with
  `source_type: archive`). No third-party CLI binary in CI. **Verified live:** Hostinger runs
  the prebuilt package as-is (install = "audited 1 package", build = `echo prebuilt`, deploy
  ~7 s). No fallback from spec §5A needed. Build responses are unwrapped (`.state`, `.uuid`);
  the logs endpoint returns `{logs, lines}` where `lines` is the count returned per call.
- **2026-11-07 Gotcha: deleting a Hostinger website does not kill its Node processes.** A
  re-created site with the same domain kept serving the old app until its orphaned
  `next-server` processes (cwd `domains/.removed-<domain>-*`) were killed over SSH
  (`ssh -p 65002 u701027769@31.170.166.52`; local alias `endzoneiq-ssh`). Check
  `ps -u $USER -o pid,lstart,args` and `readlink /proc/<pid>/cwd` if the live site doesn't
  match the deployed SHA.
- **2026-11-07 Gotcha: changing hPanel/API env vars doesn't reach the running app.** Neither
  saving the variables nor the "restart" API replaced the `next-server` processes. Re-run the
  latest Deploy workflow (`gh run rerun <id>`), then check `/api/me` or the process environ
  over SSH (names only).
- **2026-11-07 Email:** endzoneiq.com is a verified sending domain in the Resend account
  shared with mesvaleurs.ma (user-approved). EndzoneIQ uses its own send-only key
  restricted to endzoneiq.com. The DNS records (`resend._domainkey`, `send` MX/TXT,
  `rsend`) live in Hostinger DNS.
- **2026-11-07 Build SHA** is baked in through `next.config.ts` `env.BUILD_SHA` (from
  `GITHUB_SHA`), so the smoke test can confirm exactly which commit is live.
- **2026-11-07 `www` → apex:** handled at DNS/hPanel, with a `next.config.ts` redirect as
  backup.
- **2026-11-07 Pipeline deps** are added per phase (Phase 0 has only httpx + pydantic) to
  keep CI fast. Python is managed with uv (`uv.lock` committed).
- **2026-11-07 Shadcn/ui:** design tokens use shadcn names; components are added with
  `npx shadcn add` as each phase needs them (none needed for the hello page).
- **2026-11-07 Phase 1 scope:** data tables only (Section 9 minus user tables). Auth, profiles,
  subscriptions, chat, alerts, push and notification_queue arrive with Phases 5–7, because the
  auth library creates the `user` table they reference.
- **2026-11-07 Games are keyed by the nflverse `game_id`** (e.g. `2024_01_BAL_KC`); team ids
  1–32 are fixed by the seed (alphabetical). Legacy abbreviations OAK/SD/STL map to LV/LAC/LA,
  in the pipeline adapter and again server-side. Stadium ids are nflverse `stadium_id`s, with
  roof/surface/coordinates curated in `db/seed/reference-data.ts`.
- **2026-11-07 Seeds are a custom migration** rendered from TS (`npm run db:seed-sql`), because
  only the app itself can reach production MySQL. A test keeps file and data in sync.
- **2026-11-07 Append-only picks:** triggers allow only `is_current` 1→0, generated from the
  Drizzle column list and re-installed after every migration run. Installing them is
  best-effort (binlog may require SUPER on Hostinger): `/api/health` reports
  `db.appendOnly` = `triggers` | `app-layer`.
- **2026-11-07 `updated_at` columns are TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP**
  (Drizzle's DATETIME has no onUpdateNow), so they only move when a row really changes.
- **2026-11-07 Internal API signing:** `v1=HMAC-SHA256(INGEST_SECRET, "ts.METHOD.path?query.body")`,
  ±300 s window, shared test vector in both test suites. Ingest diffs incoming rows against
  stored ones and writes only changes. A per-season **digest endpoint** lets the pipeline prove
  that the DB matches nflverse exactly.
- **2026-11-07 GET route handlers call `await connection()`** before reading the request, so
  `cacheComponents` never prerenders them. Handlers live in `lib/internal/handlers.ts` so
  tests can call them directly.
- **2026-11-07 Model v1 = Elo-anchored LightGBM.** A linear Elo anchor (refit per training
  set) is LightGBM's `init_score` for win and margin; the trees learn corrections. Rounds,
  Platt calibration and σ come from an inner 3-season walk-forward. The design changed 4
  times while looking at the same backtest seasons; all runs are listed in
  docs/model-card.md. The edge over Elo is small (95% CI just includes zero): say so,
  never overclaim.
- **2026-11-07 No look-ahead by construction:** results count as data 4 h after kickoff,
  injury rows stamped after kickoff are ignored, every feature row has `data_asof`, and the
  jobs refuse to run if any `data_asof >= kickoff`. Leakage tests mutate future data.
- **2026-11-07 Win/margin models never see symmetric "scoring environment" features**
  (totals only), so SHAP reasons for a pick are always about the matchup.
- **2026-11-07 SHAP via LightGBM `pred_contrib`** (exact TreeSHAP), plus the anchor's linear
  terms. No `shap`/numba dependency.
- **2026-11-07 Model files live in GitHub Releases** (`model-<name>`), names are
  content hashes (same data → same name → no new version). `retrain.yml` publishes and
  registers; its weekly schedule retrains only in the offseason.
- **2026-11-07 Stadium data single source:** `db/seed/stadiums.json`, read by the TS seed
  and by the pipeline (`model/geo.py`) for travel and time-zone features.
- **2026-11-07 Picks:** `win_prob` is the picked team's probability (≥ 0.5) and
  `pred_spread` is the projected _home_ margin. A new version is appended only when the
  winner changes or the probability moves ≥ 5 points; kicked-off games are locked. The global
  hash chain covers the pick rows (not the explanation text); details in docs/internal-api.md.
- **2026-11-07 Explanations:** Claude via `messages.parse` with a pydantic `output_format`,
  model from `CLAUDE_MODEL_FAST` (no hardcoded model), effort `low`. EN first, then FR/ES
  written natively with EN as reference. Each locale is validated:
  - exactly 3 reasons of at most 20 words;
  - no betting or guarantee words (EN/FR/ES);
  - every number must appear in the facts.

  An answer that fails gets one retry, then the SHAP template for that locale. Without
  `ANTHROPIC_API_KEY` + `CLAUDE_MODEL_FAST` everything uses templates.

- **2026-11-07 SHAP drivers never include factors at their neutral value** (no QB change,
  equal injuries, ...), and home-field advantage (the anchor's intercept) is its own driver.
- **2026-11-07 Injury timestamps:** nflverse injury rows have no `date_modified` from 2025
  on. Undated Out/Doubtful statuses are treated as published 24 h before kickoff. Before this
  fix the injury feature was silently zero for 2025–2026 (model-card run 5).
- **2026-11-07 Publishing is gated:** `publish_week.yml` publishes on schedule only when the
  repo variable `PUBLISH_ENABLED=true` (picks are permanent); otherwise it's a dry run with a
  `picks.json` artifact.
- **2026-11-07 Tests run file by file** (`fileParallelism: false`) because the integration
  tests share one test database.
- **2026-11-07 Public pages are static entries filled on first visit.** The build can't
  reach MySQL, so no page with data may be prerendered:
  - Data reads are `use cache` functions in `lib/site/data.ts`, tagged with
    `lib/cache-tags.ts` and `cacheLife("hours")`. Ingests revalidate the tags.
  - Data routes export `ensureStatic = "navigation"` and a placeholder
    `generateStaticParams` (`"_"`, which 404s before any data access). Real params render on
    the first visit, then are served as `x-nextjs-cache: HIT`.
  - Home and record have no dynamic param (and the locale must be listed at build), so
    `proxy.ts` rewrites `/[locale]` and `/[locale]/record` to `/[locale]/ez-view/[view]`.
    Direct visits to `ez-view` get a 404.
  - Never use `connection()`, `Date.now()` or other request-time APIs in pages (except
    `sitemap.ts`). Clock-dependent UI ("Locked at kickoff") is client-side via
    `components/after-kickoff.tsx`; kickoff times render in the visitor's time zone via
    `components/local-time.tsx` (Eastern on the server).
  - Measured locally (warm): 146 req/s at 50 users, p95 473 ms; before (per-request
    rendering) 18 req/s, p95 6 s. Production, 50 users from Europe: 0 errors, p95 863 ms.
- **2026-11-07 Client JavaScript is kept minimal** (Lighthouse TBT): no next-intl in the
  browser (server `components/locale-link.tsx`, translated props, no
  NextIntlClientProvider), one `LocalTimes` rewriter for all kickoff times, no prefetch on
  header/week links. Lighthouse: accessibility, best practices and SEO are 100. Mobile
  performance measured 77–97 on the dev machine, which is too slow for Lighthouse's 4x
  CPU throttling (benchmark 750–1430). Confirm with `lighthouse.yml` (PageSpeed Insights;
  set the `PSI_API_KEY` secret). GitHub runners can't run Lighthouse against production:
  Hostinger's bot filter returns 403 to datacenter browsers.
- **2026-11-07 Grading happens on the site** from stored scores, after every games ingest
  and via `ingest/results` (`grade_picks.yml`, Mon/Tue/Fri 07:00 UTC). Ties are
  `correct_winner = false` but shown as ties. ATS/totals are not tracked (no market
  lines); the record page says so.
- **2026-11-07 Team pages** show the model's own Elo and season-to-date EPA ranks, posted by
  `grade_picks` to `ingest/team-stats` (computed by `model/team_stats.py`).
- **2026-11-07 Team colors appear only as small swatches**; probability bars use the accent
  color for the pick, so dark team colors stay readable in dark mode. No logos.
- **2026-11-07 Auth = Better Auth 1.7** (magic link via Resend + Google), sessions in MySQL.
  Its core tables are hand-written in `db/schema.ts` (snake_case columns, Better Auth
  property names); `tests/auth.test.ts` signs in end to end to prove the mapping. Every
  user gets a `profiles` row (database hook); `ADMIN_EMAILS` get the admin role. Auth is
  created lazily (`getAuth()`), so the build needs no secret; without one, `/api/auth`
  answers 503.
- **2026-11-07 Sign-in is email + password** (user request: no email on every sign-in).
  - A new account confirms its email once (`requireEmailVerification`), which prevents
    someone from registering another person's address with their own password.
  - Password reset sends an email link that lands on `/[locale]/reset-password`. It also
    sets a first password on accounts created by magic link.
  - The emailed one-time link stays available as a secondary option.
  - Better Auth's rate limits (stricter on sign-in and reset) run in production only,
    keyed on `x-forwarded-for`.
  - Sessions last 30 days.
- **2026-11-07 No auth or i18n code in the browser.** Pages stay cached HTML shared by
  everyone. Per-viewer parts are small client components that call `/api/me` and
  `/api/pro/game`; sign-in posts to Better Auth's endpoints with plain `fetch`.
- **2026-11-07 Free plan "3 full breakdowns a week" = the week's 3 night games** (latest
  US Eastern kickoff times: normally Thursday, Sunday and Monday night;
  `lib/site/free-games.ts`). The same for everyone, needs no account (spec: "no wall"), and
  keeps those breakdowns cached and indexable. On the other games the HTML has only the top
  reason; reasons 2–3, matchup notes and the Pro projections (margin, total, SHAP drivers)
  come from `/api/pro/game`, gated by `lib/authz.ts`.
- **2026-11-07 Billing:** Stripe Checkout (subscription mode for both prices; the season pass
  is a yearly price), Customer Portal and webhooks. `profiles.plan` is only ever set by the
  webhook sync (Pro = `trialing`, `active` or `past_due`).
  - Webhooks are idempotent through `stripe_events` (in the same transaction) and
    order-safe through `subscriptions.event_created_at`.
  - The trial is offered once per account.
  - Cookie-authenticated POST/PATCH routes check `Origin` (`sameOrigin`).
  - Setup is in docs/deployment.md §5c.
- **2026-11-07 Payments deferred** (the user may switch away from Stripe). The Stripe code is
  isolated in `lib/billing/` (checkout, portal, webhook sync); the rest of the app only
  reads `profiles.plan`. Until billing env vars exist, `/api/me` reports `billing: false`
  and the pricing page says Pro opens soon. Phase 5 acceptance (test-mode
  purchase/upgrade/cancel) is still open.
- **2026-11-07 Assistant = manual streaming tool loop** (`lib/chat/assistant.ts`) on
  `CLAUDE_MODEL_CHAT` (production: `claude-haiku-5-5`), not the beta tool runner. That
  gives simple control of the 85 s deadline (AbortController): max 6 turns, 1500 tokens
  per turn, cached system prompt.
  - Its 7 tools (`lib/chat/tools.ts`) read the same cached data as the pages and apply
    `lib/authz.ts`, so a free user's assistant can't reveal Pro reasons or projections.
  - `/api/chat` streams NDJSON (`start`, `text`, `tool`, `done`).
  - Signed-in users only. Quota: questions per UTC day counted in `chat_messages`
    (`CHAT_LIMIT_FREE` 3, `CHAT_LIMIT_PRO` 50, admins 500). A failed answer gives the
    question back.
  - Threads are readable only by their owner; tokens are logged per answer.
- **2026-11-07 Live updates (Phase 7).** Watchers post to the site, then run `publish_week`.
  The site only versions a pick on a material change.
  - `injury_watch` (nflverse reports plus the listed starting QBs) and `weather_watch`
    (Open-Meteo, outdoor games within 72 h) do the posting.
  - Admin overrides live in `injuries` with `source = admin` and reach the model through
    `/api/internal/export` (`pipeline/endzoneiq_pipeline/live.py`).
  - A starting QB marked out is replaced by an unknown backup (that's what `qb_delta`
    measures). QBs weigh 0 in `injury_diff` by design.
  - Saving an override dispatches `repredict.yml` through the GitHub API
    (`GITHUB_TOKEN`, fine-grained, Actions only).
- **2026-11-07 Alerts:** pick-change alerts go to Pro users and admins (push on by default
  once a device is registered, email opt-in), for followed teams (none = all). The weekly
  email is opt-in for everyone.
  - Alerts are queued with a unique dedupe key and sent immediately after the ingest that
    created them; `cron/notifications` is the backstop.
  - A queue row is claimed by one worker (`queued` → `sending`). 404/410 push endpoints are
    deleted.
  - Notification text lives in `lib/notify/copy.ts`, not messages/, because it's built
    outside page renders.
- **2026-11-07 Admin is `/admin`, English only**, with its own root layout outside
  `[locale]`. Non-admins get a 404, and admin APIs answer 404 too. Every override and
  re-predict is written to `audit_log`.
