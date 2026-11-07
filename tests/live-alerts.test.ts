/**
 * Phase 7 against the test database: live-data ingests, admin overrides and
 * re-predict dispatch, pick-change alerts (who gets what, once), the queue (delivery,
 * retries, expired push subscriptions, one worker per row), cron auth and the
 * integrity check, and the users' own alert settings.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import type { Viewer } from "@/lib/authz";
import { resetServerEnvForTests } from "@/lib/env";
import {
  exportState,
  ingestPicks,
  ingestPlayersInjuries,
  ingestWeather,
} from "@/lib/internal/handlers";
import { sign } from "@/lib/internal/signature";
import { connect, dbReachable, resetPicksForTests, testDbUrl } from "./helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  authConfigured: () => true,
  googleConfigured: () => false,
  getAuth: () => ({}),
}));

const SECRET = "ez-test-secret-for-vitest-0123456789abcdef";
const CRON = "cron-secret-for-vitest-0123456789abcdef";
const SITE = "http://localhost:3000";
const SEASON = 2094;
const MODEL = "alerttest-model";
const GAME = `${SEASON}_01_BUF_KC`; // KC (16) home, BUF (4) away
const OTHER = `${SEASON}_01_MIA_NE`; // NE (22) home, MIA (20) away
const LOCKED = `${SEASON}_01_DAL_NYG`; // already kicked off
const PRO = "alerttest-pro";
const FREE = "alerttest-free";
const ADMIN = "alerttest-admin";
const FAN = "alerttest-fan"; // Pro, follows MIA only

const viewer = (
  userId: string,
  plan: "free" | "pro" = "free",
  role: "user" | "admin" = "user",
): Viewer => ({
  userId,
  email: `${userId}@test.endzoneiq`,
  role,
  plan,
});

async function signed(handler: (r: Request) => Promise<Response>, p: string, body?: unknown) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const method = body === undefined ? "GET" : "POST";
  return handler(
    new Request(`${SITE}${p}`, {
      method,
      ...(body === undefined ? {} : { body: raw }),
      headers: { "x-ez-timestamp": ts, "x-ez-signature": sign(SECRET, ts, method, p, raw) },
    }),
  );
}

const expl = {
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
  explanations: { en: expl, fr: expl, es: expl },
});
const publish = (picks: object[]) =>
  signed(ingestPicks, "/api/internal/ingest/picks", { modelVersion: MODEL, picks });

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await connect();
  const [rows] = (await c.query(sql, params)) as unknown as [T[]];
  await c.end();
  return rows;
}

async function cleanup() {
  await query("DELETE FROM user WHERE id IN (?, ?, ?, ?)", [PRO, FREE, ADMIN, FAN]);
  await query(
    "DELETE FROM notification_queue WHERE dedupe_key LIKE 'admin:alerttest%' OR to_email LIKE '%alerttest%'",
  );
  await query("DELETE FROM injuries WHERE game_id IN (?, ?, ?)", [GAME, OTHER, LOCKED]);
  await query("DELETE FROM weather WHERE game_id IN (?, ?)", [GAME, OTHER]);
  await query("DELETE FROM players WHERE gsis_id LIKE 'AT-%'");
}

beforeAll(async () => {
  Object.assign(process.env, {
    INGEST_SECRET: SECRET,
    CRON_SECRET: CRON,
    NEXT_PUBLIC_SITE_URL: SITE,
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    ADMIN_EMAILS: "",
    GITHUB_TOKEN: "",
  });
  if (testDbUrl) process.env.DATABASE_URL = testDbUrl;
  resetServerEnvForTests();
  if (!(await dbReachable())) return;
  await runMigrations({
    databaseUrl: testDbUrl!,
    migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
    log: () => {},
  });
  await resetPicksForTests(); // picks are append-only: start each run from none
  await cleanup();
  for (const [id, plan, role] of [
    [PRO, "pro", "user"],
    [FREE, "free", "user"],
    [ADMIN, "free", "admin"],
    [FAN, "pro", "user"],
  ]) {
    await query(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(3), NOW(3))",
      [id, id, `${id}@test.endzoneiq`],
    );
    await query("INSERT INTO profiles (user_id, plan, role, locale) VALUES (?, ?, ?, ?)", [
      id,
      plan,
      role,
      id === PRO ? "fr" : "en",
    ]);
  }
  await query("INSERT INTO alert_prefs (user_id, notify_pick_change_email) VALUES (?, 1)", [PRO]);
  await query("INSERT INTO alert_teams (user_id, team_id) VALUES (?, 20)", [FAN]); // MIA
  await query(
    "INSERT IGNORE INTO model_versions (name, trained_at, metrics_json) VALUES (?, UTC_TIMESTAMP(), '{}')",
    [MODEL],
  );
  await query(
    `INSERT IGNORE INTO games (id, season, week, game_type, home_team_id, away_team_id, stadium_id, kickoff_at, slug) VALUES
     (?, ?, 1, 'REG', 16, 4, NULL, '2094-09-11 17:00:00', 'alerttest-buf-at-kc'),
     (?, ?, 1, 'REG', 22, 20, NULL, '2094-09-11 20:25:00', 'alerttest-mia-at-ne'),
     (?, ?, 1, 'REG', 24, 9, NULL, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR), 'alerttest-dal-at-nyg')`,
    [GAME, SEASON, OTHER, SEASON, LOCKED, SEASON],
  );
});

afterAll(async () => {
  if (await dbReachable()) await cleanup();
});

const db = await dbReachable();

// --- Live data -----------------------------------------------------------------------

describe.runIf(db)("players, injuries and weather ingest", () => {
  const body = (injuries: object[]) => ({
    games: [GAME],
    players: [
      { gsisId: "AT-QB-KC", name: "Starter KC", position: "QB", team: "KC" },
      { gsisId: "AT-CB-KC", name: "Corner KC", position: "CB", team: "KC" },
    ],
    injuries,
  });

  it("replaces the nflverse report of a game and keeps admin overrides", async () => {
    let res = await signed(
      ingestPlayersInjuries,
      "/api/internal/ingest/players-injuries",
      body([{ gameId: GAME, gsisId: "AT-CB-KC", status: "questionable" }]),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).changedGames).toEqual([GAME]);
    // Same payload again: nothing changes.
    res = await signed(
      ingestPlayersInjuries,
      "/api/internal/ingest/players-injuries",
      body([{ gameId: GAME, gsisId: "AT-CB-KC", status: "questionable" }]),
    );
    expect((await res.json()).changedGames).toEqual([]);

    const [{ id: qb }] = await query<{ id: number }>(
      "SELECT id FROM players WHERE gsis_id = 'AT-QB-KC'",
    );
    await query(
      "INSERT INTO injuries (player_id, game_id, report_status, source) VALUES (?, ?, 'out', 'admin')",
      [qb, GAME],
    );
    // The corner is off the report now: his nflverse row goes, the admin override stays.
    await signed(ingestPlayersInjuries, "/api/internal/ingest/players-injuries", body([]));
    const rows = await query<{ source: string; status: string }>(
      "SELECT source, report_status AS status FROM injuries WHERE game_id = ?",
      [GAME],
    );
    expect(rows).toEqual([{ source: "admin", status: "out" }]);
  });

  it("exports overrides with team and position, and stored forecasts", async () => {
    await signed(ingestWeather, "/api/internal/ingest/weather", {
      forecasts: [{ gameId: GAME, tempC: -3.2, windKph: 31.5, precipMm: 0.4, condition: "snow" }],
    });
    const res = await signed(exportState, "/api/internal/export");
    const data = await res.json();
    expect(data.injuryOverrides).toContainEqual(
      expect.objectContaining({
        gameId: GAME,
        gsisId: "AT-QB-KC",
        status: "out",
        team: "KC",
        position: "QB",
      }),
    );
    expect(data.weather).toContainEqual(
      expect.objectContaining({ gameId: GAME, tempC: -3.2, windKph: 31.5 }),
    );
  });
});

// --- Admin -----------------------------------------------------------------------------

describe.runIf(db)("admin overrides and re-predict", () => {
  const dispatched: (string | null)[] = [];
  const call = async (v: Viewer, action: "override" | "repredict", body: object, origin = SITE) => {
    const { adminHandlers } = await import("@/lib/admin/data");
    const h = adminHandlers({
      viewer: async () => v,
      dispatch: async (id) => (dispatched.push(id), true),
    });
    return h[action](
      new Request(`${SITE}/api/admin/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", origin },
      }),
    );
  };

  it("hides the admin actions from everyone but admins", async () => {
    const body = { gameId: GAME, gsisId: "AT-CB-KC", status: "out" };
    expect((await call(null, "override", body)).status).toBe(404);
    expect((await call(viewer(PRO, "pro"), "override", body)).status).toBe(404);
    expect(
      (await call(viewer(ADMIN, "free", "admin"), "override", body, "https://evil.example")).status,
    ).toBe(403);
    expect(dispatched).toEqual([]);
  });

  it("sets and clears an override, audits it and starts a re-prediction", async () => {
    const admin = viewer(ADMIN, "free", "admin");
    const res = await call(admin, "override", { gameId: GAME, gsisId: "AT-CB-KC", status: "out" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dispatched: true });
    expect(dispatched).toEqual([GAME]);
    const rows = await query<{ status: string }>(
      "SELECT i.report_status AS status FROM injuries i JOIN players p ON p.id = i.player_id WHERE p.gsis_id = 'AT-CB-KC' AND i.source = 'admin'",
    );
    expect(rows).toEqual([{ status: "out" }]);
    const audit = await query<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY id DESC LIMIT 1",
      [`${GAME}:AT-CB-KC`],
    );
    expect(audit[0]!.action).toBe("override.set");

    await call(admin, "override", { gameId: GAME, gsisId: "AT-CB-KC", status: null });
    expect(
      await query(
        "SELECT 1 FROM injuries i JOIN players p ON p.id = i.player_id WHERE p.gsis_id = 'AT-CB-KC' AND i.source = 'admin'",
      ),
    ).toEqual([]);
    expect((await call(admin, "repredict", { gameId: null })).status).toBe(200);
    expect(dispatched.at(-1)).toBeNull();
  });

  it("refuses overrides on games that kicked off", async () => {
    const res = await call(viewer(ADMIN, "free", "admin"), "override", {
      gameId: LOCKED,
      gsisId: "AT-QB-KC",
      status: "out",
    });
    expect(res.status).toBe(409);
  });
});

// --- Alerts and the queue ----------------------------------------------------------------

describe.runIf(db)("pick-change alerts", () => {
  type Row = {
    user_id: string | null;
    channel: string;
    dedupe_key: string;
    payload_json: string | object;
    status: string;
  };
  const queued = () =>
    query<Row>(
      "SELECT user_id, channel, dedupe_key, payload_json, status FROM notification_queue WHERE user_id IN (?, ?, ?, ?)",
      [PRO, FREE, ADMIN, FAN],
    );

  it("first publish alerts nobody; a material change alerts Pro users and admins once", async () => {
    await publish([pick(GAME, 0.62), pick(OTHER, 0.6)]);
    expect(await queued()).toEqual([]);

    // KC 62% -> BUF 55%: the winner flips.
    await publish([pick(GAME, 0.45)]);
    const rows = await queued();
    const who = rows.map((r) => `${r.user_id}:${r.channel}`).sort();
    expect(who).toEqual([`${ADMIN}:push`, `${PRO}:email`, `${PRO}:push`]); // not FREE, not FAN (follows MIA)
    const push = rows.find((r) => r.user_id === PRO && r.channel === "push")!;
    const payload =
      typeof push.payload_json === "string" ? JSON.parse(push.payload_json) : push.payload_json;
    expect(payload.title).toBe("Pronostic mis à jour : Bills à Chiefs"); // PRO reads French
    expect(payload.body).toContain("Bills");
    expect(payload.url).toBe(`${SITE}/fr/game/alerttest-buf-at-kc`);

    // Re-queuing the same change adds nothing.
    const { queuePickChangeAlerts } = await import("@/lib/notify/alerts");
    expect(await queuePickChangeAlerts([{ gameId: GAME, versionNo: 2 }])).toBe(0);
  });

  it("respects followed teams", async () => {
    await publish([pick(OTHER, 0.4)]); // NE -> MIA
    const rows = await queued();
    expect(rows.some((r) => r.user_id === FAN && r.dedupe_key.includes(":push"))).toBe(true);
  });

  it("delivers push to every device, drops expired ones and retries failures", async () => {
    const { processQueue, MAX_ATTEMPTS } = await import("@/lib/notify/queue");
    await query("DELETE FROM notification_queue WHERE user_id = ? AND channel = 'email'", [PRO]);
    await query(
      'INSERT INTO push_subscriptions (user_id, endpoint, keys_json) VALUES (?, \'https://push.test/ok\', \'{"p256dh":"x","auth":"y"}\'), (?, \'https://push.test/gone\', \'{"p256dh":"x","auth":"y"}\')',
      [PRO, PRO],
    );
    // At publish time PRO had no device, so the immediate send skipped the alert.
    // Re-queue it now that two devices are registered.
    await query(
      "UPDATE notification_queue SET status = 'queued', attempts = 0 WHERE user_id = ? AND channel = 'push'",
      [PRO],
    );
    const sent: string[] = [];
    const senders = {
      push: async (sub: { endpoint: string }) => {
        if (sub.endpoint.endsWith("/gone"))
          throw Object.assign(new Error("gone"), { statusCode: 410 });
        sent.push(sub.endpoint);
      },
      email: async () => {},
    };
    const r = await processQueue({ senders });
    expect(sent).toContain("https://push.test/ok");
    expect(r.sent).toBeGreaterThan(0);
    expect(
      await query("SELECT 1 FROM push_subscriptions WHERE endpoint = 'https://push.test/gone'"),
    ).toEqual([]);
    // Users without a device: skipped, not failed.
    const admin = await query<{ status: string }>(
      "SELECT status FROM notification_queue WHERE user_id = ?",
      [ADMIN],
    );
    expect(admin.every((a) => a.status === "skipped")).toBe(true);

    // A push service outage: retried, then failed after MAX_ATTEMPTS.
    await query(
      "UPDATE notification_queue SET status = 'queued', attempts = 0 WHERE user_id = ? AND channel = 'push'",
      [PRO],
    );
    const down = {
      ...senders,
      push: async () => {
        throw new Error("503 from push service");
      },
    };
    for (let i = 0; i < MAX_ATTEMPTS; i++) await processQueue({ senders: down });
    const final = await query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM notification_queue WHERE user_id = ? AND channel = 'push'",
      [PRO],
    );
    expect(final.every((f) => f.status === "failed" && f.attempts === MAX_ATTEMPTS)).toBe(true);
  });

  it("never sends a row twice when two workers run at once", async () => {
    const { enqueue, processQueue } = await import("@/lib/notify/queue");
    await enqueue(
      Array.from({ length: 6 }, (_, i) => ({
        toEmail: `n${i}@alerttest.endzoneiq`,
        channel: "email" as const,
        dedupeKey: `admin:alerttest-race-${i}`,
        payload: { subject: "s", text: "t", html: "h" },
      })),
    );
    const got: string[] = [];
    const senders = {
      push: async () => {},
      email: async (to: string) => {
        await new Promise((r) => setTimeout(r, 5));
        got.push(to);
      },
    };
    await Promise.all([processQueue({ senders }), processQueue({ senders })]);
    const mine = got.filter((t) => t.endsWith("@alerttest.endzoneiq"));
    expect(mine.sort()).toEqual(
      Array.from({ length: 6 }, (_, i) => `n${i}@alerttest.endzoneiq`).sort(),
    );
  });
});

// --- Cron --------------------------------------------------------------------------------

describe.runIf(db)("cron endpoints", () => {
  const cron = async (bearer?: string) => {
    const { cronIntegrityCheck } = await import("@/lib/cron/handlers");
    return cronIntegrityCheck(
      new Request(`${SITE}/api/internal/cron/integrity-check`, {
        method: "POST",
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      }),
    );
  };

  it("require the cron secret", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("wrong-secret-of-the-same-length-000000")).status).toBe(401);
  });

  it("verify the hash chain", async () => {
    const res = await cron(CRON);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.ok).toBe(true);
    expect(body.result.count).toBeGreaterThan(0);
  });
});

// --- The users' own alert settings ---------------------------------------------------------

describe.runIf(db)("alert settings", () => {
  const req = (method: string, url: string, body?: object, origin = SITE) =>
    new Request(`${SITE}${url}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
      headers: { "content-type": "application/json", origin },
    });

  it("lets users manage only their own preferences and devices", async () => {
    const { alertsHandlers, pushHandlers } = await import("@/lib/notify/routes");
    const free = alertsHandlers({ viewer: async () => viewer(FREE) });
    expect(
      (await alertsHandlers({ viewer: async () => null }).GET(req("GET", "/api/alerts"))).status,
    ).toBe(401);

    const saved = await free.PUT(
      req("PUT", "/api/alerts", {
        notifyPickChange: true,
        notifyPickChangeEmail: false,
        notifyWeekly: true,
        teams: ["KC", "BUF"],
      }),
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      notifyWeekly: true,
      teams: expect.arrayContaining(["KC", "BUF"]),
    });
    expect(
      (
        await free.PUT(
          req("PUT", "/api/alerts", {
            notifyPickChange: true,
            notifyPickChangeEmail: false,
            notifyWeekly: true,
            teams: ["ZZZ"],
          }),
        )
      ).status,
    ).toBe(422);
    expect((await (await free.GET(req("GET", "/api/alerts"))).json()).pro).toBe(false);

    // PRO's device can't be removed by FREE.
    const del = await pushHandlers({ viewer: async () => viewer(FREE) }).DELETE(
      req("DELETE", "/api/alerts/push", { endpoint: "https://push.test/ok" }),
    );
    expect((await del.json()).removed).toBe(0);
    expect(
      await query("SELECT 1 FROM push_subscriptions WHERE endpoint = 'https://push.test/ok'"),
    ).toHaveLength(1);
    // Push is off without VAPID keys.
    const sub = await pushHandlers({ viewer: async () => viewer(FREE) }).POST(
      req("POST", "/api/alerts/push", {
        endpoint: "https://push.test/new",
        keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) },
      }),
    );
    expect(sub.status).toBe(503);
  });
});
