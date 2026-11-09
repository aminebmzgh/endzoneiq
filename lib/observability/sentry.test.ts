import { afterEach, describe, expect, it, vi } from "vitest";
import { clientErrorHandler } from "./client-errors";
import {
  buildEnvelope,
  captureError,
  parseDsn,
  parseStack,
  resetSentryForTests,
  type ErrorContext,
} from "./sentry";

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://endzoneiq.com" }),
}));

const DSN = "https://abc123@o42.ingest.de.sentry.io/4507";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SENTRY_DSN;
  resetSentryForTests();
});

describe("sentry client", () => {
  it("parses a DSN into the envelope URL and key", () => {
    expect(parseDsn(DSN)).toEqual({
      key: "abc123",
      envelopeUrl: "https://o42.ingest.de.sentry.io/api/4507/envelope/",
      raw: DSN,
    });
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o42.ingest.sentry.io/4507")).toBeNull(); // no key
  });

  it("turns a V8 stack into frames, oldest first", () => {
    const err = new Error("boom");
    err.stack = [
      "Error: boom",
      "    at inner (/app/server/chunks/a.js:10:5)",
      "    at outer (/app/node_modules/next/dist/x.js:20:7)",
      "    at /app/server/chunks/b.js:30:1",
    ].join("\n");
    const frames = parseStack(err.stack);
    expect(frames.map((f) => f.function)).toEqual(["?", "outer", "inner"]);
    expect(frames[2]).toMatchObject({ filename: "/app/server/chunks/a.js", lineno: 10, colno: 5 });
    expect(frames[1]!.in_app).toBe(false);
  });

  it("builds an envelope with the event, release and tags", () => {
    const { id, body } = buildEnvelope(
      Object.assign(new Error("db down"), { digest: "123" }),
      { source: "render", path: "/en/record", method: "GET" },
      parseDsn(DSN)!,
    );
    const [header, item, event] = body.split("\n").map((l) => JSON.parse(l));
    expect(header).toMatchObject({ event_id: id, dsn: DSN });
    expect(item).toEqual({ type: "event" });
    expect(event).toMatchObject({
      event_id: id,
      level: "error",
      platform: "node",
      tags: { source: "render", digest: "123" },
      request: { url: "/en/record", method: "GET" },
      exception: { values: [{ type: "Error", value: "db down" }] },
    });
  });

  it("does nothing without a DSN", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await captureError(new Error("x"), { source: "test" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to Sentry, at most once a minute for the same error, and never throws", async () => {
    process.env.SENTRY_DSN = DSN;
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    await captureError(new Error("same thing"), { source: "dedupe-test" });
    await captureError(new Error("same thing"), { source: "dedupe-test" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://o42.ingest.de.sentry.io/api/4507/envelope/");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=abc123");
  });
});

describe("POST /api/client-error", () => {
  const post = (body: unknown, origin = "https://endzoneiq.com") =>
    new Request("https://endzoneiq.com/api/client-error", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const valid = {
    name: "TypeError",
    message: "x is undefined",
    stack: "TypeError: x is undefined\n    at f (https://endzoneiq.com/_next/static/a.js:1:2)",
    path: "/en/game/abc?token=secret",
    source: "boundary",
  };

  it("forwards a valid report without the query string", async () => {
    const capture = vi.fn<(e: unknown, c: ErrorContext) => Promise<void>>(async () => {});
    const res = await clientErrorHandler({ capture })(post(valid));
    expect(res.status).toBe(204);
    const [err, ctx] = capture.mock.calls[0]!;
    expect((err as Error).message).toBe("x is undefined");
    expect(ctx).toMatchObject({
      source: "client-boundary",
      platform: "javascript",
      path: "/en/game/abc",
    });
  });

  it("rejects other origins, bad bodies and floods", async () => {
    const capture = vi.fn(async () => {});
    const h = clientErrorHandler({ capture });
    expect((await h(post(valid, "https://evil.example"))).status).toBe(403);
    expect((await h(post("{not json"))).status).toBe(422);
    expect((await h(post({ ...valid, source: "other" }))).status).toBe(422);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await h(post(valid))).status;
    expect(last).toBe(429);
  });
});
