/**
 * AI assistant (spec 10.2): tools read our data with the site's gating, the loop runs
 * tools and respects the deadline, and /api/chat enforces sign-in, same-origin, the
 * daily quota and thread ownership. Claude is a scripted fake here.
 */
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@/db/migrator";
import type { Viewer } from "@/lib/authz";
import { resetServerEnvForTests } from "@/lib/env";
import { ingestPicks } from "@/lib/internal/handlers";
import { sign } from "@/lib/internal/signature";
import { connect, dbReachable, testDbUrl } from "./helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  authConfigured: () => true,
  googleConfigured: () => false,
  getAuth: () => ({}),
}));

const SECRET = "ez-test-secret-for-vitest-0123456789abcdef";
const SITE = "http://localhost:3000";
const SEASON = 2095;
const MODEL = "chattest-model";
// Week 1: KC at 1:00 PM ET (not free), two 4:25 PM games and one 8:20 PM game (free).
const GAME = `${SEASON}_01_BUF_KC`;
const NIGHT = `${SEASON}_01_MIA_NE`; // 8:20 PM ET: a free game
const FREE_USER = "chattest-free";
const PRO_USER = "chattest-pro";

const viewer = (userId: string, plan: "free" | "pro"): Viewer => ({
  userId,
  email: `${userId}@test.endzoneiq`,
  role: "user",
  plan,
});

async function cleanup() {
  const c = await connect();
  await c.query("DELETE FROM user WHERE id IN (?, ?)", [FREE_USER, PRO_USER]); // cascades chats
  await c.end();
}

beforeAll(async () => {
  Object.assign(process.env, {
    INGEST_SECRET: SECRET,
    ANTHROPIC_API_KEY: "sk-ant-test",
    CLAUDE_MODEL_CHAT: "test-model",
    NEXT_PUBLIC_SITE_URL: SITE,
  });
  if (testDbUrl) process.env.DATABASE_URL = testDbUrl;
  resetServerEnvForTests();
  if (!(await dbReachable())) return;
  await runMigrations({
    databaseUrl: testDbUrl!,
    migrationsFolder: path.resolve(import.meta.dirname, "../db/migrations"),
    log: () => {},
  });
  await cleanup();
  const c = await connect();
  for (const id of [FREE_USER, PRO_USER]) {
    await c.query(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(3), NOW(3))",
      [id, id, `${id}@test.endzoneiq`],
    );
    await c.query("INSERT INTO profiles (user_id, plan) VALUES (?, ?)", [
      id,
      id === PRO_USER ? "pro" : "free",
    ]);
  }
  // Idempotent: picks are append-only, so earlier runs' rows stay; re-ingesting is a no-op.
  await c.query(
    "INSERT IGNORE INTO model_versions (name, trained_at, metrics_json) VALUES (?, UTC_TIMESTAMP(), '{}')",
    [MODEL],
  );
  await c.query(
    `INSERT IGNORE INTO games (id, season, week, game_type, home_team_id, away_team_id, kickoff_at, slug) VALUES
     (?, ?, 1, 'REG', 16, 4, '2095-09-11 17:00:00', 'chattest-buf-at-kc'),
     (?, ?, 1, 'REG', 22, 20, '2095-09-12 00:20:00', 'chattest-mia-at-ne'),
     (?, ?, 1, 'REG', 9, 24, '2095-09-11 20:25:00', 'chattest-nyg-at-dal'),
     (?, ?, 1, 'REG', 1, 2, '2095-09-11 20:25:00', 'chattest-atl-at-ari')`,
    [GAME, SEASON, NIGHT, SEASON, `${SEASON}_01_NYG_DAL`, SEASON, `${SEASON}_01_ATL_ARI`, SEASON],
  );
  await c.end();
  const expl = {
    headline: "Chiefs over Bills",
    reasons: [
      "Reason one from the model.",
      "Reason two from the model.",
      "Reason three from the model.",
    ],
    matchupNotes: ["Watch the pass rush."],
    source: "template",
  };
  const pick = (gameId: string) => ({
    gameId,
    homeWinProb: 0.66,
    tier: "solid",
    predMargin: 4.5,
    predTotal: 47.5,
    features: {},
    shap: {
      pick: "home",
      for: [
        { concept: "team_strength", label: "Overall team strength", impact: 0.3, features: {} },
      ],
      against: [],
    },
    explanations: { en: expl, fr: expl, es: expl },
  });
  const raw = JSON.stringify({ modelVersion: MODEL, picks: [pick(GAME), pick(NIGHT)] });
  const ts = String(Math.floor(Date.now() / 1000));
  const p = "/api/internal/ingest/picks";
  const res = await ingestPicks(
    new Request(`${SITE}${p}`, {
      method: "POST",
      body: raw,
      headers: { "x-ez-timestamp": ts, "x-ez-signature": sign(SECRET, ts, "POST", p, raw) },
    }),
  );
  expect(res.status).toBe(200);
});

