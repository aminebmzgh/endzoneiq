// Fails the build if a server-only secret leaks into client bundles.
// Two layers: (1) `import "server-only"` in lib/env.ts and lib/db makes Next fail
// the build when they are imported from client code; (2) this scan of the emitted
// browser assets for server env var names and, when present, their actual values.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SERVER_ONLY_VARS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "INGEST_SECRET",
  "CRON_SECRET",
  "GITHUB_TOKEN",
  "VAPID_PRIVATE_KEY",
  "SENTRY_AUTH_TOKEN",
  "HOSTINGER_API_TOKEN",
];

const roots = [".next/static", "public"].filter((p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
});
if (!roots.includes(".next/static")) {
  console.error("check-client-secrets: .next/static not found; run `next build` first");
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|cjs|css|html|json|map|txt)$/.test(entry.name)) yield p;
  }
}

const needles = [];
for (const name of SERVER_ONLY_VARS) {
  needles.push({ label: `env var name ${name}`, value: name });
  const v = process.env[name];
  if (v && v.length >= 8) needles.push({ label: `value of ${name}`, value: v });
}

const hits = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const n of needles) if (text.includes(n.value)) hits.push(`${file}: ${n.label}`);
  }
}

if (hits.length) {
  console.error("Server secrets found in client assets:\n  " + hits.join("\n  "));
  process.exit(1);
}
console.log(`check-client-secrets: OK (${needles.length} patterns, ${roots.join(", ")})`);
