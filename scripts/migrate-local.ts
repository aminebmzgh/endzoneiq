/** `npm run db:migrate`: apply migrations to the database in DATABASE_URL (local dev). */
import path from "node:path";
import { runMigrations } from "../db/migrator";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (copy .env.example to .env.local)");
  process.exit(1);
}

runMigrations({
  databaseUrl,
  migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
}).catch((err: unknown) => {
  console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
