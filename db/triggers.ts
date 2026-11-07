/**
 * Append-only enforcement for `picks` at the database level.
 *
 * - BEFORE UPDATE: the only allowed change is is_current 1 -> 0 (superseding a
 *   version). Every other column must stay identical.
 * - BEFORE DELETE: always rejected.
 *
 * The column list comes from the Drizzle table, so a column added later is
 * covered as soon as the app restarts. Triggers are (re)installed after every
 * migration run with CREATE OR REPLACE. This step is best-effort: on Hostinger,
 * binary logging may require SUPER to create triggers. If MariaDB refuses, the app
 * still starts, logs a warning, and relies on the picks repository (which has no
 * update/delete functions) plus the nightly hash-chain integrity check.
 */
import { getTableConfig } from "drizzle-orm/mysql-core";
import type { Connection } from "mysql2/promise";
import { picks } from "./schema";

export const PICKS_UPDATE_TRIGGER = "picks_append_only_update";
export const PICKS_DELETE_TRIGGER = "picks_append_only_delete";
export const APPEND_ONLY_MESSAGE = "picks are append-only";

export function appendOnlyTriggerSql(): string[] {
  const { columns, name } = getTableConfig(picks);
  const unchanged = columns
    .map((c) => c.name)
    .filter((c) => c !== "is_current")
    .map((c) => `NEW.\`${c}\` <=> OLD.\`${c}\``)
    .join(" AND ");
  return [
    `CREATE OR REPLACE TRIGGER \`${PICKS_UPDATE_TRIGGER}\` BEFORE UPDATE ON \`${name}\` FOR EACH ROW
BEGIN
  IF NOT (OLD.\`is_current\` = 1 AND NEW.\`is_current\` = 0 AND ${unchanged}) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${APPEND_ONLY_MESSAGE}';
  END IF;
END`,
    `CREATE OR REPLACE TRIGGER \`${PICKS_DELETE_TRIGGER}\` BEFORE DELETE ON \`${name}\` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${APPEND_ONLY_MESSAGE}'`,
  ];
}

export type AppendOnlyMode = "triggers" | "app-layer";

export async function ensureAppendOnlyTriggers(
  conn: Connection,
  log: (msg: string) => void,
): Promise<AppendOnlyMode> {
  try {
    for (const stmt of appendOnlyTriggerSql()) await conn.query(stmt);
    log("[migrate] picks append-only triggers installed");
    return "triggers";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(
      `[migrate] WARNING: could not install picks triggers (${msg}). ` +
        "Append-only is enforced by the picks repository and the integrity check.",
    );
    return "app-layer";
  }
}

/** Which mode is active right now (used by /api/health). */
export const TRIGGER_STATUS_SQL = `SELECT COUNT(*) AS n FROM information_schema.TRIGGERS
  WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME IN ('${PICKS_UPDATE_TRIGGER}', '${PICKS_DELETE_TRIGGER}')`;
