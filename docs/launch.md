# Launch checklist

Phase 8 acceptance (spec §13) plus the compliance and trust checklist (spec §16). An item is
checked only once it has been verified on production, with the date and how.

Status as of 2026-11-09: **not ready to sign off.** Open items are marked ☐ with what's
missing.

## Production and operations

- [x] **Production on Hostinger at https://endzoneiq.com with HTTPS.** `/api/health` reports
      `status: ok`, `db.ok: true`, MariaDB 11.8.9, `appendOnly: triggers` (2026-11-09).
- [x] **Deployed only through GitHub Actions.** `deploy.yml` on push to `main`, gated by
      `DEPLOY_ENABLED=true`; the smoke test checks the live SHA (Phase 0, 2026-11-07).
- [x] **Cron jobs configured.** Hostinger cron calls the four `cron/*` endpoints (notifications, weekly email,
      integrity check, cleanup) with the bearer from `~/.endzoneiq_cron` (Phase 7,
      2026-11-07). GitHub Actions schedules: see [runbook.md](runbook.md) §2.
- [x] **GitHub Actions secrets and variables set.** Secrets `HOSTINGER_API_TOKEN`,
      `INGEST_SECRET`, `ANTHROPIC_API_KEY`; variables `DEPLOY_ENABLED`, `PUBLISH_ENABLED`,
      `NEXT_PUBLIC_SITE_URL`, `SITE_URL`, `HOSTINGER_USERNAME`, `HOSTINGER_WEBSITE`,
      `CLAUDE_MODEL_FAST` (checked with `gh secret list` / `gh variable list`, 2026-11-09).
- [ ] **A rollback has been tested once.** Not yet: run `rollback.yml` against the previous
      green Deploy run, confirm `/api/health` shows the old SHA, then re-run the latest
      Deploy. Record the run IDs here.
- [x] **Runbook** in [runbook.md](runbook.md).
- [ ] **Rotate the credentials that appeared in chat transcripts** during setup (Hostinger
      API token, the production env values sent on 2026-11-07).

## Phase 8 features

- [x] **Legal pages** in EN/FR/ES: `/about` (methodology), `/terms`, `/privacy`,
      `/cookies`, `/responsible-gaming`, linked from every footer and listed in the sitemap.
- [ ] **Operator identity in the legal pages.** `lib/site/legal.ts` still holds
      placeholders: operator name, postal address, governing law. Fill them in, then check
      `hello@endzoneiq.com` actually receives mail.
- [ ] **Legal review.** The terms, privacy and cookie policies were drafted from what the
      code does; have them reviewed for the operator's country before launch.
- [x] **GDPR cookie consent.** Banner with equal "Accept" / "Decline", reopened from
      "Cookie settings" in the footer; nothing non-essential runs before consent. The banner
      only exists when analytics are configured.
- [ ] **PostHog events live.** Code done (events in runbook §5). Needs a PostHog EU project:
      set `NEXT_PUBLIC_POSTHOG_KEY` as a GitHub Actions variable, redeploy, accept the
      banner and see a `$pageview` arrive. Set retention ≤ 12 months.
- [ ] **Sentry live.** Code done. Needs a Sentry project: add `SENTRY_DSN` to the Hostinger
      env vars (whole set from `production.env`), re-run Deploy, trigger a test error and see
      it in Sentry. Set retention ≤ 90 days.
- [x] **Offseason mode.** From the Super Bowl until the next schedule, home shows the
      all-time record, how the model works (about page, model card) and "Notify me at
      kickoff" (the weekly email, sent when the first picks are published). Checked locally
      with the season set to `offseason`.
- [x] **404 page.** Localized for unknown games/teams/weeks; a trilingual page for URLs that
      match no route. Error boundaries report to Sentry.

## Compliance and trust (spec §16)

- [x] No NFL or team logos or official imagery. Non-affiliation notice in the footer of
      every page (tested in `tests/i18n-messages.test.ts`).
- [x] "For entertainment and informational purposes. Not betting advice." in the footer of
      every page (so under every pick) and in the assistant.
- [x] Betting-line content stays behind `FEATURE_ODDS` (off; no market data is used). The
      responsible-gaming page links to help resources and states the age limits.
- [x] The track record shows all picks, losses included. Locked picks are immutable
      (triggers), the hash chain is verified daily, both covered by tests.
- [x] No unverifiable accuracy claims in the copy. The about page says the edge over Elo is
      small and not statistically certain.
- [x] Privacy policy, GDPR cookie consent, **account deletion and data export** (self-service
      on `/account`, tested in `tests/account-data.test.ts`).
- [x] Remote MySQL access stays disabled. Internal endpoints are HMAC-signed and
      rate-limited.
- [x] Data-source terms respected: nflverse and Open-Meteo (CC BY 4.0) credited in every
      footer and on the about page. No scraping.

## Carried over from earlier phases

- [ ] **Lighthouse ≥ 90 on mobile** confirmed with `lighthouse.yml` (needs the
      `PSI_API_KEY` secret). Accessibility, best practices and SEO measured 100.
- [ ] **Payments (Phase 5 acceptance).** Provider decision pending; test-mode purchase,
      upgrade and cancel not yet done. The pricing page says Pro opens soon.
