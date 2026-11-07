/**
 * Picks: hash chain (unit) and POST /api/internal/ingest/picks (integration):
 * append-only versions, the 5-point rule, and kicked-off games locked.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import { resetServerEnvForTests } from "@/lib/env";
import { ingestPicks } from "@/lib/internal/handlers";
import { sign } from "@/lib/internal/signature";
import { canonical, contentHash, type PickContent, verifyChain } from "@/lib/picks/hash";
import { changeReason, loadChain } from "@/lib/picks/repository";
import { connect, dbReachable, resetPicksForTests, testDbUrl } from "./helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const SECRET = "ez-test-secret-for-vitest-0123456789abcdef";
const SEASON = 2097;
const MODEL = "picktest-model";
const FUTURE = `${SEASON}_01_BUF_KC`; // KC home
const FUTURE2 = `${SEASON}_01_MIA_NE`;
const KICKED_OFF = `${SEASON}_02_KC_BUF`;

// --- Unit: hash chain --------------------------------------------------------

const content = (over: Partial<PickContent> = {}): PickContent => ({
  game_id: FUTURE,
  model_version: MODEL,
  version_no: 1,
  published_at: "2097-09-01T12:00:00Z",
  winner: "KC",
  win_prob: 0.62,
  confidence_tier: "solid",
  pred_spread: 3.5,
  pred_total: 45.25,
  features: { elo_diff: 50, rest_diff: 0 },
  shap: { pick: "home", for: [] },
  change_reason: null,
  ...over,
});

describe("pick hash chain", () => {
  it("canonicalises key order, so stored JSON can be re-verified", () => {
    expect(canonical({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    );
    const a = content({ features: { x: 1, y: 2 } });
    const b = content({ features: { y: 2, x: 1 } });
    expect(contentHash(a, null)).toBe(contentHash(b, null));
  });

  it("detects a rewritten pick and a broken link", () => {
    const c1 = content();
    const h1 = contentHash(c1, null);
    const c2 = content({ version_no: 2, win_prob: 0.7, change_reason: "x" });
    const h2 = contentHash(c2, h1);
    const rows = [
      { id: 1, content: c1, contentHash: h1, prevHash: null },
      { id: 2, content: c2, contentHash: h2, prevHash: h1 },
    ];
    expect(verifyChain(rows)).toEqual({ ok: true, count: 2, head: h2 });
    const tampered = [{ ...rows[0]!, content: { ...c1, winner: "BUF" } }, rows[1]!];
    expect(verifyChain(tampered)).toMatchObject({ ok: false, brokenAtId: 1 });
    const relinked = [rows[0]!, { ...rows[1]!, prevHash: null }];
    expect(verifyChain(relinked)).toMatchObject({ ok: false, brokenAtId: 2 });
  });

  it("publishes a new version only for a material change", () => {
    const prev = { winnerIsHome: true, homeProb: 0.62 };
    expect(changeReason(undefined, prev)).toBeNull();
    expect(changeReason(prev, { winnerIsHome: true, homeProb: 0.66 })).toBeUndefined();
    expect(changeReason(prev, { winnerIsHome: true, homeProb: 0.67 })).toBe(
      "win probability moved 5 points",
    );
    expect(changeReason(prev, { winnerIsHome: false, homeProb: 0.49 })).toBe("winner changed");
  });
});

// --- Integration -------------------------------------------------------------

const PATH = "/api/internal/ingest/picks";
function post(body: unknown, secret = SECRET) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  return ingestPicks(
    new Request(`http://localhost${PATH}`, {
      method: "POST",
      body: raw,
      headers: { "x-ez-timestamp": ts, "x-ez-signature": sign(secret, ts, "POST", PATH, raw) },
    }),
  );
}

const explanation = (lang: string) => ({
  headline: `${lang}: Chiefs over Bills`,
  reasons: ["Reason one is short.", "Reason two is short.", "Reason three is short."],
  matchupNotes: ["Watch the Bills pass rush."],
  source: "template",
});
const pick = (gameId: string, homeWinProb: number, over: Record<string, unknown> = {}) => ({
  gameId,
  homeWinProb,
  tier: "solid",
  predMargin: 3.5,
  predTotal: 45.25,
  features: { elo_diff: 50, rest_diff: 0, wind_kph: null },
  shap: { pick: homeWinProb >= 0.5 ? "home" : "away", for: [], against: [] },
  explanations: { en: explanation("en"), fr: explanation("fr"), es: explanation("es") },
  ...over,
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
  await c.query("DELETE FROM model_versions WHERE name = ?", [MODEL]);
  await c.query(
    "INSERT INTO model_versions (name, trained_at, metrics_json) VALUES (?, UTC_TIMESTAMP(), '{}')",
    [MODEL],
  );
  // KC=16, BUF=4, MIA=20, NE=22 (seed ids). Two future games and one already kicked off.
  await c.query(
    `INSERT INTO games (id, season, week, game_type, home_team_id, away_team_id, kickoff_at, slug) VALUES
     (?, ?, 1, 'REG', 16, 4, '2097-09-10 00:20:00', 'picktest-1'),
     (?, ?, 1, 'REG', 22, 20, '2097-09-12 17:00:00', 'picktest-2'),
     (?, ?, 2, 'REG', 4, 16, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'picktest-3')`,
    [FUTURE, SEASON, FUTURE2, SEASON, KICKED_OFF, SEASON],
  );
  await c.end();
});

afterAll(async () => {
  if (!reachable) return;
  await resetPicksForTests();
  const c = await connect();
  await c.query("DELETE FROM games WHERE season = ?", [SEASON]);
  await c.query("DELETE FROM model_versions WHERE name = ?", [MODEL]);
  await c.end();
});

async function picksFor(gameId: string) {
  const c = await connect();
  const [rows] = await c.query(
    "SELECT version_no, is_current, win_prob, winner_team_id, change_reason FROM picks WHERE game_id = ? ORDER BY version_no",
    [gameId],
  );
  await c.end();
  return rows as Array<Record<string, unknown>>;
}

describe("POST /api/internal/ingest/picks (integration)", () => {
  it("rejects unsigned requests and invalid explanations", async (ctx) => {
    if (!reachable) ctx.skip();
    expect((await post({ modelVersion: MODEL, picks: [pick(FUTURE, 0.62)] }, "wrong")).status).toBe(
      401,
    );
    const tooLong = pick(FUTURE, 0.62, {
      explanations: {
        en: { ...explanation("en"), reasons: ["one", "two", Array(21).fill("word").join(" ")] },
        fr: explanation("fr"),
        es: explanation("es"),
      },
    });
    expect((await post({ modelVersion: MODEL, picks: [tooLong] })).status).toBe(422);
    const twoReasons = pick(FUTURE, 0.62, {
      explanations: {
        en: { ...explanation("en"), reasons: ["one", "two"] },
        fr: explanation("fr"),
        es: explanation("es"),
      },
    });
    expect((await post({ modelVersion: MODEL, picks: [twoReasons] })).status).toBe(422);
    expect(await picksFor(FUTURE)).toEqual([]);
  });

  it("creates version 1 with explanations in all 3 languages", async (ctx) => {
    if (!reachable) ctx.skip();
    const res = await post({
      modelVersion: MODEL,
      picks: [pick(FUTURE, 0.62), pick(FUTURE2, 0.4)],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ created: 2, unchanged: 0, locked: 0 });
    const [rows] = await (async () => {
      const c = await connect();
      const r = await c.query(
        "SELECT e.locale, e.source FROM explanations e JOIN picks p ON p.id = e.pick_id WHERE p.game_id = ? ORDER BY e.locale",
        [FUTURE],
      );
      await c.end();
      return r;
    })();
    expect(rows).toEqual([
      // ENUM columns sort by declaration order (en, fr, es).
      { locale: "en", source: "template" },
      { locale: "fr", source: "template" },
      { locale: "es", source: "template" },
    ]);
    // FUTURE2: home NE at 40%, so the pick is MIA at 60%.
    expect(await picksFor(FUTURE2)).toMatchObject([
      { version_no: 1, winner_team_id: 20, win_prob: 0.6 },
    ]);
  });

  it("is idempotent and ignores moves under 5 points", async (ctx) => {
    if (!reachable) ctx.skip();
    expect(
      await (await post({ modelVersion: MODEL, picks: [pick(FUTURE, 0.62)] })).json(),
    ).toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(
      await (await post({ modelVersion: MODEL, picks: [pick(FUTURE, 0.66)] })).json(),
    ).toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(await picksFor(FUTURE)).toHaveLength(1);
  });

  it("appends a new version on a material change and supersedes the old one", async (ctx) => {
    if (!reachable) ctx.skip();
    const moved = await (await post({ modelVersion: MODEL, picks: [pick(FUTURE, 0.7)] })).json();
    expect(moved.results[0]).toMatchObject({
      status: "created",
      versionNo: 2,
      changeReason: "win probability moved 8 points",
    });
    const flipped = await (await post({ modelVersion: MODEL, picks: [pick(FUTURE, 0.45)] })).json();
    expect(flipped.results[0]).toMatchObject({ versionNo: 3, changeReason: "winner changed" });

    const rows = await picksFor(FUTURE);
    expect(rows.map((r) => [r.version_no, r.is_current])).toEqual([
      [1, 0],
      [2, 0],
      [3, 1],
    ]);
    expect(rows[2]).toMatchObject({ winner_team_id: 4, win_prob: 0.55 });
  });

  it("refuses any change to a game that has kicked off", async (ctx) => {
    if (!reachable) ctx.skip();
    const res = await post({ modelVersion: MODEL, picks: [pick(KICKED_OFF, 0.9)] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, locked: 1 });
    expect(await picksFor(KICKED_OFF)).toEqual([]);

    // A game with a published pick that has since kicked off keeps its pick frozen.
    const c = await connect();
    await c.query(
      "UPDATE games SET kickoff_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE id = ?",
      [FUTURE2],
    );
    await c.end();
    const late = await (await post({ modelVersion: MODEL, picks: [pick(FUTURE2, 0.9)] })).json();
    expect(late).toMatchObject({ created: 0, locked: 1 });
    expect(await picksFor(FUTURE2)).toHaveLength(1);
  });

  it("keeps a verifiable hash chain that the database won't let anyone rewrite", async (ctx) => {
    if (!reachable) ctx.skip();
    const chain = await loadChain();
    expect(chain).toHaveLength(4);
    const verdict = verifyChain(chain);
    expect(verdict).toMatchObject({ ok: true, count: 4 });

    const c = await connect();
    await expect(
      c.query("UPDATE picks SET win_prob = 0.99 WHERE game_id = ?", [FUTURE]),
    ).rejects.toThrow("append-only");
    await expect(c.query("DELETE FROM picks WHERE game_id = ?", [FUTURE])).rejects.toThrow(
      "append-only",
    );
    await c.end();
  });

  it("rejects an unknown model version", async (ctx) => {
    if (!reachable) ctx.skip();
    const res = await post({ modelVersion: "no-such-model", picks: [pick(FUTURE, 0.2)] });
    expect(res.status).toBe(422);
  });
});
