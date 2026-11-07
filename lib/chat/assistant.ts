import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Locale } from "@/i18n/routing";
import { runTool, TOOL_SCHEMAS, type ToolContext } from "./tools";

/**
 * The assistant's agentic loop (spec 10.2): stream Claude's answer, run the tools it
 * asks for against our own data, repeat. A hard deadline aborts the request well before
 * Hostinger's 120 s limit (spec: no response may run past 90 s).
 */

export const DEADLINE_MS = 85_000;
export const MAX_TURNS = 6;
const MAX_TOKENS = 1500;

const LANGUAGE: Record<Locale, string> = {
  en: "English",
  fr: "French (as French-speaking NFL fans write it)",
  es: "Spanish (as Spanish-speaking NFL fans write it)",
};

export function systemPrompt(locale: Locale, today: Date): string {
  return `You are the EndzoneIQ assistant. EndzoneIQ is a fan-first NFL analysis site: every game gets a pick, a win probability, a confidence tier and plain-language reasons from a statistical model, and every pick is tracked in a public record. It is not a betting site.

Scope
- Answer only questions about the NFL and about EndzoneIQ (its picks, model, track record, how the site works). Politely decline anything else in one short sentence and say what you can help with.

Facts
- Use the tools for every fact about games, teams, players, injuries, picks and results. Do not use outside knowledge for current facts (records, injuries, news, trades); if our data doesn't have something, say so plainly.
- Cite the data you used, for example: "Based on our model's Week 10 data, ...".
- Picks are model estimates, never certainties. Never promise or guarantee an outcome, and no hype.
- If the user asks about betting, odds, spreads as wagers or parlays: don't give betting advice, and add one short sentence that EndzoneIQ is for entertainment and information, not betting advice.
- If a tool says something is locked for this user (EndzoneIQ Pro), say it's part of Pro. Don't guess what it says.

Style
- Reply in ${LANGUAGE[locale]}. Team names stay in English.
- Be brief: 2 to 6 sentences, or a short list. No tables.

Today is ${today.toISOString().slice(0, 10)} (UTC).`;
}

export type ChatEvent = { type: "text"; text: string } | { type: "tool"; name: string };

export type StopReason = "done" | "deadline" | "refusal" | "max_turns" | "error";

export interface AssistantResult {
  text: string;
  tokens: number;
  stopped: StopReason;
}

type Client = Pick<Anthropic, "messages">;

export async function runAssistant(opts: {
  client: Client;
  model: string;
  history: Anthropic.MessageParam[];
  ctx: ToolContext;
  onEvent: (e: ChatEvent) => void;
  deadlineMs?: number;
  now?: Date;
}): Promise<AssistantResult> {
  const { client, model, ctx, onEvent } = opts;
  const messages: Anthropic.MessageParam[] = [...opts.history];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.deadlineMs ?? DEADLINE_MS);
  let text = "";
  let tokens = 0;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: "text",
              text: systemPrompt(ctx.locale, opts.now ?? new Date()),
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: TOOL_SCHEMAS,
          messages,
        },
        { signal: abort.signal },
      );
      stream.on("text", (delta) => {
        text += delta;
        onEvent({ type: "text", text: delta });
      });
      const message = await stream.finalMessage();
      tokens += message.usage.input_tokens + message.usage.output_tokens;

      if (message.stop_reason === "refusal") return { text, tokens, stopped: "refusal" };
      const calls = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (calls.length === 0 || message.stop_reason !== "tool_use") {
        return { text, tokens, stopped: "done" };
      }

      messages.push({ role: "assistant", content: message.content });
      for (const c of calls) onEvent({ type: "tool", name: c.name });
      const results = await Promise.all(calls.map((c) => runTool(c.name, c.input, ctx)));
      messages.push({
        role: "user",
        content: calls.map((c, i) => ({
          type: "tool_result" as const,
          tool_use_id: c.id,
          content: results[i]!.content,
          is_error: results[i]!.isError,
        })),
      });
      // Separate the text of successive turns.
      if (text && !text.endsWith("\n")) {
        text += "\n\n";
        onEvent({ type: "text", text: "\n\n" });
      }
    }
    return { text, tokens, stopped: "max_turns" };
  } catch (err) {
    if (abort.signal.aborted || err instanceof Anthropic.APIUserAbortError) {
      return { text, tokens, stopped: "deadline" };
    }
    console.error("[chat] assistant failed", err);
    return { text, tokens, stopped: "error" };
  } finally {
    clearTimeout(timer);
  }
}
