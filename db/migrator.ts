/**
 * Migration runner used at startup on Hostinger (bundled into `migrate.cjs` by
 * scripts/build-migrator.mjs) and locally via `npm run db:migrate`.
 *
 * GitHub Actions cannot reach the database (Remote MySQL stays off), so pending
 * migrations are applied by the app itself before the server starts. A MySQL
 * named lock guarantees only one process runs them, even if Hostinger starts
 * several workers at once.
 */
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";

export const MIGRATION_LOCK = "endzoneiq_migrations";
const LOCK_TIMEOUT_S = 90;

export interface MigrateOptions {
  databaseUrl: string;
  migrationsFolder: string;
  log?: (msg: string) => void;
}

export async function runMigrations({
  databaseUrl,
  migrationsFolder,
  log = console.log,
}: MigrateOptions): Promise<void> {
  const conn = await mysql.createConnection({
    uri: databaseUrl,
    timezone: "Z",
    charset: "utf8mb4",
    connectTimeout: 10_000,
    multipleStatements: false,
  });
  try {
    const [rows] = await conn.query("SELECT GET_LOCK(?, ?) AS got", [
      MIGRATION_LOCK,
      LOCK_TIMEOUT_S,
    ]);
    const got = (rows as Array<{ got: number | null }>)[0]?.got;
    if (got !== 1) {
      throw new Error(`could not acquire migration lock within ${LOCK_TIMEOUT_S}s`);
    }
    log("[migrate] lock acquired, applying pending migrations");
    try {
      await migrate(drizzle(conn), { migrationsFolder });
      log("[migrate] database is up to date");
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
    }
  } finally {
    await conn.end();
  }
}