afterAll(async () => {
  if (await dbReachable()) await cleanup();
});

// --- A scripted Claude ---------------------------------------------------------------

type Turn = {
  text?: string;
  tools?: { name: string; input: unknown }[];
  stop?: string;
  hang?: boolean;
};

function fakeClient(turns: Turn[]) {
  const calls: Anthropic.MessageStreamParams[] = [];
  let i = 0;
  const client = {
    messages: {
      stream(params: Anthropic.MessageStreamParams, opts?: { signal?: AbortSignal }) {
        calls.push(structuredClone(params));
        const turn = turns[i++]!;
        let onText: ((t: string) => void) | null = null;
        return {
          on(event: string, cb: (t: string) => void) {
            if (event === "text") onText = cb;
            return this;
          },
          async finalMessage() {
            if (turn.hang) {
              await new Promise((_, reject) =>
                opts?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
              );
            }
            if (turn.text) onText?.(turn.text);
            const content: unknown[] = [];
            if (turn.text) content.push({ type: "text", text: turn.text });
            (turn.tools ?? []).forEach((t, k) =>
              content.push({ type: "tool_use", id: `tu_${i}_${k}`, name: t.name, input: t.input }),
            );
            return {
              content,
              stop_reason: turn.stop ?? (turn.tools ? "tool_use" : "end_turn"),
              usage: { input_tokens: 100, output_tokens: 20 },
            };
          },
        };
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, calls };
}

// --- Tools ---------------------------------------------------------------------------

describe("team names", () => {
  it("resolve abbreviations, names and legacy codes", async () => {
    const { resolveTeam } = await import("@/lib/chat/tools");
    expect(resolveTeam("kc")).toBe("KC");
    expect(resolveTeam("Chiefs")).toBe("KC");
    expect(resolveTeam("Kansas City Chiefs")).toBe("KC");
    expect(resolveTeam("OAK")).toBe("LV");
    expect(resolveTeam("Giants and Jets")).toBeNull();
    expect(resolveTeam("Martians")).toBeNull();
  });
});

describe.runIf(await dbReachable())("assistant tools", () => {
  const detail = async (v: Viewer, team: string) => {
    const { runTool } = await import("@/lib/chat/tools");
    const r = await runTool(
      "get_game_detail",
      { team, season: SEASON, week: 1 },
      { viewer: v, locale: "en" },
    );
    expect(r.isError).toBe(false);
    return JSON.parse(r.content);
  };

  it("gives a free user only the top reason off the free games, and no projection", async () => {
    const d = await detail(viewer(FREE_USER, "free"), "Chiefs");
    expect(d.pick).toBe("KC");
    expect(d.win_probability_pct).toBe(66);
    expect(d.reasons).toEqual(["Reason one from the model."]);
    expect(d.matchup_notes).toEqual([]);
    expect(d.locked_for_this_user).toMatch(/Pro/);
    expect(typeof d.pro_projection).toBe("string");
    expect(JSON.stringify(d)).not.toContain("Reason two");
  });

  it("gives everyone the full breakdown of a night game", async () => {
    const d = await detail(viewer(FREE_USER, "free"), "NE");
    expect(d.reasons).toHaveLength(3);
    expect(d.free_full_breakdown).toBe(true);
  });

  it("gives a Pro user everything", async () => {
    const d = await detail(viewer(PRO_USER, "pro"), "KC");
    expect(d.reasons).toHaveLength(3);
    expect(d.pro_projection).toMatchObject({
      projected_home_margin_pts: 4.5,
      projected_total_pts: 47.5,
    });
  });

  it("returns errors for bad input instead of throwing", async () => {
    const { runTool } = await import("@/lib/chat/tools");
    const ctx = { viewer: null, locale: "en" as const };
    expect((await runTool("get_game_detail", { team: 42 }, ctx)).isError).toBe(true);
    expect((await runTool("drop_tables", {}, ctx)).isError).toBe(true);
    const unknown = JSON.parse(
      (await runTool("get_game_detail", { team: "Martians" }, ctx)).content,
    );
    expect(unknown.error).toMatch(/Unknown team/);
  });
});

// --- The loop ------------------------------------------------------------------------

describe.runIf(await dbReachable())("assistant loop", () => {
  it("runs the tools it asks for and answers from their data", async () => {
    const { runAssistant } = await import("@/lib/chat/assistant");
    const { client, calls } = fakeClient([
      { tools: [{ name: "get_game_detail", input: { team: "KC", season: SEASON, week: 1 } }] },
      { text: "Based on our model's Week 1 data, we like the Chiefs at 66%." },
    ]);
    const events: unknown[] = [];
    const r = await runAssistant({
      client,
      model: "test-model",
      history: [{ role: "user", content: "Why do you like the home team in Bills at Chiefs?" }],
      ctx: { viewer: viewer(PRO_USER, "pro"), locale: "en" },
      onEvent: (e) => events.push(e),
    });
    expect(r.stopped).toBe("done");
    expect(r.tokens).toBe(240);
    expect(r.text).toContain("Chiefs at 66%");
    expect(events).toContainEqual({ type: "tool", name: "get_game_detail" });
    const second = JSON.stringify(calls[1]!.messages);
    expect(second).toContain("Reason three from the model.");
    expect(calls[0]!.model).toBe("test-model");
    expect(JSON.stringify(calls[0]!.system)).toContain("Answer only questions about the NFL");
  });

  it("stops at the deadline", async () => {
    const { runAssistant } = await import("@/lib/chat/assistant");
    const { client } = fakeClient([{ hang: true }]);
    const t0 = Date.now();
    const r = await runAssistant({
      client,
      model: "m",
      history: [{ role: "user", content: "slow" }],
      ctx: { viewer: null, locale: "en" },
      onEvent: () => {},
      deadlineMs: 50,
    });
    expect(r.stopped).toBe("deadline");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("stops on a refusal without running tools", async () => {
    const { runAssistant } = await import("@/lib/chat/assistant");
    const { client, calls } = fakeClient([
      { tools: [{ name: "get_week_games", input: {} }], stop: "refusal" },
    ]);
    const r = await runAssistant({
      client,
      model: "m",
      history: [{ role: "user", content: "x" }],
      ctx: { viewer: null, locale: "en" },
      onEvent: () => {},
    });
    expect(r.stopped).toBe("refusal");
    expect(calls).toHaveLength(1);
  });
});

// --- The route -----------------------------------------------------------------------

describe.runIf(await dbReachable())("/api/chat", () => {
  const post = async (
    v: Viewer,
    body: object,
    origin = SITE,
    turns: Turn[] = [{ text: "Hello from EndzoneIQ." }],
  ) => {
    const { chatPostHandler } = await import("@/lib/chat/route");
    const { client } = fakeClient(turns);
    const handler = chatPostHandler({
      viewer: async () => v,
      client: () => client,
      model: () => "test-model",
      now: () => new Date(),
    });
    const res = await handler(
      new Request(`${SITE}/api/chat`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", origin },
      }),
    );
    const text = res.ok ? await res.text() : "";
    return {
      status: res.status,
      events: text
        .split("\n")
        .filter(Boolean)
        .map(
          (l) =>
            JSON.parse(l) as { type: string; threadId?: string; text?: string; remaining?: number },
        ),
    };
  };
  const get = async (v: Viewer, threadId?: string) => {
    const { chatGetHandler } = await import("@/lib/chat/route");
    const res = await chatGetHandler({ viewer: async () => v, now: () => new Date() })(
      new Request(`${SITE}/api/chat${threadId ? `?threadId=${threadId}` : ""}`),
    );
    return { status: res.status, body: res.ok ? await res.json() : null };
  };

  it("needs a signed-in, same-origin request with a valid message", async () => {
    expect((await post(null, { message: "hi", locale: "en" })).status).toBe(401);
    expect(
      (
        await post(
          viewer(FREE_USER, "free"),
          { message: "hi", locale: "en" },
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect((await post(viewer(FREE_USER, "free"), { message: "", locale: "en" })).status).toBe(422);
    expect(
      (await post(viewer(FREE_USER, "free"), { message: "x".repeat(501), locale: "en" })).status,
    ).toBe(422);
  });

  it("streams the answer, stores it with its tokens, and counts the question", async () => {
    const { status, events } = await post(viewer(FREE_USER, "free"), {
      message: "Who wins KC?",
      locale: "en",
    });
    expect(status).toBe(200);
    expect(events[0]).toMatchObject({ type: "start", remaining: 2 });
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe("Hello from EndzoneIQ.");
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const threadId = events[0]!.threadId!;
    const { body } = await get(viewer(FREE_USER, "free"), threadId);
    expect(body.messages).toEqual([
      { role: "user", content: "Who wins KC?" },
      { role: "assistant", content: "Hello from EndzoneIQ." },
    ]);
    expect(body.remaining).toBe(2);
    const c = await connect();
    const [[row]] = (await c.query(
      "SELECT tokens FROM chat_messages WHERE thread_id = ? AND role = 'assistant'",
      [threadId],
    )) as unknown as [[{ tokens: number }]];
    await c.end();
    expect(row.tokens).toBe(120);
  });

  it("never lets a user read or extend someone else's thread", async () => {
    const mine = await post(viewer(FREE_USER, "free"), { message: "Mine", locale: "en" });
    const threadId = mine.events[0]!.threadId!;
    expect((await get(viewer(PRO_USER, "pro"), threadId)).status).toBe(404);
    expect(
      (await post(viewer(PRO_USER, "pro"), { message: "Hijack", locale: "en", threadId })).status,
    ).toBe(404);
    const theirs = await get(viewer(PRO_USER, "pro"));
    expect(theirs.body.threads.map((t: { id: string }) => t.id)).not.toContain(threadId);
  });

  it("stops free users after 3 questions a day", async () => {
    const third = await post(viewer(FREE_USER, "free"), { message: "Third", locale: "en" });
    expect(third.status).toBe(200);
    expect(third.events[0]).toMatchObject({ remaining: 0 });
    expect(
      (await post(viewer(FREE_USER, "free"), { message: "Fourth", locale: "en" })).status,
    ).toBe(429);
    expect(
      (await post(viewer(PRO_USER, "pro"), { message: "Pro is fine", locale: "en" })).status,
    ).toBe(200);
  });

  it("gives the question back when nothing could be answered", async () => {
    const before = (await get(viewer(PRO_USER, "pro"))).body.remaining;
    const failing = fakeClient([]).client; // no turns: the stream call throws
    const { chatPostHandler } = await import("@/lib/chat/route");
    const res = await chatPostHandler({
      viewer: async () => viewer(PRO_USER, "pro"),
      client: () => failing,
      model: () => "m",
      now: () => new Date(),
    })(
      new Request(`${SITE}/api/chat`, {
        method: "POST",
        body: JSON.stringify({ message: "boom", locale: "fr" }),
        headers: { "content-type": "application/json", origin: SITE },
      }),
    );
    const text = await res.text();
    expect(text).toContain("Désolé");
    expect((await get(viewer(PRO_USER, "pro"))).body.remaining).toBe(before);
  });
});
