import "server-only";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { chatMessages, chatThreads } from "@/db/schema";
import { routing, type Locale } from "@/i18n/routing";
import { getViewer, isAdmin, ownsResource, type Viewer } from "@/lib/authz";
import { sameOrigin } from "@/lib/billing/routes";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { type AssistantResult, type ChatEvent, runAssistant } from "./assistant";

/**
 * POST /api/chat (streamed answer) and GET /api/chat (the viewer's threads and one
 * thread's messages). Signed-in users only; a thread is only ever read or extended by
 * its owner. Questions per UTC day are counted in MySQL (spec 10.2).
 */

const HISTORY_MESSAGES = 10;
const ADMIN_LIMIT = 500;
const noStore = { "Cache-Control": "private, no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

export function chatConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.ANTHROPIC_API_KEY && env.CLAUDE_MODEL_CHAT);
}

export function dailyLimit(v: NonNullable<Viewer>): number {
  const env = serverEnv();
  if (isAdmin(v)) return ADMIN_LIMIT;
  return v.plan === "pro" ? env.CHAT_LIMIT_PRO : env.CHAT_LIMIT_FREE;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function questionsToday(userId: string, now: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, startOfUtcDay(now)),
      ),
    );
  return row?.n ?? 0;
}

async function ownedThread(viewer: Viewer, threadId: string) {
  const [t] = await getDb()
    .select({ id: chatThreads.id, userId: chatThreads.userId })
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId));
  return t && ownsResource(viewer, t.userId) ? t : null;
}

const postBody = z.object({
  message: z.string().trim().min(1).max(500),
  threadId: z.string().uuid().optional(),
  locale: z.enum(routing.locales),
});

type Deps = {
  viewer: (req: Request) => Promise<Viewer>;
  client: () => Pick<Anthropic, "messages">;
  model: () => string;
  now: () => Date;
  run?: typeof runAssistant;
};

let anthropic: Anthropic | undefined;
const defaults: Deps = {
  viewer: (req) => getViewer(req.headers),
  client: () =>
    (anthropic ??= new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY, maxRetries: 1 })),
  model: () => serverEnv().CLAUDE_MODEL_CHAT!,
  now: () => new Date(),
};

const STOPPED_NOTE: Record<Locale, Partial<Record<AssistantResult["stopped"], string>>> = {
  en: {
    deadline: "\n\n(Answer stopped: it took too long. Please ask again, more briefly.)",
    error: "Sorry, something went wrong. Please try again.",
    refusal: "Sorry, I can't help with that. I can answer questions about the NFL and EndzoneIQ.",
  },
  fr: {
    deadline:
      "\n\n(Réponse interrompue : elle prenait trop de temps. Reposez la question plus brièvement.)",
    error: "Désolé, une erreur s'est produite. Veuillez réessayer.",
    refusal:
      "Désolé, je ne peux pas aider avec cela. Je réponds aux questions sur la NFL et EndzoneIQ.",
  },
  es: {
    deadline:
      "\n\n(Respuesta interrumpida: tardaba demasiado. Vuelve a preguntar de forma más breve.)",
    error: "Lo siento, algo salió mal. Inténtalo de nuevo.",
    refusal: "Lo siento, no puedo ayudar con eso. Respondo preguntas sobre la NFL y EndzoneIQ.",
  },
};

export function chatPostHandler(deps: Deps = defaults) {
  return async (req: Request): Promise<Response> => {
    if (!chatConfigured()) return json(503, { error: "the assistant is not configured" });
    if (!sameOrigin(req)) return json(403, { error: "cross-origin request" });
    const viewer = await deps.viewer(req);
    if (!viewer) return json(401, { error: "sign in first" });
    const parsed = postBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json(422, { error: "invalid request" });
    const { message, locale } = parsed.data;
    const now = deps.now();
    const db = getDb();

    const limit = dailyLimit(viewer);
    const used = await questionsToday(viewer.userId, now);
    if (used >= limit) return json(429, { error: "daily limit reached", limit, remaining: 0 });

    let threadId = parsed.data.threadId;
    if (threadId) {
      if (!(await ownedThread(viewer, threadId))) return json(404, { error: "thread not found" });
    } else {
      threadId = randomUUID();
      await db.insert(chatThreads).values({
        id: threadId,
        userId: viewer.userId,
        title: message.slice(0, 120),
      });
    }
    const earlier = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.threadId, threadId))
      .orderBy(desc(chatMessages.id))
      .limit(HISTORY_MESSAGES);
    const [question] = await db.insert(chatMessages).values({
      threadId,
      userId: viewer.userId,
      role: "user",
      content: message,
    });
    const history: Anthropic.MessageParam[] = [
      ...earlier.reverse().map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: message },
    ];
    // The API needs the history to start with a user turn.
    while (history[0]?.role === "assistant") history.shift();

    const encoder = new TextEncoder();
    const run = deps.run ?? runAssistant;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: object) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        send({ type: "start", threadId, remaining: limit - used - 1, limit });
        const result = await run({
          client: deps.client(),
          model: deps.model(),
          history,
          ctx: { viewer, locale },
          onEvent: (e: ChatEvent) => send(e),
          now,
        });
        let answer = result.text;
        const note = STOPPED_NOTE[locale][result.stopped];
        if (note && (result.stopped === "deadline" || !answer.trim())) {
          answer += note;
          send({ type: "text", text: note });
        }
        if (result.stopped === "error" && !result.text.trim()) {
          // Nothing was answered: give the question back.
          await db.delete(chatMessages).where(eq(chatMessages.id, question.insertId));
        } else {
          await db.insert(chatMessages).values({
            threadId: threadId!,
            userId: viewer.userId,
            role: "assistant",
            content: answer,
            tokens: result.tokens,
          });
          await db
            .update(chatThreads)
            .set({ updatedAt: new Date() })
            .where(eq(chatThreads.id, threadId!));
        }
        send({ type: "done", stopped: result.stopped });
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        ...noStore,
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  };
}

/** GET /api/chat[?threadId=]: the viewer's recent threads, one thread's messages, quota. */
export function chatGetHandler(deps: Pick<Deps, "viewer" | "now"> = defaults) {
  return async (req: Request): Promise<Response> => {
    const viewer = await deps.viewer(req);
    if (!viewer) return json(401, { error: "sign in first" });
    const db = getDb();
    const threadId = new URL(req.url).searchParams.get("threadId");
    const threads = await db
      .select({ id: chatThreads.id, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.userId, viewer.userId))
      .orderBy(desc(chatThreads.updatedAt))
      .limit(20);
    let messages: { role: string; content: string }[] = [];
    if (threadId) {
      if (!(await ownedThread(viewer, threadId))) return json(404, { error: "thread not found" });
      messages = await db
        .select({ role: chatMessages.role, content: chatMessages.content })
        .from(chatMessages)
        .where(eq(chatMessages.threadId, threadId))
        .orderBy(asc(chatMessages.id));
    }
    const limit = dailyLimit(viewer);
    const used = await questionsToday(viewer.userId, deps.now());
    return json(200, {
      configured: chatConfigured(),
      plan: viewer.plan,
      limit,
      remaining: Math.max(0, limit - used),
      threads: threads.map((t) => ({ ...t, updatedAt: t.updatedAt.toISOString() })),
      messages,
    });
  };
}
