/**
 * Better Auth end to end on MariaDB: request a magic link, follow it, get a session
 * cookie, resolve the viewer. Proves the Drizzle tables match Better Auth's schema and
 * that every new user gets a profile (admins from ADMIN_EMAILS).
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import { resetServerEnvForTests } from "@/lib/env";
import { connect, dbReachable, testDbUrl } from "./helpers/db";

const sent: { to: string; text: string }[] = [];
vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmail: async (e: { to: string; text: string }) => {
    sent.push(e);
  },
}));

const SITE = "http://localhost:3000";
const EMAILS = ["authtest-user@test.endzoneiq", "authtest-admin@test.endzoneiq"];

async function cleanup() {
  const c = await connect();
  await c.query("DELETE FROM user WHERE email IN (?, ?)", EMAILS);
  await c.query("DELETE FROM verification WHERE identifier LIKE '%'");
  await c.end();
}

beforeAll(async () => {
  Object.assign(process.env, {
    BETTER_AUTH_SECRET: "test-secret-for-better-auth-0123456789abcdef",
    BETTER_AUTH_URL: SITE,
    NEXT_PUBLIC_SITE_URL: SITE,
    ADMIN_EMAILS: EMAILS[1],
  });
  if (testDbUrl) process.env.DATABASE_URL = testDbUrl;
  resetServerEnvForTests();
  if (!(await dbReachable())) return;
  await runMigrations({
    databaseUrl: testDbUrl!,
    migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
    log: () => {},
  });
  await cleanup();
});

afterAll(async () => {
  if (await dbReachable()) await cleanup();
});

async function signIn(email: string): Promise<Headers> {
  const { getAuth } = await import("@/lib/auth");
  const auth = getAuth();
  const res = await auth.handler(
    new Request(`${SITE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE },
      body: JSON.stringify({ email, callbackURL: "/fr/account" }),
    }),
  );
  expect(res.status).toBe(200);
  const mail = sent.findLast((m) => m.to === email)!;
  const link = /https?:\/\/\S+/.exec(mail.text)![0];
  const verify = await auth.handler(new Request(link, { headers: { origin: SITE } }));
  expect([200, 302]).toContain(verify.status);
  const cookie = verify.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("session_token");
  return new Headers({ cookie });
}

describe.runIf(await dbReachable())("better auth magic link", () => {
  it("emails a localized link and signs the user in with a profile", async () => {
    const headers = await signIn(EMAILS[0]!);
    const mail = sent.findLast((m) => m.to === EMAILS[0])!;
    expect(mail.text).toContain("Cliquez"); // French: the sign-in started from /fr

    const { getViewer } = await import("@/lib/authz");
    const viewer = await getViewer(headers);
    expect(viewer).toMatchObject({ email: EMAILS[0], role: "user", plan: "free" });
    expect(await getViewer(new Headers())).toBeNull();
  });

  it("gives ADMIN_EMAILS the admin role", async () => {
    const headers = await signIn(EMAILS[1]!);
    const { getViewer } = await import("@/lib/authz");
    expect((await getViewer(headers))?.role).toBe("admin");
    const c = await connect();
    const [[p]] = (await c.query(
      "SELECT p.role FROM profiles p JOIN user u ON u.id = p.user_id WHERE u.email = ?",
      [EMAILS[1]],
    )) as unknown as [[{ role: string }]];
    await c.end();
    expect(p.role).toBe("admin");
  });
});
