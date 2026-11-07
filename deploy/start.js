// Production entry file on Hostinger (set "Entry file" = start.js).
// 1. Apply pending DB migrations (bundled SQL, guarded by a MySQL named lock).
// 2. Start the prebuilt Next.js standalone server in this same process
//    (no child processes: the shared plan caps processes/threads).
// If migrations fail, the app does NOT start; the error is logged and the
// CI smoke test against /api/health fails.
"use strict";

const path = require("node:path");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[start] FATAL: DATABASE_URL is not set in Hostinger's environment variables");
    process.exit(1);
  }

  if (process.env.SKIP_MIGRATIONS === "true") {
    console.warn("[start] SKIP_MIGRATIONS=true, not running migrations");
  } else {
    const { runMigrations } = require("./migrate.cjs");
    try {
      await runMigrations({
        databaseUrl,
        migrationsFolder: path.join(__dirname, "migrations"),
      });
    } catch (err) {
      console.error("[start] FATAL: migration failed, refusing to start:", err && err.message);
      process.exit(1);
    }
  }

  process.env.NODE_ENV = "production";
  // Next's standalone server reads PORT/HOSTNAME from the environment.
  require("./server/server.js");
}

main();
