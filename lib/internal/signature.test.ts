import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";
import { MAX_SKEW_S, sign, verifySignature } from "./signature";

// Shared with pipeline/tests/test_site_client.py. Change both or neither.
const VECTOR = {
  secret: "ez-test-secret-0123456789abcdef0123456789",
  ts: "1794040000",
  post: {
    path: "/api/internal/ingest/games",
    body: '{"games":[],"seasons":[]}',
    sig: "v1=79c6880dde6c660e240d5e3795ec48cf03c96f14c7509df7f801df32abf8ae88",
  },
  get: {
    path: "/api/internal/games/digest?season=2024",
    sig: "v1=f111ade2073e728268d13852e10e0b84d822ab8656dcd85c1756080be75b05b9",
  },
};
const nowMs = Number(VECTOR.ts) * 1000;

const base = {
  secret: VECTOR.secret,
  timestamp: VECTOR.ts,
  signature: VECTOR.post.sig,
  method: "POST",
  pathWithQuery: VECTOR.post.path,
  body: VECTOR.post.body,
  nowMs,
};

describe("sign", () => {
  it("matches the shared test vector", () => {
    expect(sign(VECTOR.secret, VECTOR.ts, "POST", VECTOR.post.path, VECTOR.post.body)).toBe(
      VECTOR.post.sig,
    );
    expect(sign(VECTOR.secret, VECTOR.ts, "get", VECTOR.get.path, "")).toBe(VECTOR.get.sig);
  });
});

describe("verifySignature", () => {
  it("accepts a valid signature inside the window", () => {
    expect(verifySignature(base)).toEqual({ ok: true });
    expect(verifySignature({ ...base, nowMs: nowMs + MAX_SKEW_S * 1000 })).toEqual({ ok: true });
  });

  it("rejects unsigned requests", () => {
    expect(verifySignature({ ...base, signature: null })).toEqual({ ok: false, reason: "missing" });
    expect(verifySignature({ ...base, timestamp: null })).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects expired and future timestamps (replay protection)", () => {
    const late = nowMs + (MAX_SKEW_S + 1) * 1000;
    const early = nowMs - (MAX_SKEW_S + 1) * 1000;
    expect(verifySignature({ ...base, nowMs: late })).toEqual({ ok: false, reason: "expired" });
    expect(verifySignature({ ...base, nowMs: early })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampering with body, path, method, timestamp or secret", () => {
    const bad = { ok: false, reason: "bad-signature" };
    expect(verifySignature({ ...base, body: '{"games":[1]}' })).toEqual(bad);
    expect(verifySignature({ ...base, pathWithQuery: "/api/internal/pipeline-run" })).toEqual(bad);
    expect(verifySignature({ ...base, method: "PUT" })).toEqual(bad);
    expect(verifySignature({ ...base, timestamp: String(Number(VECTOR.ts) + 1) })).toEqual(bad);
    expect(verifySignature({ ...base, secret: `${VECTOR.secret}x` })).toEqual(bad);
  });

  it("rejects malformed headers", () => {
    const malformed = { ok: false, reason: "malformed" };
    expect(verifySignature({ ...base, timestamp: "12.5" })).toEqual(malformed);
    expect(verifySignature({ ...base, signature: "sha256=abc" })).toEqual(malformed);
    expect(verifySignature({ ...base, signature: VECTOR.post.sig.toUpperCase() })).toEqual(
      malformed,
    );
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then asks to wait", () => {
    const rl = createRateLimiter(2, 60_000);
    expect(rl.hit("a", 0)).toBe(0);
    expect(rl.hit("a", 1_000)).toBe(0);
    expect(rl.hit("a", 2_000)).toBe(58);
    expect(rl.hit("b", 2_000)).toBe(0);
    expect(rl.hit("a", 60_000)).toBe(0);
  });
});
