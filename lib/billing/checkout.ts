import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { profiles, subscriptions } from "@/db/schema";
import type { Viewer } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { priceFor, type PlanChoice } from "./stripe";

export const TRIAL_DAYS = 7;

type Client = Pick<Stripe, "customers" | "checkout" | "billingPortal">;

async function customerFor(client: Client, viewer: NonNullable<Viewer>): Promise<string> {
  const db = getDb();
  const [p] = await db
    .select({ customer: profiles.stripeCustomerId })
    .from(profiles)
    .where(eq(profiles.userId, viewer.userId));
  if (p?.customer) return p.customer;
  const customer = await client.customers.create(
    { email: viewer.email, metadata: { userId: viewer.userId } },
    { idempotencyKey: `customer-${viewer.userId}` },
  );
  await db
    .update(profiles)
    .set({ stripeCustomerId: customer.id })
    .where(eq(profiles.userId, viewer.userId));
  return customer.id;
}

/** Stripe Checkout for Pro. The 7-day trial is offered once per account. */
export async function createCheckout(
  client: Client,
  viewer: NonNullable<Viewer>,
  choice: PlanChoice,
  locale: string,
): Promise<string> {
  const site = serverEnv().NEXT_PUBLIC_SITE_URL;
  const customer = await customerFor(client, viewer);
  const before = await getDb()
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, viewer.userId))
    .limit(1);
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: viewer.userId,
    line_items: [{ price: priceFor(choice), quantity: 1 }],
    subscription_data: {
      metadata: { userId: viewer.userId },
      ...(before.length === 0 ? { trial_period_days: TRIAL_DAYS } : {}),
    },
    allow_promotion_codes: true,
    locale: (["en", "fr", "es"].includes(locale) ? locale : "auto") as "en" | "fr" | "es" | "auto",
    success_url: `${site}/${locale}/account?checkout=success`,
    cancel_url: `${site}/${locale}/pricing`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}

/** Stripe Customer Portal: change plan, update card, cancel. */
export async function createPortal(
  client: Client,
  viewer: NonNullable<Viewer>,
  locale: string,
): Promise<string | null> {
  const [p] = await getDb()
    .select({ customer: profiles.stripeCustomerId })
    .from(profiles)
    .where(eq(profiles.userId, viewer.userId));
  if (!p?.customer) return null;
  const portal = await client.billingPortal.sessions.create({
    customer: p.customer,
    return_url: `${serverEnv().NEXT_PUBLIC_SITE_URL}/${locale}/account`,
  });
  return portal.url;
}
