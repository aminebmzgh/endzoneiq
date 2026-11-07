import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

let client: Stripe | undefined;

export function billingConfigured(): boolean {
  const env = serverEnv();
  return Boolean(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_WEBHOOK_SECRET &&
    env.STRIPE_PRICE_PRO_MONTHLY &&
    env.STRIPE_PRICE_PRO_SEASON,
  );
}

export function stripe(): Stripe {
  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export type PlanChoice = "monthly" | "season";

export function priceFor(choice: PlanChoice): string {
  const env = serverEnv();
  const price = choice === "monthly" ? env.STRIPE_PRICE_PRO_MONTHLY : env.STRIPE_PRICE_PRO_SEASON;
  if (!price) throw new Error(`Stripe price for "${choice}" is not set`);
  return price;
}
