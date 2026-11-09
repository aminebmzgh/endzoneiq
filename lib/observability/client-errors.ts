import "server-only";
import { z } from "zod";
import { sameOrigin } from "@/lib/billing/routes";
import { createRateLimiter } from "@/lib/internal/rate-limit";
import { captureError, type ErrorContext } from "./sentry";

const body = z.object({
  name: z.string().max(200).default("Error"),
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(200).optional(),
  path: z.string().max(500),
  source: z.enum(["boundary", "global-boundary", "window"]),
});

const limiter = createRateLimiter(10, 60_000);

/**
 * POST /api/client-error: browser errors, forwarded to Sentry by the server (so the
 * browser needs no SDK and no DSN). Same-origin only, small bodies, 10 a minute per IP.
 */
export function clientErrorHandler(
  deps: { capture: (err: unknown, ctx: ErrorContext) => Promise<void> } = {
    capture: captureError,
  },
) {
  return async (req: Request): Promise<Response> => {
    if (!sameOrigin(req)) return new Response(null, { status: 403 });
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
    if (limiter.hit(ip)) return new Response(null, { status: 429 });
    const raw = await req.text();
    if (raw.length > 12_000) return new Response(null, { status: 413 });
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // handled below
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) return new Response(null, { status: 422 });
    const e = parsed.data;
    const err = Object.assign(new Error(e.message), {
      name: e.name,
      stack: e.stack,
      ...(e.digest ? { digest: e.digest } : {}),
    });
    await deps.capture(err, {
      source: `client-${e.source}`,
      platform: "javascript",
      path: e.path.split("?")[0],
      tags: { browser: (req.headers.get("user-agent") ?? "").slice(0, 120) },
    });
    return new Response(null, { status: 204 });
  };
}
