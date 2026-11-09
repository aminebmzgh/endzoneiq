# Runbook: operating EndzoneIQ in production

What to check, what runs when, and what to do when something breaks. Setup details live in
[deployment.md](deployment.md); the model in [model-card.md](model-card.md).

## Contents

1. [Daily health check](#1-daily-health-check)
2. [What runs when](#2-what-runs-when)
3. [Incidents](#3-incidents)
4. [Season calendar](#4-season-calendar)
5. [Errors and analytics](#5-errors-and-analytics)
6. [Privacy requests](#6-privacy-requests)
7. [Access and secrets](#7-access-and-secrets)

## 1. Daily health check

| Check              | How                                                                              | Healthy                                       |
| ------------------ | -------------------------------------------------------------------------------- | --------------------------------------------- |
| Site and database  | `curl https://endzoneiq.com/api/health`                                          | `status: ok`, `db.ok: true`, the expected SHA |
| Append-only picks  | same response, `db.appendOnly`                                                   | `triggers` (`app-layer` = triggers missing)   |
| Pipeline runs      | GitHub → Actions, or `/admin` → recent pipeline runs                             | last Refresh data and Grade picks green       |
| Hash chain         | the daily `integrity-check` cron; a failure emails the admins and goes to Sentry | no email                                      |
| Errors             | Sentry → Issues (when `SENTRY_DSN` is set)                                       | nothing new since yesterday                   |
| Live site vs. repo | `/api/health` `sha` = latest green Deploy run's commit                           | equal                                         |

Hostinger's bot filter answers 403 to some datacenter clients. If `curl` from a server gets
403, check from a normal browser before assuming an outage.

## 2. What runs when

All GitHub Actions cron times are UTC and may start a few minutes late. Eastern-time
targets move by an hour with daylight saving time.

| Job                    | Where          | When (UTC)                                      | What it does                                                           |
| ---------------------- | -------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `refresh_data.yml`     | GitHub Actions | daily 11:00                                     | Schedules, results, rosters, injuries → ingest (grades finished games) |
| `grade_picks.yml`      | GitHub Actions | Mon, Tue, Fri 07:00                             | Results and team stats → grading                                       |
| `retrain.yml`          | GitHub Actions | Tue 09:00                                       | Full retrain only in the offseason; otherwise skipped                  |
| `publish_week.yml`     | GitHub Actions | Tue 15:00                                       | Predicts the next week, explanations, publishes picks                  |
| `injury_watch.yml`     | GitHub Actions | Wed–Sat every 2 h, Sun every 15 min 12:00–17:45 | Injury and QB changes → re-predict affected games                      |
| `weather_watch.yml`    | GitHub Actions | every 6 h at :30                                | Outdoor games within 72 h → re-predict on a material change            |
| `repredict.yml`        | GitHub Actions | from `/admin` (override saved)                  | Re-predicts one game                                                   |
| `cron/notifications`   | Hostinger cron | every 5 min                                     | Sends queued push/email alerts (backstop; most go out immediately)     |
| `cron/weekly-email`    | Hostinger cron | Tuesdays (checks 12:00–16:00 ET)                | Weekly picks email to subscribers, once per week                       |
| `cron/integrity-check` | Hostinger cron | daily 03:00                                     | Re-verifies the public hash chain                                      |
| `cron/cleanup`         | Hostinger cron | daily 04:00                                     | Expired sessions/links, 90-day ingest log, 30-day notifications        |

Publishing is permanent. Scheduled publishing and watcher re-predictions only write when the
repository variable `PUBLISH_ENABLED=true`; otherwise they are dry runs with a `picks.json`
artifact.

## 3. Incidents

### Site down or `/api/health` returns 503

1. `curl -i https://endzoneiq.com/api/health`. A 503 with `db.ok: false` means MySQL; 5xx
   without JSON means the Node app.
2. hPanel → the Node.js app → **Runtime logs**. Look for `[start]`, `[migrate]` and stack
   traces. A failed migration stops the app on purpose.
3. If the last deploy caused it, **roll back** (below). If MySQL is down, check hPanel →
   Databases; Hostinger support handles server-side outages.
4. If the processes look stuck, re-run the latest green Deploy run (`gh run rerun <id>`).
   The hPanel/API "restart" does not replace the `next-server` processes.

### Roll back a bad deploy

```bash
gh run list --workflow deploy.yml --limit 10      # find the last good run ID
gh workflow run rollback.yml -f run_id=<RUN_ID>   # re-uploads that package, no rebuild
gh run watch                                      # smoke test must pass
curl https://endzoneiq.com/api/health             # sha = the restored commit
```

Migrations are forward-only and backward-compatible, so an older build runs against the
newer schema. The next push to `main` deploys forward again. Rolling back does not undo
data: picks are append-only by design.

### Live site doesn't match the deployed SHA

Orphaned Node processes from a deleted or re-created site can keep serving old code. Over
SSH (`ssh endzoneiq-ssh`): `ps -u $USER -o pid,lstart,args` and
`readlink /proc/<pid>/cwd`; kill processes whose cwd is under `domains/.removed-*`.

### Changed environment variables have no effect

Saving variables in hPanel or through the API does not restart the running processes.
Re-run the latest Deploy workflow. `NEXT_PUBLIC_*` values are baked in at build time and
must also be GitHub Actions variables; they need a new build (push or **Run workflow**).

### A pipeline workflow failed

Open the run in GitHub Actions. Every job is idempotent: re-run it once the cause is fixed.

- **401 from the site:** `INGEST_SECRET` differs between GitHub and Hostinger.
- **403:** Hostinger's bot filter. Re-run later.
- **Refused to run because `data_asof >= kickoff`:** a look-ahead guard tripped; don't
  force it. Check the source data first.
- **nflverse late or down:** the next scheduled run catches up. Injury news can be entered
  by hand (below).

### Breaking news before kickoff (QB out, key injury)

`/admin` → injury override → save. That dispatches `repredict.yml`. The pick only gets a new
version if the winner changes or the probability moves at least 5 points. Kicked-off games
are locked. Every override is in `audit_log`.

### Hash chain verification failed

The admins get an email and Sentry an event. Treat it as serious: picks are append-only and
protected by triggers, so a broken chain means a manual change to the database or a bug.
Don't "fix" rows by hand. Compare `/api/internal/export` and the `picks` rows over SSH,
find the first bad version, and document what happened publicly on the record page if a
published pick was affected.

### Alerts not arriving

- Push: `/account` → "Send a test notification". Brave blocks push by default (the account
  page explains the setting). 404/410 endpoints are deleted automatically.
- Email: Resend dashboard → logs (domain endzoneiq.com).
- Stuck rows: `cron/notifications` re-queues rows stuck in `sending`.

### Assistant failing

Sentry source `chat` / `chat-tool`. Check `ANTHROPIC_API_KEY` and `CLAUDE_MODEL_CHAT`, then
the Anthropic status page. A failed answer gives the user their question back (the quota is
not used).

## 4. Season calendar

| When                   | What happens                                                                       | What to do                                                     |
| ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| After the Super Bowl   | The latest season's phase becomes `offseason`. Home shows offseason mode           | Nothing. Check the home page once                              |
| Offseason (Feb–Apr)    | `retrain.yml` does full retrains weekly; new model files are published as releases | Review the backtest; update model-card.md if the model changes |
| Schedule release (May) | A new season appears in `preseason`; home shows week 1 without picks               | Nothing                                                        |
| Tuesday before week 1  | First picks published; the weekly email ("Notify me at kickoff") goes out          | Watch the first `publish_week` run and the email cron          |
| During the season      | Everything in section 2                                                            | Daily health check                                             |

## 5. Errors and analytics

**Sentry** (`SENTRY_DSN`, server runtime only). `lib/observability/sentry.ts` posts errors
directly to Sentry's envelope API, no SDK:

- uncaught server errors (renders, route handlers) via `instrumentation.ts`;
- errors the code catches: assistant, tools, Stripe webhook, internal API, cron, alerts,
  account deletion, hash-chain failures (tag `source`);
- browser errors via `/api/client-error` (same-origin, 10/min per IP).

At most 30 events a minute, and the same error once a minute. Query strings are never sent.
Set the project's data retention to 90 days or less (the privacy policy says so).

**PostHog** (`NEXT_PUBLIC_POSTHOG_KEY`, EU host by default). Nothing is sent and no banner is
shown until the key exists at build time. With the key, visitors see a consent banner;
only after "Accept" does the browser send anonymous events (`$process_person_profile:
false`, random `ez-aid` id, no query strings, no user ids):

| Event              | When                                    |
| ------------------ | --------------------------------------- |
| `$pageview`        | every page (client-side navigation too) |
| `sign_up`          | sign-up form submitted successfully     |
| `sign_in`          | password sign-in succeeded              |
| `chat_question`    | an assistant question was accepted      |
| `push_enabled`     | push notifications turned on            |
| `checkout_started` | redirect to the payment provider        |
| `offseason_notify` | "Notify me at kickoff" turned on        |

Set PostHog's data retention to 12 months or less (privacy policy). Turn off session
replay, autocapture and person profiles in the project settings; this client doesn't use them.

## 6. Privacy requests

- **Export and deletion** are self-service on `/account` ("Your data", "Delete account").
  Deletion cancels live Stripe subscriptions first, then deletes the `user` row (every user
  table cascades) and writes `account.delete` to `audit_log` with the user id only.
- **By email** (`hello@endzoneiq.com`): verify the sender owns the account's address, then do
  it from their account or, for deletion, ask them to use the button. Answer within a month.
- **PostHog** events are anonymous and not linked to accounts; a visitor clears them by
  declining analytics (the id is deleted).

## 7. Access and secrets

- **GitHub:** `aminebmzgh/endzoneiq`. Secrets: `HOSTINGER_API_TOKEN`, `INGEST_SECRET`,
  `ANTHROPIC_API_KEY`. Variables: `DEPLOY_ENABLED`, `PUBLISH_ENABLED`,
  `NEXT_PUBLIC_SITE_URL`, `SITE_URL`, `HOSTINGER_*`, `CLAUDE_MODEL_FAST`, and once set
  `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`.
- **Hostinger env vars:** source of truth is `C:\Users\Amine\.endzoneiq\production.env`
  (outside the repo). The API replaces the whole set: always send every key.
- **SSH:** `ssh endzoneiq-ssh` (key `~/.ssh/endzoneiq_hostinger`). Remote MySQL stays off;
  verify production state through `/api/health`, `/api/me` and the signed internal API.
- **Rotation:** after rotating `INGEST_SECRET`, update GitHub and Hostinger together.
  Rotating `BETTER_AUTH_SECRET` signs everyone out. Rotating the VAPID keys drops every push
  subscription.
