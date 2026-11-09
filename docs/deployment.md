# Deployment guide (GitHub Actions → Hostinger)

Hostinger never compiles EndzoneIQ. GitHub Actions lints, type-checks, tests and builds the
app, packages a ready-to-run archive, uploads it through the Hostinger API, and smoke-tests
`/api/health`. Hostinger's "build" step is `echo prebuilt`.

```
push to main ─► CI (lint, types, vitest + MariaDB, ruff, pytest)
             ─► next build (standalone) ─► secret scan ─► package .tar.gz (artifact, last 10 kept)
             ─► Hostinger API: upload URL → TUS upload → start build (no-op) → poll → restart
             ─► smoke test: GET /api/health must report this commit's SHA and db.ok = true
```

## Contents

1. [Package layout](#1-package-layout)
2. [One-time Hostinger setup](#2-one-time-hostinger-setup)
3. [One-time GitHub setup](#3-one-time-github-setup)
4. [Day-to-day deploys and rollback](#4-day-to-day-deploys-and-rollback)
5. [Database migrations](#5-database-migrations)
   - [5b. Data pipeline](#5b-data-pipeline-github-actions--internal-api)
   - [5c. Sign-in, email and payments](#5c-sign-in-email-and-payments-phase-5)
6. [Cron jobs (hPanel)](#6-cron-jobs-hpanel)
   - [6b. Errors and analytics](#6b-errors-and-analytics-phase-8)
7. [Fallback if Hostinger rejects the prebuilt package](#7-fallback-if-hostinger-rejects-the-prebuilt-package)
8. [Upgrade path](#8-upgrade-path)

---

## 1. Package layout

`scripts/package-standalone.sh` builds this archive (about 9 MB; Hostinger's limit is 50 MB):

| Path              | What it is                                                                       |
| ----------------- | -------------------------------------------------------------------------------- |
| `package.json`    | No dependencies. `"build": "echo prebuilt"`, `"start": "node start.js"`          |
| `start.js`        | **Entry file.** Runs pending migrations under a MySQL lock, then starts Next.js  |
| `migrate.cjs`     | Migration runner, bundled with drizzle-orm + mysql2 (no `node_modules` needed)   |
| `migrations/`     | Drizzle SQL migrations + `meta/_journal.json`                                    |
| `build-info.json` | Git SHA, build time, Actions run ID                                              |
| `server/`         | Next.js standalone output: `server.js`, traced `node_modules`, `.next`, `public` |

The Next.js server sits in `server/`, not at the root, on purpose: if Hostinger runs
`npm install` against the root `package.json` (which has no dependencies), npm would prune any
root `node_modules` it doesn't recognise. `server/node_modules` is out of its reach.

`start.js` runs the migrations and the server **in one process** (no child processes, because
the shared plan caps processes and threads).

## 2. One-time Hostinger setup

### 2.1 Database

A database already exists on the account: **`u701027769_endzoneiq`** (user
`u701027769_endzoneiq`). It has the `TRIGGER` privilege, which the append-only `picks` table
uses in Phase 1.

1. hPanel → **Databases → Management**. If you don't know the user's password, set a new one
   there (use a long random password).
2. **Do not** enable Remote MySQL / "Any Host". The app connects locally; GitHub Actions goes
   through the internal API instead.
3. Your `DATABASE_URL` for the app is:
   ```
   mysql://u701027769_endzoneiq:<PASSWORD>@127.0.0.1:3306/u701027769_endzoneiq
   ```
   Use `127.0.0.1`, not `localhost` (Node may resolve `localhost` to IPv6 `::1`). URL-encode
   any special characters in the password.

### 2.2 Create the Node.js Web App (from an archive, not from GitHub)

The domain must first be on the hosting plan.

1. hPanel → **Websites → Add website → Node.js Web App**, domain **`endzoneiq.com`**.
2. Choose **Upload files** (archive), **not** "Connect GitHub". Hostinger must never auto-build
   from the repository.
3. Upload `endzoneiq-deploy.tar.gz`. Get it from the first CI run: **Actions → Deploy → latest
   run → Artifacts → `deploy-package`** (it downloads as a zip; upload the `.tar.gz` inside).
4. Build settings:

   | Setting          | Value                               |
   | ---------------- | ----------------------------------- |
   | Framework preset | **Other**                           |
   | Node.js version  | **24** (must match `.nvmrc` and CI) |
   | Root directory   | `.` (default)                       |
   | Build command    | `build` (runs `echo prebuilt`)      |
   | Output directory | empty                               |
   | Entry file       | **`start.js`**                      |
   | Package manager  | npm                                 |

5. Deploy. Hostinger runs the no-op build and starts `start.js`.

### 2.3 Environment variables (hPanel → the Node.js app → Environment variables)

Set the server-only values from `.env.example` **here only**, never in GitHub. For Phase 0
you need:

| Key                    | Value                   |
| ---------------------- | ----------------------- |
| `DATABASE_URL`         | see 2.1                 |
| `NEXT_PUBLIC_SITE_URL` | `https://endzoneiq.com` |
| `NODE_ENV`             | `production`            |

Later phases add the rest (`BETTER_AUTH_SECRET`, `STRIPE_*`, `ANTHROPIC_API_KEY`,
`INGEST_SECRET`, `CRON_SECRET`, ...). Saving env vars restarts the app. `NEXT_PUBLIC_*` values
are baked in at build time, so changing one also needs a new deploy (push to `main` or run
the Deploy workflow manually).

### 2.4 API token

hPanel → **Profile → API** (`https://hpanel.hostinger.com/profile/api`) → create a token.
Store it **only** as the GitHub secret `HOSTINGER_API_TOKEN`.

### 2.4b Where production secrets live

The production values for `DATABASE_URL` (and its password), `INGEST_SECRET` and
`CRON_SECRET` were generated on the developer machine into
`C:\Users\Amine\.endzoneiq\production.env` (outside the repo, never committed). That file is
the source of truth: the Hostinger "replace environment variables" API replaces the **whole**
set and only returns masked values, so every update must resend all keys from that file.
Back it up in a password manager.

### 2.5 `www` → apex redirect

Only `endzoneiq.com` should be the canonical host.

Current DNS (set by Hostinger, leave as is): `@` is an `ALIAS` to
`endzoneiq.com.cdn.hstgr.net.` and `www` is a `CNAME` to `www.endzoneiq.com.cdn.hstgr.net.`.
Both go through Hostinger's CDN to the same single Node.js app (one process set, not two).
Re-pointing `www` away from the CDN can break its SSL, so don't.

The redirect is done in the app: `next.config.ts` 301s any request whose host is
`www.endzoneiq.com` to `https://endzoneiq.com`. Optionally also add an hPanel redirect if
offered for Node.js apps.

### 2.6 SSL

hPanel → **Security → SSL**: make sure the free certificate covers `endzoneiq.com` and
`www.endzoneiq.com`, and turn on **Force HTTPS**.

## 3. One-time GitHub setup

Repository → **Settings → Secrets and variables → Actions**.

**Secrets**

| Name                  | Used by                  |
| --------------------- | ------------------------ |
| `HOSTINGER_API_TOKEN` | deploy.yml, rollback.yml |
| `INGEST_SECRET`       | pipeline (Phase 1+)      |
| `ANTHROPIC_API_KEY`   | pipeline (Phase 3+)      |
| `ODDS_API_KEY`        | pipeline (optional)      |
| `SENTRY_AUTH_TOKEN`   | optional, source maps    |

**Variables**

| Name                                 | Value                              |
| ------------------------------------ | ---------------------------------- |
| `DEPLOY_ENABLED`                     | `true` once 2.2 is done            |
| `HOSTINGER_USERNAME`                 | `u701027769`                       |
| `HOSTINGER_WEBSITE`                  | `endzoneiq.com`                    |
| `NEXT_PUBLIC_SITE_URL`               | `https://endzoneiq.com`            |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Phase 5                            |
| `NEXT_PUBLIC_POSTHOG_KEY`            | Phase 8                            |
| `SITE_URL`                           | `https://endzoneiq.com` (pipeline) |
| `CLAUDE_MODEL_FAST`                  | Phase 3 (pipeline)                 |

Also create a GitHub **environment** named `production` (Settings → Environments). You can
add required reviewers there if you want to approve each deploy.

Until `DEPLOY_ENABLED` is `true`, pushes to `main` run all checks and build the package, but
skip the upload.

## 4. Day-to-day deploys and rollback

- **Deploy:** push or merge to `main`. Or run **Actions → Deploy → Run workflow**.
- **What blocks a deploy:** any lint, format, type, vitest, ruff or pytest failure; a server
  secret found in client assets; a package over 48 MB; a failed Hostinger build; a smoke test
  that doesn't see the new SHA with `db.ok: true` within 5 minutes.
- **Health check:** `curl https://endzoneiq.com/api/health` →
  `{"status":"ok","sha":"<commit>","db":{"ok":true,"version":"..."}}`. Returns 503 when the
  database is unreachable.
- **Rollback:** find the last good Deploy run ID (the number in its URL), then:
  ```bash
  gh workflow run rollback.yml -f run_id=<RUN_ID>
  ```
  It re-uploads that run's package (no rebuild) and smoke-tests it. The last 10 packages are
  kept.
- **Logs:** hPanel → the Node.js app → **Runtime logs**. Migration errors show up there with
  the `[start]` / `[migrate]` prefix.

## 5. Database migrations

- Change `db/schema.ts`, then run `npm run db:generate` and commit the SQL in `db/migrations/`.
- In production, `start.js` applies pending migrations at startup. It takes the MySQL named
  lock `endzoneiq_migrations` (`GET_LOCK`), so only one process migrates. If a migration fails,
  the app **does not start**, and the smoke test fails the deploy.
- **Write backward-compatible migrations** (add first, remove later): add new columns as
  nullable or with defaults, and drop old columns only in a later release. That way a
  rollback to the previous build still works against the newer schema.

**Manual fallback** (if startup migrations ever have to be bypassed):

1. Set `SKIP_MIGRATIONS=true` in hPanel env vars (the app restarts and skips migrations).
2. hPanel → Databases → **phpMyAdmin** → `u701027769_endzoneiq` → SQL tab. Run each pending
   file from `db/migrations/` in order. Statements are separated by
   `--> statement-breakpoint`.
3. Record each one so the migrator skips it later:
   `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('<sha256 of the .sql file>', <"when" from meta/_journal.json>);`
   (`sha256sum db/migrations/XXXX.sql` gives the hash.)
4. Remove `SKIP_MIGRATIONS`.

**Reference data** (teams, stadiums) is seeded by a migration
(`0002_seed_teams_stadiums.sql`, rendered from `db/seed/reference-data.ts` with
`npm run db:seed-sql`). To change it, edit the TS file, create a new custom migration
(`npx drizzle-kit generate --custom --name=...`), point `SEED_MIGRATION` in
`db/seed/render-sql.ts` at it and re-render. A test fails if the file and the data drift.

**Append-only picks:** after migrating, `start.js` (re)installs two triggers on `picks`
(`CREATE OR REPLACE TRIGGER`). If MariaDB refuses (binary logging can require SUPER), the
app logs `[migrate] WARNING: could not install picks triggers` and starts anyway; the picks
repository and the nightly integrity check still enforce append-only. `/api/health` shows
which mode is live: `db.appendOnly` is `"triggers"` or `"app-layer"`.

## 5b. Data pipeline (GitHub Actions → internal API)

The pipeline never connects to MySQL. It posts to `/api/internal/*`, signed with
`INGEST_SECRET` (the same value in hPanel env vars and in GitHub secrets). The contract is in
[internal-api.md](internal-api.md).

- `refresh_data.yml` runs daily (11:00 UTC) and syncs the current season.
- **Full backfill (2012 → today):** Actions → _Refresh data_ → _Run workflow_ with
  `from_season = 2012`. Takes about a minute. Re-running is safe: unchanged games are not
  written again.
- Every run compares a per-season digest from the site with one computed from nflverse and
  fails on any mismatch. Each run is recorded in `pipeline_runs`, each API call in `ingest_log`.

## 5c. Sign-in, email and payments (Phase 5)

All of these are hPanel environment variables (runtime only, never GitHub). Until they're set
the site works as before: sign-in says it isn't available yet (`/api/auth` answers 503) and
the pricing buttons say payments aren't available (`/api/billing/*` answer 503).

**Auth (Better Auth).**

- `BETTER_AUTH_SECRET`: `openssl rand -hex 32`. Changing it signs everyone out.
- `BETTER_AUTH_URL=https://endzoneiq.com`
- `ADMIN_EMAILS`: comma-separated; these accounts get the admin role.

**Google sign-in (optional).** Google Cloud console → APIs & Services → Credentials →
OAuth client ID (type "Web application").

- Authorized JavaScript origin: `https://endzoneiq.com`.
- Authorized redirect URI: `https://endzoneiq.com/api/auth/callback/google`.
- Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Without them only the email link is shown.

**Email (Resend), for magic links.**

1. resend.com → Domains → add `endzoneiq.com`.
2. Add the DNS records Resend shows (SPF/DKIM on a `send` subdomain) in Hostinger DNS.
3. Wait until the domain is verified.
4. Set `RESEND_API_KEY` and `EMAIL_FROM` (for example `EndzoneIQ <hello@endzoneiq.com>`).

**Stripe.** Start in test mode, then repeat with live keys.

1. Product "EndzoneIQ Pro" with two recurring prices: $7.99 / month and $39.99 / year (the
   season pass renews each year).
   - Their ids go in `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_PRO_SEASON`.
   - The prices shown on `/pricing` come from `messages/*.json` ("Pricing"); keep them in sync.
2. Developers → Webhooks → endpoint `https://endzoneiq.com/api/stripe/webhook`.
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
   - Its signing secret is `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → Customer portal: allow cancelling, switching between the two prices and
   updating the payment method.
4. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. The publishable key is
   unused for now; Checkout is a redirect.

How it fits together:

- The 7-day trial is offered on a user's first subscription only.
- `profiles.plan` is derived by the webhook from `subscriptions`. Statuses `trialing`,
  `active` and `past_due` keep Pro, so a failed card keeps access while Stripe retries.
- Webhooks are idempotent: event ids are stored in `stripe_events`, and older events never
  overwrite newer state.
- Test a webhook locally with
  `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## 6. Cron jobs (hPanel)

Added in Phase 7. hPanel → **Advanced → Cron Jobs**. Hostinger cron runs in the server's
timezone; check it in hPanel and convert from US Eastern. Store the secret in a file outside
`public_html` (for example `~/.endzoneiq_cron`, `chmod 600`, containing only the
`CRON_SECRET` value) so it never shows up in the cron list:

| Schedule                       | Command                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `*/5 * * * *`                  | `curl -fsS -X POST -H "Authorization: Bearer $(cat ~/.endzoneiq_cron)" https://endzoneiq.com/api/internal/cron/notifications`   |
| `*/5 * * * 2` (12:00–16:00 ET) | `curl -fsS -X POST -H "Authorization: Bearer $(cat ~/.endzoneiq_cron)" https://endzoneiq.com/api/internal/cron/weekly-email`    |
| daily 03:00                    | `curl -fsS -X POST -H "Authorization: Bearer $(cat ~/.endzoneiq_cron)" https://endzoneiq.com/api/internal/cron/integrity-check` |
| daily 04:00                    | `curl -fsS -X POST -H "Authorization: Bearer $(cat ~/.endzoneiq_cron)" https://endzoneiq.com/api/internal/cron/cleanup`         |

The weekly-email endpoint checks the Eastern time window itself (Tuesday 12:00–16:00 ET), so
the cron line can simply run every 15 minutes on Tuesdays.

**Phase 7 environment variables** (hPanel; then re-run the latest Deploy workflow, because
saving variables doesn't restart the running processes):

- `CRON_SECRET`: as above.
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`: web push. Generate with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"`. Changing them drops
  every existing push subscription.
- `GITHUB_TOKEN`: for the admin "Re-predict" button. Use a fine-grained personal access
  token with only this repository and **Actions: Read and write**. Optional, defaults
  shown: `GITHUB_REPO=aminebmzgh/endzoneiq`.

**GitHub Actions (pipeline):**

- `repredict.yml`: started by the admin screen.
- `injury_watch.yml`: Wednesday to Saturday every 2 h, Sunday morning every 15 min.
- `weather_watch.yml`: every 6 h.

They publish only when the repository variable `PUBLISH_ENABLED=true`, like `publish_week.yml`.

## 6b. Errors and analytics (Phase 8)

Both are optional: without them nothing is sent anywhere and the cookie banner doesn't
appear.

- **Sentry:** create a project (platform "Node.js"; EU data region if available), copy its
  DSN and add `SENTRY_DSN` to the Hostinger env vars (send the whole set from
  `production.env`), then re-run the latest Deploy workflow. Browser errors are forwarded by
  the server, so no `NEXT_PUBLIC_` DSN is needed. Set data retention to 90 days or less.
- **PostHog:** create a project in the **EU** region, copy the project API key (`phc_...`)
  and set it as the GitHub Actions **variable** `NEXT_PUBLIC_POSTHOG_KEY` (it is public and
  baked in at build time). `NEXT_PUBLIC_POSTHOG_HOST` defaults to
  `https://eu.i.posthog.com`. Push or run Deploy. In PostHog, turn off autocapture, session
  replay and person profiles, and set retention to 12 months or less.

Details and the event list: [runbook.md](runbook.md) §5.

## 7. Fallback if Hostinger rejects the prebuilt package

Phase 0 must confirm with a real deploy that Hostinger runs the package as-is. If it forces
its own `next build` or breaks the entry file, try in order:

1. **Adjust the preset, entry file or archive layout** until the prebuilt package runs as-is
   (for example the "Express" preset with entry `start.js`).
2. **`deploy` branch fallback:** CI runs all checks, then pushes the passing commit to a
   `deploy` branch, and Hostinger builds from that branch (Git deploy). CI still gates every
   release; Hostinger then does compile the app.

Never copy files over SSH/FTP into Hostinger's build folders: deployments overwrite them, and
npm can't run over SSH on this plan.

## 8. Upgrade path

The shared plan allows about 120 processes/threads across the account (one Next.js app uses
about 10–11), 120-second requests and no WebSockets. When Sunday traffic outgrows it:

1. **Hostinger Cloud Startup:** roughly double the process, CPU and RAM limits. Same
   deployment flow (same API), just a different plan.
2. **VPS** (Hostinger KVM or similar): run the same standalone package under systemd or PM2
   behind Nginx; move MySQL to the VPS or a managed DB.
3. **Vercel Pro:** native Next.js hosting; keep MySQL reachable through a private connection
   or move to a managed MySQL provider.

Signs it's time: 503s or slow responses on Sunday afternoons, "process limit reached" in
hPanel, or LCP over 2.5 s on 4G while pages are served from cache.
