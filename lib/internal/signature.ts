/**
 * Request signing for /api/internal/* (spec Section 8).
 *
 *   X-EZ-Timestamp: <unix seconds>
 *   X-EZ-Signature: v1=<hex HMAC-SHA256(INGEST_SECRET, "<ts>.<METHOD>.<path+query>.<raw body>")>
 *
 * Binding method and path stops a signature for one endpoint being replayed on
 * another. Requests outside a 5-minute window are rejected (replay protection);
 * every ingest endpoint is also idempotent, so a replay inside the window changes
 * nothing. The Python client (pipeline/endzoneiq_pipeline/site_client.py) must
 * stay byte-for-byte compatible; both test suites share one test vector.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TIMESTAMP_HEADER = "x-ez-timestamp";
export const SIGNATURE_HEADER = "x-ez-signature";
export const MAX_SKEW_S = 300;

export function signingPayload(ts: string, method: string, pathWithQuery: string, body: string) {
  return `${ts}.${method.toUpperCase()}.${pathWithQuery}.${body}`;
}

export function sign(
  secret: string,
  ts: string,
  method: string,
  pathWithQuery: string,
  body: string,
): string {
  const mac = createHmac("sha256", secret)
    .update(signingPayload(ts, method, pathWithQuery, body), "utf8")
    .digest("hex");
  return `v1=${mac}`;
}

export type VerifyResult =
  { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "bad-signature" };

export function verifySignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  method: string;
  pathWithQuery: string;
  body: string;
  nowMs?: number;
}): VerifyResult {
  const { secret, timestamp, signature, method, pathWithQuery, body } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  if (!/^\d{1,12}$/.test(timestamp) || !/^v1=[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, reason: "malformed" };
  }
  const nowS = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowS - Number(timestamp)) > MAX_SKEW_S) return { ok: false, reason: "expired" };

  const expected = Buffer.from(sign(secret, timestamp, method, pathWithQuery, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad-signature" };
  }
  return { ok: true };
}
