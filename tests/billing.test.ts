/**
 * Stripe billing against the test database: webhooks (signature, idempotency, order,
 * plan sync), checkout (auth, CSRF, trial once) and the customer portal.
 * Signatures are made and checked with Stripe's own library; Stripe API calls are stubbed.
 */
import path from "node:path";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import type { Viewer } from "@/lib/authz";
import { checkoutHandler, portalHandler, webhookHandler } from "@/lib/billing/routes";
import { resetServerEnvForTests } from "@/lib/env";
import { preferencesHandler } from "@/lib/account";
import { connect, dbReachable, testDbUrl } from "./helpers/db";

vi.mock("@/lib/auth", () => ({
  authConfigured: () => true,
  googleConfigured: () => false,
  getAuth: () => ({}),
}));

const WHSEC = "whsec_test_secret_for_vitest";
const SITE = "http://localhost:3000";
const ALICE = "billtest-alice";
const BOB = "billtest-bob";
const stripeLib = new Stripe("sk_test_dummy");

const viewerOf = (userId: string, plan: "free" | "pro" = "free"): Viewer => ({
  userId,
  email: `${userId}@test.endzoneiq`,
  role: "user",
  plan,
});

function subscription(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sub_test_1",
    object: "subscription",
    customer: "cus_test_alice",
    status: "trialing",
    cancel_at_period_end: false,
    metadata: { userId: ALICE },
    items: { data: [{ current_period_end: 1_900_000_000, price: { id: "price_test_monthly" } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

let seq = 0;
function event(type: string, object: unknown, created = 1_800_000_000 + seq) {
  seq += 1;
  return { id: `evt_billtest_${seq}`, object: "event", type, created, data: { object } };
}

let current: Stripe.Subscription = subscription();
const webhook = webhookHandler({
  verify: (raw, sig) => stripeLib.webhooks.constructEventAsync(raw, sig, WHSEC),
  retrieveSubscription: async () => current,
});

async function deliver(evt: object, sig?: string) {
  const raw = JSON.stringify(evt);
  const header =
    sig ??
    (await stripeLib.webhooks.generateTestHeaderStringAsync({ payload: raw, secret: WHSEC }));
  const res = await webhook(
    new Request(`${SITE}/api/stripe/webhook`, {
      method: "POST",
      body: raw,
      headers: { "stripe-signature": header },
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function profile(userId: string) {
  const c = await connect();
  const [[p]] = (await c.query(
    "SELECT plan, stripe_customer_id AS customer FROM profiles WHERE user_id = ?",
    [userId],
  )) as unknown as [[{ plan: string; customer: string | null }]];
  const [subs] = (await c.query(
    "SELECT status, cancel_at_period_end AS cancelAt, current_period_end AS periodEnd FROM subscriptions WHERE user_id = ?",
    [userId],
  )) as unknown as [{ status: string; cancelAt: number; periodEnd: Date }[]];
  await c.end();
  return { ...p!, subs };
}

async function cleanup() {
  const c = await connect();
  await c.query("DELETE FROM user WHERE id IN (?, ?)", [ALICE, BOB]); // cascades
  await c.query("DELETE FROM stripe_events WHERE id LIKE 'evt_billtest_%'");
  await c.end();
}

beforeAll(async () => {
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_PRICE_PRO_MONTHLY: "price_test_monthly",
    STRIPE_PRICE_PRO_SEASON: "price_test_season",
    NEXT_PUBLIC_SITE_URL: SITE,
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
  const c = await connect();
  for (const id of [ALICE, BOB]) {
    await c.query(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(3), NOW(3))",
      [id, id, `${id}@test.endzoneiq`],
    );
    await c.query("INSERT INTO profiles (user_id) VALUES (?)", [id]);
  }
  await c.end();
});

afterAll(async () => {
  if (await dbReachable()) await cleanup();
});

describe.runIf(await dbReachable())("stripe webhook", () => {
  it("rejects missing and forged signatures", async () => {
    const evt = event("customer.subscription.updated", subscription());
    expect((await deliver(evt, "t=1,v1=deadbeef")).status).toBe(400);
    const res = await webhook(
      new Request(`${SITE}/api/stripe/webhook`, { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(400);
  });

  it("checkout completed: Pro, customer linked, trial recorded", async () => {
    current = subscription({ status: "trialing" });
    const evt = event("checkout.session.completed", {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "subscription",
      client_reference_id: ALICE,
      customer: "cus_test_alice",
      subscription: "sub_test_1",
    });
    const { status, body } = await deliver(evt);
    expect(status).toBe(200);
    expect(body.result).toBe("processed");
    const p = await profile(ALICE);
    expect(p.plan).toBe("pro");
    expect(p.customer).toBe("cus_test_alice");
    expect(p.subs).toHaveLength(1);
    expect(p.subs[0]!.status).toBe("trialing");
    expect(new Date(p.subs[0]!.periodEnd).getTime()).toBe(1_900_000_000_000);

    // Stripe redelivers: nothing happens twice.
    expect((await deliver(evt)).body.result).toBe("duplicate");
  });

  it("keeps Pro through cancel-at-period-end and a failed payment", async () => {
    await deliver(
      event(
        "customer.subscription.updated",
        subscription({ status: "active", cancel_at_period_end: true }),
      ),
    );
    let p = await profile(ALICE);
    expect(p.plan).toBe("pro");
    expect(p.subs[0]!.cancelAt).toBe(1);

    current = subscription({ status: "past_due" });
    const inv = {
      id: "in_test_1",
      object: "invoice",
      parent: { subscription_details: { subscription: "sub_test_1" } },
    };
    expect((await deliver(event("invoice.payment_failed", inv))).body.result).toBe("processed");
    p = await profile(ALICE);
    expect(p.subs[0]!.status).toBe("past_due");
    expect(p.plan).toBe("pro");
  });

  it("ignores an event older than the stored state", async () => {
    const stale = event(
      "customer.subscription.updated",
      subscription({ status: "canceled" }),
      1_700_000_000,
    );
    expect((await deliver(stale)).body.result).toBe("processed");
    const p = await profile(ALICE);
    expect(p.subs[0]!.status).toBe("past_due");
    expect(p.plan).toBe("pro");
  });

  it("subscription deleted: back to free", async () => {
    await deliver(event("customer.subscription.deleted", subscription({ status: "canceled" })));
    const p = await profile(ALICE);
    expect(p.plan).toBe("free");
    expect(p.subs[0]!.status).toBe("canceled");
  });

  it("ignores customers that aren't ours and unhandled event types", async () => {
    const stranger = subscription({ id: "sub_other", customer: "cus_unknown", metadata: {} });
    expect((await deliver(event("customer.subscription.created", stranger))).body.result).toBe(
      "ignored",
    );
    expect((await deliver(event("charge.refunded", {}))).body.result).toBe("ignored");
    expect((await profile(BOB)).plan).toBe("free");
  });
});

describe.runIf(await dbReachable())("checkout and portal", () => {
  const created: Record<string, unknown>[] = [];
  const client = {
    customers: { create: vi.fn(async () => ({ id: "cus_test_bob" })) },
    checkout: {
      sessions: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          created.push(params);
          return { url: "https://checkout.stripe.test/session" };
        }),
      },
    },
    billingPortal: {
      sessions: { create: vi.fn(async () => ({ url: "https://billing.stripe.test/p" })) },
    },
  } as unknown as Pick<Stripe, "customers" | "checkout" | "billingPortal">;

  const post = (
    handler: (r: Request) => Promise<Response>,
    body: unknown,
    origin: string | null = SITE,
  ) =>
    handler(
      new Request(`${SITE}/api/billing/x`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      }),
    );

  it("requires a signed-in, same-origin request", async () => {
    const anon = checkoutHandler({ viewer: async () => null, client: () => client });
    expect((await post(anon, { plan: "monthly", locale: "en" })).status).toBe(401);
    const bob = checkoutHandler({ viewer: async () => viewerOf(BOB), client: () => client });
    expect(
      (await post(bob, { plan: "monthly", locale: "en" }, "https://evil.example")).status,
    ).toBe(403);
    expect((await post(bob, { plan: "monthly", locale: "en" }, null)).status).toBe(403);
    expect((await post(bob, { plan: "lifetime", locale: "en" })).status).toBe(422);
  });

  it("refuses a second subscription for a Pro user", async () => {
    const pro = checkoutHandler({ viewer: async () => viewerOf(BOB, "pro"), client: () => client });
    expect((await post(pro, { plan: "season", locale: "en" })).status).toBe(409);
  });

  it("creates the customer once and offers the 7-day trial only the first time", async () => {
    const bob = checkoutHandler({ viewer: async () => viewerOf(BOB), client: () => client });
    const res = await post(bob, { plan: "season", locale: "fr" });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://checkout.stripe.test/session");
    const first = created.at(-1)!;
    expect(first).toMatchObject({
      mode: "subscription",
      customer: "cus_test_bob",
      client_reference_id: BOB,
      line_items: [{ price: "price_test_season", quantity: 1 }],
      locale: "fr",
      success_url: `${SITE}/fr/account?checkout=success`,
    });
    expect((first.subscription_data as { trial_period_days?: number }).trial_period_days).toBe(7);
    expect((await profile(BOB)).customer).toBe("cus_test_bob");

    // Alice already had a subscription: no second trial, existing customer reused.
    const alice = checkoutHandler({ viewer: async () => viewerOf(ALICE), client: () => client });
    await post(alice, { plan: "monthly", locale: "en" });
    const second = created.at(-1)!;
    expect(second.customer).toBe("cus_test_alice");
    expect(
      (second.subscription_data as { trial_period_days?: number }).trial_period_days,
    ).toBeUndefined();
    expect(client.customers.create).toHaveBeenCalledTimes(1);
  });

  it("opens the portal only for users with a billing account", async () => {
    const alice = portalHandler({ viewer: async () => viewerOf(ALICE), client: () => client });
    const res = await post(alice, { locale: "en" });
    expect((await res.json()).url).toBe("https://billing.stripe.test/p");
    const c = await connect();
    await c.query("UPDATE profiles SET stripe_customer_id = NULL WHERE user_id = ?", [BOB]);
    await c.end();
    const bob = portalHandler({ viewer: async () => viewerOf(BOB), client: () => client });
    expect((await post(bob, { locale: "en" })).status).toBe(404);
  });
});

describe.runIf(await dbReachable())("account preferences", () => {
  const patch = (viewer: Viewer, body: unknown, origin = SITE) =>
    preferencesHandler({ viewer: async () => viewer })(
      new Request(`${SITE}/api/account`, {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", origin },
      }),
    );

  it("lets users change only their own language and team, never their plan", async () => {
    expect((await patch(null, { locale: "fr", favoriteTeam: null })).status).toBe(401);
    expect(
      (await patch(viewerOf(BOB), { locale: "fr", favoriteTeam: "KC" }, "https://evil.example"))
        .status,
    ).toBe(403);
    const ok = await patch(viewerOf(BOB), {
      locale: "es",
      favoriteTeam: "KC",
      plan: "pro",
      role: "admin",
    });
    expect(ok.status).toBe(200);
    const c = await connect();
    const [[p]] = (await c.query(
      "SELECT p.locale, p.plan, p.role, t.abbr FROM profiles p LEFT JOIN teams t ON t.id = p.favorite_team_id WHERE p.user_id = ?",
      [BOB],
    )) as unknown as [[{ locale: string; plan: string; role: string; abbr: string }]];
    const [[a]] = (await c.query("SELECT locale FROM profiles WHERE user_id = ?", [
      ALICE,
    ])) as unknown as [[{ locale: string }]];
    await c.end();
    expect(p).toMatchObject({ locale: "es", plan: "free", role: "user", abbr: "KC" });
    expect(a.locale).toBe("en");
    expect((await patch(viewerOf(BOB), { locale: "es", favoriteTeam: "ZZZ" })).status).toBe(422);
  });
});
