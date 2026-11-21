import { connection, NextResponse } from "next/server";
import { TRIGGER_STATUS_SQL } from "@/db/triggers";
import { getPool } from "@/lib/db";
import { buildHealthReport } from "@/lib/health";

export async function GET() {
  await connection(); // always dynamic: never cache a health check

  const report = await buildHealthReport(
    async () => {
      const pool = getPool();
      const timed = async (sql: string) => {
        const t0 = performance.now();
        const [rows] = await pool.query(sql);
        return { rows, ms: Math.round(performance.now() - t0) };
      };
      const [v, t] = await Promise.all([
        timed("SELECT VERSION() AS version"),
        timed(TRIGGER_STATUS_SQL),
      ]);
      const version = (v.rows as Array<{ version: string }>)[0]?.version ?? "unknown";
      const triggers = Number((t.rows as Array<{ n: number }>)[0]?.n ?? 0);
      return {
        version,
        appendOnly: triggers === 2 ? "triggers" : "app-layer",
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
