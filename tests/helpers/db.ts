import mysql from "mysql2/promise";

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
