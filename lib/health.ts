export interface DbProbeResult {
  version: string;
  /** How picks are kept append-only: DB triggers, or only the app layer. */
  appendOnly: "triggers" | "app-layer";
}
export type DbProbe = () => Promise<DbProbeResult>;

export interface HealthReport {
  status: "ok" | "degraded";
  sha: string;
  builtAt: string;
  time: string;
  db: ({ ok: true; latencyMs: number } & DbProbeResult) | { ok: false; error: string };
}

const DB_TIMEOUT_MS = 3_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Build the health report. Never leaks connection strings or stack traces. */
export async function buildHealthReport(
  probe: DbProbe,
  build: { sha: string; builtAt: string },
  now: () => number = Date.now,
): Promise<HealthReport> {
  const started = now();
  let db: HealthReport["db"];
  try {
    const result = await withTimeout(probe(), DB_TIMEOUT_MS);
    db = { ok: true, ...result, latencyMs: now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // Strip anything that looks like a credentialed URL.
    db = { ok: false, error: message.replace(/mysql:\/\/\S+/gi, "mysql://***") };
  }
  return {
    status: db.ok ? "ok" : "degraded",
    sha: build.sha,
    builtAt: build.builtAt,
    time: new Date(now()).toISOString(),
    db,
  };
}
