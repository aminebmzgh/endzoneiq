/**
 * Grading (POST /api/internal/ingest/results and the games ingest) and
 * POST /api/internal/ingest/team-stats, against the test database.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import { resetServerEnvForTests } from "@/lib/env";
import { ingestPicks, ingestResults, ingestTeamStats } from "@/lib/internal/handlers";
import { sign } from "@/lib/internal/signature";
import { connect, dbReachable, resetPicksForTests, testDbUrl } from "./helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const SECRET = "ez-test-secret-for-vitest-0123456789abcdef";
const SEASON = 2096;
const MODEL = "gradetest-model";
const HOME_WIN = `${SEASON}_01_BUF_KC`; // KC home (16), BUF (4)
const AWAY_WIN = `${SEASON}_01_MIA_NE`; // NE home (22), MIA (20)
const TIE = `${SEASON}_01_DAL_NYG`; // NYG home (24), DAL (9)
const NOT_FINAL = `${SEASON}_02_KC_BUF`;

function signed(handler: (r: Request) => Promise<Response>, p: string, body: unknown) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  return handler(
    new Request(`http://localhost${p}`, {
      method: "POST",
      body: raw,
      headers: { "x-ez-timestamp": ts, "x-ez-signature": sign(SECRET, ts, "POST", p, raw) },
    }),
  );
}

const explanation = {
  headline: "Headline",
  reasons: ["One.", "Two.", "Three."],
  matchupNotes: ["Note."],
  source: "template",
};
const pick = (gameId: string, homeWinProb: number) => ({
  gameId,
  homeWinProb,
  tier: "solid",
  predMargin: 3,
  predTotal: 44,
  features: {},
  shap: { pick: homeWinProb >= 0.5 ? "home" : "away", for: [], against: [] },
  explanations: { en: explanation, fr: explanation, es: explanation },
});

let reachable = false;
beforeAll(async () => {
  process.env.INGEST_SECRET = SECRET;
  if (testDbUrl) process.env.DATABASE_URL = testDbUrl;
  resetServerEnvForTests();
  reachable = await dbReachable();
  if (!reachable) return;
  await runMigrations({
    databaseUrl: testDbUrl!,
    migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
    log: () => {},
  });
  await resetPicksForTests();
  const c = await connect();
  await c.query("DELETE FROM games WHERE season = ?", [SEASON]);
  await c.query("DELETE FROM team_week_stats WHERE season = ?", [SEASON]);
  await c.query("DELETE FROM model_versions WHERE name = ?", [MODEL]);
  await c.query(
    "INSERT INTO model_versions (name, trained_at, metrics_json) VALUES (?, UTC_TIMESTAMP(), '{}')",
    [MODEL],
  );
  // Future kickoffs so picks can be published, then the games are "played" below.
  await c.query(
    `INSERT INTO games (id, season, week, game_type, home_team_id, away_team_id, kickoff_at, slug) VALUES
     (?, ?, 1, 'REG', 16, 4, '2096-09-10 00:20:00', 'gradetest-1'),
     (?, ?, 1, 'REG', 22, 20, '2096-09-12 17:00:00', 'gradetest-2'),
     (?, ?, 1, 'REG', 24, 9, '2096-09-12 20:25:00', 'gradetest-3'),
     (?, ?, 2, 'REG', 4, 16, '2096-09-19 17:00:00', 'gradetest-4')`,
    [HOME_WIN, SEASON, AWAY_WIN, SEASON, TIE, SEASON, NOT_FINAL, SEASON],
  );
  await c.end();
  const res = await signed(ingestPicks, "/api/internal/ingest/picks", {
    modelVersion: MODEL,
    picks: [pick(HOME_WIN, 0.7), pick(AWAY_WIN, 0.7), pick(TIE, 0.6), pick(NOT_FINAL, 0.55)],
  });
  expect(res.status).toBe(200);
  // Final scores: KC beats BUF (pick right), MIA beats NE (home pick wrong), tie.
  const c2 = await connect();
  await c2.query(
    `UPDATE games SET status = 'final', home_score = CASE id
       WHEN ? THEN 27 WHEN ? THEN 10 WHEN ? THEN 20 END,
     away_score = CASE id WHEN ? THEN 20 WHEN ? THEN 24 WHEN ? THEN 20 END
     WHERE id IN (?, ?, ?)`,
    [HOME_WIN, AWAY_WIN, TIE, HOME_WIN, AWAY_WIN, TIE, HOME_WIN, AWAY_WIN, TIE],
  );
  await c2.end();
});

afterAll(async () => {
  if (!reachable) return;
  const c = await connect();
  await c.query("DELETE FROM team_week_stats WHERE season = ?", [SEASON]);
  await c.end();
});

describe.runIf(await dbReachable())("grading", () => {
  it("rejects unsigned requests", async () => {
    const res = await ingestResults(
      new Request("http://localhost/api/internal/ingest/results", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
  });

  it("grades final games against the pick, and only once", async () => {
    const res = await signed(ingestResults, "/api/internal/ingest/results", { seasons: [SEASON] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.graded).toBe(3);
    expect(body.gameIds.sort()).toEqual([AWAY_WIN, HOME_WIN, TIE].sort());

    const c = await connect();
    const [rows] = (await c.query(
      `SELECT p.game_id, r.correct_winner, r.covered_spread, r.total_result
         FROM pick_results r JOIN picks p ON p.id = r.pick_id
        WHERE p.game_id LIKE ? ORDER BY p.game_id`,
      [`${SEASON}%`],
    )) as unknown as [
      { game_id: string; correct_winner: number; covered_spread: null; total_result: null }[],
    ];
    await c.end();
    const byGame = Object.fromEntries(rows.map((r) => [r.game_id, r]));
    expect(byGame[HOME_WIN]!.correct_winner).toBe(1);
    expect(byGame[AWAY_WIN]!.correct_winner).toBe(0);
    expect(byGame[TIE]!.correct_winner).toBe(0); // shown as a tie from the scores
    expect(byGame[NOT_FINAL]).toBeUndefined();
    expect(byGame[HOME_WIN]!.covered_spread).toBeNull(); // no market line, no ATS grade

    const again = await (
      await signed(ingestResults, "/api/internal/ingest/results", { seasons: [SEASON] })
    ).json();
    expect(again.graded).toBe(0);
  });
});

describe.runIf(await dbReachable())("team stats", () => {
  const body = {
    season: SEASON,
    week: 9,
    teams: [
      {
        abbr: "KC",
        elo: 1650.5,
        offEpa: 0.12,
        defEpa: -0.05,
        offPassEpa: 0.2,
        offRunEpa: 0.01,
        defPassEpa: -0.04,
        defRunEpa: -0.06,
        offEpaRank: 3,
        defEpaRank: 5,
      },
      {
        abbr: "BUF",
        elo: 1610,
        offEpa: 0.1,
        defEpa: 0.01,
        offPassEpa: null,
        offRunEpa: null,
        defPassEpa: null,
        defRunEpa: null,
        offEpaRank: 6,
        defEpaRank: 15,
      },
    ],
  };

  it("upserts idempotently", async () => {
    const p = "/api/internal/ingest/team-stats";
    const first = await (await signed(ingestTeamStats, p, body)).json();
    expect(first.changed).toBe(2);
    const second = await (await signed(ingestTeamStats, p, body)).json();
    expect(second.changed).toBe(0);
    const changed = { ...body, teams: [{ ...body.teams[0]!, elo: 1660 }] };
    expect((await (await signed(ingestTeamStats, p, changed)).json()).changed).toBe(1);
  });

  it("rejects unknown teams and invalid values", async () => {
    const p = "/api/internal/ingest/team-stats";
    const bad = { ...body, teams: [{ ...body.teams[0]!, abbr: "XYZ" }] };
    expect((await signed(ingestTeamStats, p, bad)).status).toBe(422);
    const rank = { ...body, teams: [{ ...body.teams[0]!, offEpaRank: 40 }] };
    expect((await signed(ingestTeamStats, p, rank)).status).toBe(422);
  });
});
