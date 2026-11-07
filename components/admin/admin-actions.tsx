"use client";

import { useEffect, useState } from "react";

type Player = {
  gsisId: string;
  name: string;
  position: string;
  report: string | null;
  override: string | null;
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: res.ok,
    data: (await res.json().catch(() => ({}))) as { dispatched?: boolean; error?: string },
  };
}

const STATUSES = ["", "out", "doubtful", "questionable", "active"] as const;

/** One player's admin status override. Saving triggers a re-prediction of the game. */
export function OverrideSelect({ gameId, player }: { gameId: string; player: Player }) {
  const [value, setValue] = useState(player.override ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <select
        aria-label={`Override for ${player.name}`}
        value={value}
        onChange={async (e) => {
          const next = e.target.value;
          setValue(next);
          setMsg("saving…");
          const r = await post("/api/admin/override", {
            gameId,
            gsisId: player.gsisId,
            status: next || null,
          });
          setMsg(
            r.ok
              ? r.data.dispatched
                ? "saved, re-predicting"
                : "saved (re-predict not configured)"
              : `error: ${r.data.error}`,
          );
        }}
        className="h-8 rounded border border-border bg-background px-1 text-xs"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s ? s.toUpperCase() : "no override"}
          </option>
        ))}
      </select>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </span>
  );
}

export function RepredictButton({ gameId, label }: { gameId: string | null; label: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          setMsg("starting…");
          const r = await post("/api/admin/repredict", { gameId });
          setMsg(r.ok ? "workflow started" : "could not start (is the GitHub token set?)");
        }}
        className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted"
      >
        {label}
      </button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </span>
  );
}

type Run = {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
  title: string;
};

/** Latest repredict.yml runs, refreshed every 15 s. */
export function RepredictRuns() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/runs", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d: { runs: Run[] }) => alive && setRuns(d.runs))
        .catch(() => {});
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!runs) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (runs.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No runs yet (or the GitHub token is not set).</p>
    );
  return (
    <ul className="space-y-1 text-sm">
      {runs.map((r) => (
        <li key={r.id}>
          <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
            {new Date(r.createdAt).toLocaleString()} · {r.title} ·{" "}
            <span
              className={
                r.conclusion === "success" ? "text-accent" : r.conclusion ? "text-danger" : ""
              }
            >
              {r.conclusion ?? r.status}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
