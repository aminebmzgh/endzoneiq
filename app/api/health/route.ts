import { connection, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { buildHealthReport } from "@/lib/health";

export async function GET() {
  await connection(); // always dynamic: never cache a health check

  const report = await buildHealthReport(
    async () => {
      const [rows] = await getPool().query("SELECT VERSION() AS version");
      const version = (rows as Array<{ version: string }>)[0]?.version ?? "unknown";
      return { version };
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
