"use client";

import { useState } from "react";

async function postJson(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    ok: res.ok,
    status: res.status,
    data: (await res.json().catch(() => ({}))) as { url?: string },
  };
}

const button =
  "h-10 rounded-md px-4 text-sm font-medium disabled:opacity-60 border border-border hover:bg-muted";

export function ManageBillingButton({
  locale,
  label,
  error,
}: {
  locale: string;
  label: string;
  error: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  return (
    <div>
      <button
        type="button"
        className={button}
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          const r = await postJson("/api/billing/portal", { locale });
          if (r.ok && r.data.url) window.location.assign(r.data.url);
          else setState("error");
        }}
      >
        {label}
      </button>
      {state === "error" && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function SignOutButton({ locale, label }: { locale: string; label: string }) {
  return (
    <button
      type="button"
      className={button}
      onClick={async () => {
        await postJson("/api/auth/sign-out", {});
        // Full reload on purpose: drops every cached client state of the signed-in user.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`/${locale}`);
      }}
    >
      {label}
    </button>
  );
}

export function PreferencesForm({
  initial,
  teams,
  labels,
}: {
  initial: { locale: string; favoriteTeam: string | null };
  teams: { abbr: string; name: string }[];
  labels: {
    language: string;
    favoriteTeam: string;
    none: string;
    save: string;
    saved: string;
    error: string;
    languages: Record<string, string>;
  };
}) {
  const [locale, setLocale] = useState(initial.locale);
  const [team, setTeam] = useState(initial.favoriteTeam ?? "");
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const select = "mt-1 block h-10 w-full rounded-md border border-border bg-background px-2";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        const r = await postJson("/api/account", { locale, favoriteTeam: team || null }, "PATCH");
        setState(r.ok ? "saved" : "error");
      }}
    >
      <label className="block text-sm">
        {labels.language}
        <select className={select} value={locale} onChange={(e) => setLocale(e.target.value)}>
          {Object.entries(labels.languages).map(([code, name]) => (
            <option key={code} value={code} lang={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {labels.favoriteTeam}
        <select className={select} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">{labels.none}</option>
          {teams.map((t) => (
            <option key={t.abbr} value={t.abbr}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state === "busy"}
          className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {labels.save}
        </button>
        {state === "saved" && <span className="text-sm text-accent">{labels.saved}</span>}
        {state === "error" && <span className="text-sm text-danger">{labels.error}</span>}
      </div>
    </form>
  );
}
