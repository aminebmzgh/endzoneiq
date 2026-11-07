/**
 * Append-only picks at the database level. Everything runs inside a transaction
 * that is rolled back, because the triggers forbid deleting test picks.
 */
import path from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/db/migrator";
import { picks } from "@/db/schema";
import { APPEND_ONLY_MESSAGE, appendOnlyTriggerSql } from "@/db/triggers";
import { connect, dbReachable, testDbUrl } from "./helpers/db";

let reachable = false;
beforeAll(async () => {
  reachable = await dbReachable();
  if (reachable) {
    const result = await runMigrations({
      databaseUrl: testDbUrl!,
      migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
      log: () => {},
    });
    expect(result.appendOnly).toBe("triggers");
  }
});

describe("appendOnlyTriggerSql", () => {
  it("freezes every picks column except is_current", () => {
    const [update] = appendOnlyTriggerSql();
    for (const col of getTableConfig(picks).columns.map((c) => c.name)) {
      if (col === "is_current") continue;
      expect(update).toContain(`NEW.\`${col}\` <=> OLD.\`${col}\``);
    }
    expect(update).not.toContain("NEW.`is_current` <=> OLD.`is_current`");
  });
});

describe("picks triggers (integration)", () => {
  it("allow superseding a version but block edits and deletes", async (ctx) => {
    if (!reachable) ctx.skip();
    const c = await connect();
    await c.beginTransaction();
    try {
      await c.query(
        "INSERT INTO model_versions (name, trained_at, metrics_json) VALUES ('vitest-model', UTC_TIMESTAMP(), '{}')",
      );
      const [[mv]] = (await c.query("SELECT LAST_INSERT_ID() AS id")) as unknown as [
        Array<{ id: number }>,
      ];
      await c.query(
        `INSERT INTO games (id, season, week, game_type, home_team_id, away_team_id, kickoff_at, slug)
         VALUES ('2098_01_BUF_MIA', 2098, 1, 'REG', 20, 4, '2098-09-10 17:00:00', 'vitest-append-only')`,
      );
      await c.query(
        `INSERT INTO picks (game_id, model_version_id, version_no, published_at, winner_team_id,
           win_prob, confidence_tier, pred_spread, pred_total, features_json, shap_json,
           is_current, content_hash, prev_hash)
         VALUES ('2098_01_BUF_MIA', ?, 1, UTC_TIMESTAMP(), 20, 0.61, 'solid', -3.5, 44.5,
           '{}', '{}', 1, REPEAT('a', 64), NULL)`,
        [mv!.id],
      );
      const [[pick]] = (await c.query("SELECT LAST_INSERT_ID() AS id")) as unknown as [
        Array<{ id: number }>,
      ];

      await expect(
        c.query("UPDATE picks SET win_prob = 0.99 WHERE id = ?", [pick!.id]),
      ).rejects.toThrow(APPEND_ONLY_MESSAGE);
      await expect(
        c.query("UPDATE picks SET is_current = 0, change_reason = 'x' WHERE id = ?", [pick!.id]),
      ).rejects.toThrow(APPEND_ONLY_MESSAGE);
      await expect(c.query("DELETE FROM picks WHERE id = ?", [pick!.id])).rejects.toThrow(
        APPEND_ONLY_MESSAGE,
      );

      // Superseding: is_current 1 -> 0 and nothing else.
      await c.query("UPDATE picks SET is_current = 0 WHERE id = ?", [pick!.id]);
      // ...and never back again.
      await expect(
        c.query("UPDATE picks SET is_current = 1 WHERE id = ?", [pick!.id]),
      ).rejects.toThrow(APPEND_ONLY_MESSAGE);
    } finally {
      await c.rollback();
      await c.end();
    }
  });
});
