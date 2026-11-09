import "server-only";
import type Stripe from "stripe";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { canManageBilling, getViewer, type Viewer } from "@/lib/authz";
import { serverEnv } from "@/lib/env";
import { createCheckout, createPortal } from "./checkout";
import { billingConfigured, stripe } from "./stripe";
import { handleStripeEvent } from "./sync";
import { reportError } from "@/lib/observability/sentry";

/**
 * Billing route handlers, as factories so tests can inject the viewer and the Stripe
 * client. app/api/billing/* and app/api/stripe/webhook re-export the defaults.
 */

const noStore = { "Cache-Control": "no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

/** Cookie-authenticated POSTs must come from our own pages (CSRF). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([
    new URL(serverEnv().NEXT_PUBLIC_SITE_URL).origin,
    new URL(req.url).origin,
  ]);
  return allowed.has(origin);
}

const checkoutBody = z.object({
  plan: z.enum(["monthly", "season"]),
  locale: z.enum(routing.locales),
});
const portalBody = z.object({ locale: z.enum(routing.locales) });

type Deps = {
  viewer: (req: Request) => Promise<Viewer>;
  client: () => Pick<Stripe, "customers" | "checkout" | "billingPortal">;
};
const defaults: Deps = { viewer: (req) => getViewer(req.headers), client: stripe };

export function checkoutHandler(deps: Deps = defaults) {
  return async (req: Request): Promise<Response> => {
    if (!billingConfigured()) return json(503, { error: "billing is not configured" });
    if (!sameOrigin(req)) return json(403, { error: "cross-origin request" });
    const parsed = checkoutBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(422, { error: "invalid request" });
    const viewer = await deps.viewer(req);
    if (!viewer || !canManageBilling(viewer)) return json(401, { error: "sign in first" });
    if (viewer.plan === "pro") return json(409, { error: "already pro" });
    const url = await createCheckout(deps.client(), viewer, parsed.data.plan, parsed.data.locale);
    return json(200, { url });
  };
}

export function portalHandler(deps: Deps = defaults) {
  return async (req: Request): Promise<Response> => {
    if (!billingConfigured()) return json(503, { error: "billing is not configured" });
    if (!sameOrigin(req)) return json(403, { error: "cross-origin request" });
    const parsed = portalBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(422, { error: "invalid request" });
    const viewer = await deps.viewer(req);
    if (!viewer || !canManageBilling(viewer)) return json(401, { error: "sign in first" });
    const url = await createPortal(deps.client(), viewer, parsed.data.locale);
    return url ? json(200, { url }) : json(404, { error: "no billing account yet" });
  };
}

type WebhookDeps = {
  verify: (raw: string, signature: string) => Promise<Stripe.Event>;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
};
const webhookDefaults: WebhookDeps = {
  verify: (raw, sig) =>
    stripe().webhooks.constructEventAsync(raw, sig, serverEnv().STRIPE_WEBHOOK_SECRET!),
  retrieveSubscription: (id) => stripe().subscriptions.retrieve(id),
};

/** POST /api/stripe/webhook. Signature-checked, idempotent, quick. */
export function webhookHandler(deps: WebhookDeps = webhookDefaults) {
  return async (req: Request): Promise<Response> => {
    if (!billingConfigured()) return json(503, { error: "billing is not configured" });
    const signature = req.headers.get("stripe-signature");
    if (!signature) return json(400, { error: "missing signature" });
    const raw = await req.text();
    let event: Stripe.Event;
    try {
      event = await deps.verify(raw, signature);
    } catch {
      return json(400, { error: "invalid signature" });
    }
    try {
      const result = await handleStripeEvent(event, {
        retrieveSubscription: deps.retrieveSubscription,
      });
      return json(200, { received: true, result });
    } catch (err) {
      // 500 makes Stripe retry; the transaction rolled back, so the retry is clean.
      reportError("[stripe] webhook failed", err, {
        source: "stripe-webhook",
        tags: { type: event.type, event: event.id },
      });
      return json(500, { error: "processing failed" });
    }
  };
}
