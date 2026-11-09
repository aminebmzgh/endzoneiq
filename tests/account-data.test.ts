/**
 * GDPR export and erasure against the test database: only the signed-in user's own
 * data, no secrets in the export, deletion confirmed by email, cascades to every user
 * table, and a live subscription is cancelled first (or nothing is deleted).
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import { deleteHandler, exportHandler } from "@/lib/account-data";
import type { Viewer } from "@/lib/authz";
import { resetServerEnvForTests } from "@/lib/env";
import { connect, dbReachable, testDbUrl } from "./helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));

const SITE = "http://localhost:3000";
const ME = "gdprtest-me";
const OTHER = "gdprtest-other";
const PAYING = "gdprtest-paying";
const THREAD = "00000000-0000-4000-8000-00000000gd01".slice(0, 36);

const viewer = (userId: string): NonNullable<Viewer> => ({
  userId,
  email: `${userId}@test.endzoneiq`,
  role: "user",
  plan: "free",
});

async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await connect();
  const [rows] = (await c.query(sql, params)) as unknown as [T[]];
  await c.end();
  return rows;
}

async function count(table: string, userId: string): Promise<number> {
  const [r] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [
    userId,
  ]);
  return Number(r!.n);
}

async function cleanup() {
  await query("DELETE FROM user WHERE id IN (?, ?, ?)", [ME, OTHER, PAYING]);
  await query("DELETE FROM audit_log WHERE entity_id IN (?, ?, ?)", [ME, OTHER, PAYING]);
}

async function seedUser(id: string) {
  await query(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(3), NOW(3))",
    [id, id, `${id}@test.endzoneiq`],
  );
  await query(
    "INSERT INTO profiles (user_id, plan, role, locale) VALUES (?, 'free', 'user', 'fr')",
    [id],
  );
  await query(
    "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, 'credential', ?, 'scrypt$SECRET-HASH', NOW(3), NOW(3))",
    [`${id}-acc`, id, id],
  );
  await query(
    "INSERT INTO session (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id) VALUES (?, DATE_ADD(NOW(3), INTERVAL 1 DAY), ?, NOW(3), NOW(3), '203.0.113.9', 'vitest', ?)",
    [`${id}-ses`, `${id}-SESSION-TOKEN`, id],
  );
  await query("INSERT INTO alert_prefs (user_id, notify_weekly) VALUES (?, 1)", [id]);
  await query("INSERT INTO alert_teams (user_id, team_id) VALUES (?, 4)", [id]);
  await query(
    'INSERT INTO push_subscriptions (user_id, endpoint, keys_json) VALUES (?, ?, \'{"p256dh":"PUSH-KEY","auth":"PUSH-AUTH"}\')',
    [id, `https://push.example/${id}`],
  );
}

beforeAll(async () => {
  Object.assign(process.env, { NEXT_PUBLIC_SITE_URL: SITE });
  if (testDbUrl) process.env.DATABASE_URL = testDbUrl;
  resetServerEnvForTests();
  if (!(await dbReachable())) return;
  await runMigrations({
    databaseUrl: testDbUrl!,
    migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
    log: () => {},
  });
  await cleanup();
  for (const id of [ME, OTHER, PAYING]) await seedUser(id);
  await query("INSERT INTO chat_threads (id, user_id, title) VALUES (?, ?, 'Week 1')", [
    THREAD,
    ME,
  ]);
  await query(
    "INSERT INTO chat_messages (thread_id, user_id, role, content, tokens) VALUES (?, ?, 'user', 'Who wins?', 0), (?, ?, 'assistant', 'Probably KC.', 120)",
    [THREAD, ME, THREAD, ME],
  );
  await query(
    "INSERT INTO subscriptions (user_id, stripe_subscription_id, status, event_created_at) VALUES (?, 'sub_gdprtest', 'active', UTC_TIMESTAMP())",
    [PAYING],
  );
});

afterAll(async () => {
  if (await dbReachable()) await cleanup();
});

const db = await dbReachable();
const req = (method: string, body?: unknown, origin = SITE) =>
  new Request(`${SITE}/api/account${method === "GET" ? "/export" : ""}`, {
    method,
    headers: { origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe.skipIf(!db)("account export", () => {
  it("needs a session", async () => {
    const res = await exportHandler({ viewer: async () => null })(req("GET"));
    expect(res.status).toBe(401);
  });

  it("returns the viewer's own data as a download, without secrets", async () => {
    const res = await exportHandler({ viewer: async () => viewer(ME) })(req("GET"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="endzoneiq-data-/);
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.account).toMatchObject({ id: ME, email: `${ME}@test.endzoneiq` });
    expect(data.profile).toMatchObject({ locale: "fr", plan: "free" });
    expect(data.sessions).toEqual([expect.objectContaining({ ipAddress: "203.0.113.9" })]);
    expect(data.alerts.followedTeams).toEqual(["BUF"]);
    expect(data.alerts.preferences.notifyWeekly).toBe(true);
    expect(data.assistant[0].messages.map((m: { content: string }) => m.content)).toEqual([
      "Who wins?",
      "Probably KC.",
    ]);
    for (const secret of ["SECRET-HASH", "SESSION-TOKEN", "PUSH-KEY", "PUSH-AUTH", OTHER]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe.skipIf(!db)("account deletion", () => {
  it("refuses other origins, no session and a wrong confirmation", async () => {
    const h = deleteHandler({ viewer: async () => viewer(ME) });
    expect(
      (await h(req("DELETE", { confirm: `${ME}@test.endzoneiq` }, "https://evil.example"))).status,
    ).toBe(403);
    expect(
      (await deleteHandler({ viewer: async () => null })(req("DELETE", { confirm: "x" }))).status,
    ).toBe(401);
    expect((await h(req("DELETE", { confirm: "someone@else.example" }))).status).toBe(422);
    expect(await count("profiles", ME)).toBe(1);
  });

  it("erases the account and everything that belongs to it", async () => {
    const h = deleteHandler({ viewer: async () => viewer(ME), cancelSubscription: vi.fn() });
    const res = await h(req("DELETE", { confirm: ` ${ME.toUpperCase()}@TEST.ENDZONEIQ ` }));
    expect(res.status).toBe(200);
    for (const table of [
      "profiles",
      "account",
      "session",
      "alert_prefs",
      "alert_teams",
      "push_subscriptions",
      "chat_threads",
      "chat_messages",
    ]) {
      expect(await count(table, ME), table).toBe(0);
    }
    expect(await query("SELECT id FROM user WHERE id = ?", [ME])).toEqual([]);
    const [audit] = await query<{ actor: string; action: string }>(
      "SELECT actor, action FROM audit_log WHERE entity_id = ?",
      [ME],
    );
    expect(audit).toEqual({ actor: `user:${ME}`, action: "account.delete" });
    // Someone else's data is untouched.
    expect(await count("profiles", OTHER)).toBe(1);
  });

  it("cancels a live subscription first, and deletes nothing if that fails", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_m";
    process.env.STRIPE_PRICE_PRO_SEASON = "price_s";
    resetServerEnvForTests();
    try {
      const failing = vi.fn().mockRejectedValue(new Error("stripe down"));
      const bad = deleteHandler({
        viewer: async () => viewer(PAYING),
        cancelSubscription: failing,
      });
      expect((await bad(req("DELETE", { confirm: `${PAYING}@test.endzoneiq` }))).status).toBe(502);
      expect(await count("profiles", PAYING)).toBe(1);

      const cancel = vi.fn().mockResolvedValue(undefined);
      const ok = deleteHandler({ viewer: async () => viewer(PAYING), cancelSubscription: cancel });
      expect((await ok(req("DELETE", { confirm: `${PAYING}@test.endzoneiq` }))).status).toBe(200);
      expect(cancel).toHaveBeenCalledWith("sub_gdprtest");
      expect(await count("subscriptions", PAYING)).toBe(0);
    } finally {
      for (const k of [
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRICE_PRO_MONTHLY",
        "STRIPE_PRICE_PRO_SEASON",
      ])
        delete process.env[k];
      resetServerEnvForTests();
    }
  });
});
