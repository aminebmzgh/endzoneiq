# Backlog (out of MVP scope)

Ideas that are deliberately **not** being built for the MVP. Add new ones here instead of
building them.

## From the spec (Section 17)

- Native mobile apps (iOS/Android)
- Live in-game win probability
- Player prop predictions
- Fantasy start/sit tool
- College football
- Social features and comments
- Public API
- More languages (beyond EN/FR/ES)
- Move to Hostinger Cloud / VPS hosting (only when traffic requires it; see `docs/deployment.md` §8)

## Added during the build

- Nonce store for the internal API, so a signed request can't be replayed even inside the
  5-minute window (today every ingest endpoint is idempotent instead).
- Shared rate-limit state if the site ever runs more than one Node process (the limiter is
  in-memory per process).
- Housekeeping: drop the unused Phase 0 `app_meta` table in a later migration.

- **Model v1.1: investigate the travel effect.** In 2026 week 9 the model credits away teams for
  long trips (LA at WAS: 3,719 km and 3 time zones gave the Rams +0.26 logit). Probably a spurious
  pattern or a neutral-site interaction. Explanations already hide drivers whose direction
  contradicts their evidence (`narrative.plausible`), but the model itself should be checked.
