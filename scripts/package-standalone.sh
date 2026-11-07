#!/usr/bin/env bash
# Assemble the prebuilt deploy package after `next build` + `npm run build:migrator`.
#
# Layout of the archive (extracted into the Hostinger app root):
#   package.json      no dependencies; "build": "echo prebuilt", "start": "node start.js"
#   start.js          entry file: run migrations, then require("./server/server.js")
#   migrate.cjs       bundled migration runner (drizzle-orm + mysql2 inlined)
#   migrations/       drizzle SQL migrations + meta/_journal.json
#   build-info.json   git SHA and build time
#   server/           Next.js standalone output (server.js, traced node_modules, .next, public)
#
# The standalone server lives in server/ (not the root) on purpose: if Hostinger runs
# `npm install` against the root package.json (no deps), npm would prune any root
# node_modules it does not recognise. server/node_modules is never touched.
set -euo pipefail

OUT_DIR="${1:-dist-deploy}"
ARCHIVE="${2:-endzoneiq-deploy.tar.gz}"
MAX_BYTES=$((48 * 1024 * 1024)) # Hostinger archive limit is 50 MB

[[ -f .next/standalone/server.js ]] || { echo "missing .next/standalone/server.js (run next build)"; exit 1; }
[[ -f dist-migrator/migrate.cjs ]] || { echo "missing dist-migrator/migrate.cjs (run npm run build:migrator)"; exit 1; }
[[ -f db/migrations/meta/_journal.json ]] || { echo "missing db/migrations (run npm run db:generate)"; exit 1; }

rm -rf "$OUT_DIR" "$ARCHIVE"
mkdir -p "$OUT_DIR/server/.next"

cp -R .next/standalone/. "$OUT_DIR/server/"
cp -R .next/static "$OUT_DIR/server/.next/static"
if [[ -d public ]]; then cp -R public "$OUT_DIR/server/public"; fi
# Never ship env files that may have been traced into the standalone folder.
find "$OUT_DIR/server" -maxdepth 1 -name ".env*" -delete

cp deploy/start.js deploy/package.json "$OUT_DIR/"
cp dist-migrator/migrate.cjs "$OUT_DIR/"
cp -R db/migrations "$OUT_DIR/migrations"

cat > "$OUT_DIR/build-info.json" <<EOF
{ "sha": "${GITHUB_SHA:-dev}", "builtAt": "${BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}", "runId": "${GITHUB_RUN_ID:-local}" }
EOF

tar -czf "$ARCHIVE" -C "$OUT_DIR" .
SIZE=$(wc -c < "$ARCHIVE" | tr -d ' ')
echo "Package: $ARCHIVE ($((SIZE / 1024)) KiB)"
if (( SIZE > MAX_BYTES )); then
  echo "ERROR: archive is larger than 48 MB; Hostinger rejects archives over 50 MB"
  exit 1
fi
