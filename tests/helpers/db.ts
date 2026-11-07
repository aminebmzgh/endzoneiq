import path from "node:path";
import mysql from "mysql2/promise";
import { runMigrations } from "@/db/migrator";

/** DB for integration tests: CI's service container, or the local docker MariaDB. */
export const testDbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export async function dbReachable(): Promise<boolean> {
  if (!testDbUrl) return false;
  try {
    const c = await mysql.createConnection({ uri: testDbUrl, connectTimeout: 2000 });
    await c.end();
    return true;
  } catch {
    return false;
  }
}

export function connect() {
  return mysql.createConnection({ uri: testDbUrl!, timezone: "Z" });
}

/**
 * Empty the append-only tables in the TEST database. The triggers forbid deleting
 * picks, so they are dropped, the tables cleared, and the triggers reinstalled by the
 * migrator. Refuses to run unless the database is a *_test database or CI's throwaway one.
 */
export async function resetPicksForTests(): Promise<void> {
  const c = await connect();
  try {
    const [[{ db }]] = (await c.query("SELECT DATABASE() AS db")) as unknown as [[{ db: string }]];
    if (!db.endsWith("_test") && process.env.CI !== "true") {
      throw new Error(`refusing to reset picks in database "${db}" (not a *_test database)`);
    }
    await c.query("DROP TRIGGER IF EXISTS picks_append_only_update");
    await c.query("DROP TRIGGER IF EXISTS picks_append_only_delete");
    await c.query("DELETE FROM pick_results");
    await c.query("DELETE FROM explanations");
    await c.query("DELETE FROM picks");
  } finally {
    await c.end();
  }
  await runMigrations({
    databaseUrl: testDbUrl!,
    migrationsFolder: path.resolve(import.meta.dirname, "../../db/migrations"),
    log: () => {},
  });
}
