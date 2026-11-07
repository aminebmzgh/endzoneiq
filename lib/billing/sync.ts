import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { profiles, stripeEvents, subscriptions } from "@/db/schema";
import { getDb } from "@/lib/db";

/**
 * Stripe webhook processing (spec 15). Events sync `subscriptions` and derive
 * `profiles.plan`; nothing else ever sets the plan.
 *
 * - Idempotent: the event id is recorded in `stripe_events` in the same transaction
 *   as the changes. A redelivered event is a no-op; a failure rolls back and Stripe
 *   retries.
 * - Order-safe: a subscription row remembers the `created` time of the event that
 *   wrote it, and older events never overwrite newer state.
 */

/** Statuses that keep Pro. `past_due` keeps access while Stripe retries the payment. */
export const PRO_STATUSES = ["trialing", "active", "past_due"] as const;

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export interface SyncDeps {
  /** Fetch the current subscription (checkout and invoice events only carry its id). */
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
}

export type SyncResult = "processed" | "duplicate" | "ignored";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const idOf = (x: string | { id: string } | null | undefined) =>
  typeof x === "string" ? x : (x?.id ?? null);

function periodEnd(sub: Stripe.Subscription): Date | null {
  // Since API 2025-03-31 the period lives on the items.
  const ends = sub.items?.data?.map((i) => i.current_period_end).filter(Boolean) ?? [];
  return ends.length ? new Date(Math.max(...ends) * 1000) : null;
}

async function userForCustomer(tx: Tx, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [p] = await tx
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.stripeCustomerId, customerId));
  return p?.userId ?? null;
}

async function upsertSubscription(
  tx: Tx,
  sub: Stripe.Subscription,
  eventCreated: Date,
  knownUserId?: string | null,
): Promise<string | null> {
  const customerId = idOf(sub.customer);
  const userId = knownUserId ?? sub.metadata?.userId ?? (await userForCustomer(tx, customerId));
  if (!userId) return null; // not one of ours (or created outside the site)

  if (customerId) {
    await tx
      .update(profiles)
      .set({ stripeCustomerId: customerId })
      .where(eq(profiles.userId, userId));
  }
  const values = {
    userId,
    stripeSubscriptionId: sub.id,
    status: sub.status,
    priceId: sub.items?.data?.[0]?.price?.id ?? null,
    currentPeriodEnd: periodEnd(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    eventCreatedAt: eventCreated,
  };
  const [existing] = await tx
    .select({ eventCreatedAt: subscriptions.eventCreatedAt })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .for("update");
  if (!existing) {
    await tx.insert(subscriptions).values(values);
  } else if (existing.eventCreatedAt <= eventCreated) {
    await tx
      .update(subscriptions)
      .set(values)
      .where(eq(subscriptions.stripeSubscriptionId, sub.id));
  }
  return userId;
}

/** Pro while any of the user's subscriptions has a Pro status. */
export async function recomputePlan(tx: Tx, userId: string): Promise<"free" | "pro"> {
  const live = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...PRO_STATUSES])))
    .limit(1);
  const plan = live.length > 0 ? "pro" : "free";
  await tx.update(profiles).set({ plan }).where(eq(profiles.userId, userId));
  return plan;
}

export async function handleStripeEvent(event: Stripe.Event, deps: SyncDeps): Promise<SyncResult> {
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return "ignored";
  const created = new Date(event.created * 1000);

  // Fetch first (outside the transaction): keeps the transaction short.
  let fetched: Stripe.Subscription | null = null;
  let knownUserId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    knownUserId = s.client_reference_id;
    const subId = idOf(s.subscription);
    if (s.mode !== "subscription" || !subId) return "ignored";
    fetched = await deps.retrieveSubscription(subId);
  } else if (event.type === "invoice.payment_failed") {
    const inv = event.data.object as Stripe.Invoice;
    const subId = idOf(inv.parent?.subscription_details?.subscription);
    if (!subId) return "ignored";
    fetched = await deps.retrieveSubscription(subId);
  }

  return getDb().transaction(async (tx) => {
    const [res] = await tx.insert(stripeEvents).ignore().values({ id: event.id, type: event.type });
    if (res.affectedRows === 0) return "duplicate";

    const sub = fetched ?? (event.data.object as Stripe.Subscription);
    const userId = await upsertSubscription(tx, sub, created, knownUserId);
    if (!userId) return "ignored";
    await recomputePlan(tx, userId);
    return "processed";
  });
}
