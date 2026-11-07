// Integration test against the local docker MariaDB. Skipped when no DB is reachable
// (e.g. in CI without a service container); run `docker compose up -d` locally.
import path from "node:path";
import mysql from "mysql2/promise";
import { beforeAll, describe, expect, it } from "vitest";
import { MIGRATION_LOCK, runMigrations } from "@/db/migrator";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const migrationsFolder = path.resolve(import.meta.dirname, "../db/migrations");

let reachable = false;
beforeAll(async () => {
  if (!url) return;
  try {
    const c = await mysql.createConnection({ uri: url, connectTimeout: 2000 });
    await c.end();
    reachable = true;
  } catch {
    reachable = false;
  }
});

describe("runMigrations", () => {
  it("applies migrations, is idempotent, and releases its lock", async (ctx) => {
    if (!url || !reachable) ctx.skip();
    const logs: string[] = [];
    await runMigrations({ databaseUrl: url!, migrationsFolder, log: (m) => logs.push(m) });
    await runMigrations({ databaseUrl: url!, migrationsFolder, log: (m) => logs.push(m) });
    expect(logs.filter((l) => l.includes("up to date"))).toHaveLength(2);

    const c = await mysql.createConnection({ uri: url! });
    const [free] = await c.query("SELECT IS_FREE_LOCK(?) AS free", [MIGRATION_LOCK]);
    const [tables] = await c.query("SHOW TABLES LIKE 'app_meta'");
    await c.end();
    expect((free as Array<{ free: number }>)[0]?.free).toBe(1);
    expect(tables).toHaveLength(1);
  });

  it("runs safely when two processes start at once", async (ctx) => {
    if (!url || !reachable) ctx.skip();
    await expect(
      Promise.all([
        runMigrations({ databaseUrl: url!, migrationsFolder, log: () => {} }),
        runMigrations({ databaseUrl: url!, migrationsFolder, log: () => {} }),
      ]),
    ).resolves.toBeDefined();
  });
});
