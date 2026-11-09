import "server-only";
import { randomUUID } from "node:crypto";
import { createRateLimiter } from "@/lib/internal/rate-limit";

/**
 * Minimal Sentry client: one envelope POST per error, no SDK.
 *
 * Why not @sentry/nextjs: it adds OpenTelemetry instrumentation, a build plugin and
 * ~30 KB of browser JavaScript, all of which work against the hosting limits (one
 * small Node process, Lighthouse TBT, 50 MB archive). Errors are all we need.
 *
 * Without SENTRY_DSN everything is a no-op (errors still go to the console).
 * Never throws, never waits more than 3 s, and sends at most 30 events a minute
 * (the same error at most once a minute) so a crash loop can't burn the quota.
 */

interface Dsn {
  key: string;
  envelopeUrl: string;
  raw: string;
}

let parsed: Dsn | null | undefined;

export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !project) return null;
    return {
      key: u.username,
      envelopeUrl: `${u.protocol}//${u.host}/api/${project}/envelope/`,
      raw: dsn,
    };
  } catch {
    return null;
  }
}

function dsn(): Dsn | null {
  if (parsed === undefined) parsed = parseDsn(process.env.SENTRY_DSN);
  return parsed;
}

export interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 stack ("    at fn (file:1:2)") to Sentry frames, oldest call first. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 51)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2].replace(/^file:\/\//, "");
    frames.push({
      function: m[1] ?? "?",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|node:internal|^node:/.test(filename),
    });
  }
  return frames.reverse();
}

export interface ErrorContext {
  /** Where it happened, e.g. "chat", "stripe-webhook", "render". */
  source: string;
  platform?: "node" | "javascript";
  /** Request path without the query string (it can hold tokens). */
  path?: string;
  method?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

const limiter = createRateLimiter(30, 60_000);
const perError = createRateLimiter(1, 60_000);

export function buildEnvelope(
  err: unknown,
  ctx: ErrorContext,
  d: Dsn,
  now = new Date(),
): { id: string; body: string } {
  const e =
    err instanceof Error
      ? err
      : Object.assign(new Error(typeof err === "string" ? err : JSON.stringify(err)), {
          stack: undefined,
        });
  const id = randomUUID().replace(/-/g, "");
  const digest =
    typeof err === "object" && err !== null && "digest" in err
      ? String((err as { digest: unknown }).digest)
      : undefined;
  const event = {
    event_id: id,
    timestamp: now.getTime() / 1000,
    platform: ctx.platform ?? "node",
    level: "error",
    logger: ctx.source,
    release: process.env.BUILD_SHA,
    environment: process.env.NODE_ENV === "production" ? "production" : "development",
    tags: { source: ctx.source, ...(digest ? { digest } : {}), ...ctx.tags },
    extra: ctx.extra,
    ...(ctx.path ? { request: { url: ctx.path, method: ctx.method } } : {}),
    exception: {
      values: [
        {
          type: e.name || "Error",
          value: e.message.slice(0, 2000),
          stacktrace: { frames: parseStack(e.stack) },
        },
      ],
    },
  };
  const body = [
    JSON.stringify({ event_id: id, sent_at: now.toISOString(), dsn: d.raw }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
  return { id, body };
}

/** Report an error to Sentry (if configured). Resolves when sent or given up; never throws. */
export async function captureError(err: unknown, ctx: ErrorContext): Promise<void> {
  const d = dsn();
  if (!d) return;
  try {
    const signature = `${ctx.source}:${err instanceof Error ? err.message : String(err)}`.slice(
      0,
      300,
    );
    if (limiter.hit("all") || perError.hit(signature)) return;
    const { body } = buildEnvelope(err, ctx, d);
    await fetch(d.envelopeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${d.key}, sentry_client=endzoneiq/1.0`,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Reporting must never break the request that failed.
  }
}

/** console.error + Sentry, for errors the code catches and handles itself. */
export function reportError(message: string, err: unknown, ctx: ErrorContext): void {
  console.error(message, err);
  void captureError(err, ctx);
}

/** Tests only. */
export function resetSentryForTests(): void {
  parsed = undefined;
}
