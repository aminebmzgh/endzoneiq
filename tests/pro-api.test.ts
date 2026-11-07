/** GET /api/pro/game and /api/me: free users never receive Pro data (spec 9, 15). */
import { describe, expect, it, vi } from "vitest";
import type { Viewer } from "@/lib/authz";
import { meHandler, proGameHandler } from "@/lib/pro/routes";

vi.mock("@/lib/auth", () => ({ authConfigured: () => true, googleConfigured: () => false }));

const detail = (freeBreakdown: boolean) => ({
  gameId: "2026_09_NYJ_KC",
  home: "KC",
  away: "NYJ",
  freeBreakdown,
  reasons: ["One.", "Two.", "Three."],
  matchupNotes: ["Note."],
  predSpread: 6.5,
  predTotal: 44.2,
  shap: { pick: "home" as const, for: [], against: [] },
});
const viewers: Record<string, Viewer> = {
  anon: null,
  free: { userId: "f", email: "f@x.com", role: "user", plan: "free" },
  pro: { userId: "p", email: "p@x.com", role: "user", plan: "pro" },
};

async function call(viewer: Viewer, free: boolean, query = "slug=nyj-at-kc-2026-week-9&locale=en") {
  const handler = proGameHandler({
    viewer: async () => viewer,
    detail: async () => detail(free),
  });
  const res = await handler(new Request(`http://localhost/api/pro/game?${query}`));
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
}

describe("pro game API", () => {
  it("gives anonymous and free users no Pro data on a non-free game", async () => {
    for (const v of [viewers.anon, viewers.free]) {
      const { status, body, cache } = await call(v, false);
      expect(status).toBe(200);
      expect(cache).toContain("no-store");
      expect(body.breakdown).toBeNull();
      expect(body.pro).toBeNull();
      expect(JSON.stringify(body)).not.toContain("Two.");
      expect(JSON.stringify(body)).not.toContain("6.5");
    }
  });

  it("gives everyone the full breakdown of a free game, but projections only to Pro", async () => {
    const { body } = await call(viewers.free, true);
    expect(body.breakdown.reasons).toHaveLength(3);
    expect(body.pro).toBeNull();
  });

  it("gives Pro users everything", async () => {
    const { body } = await call(viewers.pro, false);
    expect(body.breakdown.matchupNotes).toEqual(["Note."]);
    expect(body.pro).toMatchObject({ predSpread: 6.5, predTotal: 44.2, home: "KC" });
  });

  it("validates input and 404s games without a pick", async () => {
    expect((await call(viewers.pro, false, "slug=../../etc&locale=en")).status).toBe(422);
    expect((await call(viewers.pro, false, "slug=nyj-at-kc-2026-week-9&locale=de")).status).toBe(
      422,
    );
    const none = proGameHandler({ viewer: async () => viewers.pro, detail: async () => null });
    const res = await none(
      new Request("http://localhost/api/pro/game?slug=nyj-at-kc-2026-week-9&locale=en"),
    );
    expect(res.status).toBe(404);
  });
});

describe("/api/me", () => {
  it("reports Pro access for admins without a subscription", async () => {
    const admin: Viewer = { userId: "a", email: "a@x.com", role: "admin", plan: "free" };
    const res = await meHandler({ viewer: async () => admin })(
      new Request("http://localhost/api/me"),
    );
    expect(await res.json()).toMatchObject({ signedIn: true, plan: "pro", admin: true });
  });

  it("reports the plan and never the email", async () => {
    const res = await meHandler({ viewer: async () => viewers.pro })(
      new Request("http://localhost/api/me"),
    );
    const body = await res.json();
    expect(body).toMatchObject({ signedIn: true, plan: "pro", admin: false });
    expect(JSON.stringify(body)).not.toContain("p@x.com");
    const anon = await (
      await meHandler({ viewer: async () => null })(new Request("http://localhost/api/me"))
    ).json();
    expect(anon).toMatchObject({
      signedIn: false,
      providers: { email: true, google: false },
      billing: false,
    });
  });
});
