import { connection, NextResponse } from "next/server";
import { TRIGGER_STATUS_SQL } from "@/db/triggers";
import { getPool } from "@/lib/db";
import { buildHealthReport } from "@/lib/health";

export async function GET() {
  await connection(); // always dynamic: never cache a health check

  const report = await buildHealthReport(
    async () => {
      const pool = getPool();
      const [[versionRows], [triggerRows]] = await Promise.all([
        pool.query("SELECT VERSION() AS version"),
        pool.query(TRIGGER_STATUS_SQL),
      ]);
      const version = (versionRows as Array<{ version: string }>)[0]?.version ?? "unknown";
      const triggers = Number((triggerRows as Array<{ n: number }>)[0]?.n ?? 0);
      return { version, appendOnly: triggers === 2 ? "triggers" : "app-layer" };
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
