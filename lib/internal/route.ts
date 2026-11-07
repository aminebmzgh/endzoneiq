import "server-only";
import { z } from "zod";
import { ingestLog } from "@/db/schema";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { createRateLimiter } from "./rate-limit";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./signature";

/**
 * Wraps an /api/internal/* route handler with the Section 8 rules:
 * HTTPS only, rate limit, body size cap, HMAC + timestamp verification, zod
 * validation, ingest_log on every call, no caching. Handlers must finish well
 * under 30 s; the pipeline keeps payloads to about 500 rows.
 */

const limiter = createRateLimiter(120, 60_000);
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface HandlerResult {
  /** Rows touched, for ingest_log. */
  rows: number;
  data: unknown;
  status?: number;
}

export interface InternalRouteOptions<S extends z.ZodType> {
  /** Short name for ingest_log, e.g. "ingest/games". */
  endpoint: string;
  /** Body schema for POST endpoints. GET endpoints omit it. */
  schema?: S;
  maxBytes?: number;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

function isHttps(req: Request, url: URL): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const proto = forwarded ?? url.protocol.replace(":", "");
  return proto === "https" || LOCAL_HOSTS.has(url.hostname);
}

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
}

async function writeLog(
  endpoint: string,
  status: number,
  rows: number,
  started: number,
  error?: string,
) {
  try {
    await getDb()
      .insert(ingestLog)
      .values({
        endpoint,
        status,
        rows,
        durationMs: Date.now() - started,
        error: error?.slice(0, 255) ?? null,
      });
  } catch (err) {
    // Logging must never break the request itself.
    console.error(`[internal] could not write ingest_log for ${endpoint}:`, (err as Error).message);
  }
}

export function internalRoute<S extends z.ZodType>(
  opts: InternalRouteOptions<S>,
  handler: (ctx: { body: z.infer<S>; url: URL }) => Promise<HandlerResult>,
): (req: Request) => Promise<Response> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  return async (req) => {
    const started = Date.now();
    const url = new URL(req.url);
    const reject = async (status: number, error: string, extra?: Record<string, string>) => {
      await writeLog(opts.endpoint, status, 0, started, error);
      return json(status, { error }, extra);
    };

    const secret = serverEnv().INGEST_SECRET;
    if (!secret) return reject(503, "internal API not configured");
    if (!isHttps(req, url)) return reject(403, "https required");

    const wait = limiter.hit(`${opts.endpoint}:${clientKey(req)}`);
    if (wait > 0) return reject(429, "rate limited", { "Retry-After": String(wait) });

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return reject(413, "payload too large");
    const raw = await req.text();
    if (Buffer.byteLength(raw) > maxBytes) return reject(413, "payload too large");

    const verdict = verifySignature({
      secret,
      timestamp: req.headers.get(TIMESTAMP_HEADER),
      signature: req.headers.get(SIGNATURE_HEADER),
      method: req.method,
      pathWithQuery: url.pathname + url.search,
      body: raw,
    });
    if (!verdict.ok) return reject(401, `unauthorized: ${verdict.reason}`);

    let body: z.infer<S> = undefined as z.infer<S>;
    if (opts.schema) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return reject(400, "invalid JSON");
      }
      const result = opts.schema.safeParse(parsed);
      if (!result.success) {
        await writeLog(opts.endpoint, 422, 0, started, "validation failed");
        return json(422, {
          error: "validation failed",
          issues: result.error.issues.slice(0, 20).map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
      }
      body = result.data;
    }

    try {
      const { rows, data, status = 200 } = await handler({ body, url });
      await writeLog(opts.endpoint, status, rows, started);
      return json(status, data);
    } catch (err) {
      if (err instanceof InternalApiError) {
        await writeLog(opts.endpoint, err.status, 0, started, err.message);
        return json(err.status, { error: err.message, details: err.details });
      }
      console.error(`[internal] ${opts.endpoint} failed:`, err);
      return reject(500, "internal error");
    }
  };
}

/** Throw from a handler to answer with a specific status (e.g. 422 for unknown teams). */
export class InternalApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
