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
const EMAILS = [
  "authtest-user@test.endzoneiq",
  "authtest-admin@test.endzoneiq",
  "authtest-password@test.endzoneiq",
];

async function cleanup() {
  const c = await connect();
  await c.query("DELETE FROM user WHERE email IN (?, ?, ?)", EMAILS);
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

describe.runIf(await dbReachable())("email and password", () => {
  const EMAIL = EMAILS[2]!;
  const call = async (path: string, body?: object, method = "POST") => {
    const { getAuth } = await import("@/lib/auth");
    return getAuth().handler(
      new Request(`${SITE}/api/auth${path}`, {
        method,
        headers: { "content-type": "application/json", origin: SITE },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  };
  const linkFor = (to: string) =>
    /https?:\/\/\S+/.exec(sent.findLast((m) => m.to === to)!.text)![0];
  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

  it("signs up, confirms the email once, then signs in with the password", async () => {
    const up = await call("/sign-up/email", {
      email: EMAIL,
      password: "correct horse battery",
      name: "Pat",
      callbackURL: "/es/account",
    });
    expect(up.status).toBe(200);
    expect(sent.findLast((m) => m.to === EMAIL)!.text).toContain("Confirma tu correo");

    // Before confirming: refused, and the confirmation link is sent again.
    const early = await call("/sign-in/email", { email: EMAIL, password: "correct horse battery" });
    expect(early.status).toBe(403);

    const { getAuth } = await import("@/lib/auth");
    const verified = await getAuth().handler(
      new Request(linkFor(EMAIL), { headers: { origin: SITE } }),
    );
    expect([200, 302]).toContain(verified.status);

    const ok = await call("/sign-in/email", { email: EMAIL, password: "correct horse battery" });
    expect(ok.status).toBe(200);
    const { getViewer } = await import("@/lib/authz");
    expect(await getViewer(new Headers({ cookie: cookieOf(ok) }))).toMatchObject({ email: EMAIL });

    const bad = await call("/sign-in/email", { email: EMAIL, password: "wrong password!" });
    expect(bad.status).toBe(401);
    const short = await call("/sign-up/email", {
      email: "x@test.endzoneiq",
      password: "short",
      name: "x",
    });
    expect(short.status).toBe(400);
  });

  it("lets a magic-link account set its first password through reset", async () => {
    const email = EMAILS[0]!; // created by magic link above, no password yet
    expect((await call("/sign-in/email", { email, password: "anything at all" })).status).toBe(401);

    const req = await call("/request-password-reset", { email, redirectTo: "/fr/reset-password" });
    expect(req.status).toBe(200);
    const { getAuth } = await import("@/lib/auth");
    const landing = await getAuth().handler(
      new Request(linkFor(email), { headers: { origin: SITE } }),
    );
    expect(landing.status).toBe(302);
    const token = new URL(landing.headers.get("location")!, SITE).searchParams.get("token")!;
    expect(new URL(landing.headers.get("location")!, SITE).pathname).toBe("/fr/reset-password");
    expect(sent.findLast((m) => m.to === email)!.text).toContain("mot de passe");

    expect((await call("/reset-password", { newPassword: "my new password", token })).status).toBe(
      200,
    );
    expect((await call("/sign-in/email", { email, password: "my new password" })).status).toBe(200);
    // The token works once.
    expect((await call("/reset-password", { newPassword: "another password", token })).status).toBe(
      400,
    );
  });
});
