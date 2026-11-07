# EndzoneIQ — project memory for Claude Code

**EndzoneIQ** (endzoneiq.com) helps NFL fans understand every game in 60 seconds: a pick, a
win probability, a confidence tier and three plain-English reasons built only from real model
data. It has a public, hash-chained track record, an AI assistant, and English/French/Spanish
from day one. Fan-first analysis, **not** a betting app.

Full spec: `endzoneiq-claude-code-prompt.md` (Section 13 = build phases). Out-of-scope ideas go
in `BACKLOG.md`, never into the code.

@AGENTS.md

## Status

| Phase             | Status                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| 0 Setup           | ✅ Done 2026-11-07. Live at https://endzoneiq.com, deployed by GitHub Actions |
| 1 Data foundation | Not started                                                                   |
| 2–8               | Not started                                                                   |

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
app/[locale]/        localized pages (root layout lives here; html lang = locale)
app/api/             route handlers (/api/health; /api/internal/* from Phase 1)
components/          UI components
i18n/                next-intl routing, request config, navigation helpers
messages/            en.json, fr.json, es.json (keys must match; tested)
lib/                 server code: env.ts (zod, server-only), db/, health.ts
db/                  schema.ts, migrator.ts, migrations/ (generated SQL, committed)
deploy/              start.js + package.json shipped in the deploy archive
scripts/             packaging, Hostinger deploy, smoke test, secret scan, local migrate
pipeline/            Python package endzoneiq_pipeline + tests (uv project)
docs/                deployment.md (more docs per phase)
.github/workflows/   ci.yml, deploy.yml, rollback.yml
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

# Production package, same as CI:
npm run build && npm run check:client-secrets && npm run build:migrator && npm run package

cd pipeline && uv sync && uv run pytest && uv run ruff check . && uv run ruff format --check .
```

`npm test` includes DB integration tests that skip themselves when no database is reachable.
CI runs them against a MariaDB service container.

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
- **2026-11-07 Build SHA** is baked in through `next.config.ts` `env.BUILD_SHA` (from
  `GITHUB_SHA`), so the smoke test can confirm exactly which commit is live.
- **2026-11-07 `www` → apex:** handled at DNS/hPanel, with a `next.config.ts` redirect as
  backup.
- **2026-11-07 Pipeline deps** are added per phase (Phase 0 has only httpx + pydantic) to
  keep CI fast. Python is managed with uv (`uv.lock` committed).
- **2026-11-07 Shadcn/ui:** design tokens use shadcn names; components are added with
  `npx shadcn add` as each phase needs them (none needed for the hello page).
