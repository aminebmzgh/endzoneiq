import "server-only";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@/db/schema";
import { serverEnv } from "@/lib/env";

type Db = MySql2Database<typeof schema>;

// Survive dev hot reloads without leaking pools.
const globalForDb = globalThis as unknown as { __ezPool?: mysql.Pool; __ezDb?: Db };

/**
 * One small pool per process. Hostinger's shared plan caps processes/threads,
 * so keep the connection count low and rely on page caching instead.
 */
export function getPool(): mysql.Pool {
  if (!globalForDb.__ezPool) {
    globalForDb.__ezPool = mysql.createPool({
      uri: serverEnv().DATABASE_URL,
      connectionLimit: 5,
      maxIdle: 2,
      idleTimeout: 60_000,
      enableKeepAlive: true,
      timezone: "Z", // all DATETIME columns are UTC
      charset: "utf8mb4",
      connectTimeout: 5_000,
    });
  }
  return globalForDb.__ezPool;
}

export function getDb(): Db {
  if (!globalForDb.__ezDb) {
    globalForDb.__ezDb = drizzle(getPool(), { schema, mode: "default" });
  }
  return globalForDb.__ezDb;
}
