import { connection, NextResponse } from "next/server";
import { appendOnlyMode } from "@/db/triggers";
import { getPool } from "@/lib/db";
import { buildHealthReport } from "@/lib/health";

export async function GET() {
  await connection(); // always dynamic: never cache a health check

  const report = await buildHealthReport(
    async () => {
      const pool = getPool();
      const timed = async <T>(run: () => Promise<T>) => {
        const t0 = performance.now();
        const value = await run();
        return { value, ms: Math.round(performance.now() - t0) };
      };
      const [v, t] = await Promise.all([
        timed(() => pool.query("SELECT VERSION() AS version")),
        timed(() => appendOnlyMode(pool)),
      ]);
      const [versionRows] = v.value;
      const version = (versionRows as Array<{ version: string }>)[0]?.version ?? "unknown";
      return {
        version,
        appendOnly: t.value,
        timings: { versionMs: v.ms, triggersMs: t.ms },
      };
    },
    {
      sha: process.env.BUILD_SHA ?? "dev",
      builtAt: process.env.BUILD_TIME ?? "dev",
    },
  );

  return NextResponse.json(report, {
    status: report.db.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
