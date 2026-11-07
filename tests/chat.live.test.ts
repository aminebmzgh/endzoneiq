/**
 * Live acceptance test for the assistant (spec Phase 6), against real Claude and the
 * local dev database (with real picks). Opt-in, costs a few cents:
 *
 *   LIVE_CLAUDE=1 ANTHROPIC_API_KEY=... CLAUDE_MODEL_CHAT=... npx vitest run tests/chat.live.test.ts
 *
 * Asks about a game from the current week, an off-topic question, and a French question.
 */
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { resetServerEnvForTests } from "@/lib/env";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  authConfigured: () => true,
  googleConfigured: () => false,
  getAuth: () => ({}),
}));

const live =
  process.env.LIVE_CLAUDE === "1" &&
  Boolean(process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_MODEL_CHAT);

describe.runIf(live)("assistant, live", () => {
  async function ask(question: string, locale: "en" | "fr" = "en") {
    resetServerEnvForTests();
    const { runAssistant } = await import("@/lib/chat/assistant");
    const tools: string[] = [];
    const t0 = Date.now();
    const r = await runAssistant({
      client: new Anthropic(),
      model: process.env.CLAUDE_MODEL_CHAT!,
      history: [{ role: "user", content: question }],
      ctx: { viewer: { userId: "live", email: "live@test", role: "user", plan: "pro" }, locale },
      onEvent: (e) => e.type === "tool" && tools.push(e.name),
    });
    const seconds = (Date.now() - t0) / 1000;
    console.info(
      `\nQ: ${question}\nTools: ${tools.join(", ") || "none"} (${seconds.toFixed(1)} s, ${r.tokens} tokens, ${r.stopped})\nA: ${r.text}\n`,
    );
    return { ...r, tools, seconds };
  }

  it("answers 'why do you like the home team' from stored data", async () => {
    const { getCurrentWeek, getWeekGames } = await import("@/lib/site/data");
    const week = (await getCurrentWeek())!;
    const game = (await getWeekGames(week.season, week.week, "en")).find(
      (g) => g.pick?.side === "home" && g.pick.headline,
    )!;
    const r = await ask(`Why do you like the home team in ${game.away.name} at ${game.home.name}?`);
    expect(r.stopped).toBe("done");
    expect(r.tools).toContain("get_game_detail");
    expect(r.text).toContain(String(Math.round(game.pick!.winProb * 100)));
    expect(r.seconds).toBeLessThan(90);
  }, 120_000);

  it("declines off-topic questions", async () => {
    const r = await ask("Can you write me a Python script that sorts a list?");
    expect(r.tools).toHaveLength(0);
    expect(r.text.length).toBeLessThan(600);
  }, 120_000);

  it("answers in French", async () => {
    const r = await ask("Quel est le bilan de votre modèle cette saison ?", "fr");
    expect(r.tools).toContain("get_track_record");
    expect(r.text).toMatch(/[éèàç]|\bnous\b|\bnotre\b|\bmodèle\b/);
  }, 120_000);
});
