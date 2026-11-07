"use client";

import { Plus, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type ChatLabels = {
  signIn: string;
  signInButton: string;
  placeholder: string;
  send: string;
  stop: string;
  newChat: string;
  history: string;
  /** Template with {remaining} and {limit}. */
  remaining: string;
  limitFree: string;
  limitPro: string;
  notConfigured: string;
  error: string;
  you: string;
  assistant: string;
  disclaimer: string;
  examplesTitle: string;
  examples: string[];
  tools: Record<string, string>;
};

type Msg = { role: "user" | "assistant"; content: string };
type Thread = { id: string; title: string };
type State = {
  configured: boolean;
  plan: "free" | "pro";
  limit: number;
  remaining: number;
  threads: Thread[];
};

/**
 * The chat UI. Answers stream from POST /api/chat as NDJSON lines:
 * {type:"start"|"text"|"tool"|"done"}. Plain text rendering (no HTML from the model).
 */
export function ChatApp({ locale, labels }: { locale: string; labels: ChatLabels }) {
  const [state, setState] = useState<State | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async (id: string | null) => {
    const res = await fetch(`/api/chat${id ? `?threadId=${id}` : ""}`, {
      credentials: "same-origin",
    });
    if (res.status === 401) {
      setSignedIn(false);
      return;
    }
    setSignedIn(true);
    const data = (await res.json()) as State & { messages: Msg[] };
    setState(data);
    if (id) setMessages(data.messages);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load(null);
  }, [load]);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages, tool]);

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setMessages((m) => [
      ...m,
      { role: "user", content: question },
      { role: "assistant", content: "" },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: question, locale, ...(threadId ? { threadId } : {}) }),
      });
      if (!res.ok || !res.body) {
        setMessages((m) => m.slice(0, -2));
        if (res.status === 429) setState((s) => (s ? { ...s, remaining: 0 } : s));
        else setError(labels.error);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const e = JSON.parse(line) as
            | { type: "start"; threadId: string; remaining: number; limit: number }
            | { type: "text"; text: string }
            | { type: "tool"; name: string }
            | { type: "done" };
          if (e.type === "start") {
            setThreadId(e.threadId);
            setState((s) => (s ? { ...s, remaining: e.remaining, limit: e.limit } : s));
          } else if (e.type === "text") {
            setTool(null);
            setMessages((m) => {
              const last = m[m.length - 1]!;
              return [...m.slice(0, -1), { ...last, content: last.content + e.text }];
            });
          } else if (e.type === "tool") {
            setTool(labels.tools[e.name] ?? labels.stop);
          }
        }
      }
      void load(null).then(() => undefined);
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
      setTool(null);
    }
  }

  if (signedIn === false) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p>{labels.signIn}</p>
        <Link
          href={`/${locale}/signin?next=${encodeURIComponent(`/${locale}/chat`)}`}
          prefetch={false}
          className="mt-4 inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          {labels.signInButton}
        </Link>
      </div>
    );
  }
  if (!state)
    return <div aria-busy="true" className="h-64 rounded-lg border border-border bg-card" />;
  if (!state.configured) return <p className="text-muted-foreground">{labels.notConfigured}</p>;

  const outOfQuestions = state.remaining <= 0;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_14rem]">
      <div className="flex min-h-[60dvh] flex-col rounded-lg border border-border bg-card">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">{labels.examplesTitle}</p>
              <ul className="space-y-2">
                {labels.examples.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      disabled={busy || outOfQuestions}
                      onClick={() => ask(q)}
                      className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-accent text-accent-foreground" : "bg-muted"
                }`}
              >
                <span className="sr-only">
                  {m.role === "user" ? labels.you : labels.assistant}:{" "}
                </span>
                {m.content || (busy && i === messages.length - 1 ? (tool ?? labels.stop) : "")}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          {outOfQuestions ? (
            <p className="text-sm text-muted-foreground">
              {state.plan === "pro" ? labels.limitPro : labels.limitFree}
            </p>
          ) : (
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="chat-input">
                {labels.placeholder}
              </label>
              <input
                id="chat-input"
                value={input}
                maxLength={500}
                onChange={(e) => setInput(e.target.value)}
                placeholder={labels.placeholder}
                disabled={busy}
                className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label={labels.send}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-60"
              >
                <Send aria-hidden className="size-4" />
              </button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {labels.remaining
              .replace("{remaining}", String(state.remaining))
              .replace("{limit}", String(state.limit))}
            {" · "}
            {labels.disclaimer}
          </p>
          {error && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </div>

      <aside className="space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setThreadId(null);
            setMessages([]);
          }}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border text-sm hover:bg-muted"
        >
          <Plus aria-hidden className="size-4" />
          {labels.newChat}
        </button>
        {state.threads.length > 0 && (
          <>
            <h2 className="pt-2 text-xs font-semibold text-muted-foreground">{labels.history}</h2>
            <ul className="space-y-1">
              {state.threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setThreadId(t.id);
                      void load(t.id);
                    }}
                    className={`w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      t.id === threadId ? "bg-muted" : ""
                    }`}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
