#!/usr/bin/env node
/**
 * Simple load test (spec Phase 4: ~50 concurrent users). No dependencies.
 *
 *   node scripts/load-test.mjs https://endzoneiq.com [concurrency=50] [seconds=30]
 *
 * Each virtual user loops over the public pages (home, a week, a game, the record,
 * a team, in every locale) for the duration. Prints throughput, latency
 * percentiles and errors; exits 1 if any request failed or p95 > 2 s.
 */
const [base = "http://localhost:3000", conc = "50", secs = "30"] = process.argv.slice(2);
const concurrency = Number(conc);
const duration = Number(secs) * 1000;

async function discoverPaths() {
  const paths = ["/en", "/fr", "/es", "/en/record", "/fr/record", "/en/teams", "/es/teams/kc"];
  try {
    const xml = await (await fetch(`${base}/sitemap.xml`)).text();
    const games = [...xml.matchAll(/<loc>[^<]*?(\/(?:en|fr|es)\/game\/[^<]+)<\/loc>/g)].map(
      (m) => m[1],
    );
    paths.push(...games.slice(0, 12));
  } catch {
    // sitemap unavailable: static list only
  }
  return paths;
}

const latencies = [];
const errors = new Map();
let bytes = 0;

async function user(paths, until, offset) {
  let i = offset;
  while (Date.now() < until) {
    const path = paths[i++ % paths.length];
    const t0 = performance.now();
    try {
      const res = await fetch(base + path, { headers: { "user-agent": "endzoneiq-load-test" } });
      const body = await res.arrayBuffer();
      bytes += body.byteLength;
      if (!res.ok)
        errors.set(`${res.status} ${path}`, (errors.get(`${res.status} ${path}`) ?? 0) + 1);
    } catch (err) {
      const key = `ERR ${err.cause?.code ?? err.message}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
    }
    latencies.push(performance.now() - t0);
  }
}

const paths = await discoverPaths();
console.log(`${base}: ${concurrency} users for ${secs}s over ${paths.length} pages`);
const start = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, k) => user(paths, start + duration, k)));
const elapsed = (Date.now() - start) / 1000;

latencies.sort((a, b) => a - b);
const q = (p) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
const failed = [...errors.values()].reduce((a, b) => a + b, 0);
console.log(
  `requests ${latencies.length} (${(latencies.length / elapsed).toFixed(1)}/s), ` +
    `${(bytes / 1e6).toFixed(1)} MB, failed ${failed}`,
);
console.log(
  `latency ms: p50 ${q(0.5).toFixed(0)}, p90 ${q(0.9).toFixed(0)}, p95 ${q(0.95).toFixed(0)}, ` +
    `p99 ${q(0.99).toFixed(0)}, max ${q(1).toFixed(0)}`,
);
for (const [k, v] of errors) console.log(`  ${v} × ${k}`);
process.exit(failed > 0 || q(0.95) > 2000 ? 1 : 0);
