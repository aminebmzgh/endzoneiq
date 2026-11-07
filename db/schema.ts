import { datetime, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Phase 0 placeholder schema: one key/value table so the migration pipeline
 * (drizzle-kit generate -> bundled SQL -> start.js migrator) is exercised end to end.
 * The full schema (Section 9) lands in Phase 1.
 */
export const appMeta = mysqlTable("app_meta", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: varchar("value", { length: 255 }).notNull(),
  updatedAt: datetime("updated_at", { mode: "date" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
