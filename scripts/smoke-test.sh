#!/usr/bin/env bash
# Poll /api/health until it reports the expected git SHA and a healthy database.
#   scripts/smoke-test.sh <base-url> <expected-sha>
set -euo pipefail
BASE_URL="${1:?base url}"
EXPECTED_SHA="${2:?expected sha}"
ATTEMPTS="${SMOKE_ATTEMPTS:-30}"

for i in $(seq 1 "$ATTEMPTS"); do
  BODY=$(curl -sS --max-time 15 "${BASE_URL%/}/api/health?ts=$(date +%s)" || true)
  SHA=$(echo "$BODY" | jq -r '.sha // empty' 2>/dev/null || true)
  DB_OK=$(echo "$BODY" | jq -r '.db.ok // empty' 2>/dev/null || true)
  echo "attempt $i: sha=${SHA:-?} db.ok=${DB_OK:-?}"
  if [[ "$SHA" == "$EXPECTED_SHA" && "$DB_OK" == "true" ]]; then
    echo "$BODY" | jq .
    echo "Smoke test passed"
    exit 0
  fi
  sleep 10
done

echo "::error::Smoke test failed: ${BASE_URL}/api/health did not report sha=${EXPECTED_SHA} with a healthy database"
echo "Last response: ${BODY:-<none>}"
exit 1
