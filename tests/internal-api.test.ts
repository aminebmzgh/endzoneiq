/**
 * Internal API: authorization (always runs) and idempotent games ingest
 * (integration, skipped when no MariaDB is reachable).
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import { resetServerEnvForTests } from "@/lib/env";
import { gamesDigest } from "@/lib/games/digest";
import { exportState, gamesDigestHandler, ingestGames, pipelineRun } from "@/lib/internal/handlers";
import { sign } from "@/lib/internal/signature";
import { connect, dbReachable, testDbUrl } from "./helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const SECRET = "ez-test-secret-for-vitest-0123456789abcdef";
const TEST_SEASON = 2099;

function signed(
  method: "GET" | "POST",
  pathWithQuery: string,
  body = "",
  opts: { ts?: number; secret?: string; signPath?: string; headers?: Record<string, string> } = {},
) {
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const signature = sign(opts.secret ?? SECRET, ts, method, opts.signPath ?? pathWithQuery, body);
  return new Request(`http://localhost${pathWithQuery}`, {
    method,
    body: method === "POST" ? body : undefined,
    headers: {
      "content-type": "application/json",
      "x-ez-timestamp": ts,
      "x-ez-signature": signature,
      ...opts.headers,
    },
  });
}

const GAMES_PATH = "/api/internal/ingest/games";
const post = (payload: unknown, opts?: Parameters<typeof signed>[3]) =>
  ingestGames(signed("POST", GAMES_PATH, JSON.stringify(payload), opts));

let reachable = false;
beforeAll(async () => {
  process.env.INGEST_SECRET = SECRET;
  if (testDbUrl) process.env.DATABASE_URL = testDbUrl;
  resetServerEnvForTests();
  reachable = await dbReachable();
  if (reachable) {
    await runMigrations({
      databaseUrl: testDbUrl!,
      migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
      log: () => {},
    });
    await cleanup();
  }
});

afterAll(async () => {
  if (reachable) await cleanup();
});

async function cleanup() {
  const c = await connect();
  await c.query("DELETE FROM games WHERE season = ?", [TEST_SEASON]);
  await c.query("DELETE FROM seasons WHERE year = ?", [TEST_SEASON]);
  await c.query("DELETE FROM pipeline_runs WHERE id LIKE 'vitest-%'");
  await c.end();
}

describe("internal API authorization", () => {
  const empty = { games: [], seasons: [] };

  it("rejects unsigned requests", async () => {
    const res = await ingestGames(
      new Request(`http://localhost${GAMES_PATH}`, { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized: missing" });
  });

  it("rejects expired requests (older than 5 minutes)", async () => {
    const res = await post(empty, { ts: Math.floor(Date.now() / 1000) - 301 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized: expired" });
  });

  it("rejects a wrong secret and a signature made for another endpoint", async () => {
    expect((await post(empty, { secret: `${SECRET}-wrong` })).status).toBe(401);
    expect((await post(empty, { signPath: "/api/internal/pipeline-run" })).status).toBe(401);
  });

  it("rejects a valid signature replayed with a different body", async () => {
    const req = signed("POST", GAMES_PATH, JSON.stringify(empty));
    const tampered = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({
        games: [],
        seasons: [{ year: 2030, currentWeek: 1, phase: "regular" }],
      }),
    });
    expect((await ingestGames(tampered)).status).toBe(401);
  });

  it("rejects plain HTTP outside localhost", async () => {
    const body = JSON.stringify(empty);
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await ingestGames(
      new Request(`http://endzoneiq.com${GAMES_PATH}`, {
        method: "POST",
        body,
        headers: {
          "x-forwarded-proto": "http",
          "x-ez-timestamp": ts,
          "x-ez-signature": sign(SECRET, ts, "POST", GAMES_PATH, body),
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("answers 503 when INGEST_SECRET is not configured", async () => {
    delete process.env.INGEST_SECRET;
    resetServerEnvForTests();
    try {
      expect((await post(empty)).status).toBe(503);
    } finally {
      process.env.INGEST_SECRET = SECRET;
      resetServerEnvForTests();
    }
  });

  it("rejects invalid payloads with 422", async (ctx) => {
    if (!reachable) ctx.skip(); // the rejection is logged to ingest_log
    const res = await post({ games: [{ id: "nope" }] });
    expect(res.status).toBe(422);
  });
});

const game = (overrides: Record<string, unknown> = {}) => ({
  id: `${TEST_SEASON}_01_OAK_KC`,
  season: TEST_SEASON,
  week: 1,
  gameType: "REG",
  homeTeam: "KC",
  awayTeam: "OAK", // legacy abbreviation, stored as LV
  stadiumId: "KAN00",
  neutralSite: false,
  kickoffAt: "2099-09-11T00:20:00Z",
  status: "scheduled",
  homeScore: null,
  awayScore: null,
  overtime: false,
  ...overrides,
});

const batch = () => [
  game(),
  game({
    id: `${TEST_SEASON}_01_BUF_MIA`,
    homeTeam: "MIA",
    awayTeam: "BUF",
    stadiumId: "ZZZ99", // not in the seed
    kickoffAt: "2099-09-13T17:00:00Z",
  }),
  game({
    id: `${TEST_SEASON}_19_KC_BUF`,
    week: 19,
    gameType: "WC",
    homeTeam: "BUF",
    awayTeam: "KC",
    stadiumId: "BUF00",
    kickoffAt: "2100-01-15T01:15:00Z",
    status: "final",
    homeScore: 24,
    awayScore: 27,
    overtime: true,
  }),
];

describe("POST /api/internal/ingest/games (integration)", () => {
  it("inserts, then re-running the same payload changes nothing", async (ctx) => {
    if (!reachable) ctx.skip();
    const seasons = [{ year: TEST_SEASON, currentWeek: 1, phase: "regular" }];

    const first = await post({ games: batch(), seasons });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      received: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      unknownStadiums: ["ZZZ99"],
      seasonsChanged: 1,
    });

    const c = await connect();
    const snapshot = async () =>
      (
        await c.query(
          "SELECT id, slug, stadium_id, away_team_id, updated_at FROM games WHERE season = ? ORDER BY id",
          [TEST_SEASON],
        )
      )[0];
    const before = await snapshot();

    const second = await post({ games: batch(), seasons });
    expect(await second.json()).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 3,
      seasonsChanged: 0,
    });
    expect(await snapshot()).toEqual(before);

    const [rows] = await c.query("SELECT COUNT(*) AS n FROM games WHERE season = ?", [TEST_SEASON]);
    expect((rows as Array<{ n: number }>)[0]?.n).toBe(3);
    const [[lv]] = (await c.query("SELECT id FROM teams WHERE abbr = 'LV'")) as unknown as [
      Array<{ id: number }>,
    ];
    const byId = new Map((before as Array<Record<string, unknown>>).map((r) => [r.id, r]));
    expect(byId.get(`${TEST_SEASON}_01_OAK_KC`)).toMatchObject({
      slug: "lv-at-kc-2099-week-1",
      away_team_id: lv!.id,
    });
    expect(byId.get(`${TEST_SEASON}_01_BUF_MIA`)).toMatchObject({ stadium_id: null });
    await c.end();
  });

  it("updates only what changed (a final score)", async (ctx) => {
    if (!reachable) ctx.skip();
    const games = batch();
    games[0] = game({ status: "final", homeScore: 31, awayScore: 17 });
    const res = await post({ games });
    expect(await res.json()).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 });
  });

  it("rejects unknown teams without writing anything", async (ctx) => {
    if (!reachable) ctx.skip();
    const res = await post({ games: [game({ id: `${TEST_SEASON}_02_XYZ_KC`, awayTeam: "XYZ" })] });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ details: ["XYZ"] });
  });

  it("serves a season digest that matches the source data", async (ctx) => {
    if (!reachable) ctx.skip();
    const p = `/api/internal/games/digest?season=${TEST_SEASON}`;
    const res = await gamesDigestHandler(signed("GET", p));
    expect(res.status).toBe(200);
    const expected = gamesDigest([
      {
        id: `${TEST_SEASON}_01_OAK_KC`,
        homeAbbr: "KC",
        awayAbbr: "LV",
        homeScore: 31,
        awayScore: 17,
        status: "final",
        kickoffAt: new Date("2099-09-11T00:20:00Z"),
      },
      {
        id: `${TEST_SEASON}_01_BUF_MIA`,
        homeAbbr: "MIA",
        awayAbbr: "BUF",
        homeScore: null,
        awayScore: null,
        status: "scheduled",
        kickoffAt: new Date("2099-09-13T17:00:00Z"),
      },
      {
        id: `${TEST_SEASON}_19_KC_BUF`,
        homeAbbr: "BUF",
        awayAbbr: "KC",
        homeScore: 24,
        awayScore: 27,
        status: "final",
        kickoffAt: new Date("2100-01-15T01:15:00Z"),
      },
    ]);
    expect(await res.json()).toEqual({ season: TEST_SEASON, ...expected });
  });
});

describe("pipeline-run and export (integration)", () => {
  it("records a run start and its result idempotently", async (ctx) => {
    if (!reachable) ctx.skip();
    const p = "/api/internal/pipeline-run";
    const send = (body: unknown) => pipelineRun(signed("POST", p, JSON.stringify(body)));
    const id = `vitest-${Date.now()}-refresh_data`;
    expect((await send({ id, job: "refresh_data", status: "running" })).status).toBe(200);
    const done = { id, job: "refresh_data", status: "failure", error: "boom" };
    expect((await send(done)).status).toBe(200);
    expect((await send(done)).status).toBe(200);

    const c = await connect();
    const [rows] = await c.query(
      "SELECT status, error, finished_at FROM pipeline_runs WHERE id = ?",
      [id],
    );
    await c.end();
    expect(rows).toHaveLength(1);
    expect((rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      status: "failure",
      error: "boom",
    });
  });

  it("exports season state and feature flags", async (ctx) => {
    if (!reachable) ctx.skip();
    const res = await exportState(signed("GET", "/api/internal/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.featureFlags).toEqual({ odds: false });
    expect(body.seasons).toContainEqual({ year: TEST_SEASON, currentWeek: 1, phase: "regular" });
    expect(Array.isArray(body.currentPicks)).toBe(true);
  });
});
