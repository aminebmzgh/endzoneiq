#!/usr/bin/env bash
# Upload a prebuilt archive to Hostinger and activate it through the Hostinger API.
# Used by .github/workflows/deploy.yml and rollback.yml.
#
#   scripts/hostinger-deploy.sh <archive.tar.gz>
#
# Required env:
#   HOSTINGER_API_TOKEN   hPanel API token (GitHub secret)
#   HOSTINGER_USERNAME    hosting account username, e.g. u123456789 (GitHub variable)
#   HOSTINGER_WEBSITE     domain of the Node.js web app, e.g. endzoneiq.com (GitHub variable)
# Optional env:
#   NODE_MAJOR            Node.js major configured on Hostinger (default 24)
#   BUILD_TIMEOUT_S       how long to wait for Hostinger's (no-op) build (default 900)
#
# API reference: https://developers.hostinger.com (Hosting > Files > Generate upload URL,
# Hosting > Node.js > Start build / Get build / Get build logs / Restart).
set -euo pipefail

ARCHIVE="${1:?usage: hostinger-deploy.sh <archive>}"
: "${HOSTINGER_API_TOKEN:?HOSTINGER_API_TOKEN is not set}"
: "${HOSTINGER_USERNAME:?HOSTINGER_USERNAME is not set}"
: "${HOSTINGER_WEBSITE:?HOSTINGER_WEBSITE is not set}"
NODE_MAJOR="${NODE_MAJOR:-24}"
BUILD_TIMEOUT_S="${BUILD_TIMEOUT_S:-900}"

API="https://developers.hostinger.com"
SITE_PATH="/api/hosting/v1/accounts/${HOSTINGER_USERNAME}/websites/${HOSTINGER_WEBSITE}"
# Unique name per upload, so a rollback never collides with the live archive.
REMOTE_NAME="endzoneiq-deploy-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}.tar.gz"

api() { # api METHOD PATH [JSON]
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS --fail-with-body --retry 3 --retry-delay 5 -X "$method"
    -H "Authorization: Bearer ${HOSTINGER_API_TOKEN}"
    -H "Accept: application/json")
  if [[ -n "$body" ]]; then args+=(-H "Content-Type: application/json" --data "$body"); fi
  curl "${args[@]}" "${API}${path}"
}

# Responses may or may not be wrapped in {"data": ...}; unwrap either way.
jget() { jq -r "(.data // .) | $1 // empty"; }

echo "::group::1. Generate upload URL"
UPLOAD_JSON=$(api POST /api/hosting/v1/files/upload-urls \
  "$(jq -nc --arg u "$HOSTINGER_USERNAME" --arg d "$HOSTINGER_WEBSITE" '{username:$u, domain:$d}')")
UPLOAD_URL=$(echo "$UPLOAD_JSON" | jget '.url')
AUTH_KEY=$(echo "$UPLOAD_JSON" | jget '.auth_key')
REST_AUTH_KEY=$(echo "$UPLOAD_JSON" | jget '.rest_auth_key')
[[ -n "$UPLOAD_URL" && -n "$AUTH_KEY" ]] || { echo "Unexpected upload-url response: $UPLOAD_JSON" | sed 's/"auth_key":"[^"]*"/"auth_key":"***"/g'; exit 1; }
echo "::add-mask::$AUTH_KEY"
echo "::add-mask::$REST_AUTH_KEY"
echo "::endgroup::"

echo "::group::2. Upload archive (TUS 1.0.0)"
SIZE=$(stat -c%s "$ARCHIVE")
TARGET="${UPLOAD_URL%/}/${REMOTE_NAME}?override=true"
curl -sS --fail-with-body -o /dev/null -w "create: HTTP %{http_code}\n" -X POST "$TARGET" \
  -H "X-Auth: ${AUTH_KEY}" -H "X-Auth-Rest: ${REST_AUTH_KEY}" \
  -H "Tus-Resumable: 1.0.0" -H "Upload-Length: ${SIZE}" -H "Upload-Offset: 0"
OFFSET=$(curl -sS --fail-with-body -D - -o /dev/null -X PATCH "$TARGET" \
  -H "X-Auth: ${AUTH_KEY}" -H "X-Auth-Rest: ${REST_AUTH_KEY}" \
  -H "Tus-Resumable: 1.0.0" -H "Content-Type: application/offset+octet-stream" \
  -H "Upload-Offset: 0" --data-binary "@${ARCHIVE}" \
  | tr -d '\r' | awk -F': ' 'tolower($1)=="upload-offset"{print $2}')
echo "uploaded ${OFFSET:-?}/${SIZE} bytes as ${REMOTE_NAME}"
[[ "${OFFSET}" == "${SIZE}" ]] || { echo "Upload incomplete"; exit 1; }
echo "::endgroup::"

echo "::group::3. Start Node.js build (no-op: package is prebuilt)"
BUILD_BODY=$(jq -nc --arg a "$REMOTE_NAME" --argjson n "$NODE_MAJOR" '{
  source_type: "archive",
  source_options: { archive_path: $a },
  app_type: "other",
  entry_file: "start.js",
  build_script: "build",
  node_version: $n,
  package_manager: "npm"
}')
BUILD_JSON=$(api POST "${SITE_PATH}/nodejs/builds" "$BUILD_BODY")
BUILD_UUID=$(echo "$BUILD_JSON" | jget '.uuid')
[[ -n "$BUILD_UUID" ]] || { echo "Unexpected start-build response: $BUILD_JSON"; exit 1; }
echo "build uuid: $BUILD_UUID"
echo "build_uuid=$BUILD_UUID" >> "${GITHUB_OUTPUT:-/dev/null}"
echo "::endgroup::"

echo "::group::4. Wait for Hostinger build"
deadline=$((SECONDS + BUILD_TIMEOUT_S))
delay=5
LOG_LINE=0
STATE=""
while (( SECONDS < deadline )); do
  STATE=$(api GET "${SITE_PATH}/nodejs/builds/${BUILD_UUID}" | jget '.state')
  LOGS=$(api GET "${SITE_PATH}/nodejs/builds/${BUILD_UUID}/logs?from_line=${LOG_LINE}" || echo '{}')
  echo "$LOGS" | jq -r '(.data // .) | (.content // .logs // empty) | if type=="array" then .[] else . end' 2>/dev/null || true
  NEW_LINE=$(echo "$LOGS" | jq -r '(.data // .) | .lines // empty' 2>/dev/null || true)
  [[ -n "$NEW_LINE" ]] && LOG_LINE="$NEW_LINE"
  echo "state: ${STATE:-unknown}"
  case "$STATE" in
    completed) break ;;
    failed)
      echo "::error::Hostinger build failed"
      api GET "${SITE_PATH}/nodejs/builds/${BUILD_UUID}/analysis" || true
      exit 1 ;;
  esac
  sleep "$delay"
  (( delay < 30 )) && delay=$((delay * 2))
done
[[ "$STATE" == "completed" ]] || { echo "::error::Timed out waiting for Hostinger build"; exit 1; }
echo "::endgroup::"

echo "::group::5. Restart application"
api POST "${SITE_PATH}/nodejs/server/restart" >/dev/null || echo "restart call failed (the build usually restarts the app anyway)"
echo "::endgroup::"
