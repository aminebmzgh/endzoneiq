"use client";

import { useEffect, useState } from "react";

export type SignInLabels = {
  email: string;
  emailPlaceholder: string;
  send: string;
  sending: string;
  /** Template with {email}. */
  sent: string;
  or: string;
  google: string;
  error: string;
  notConfigured: string;
};

type Providers = { email: boolean; google: boolean };

/** ?next= from the URL, only if it is a path on this site in this locale. */
export function safeNext(search: string, locale: string, fallback: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith(`/${locale}/`) && !next.startsWith("//") && !next.includes("\\")
    ? next
    : fallback;
}

/**
 * Magic link and Google sign-in through Better Auth's HTTP endpoints (plain fetch:
 * no auth client library in the browser).
 */
export function SignInForm({
  locale,
  callbackPath: fallbackPath,
  labels,
}: {
  locale: string;
  callbackPath: string;
  labels: SignInLabels;
}) {
  const [providers, setProviders] = useState<Providers | null>(null);
  const [callbackPath, setCallbackPath] = useState(fallbackPath);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    const target = safeNext(window.location.search, locale, fallbackPath);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the URL once
    setCallbackPath(target);
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((m: { signedIn: boolean; providers: Providers }) => {
        if (m.signedIn) window.location.replace(target);
        else setProviders(m.providers);
      })
      .catch(() => setProviders({ email: false, google: false }));
  }, [locale, fallbackPath]);

  async function post(path: string, body: unknown) {
    const res = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json() as Promise<{ url?: string }>;
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      await post("/sign-in/magic-link", { email, callbackURL: callbackPath });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  async function google() {
    try {
      const { url } = await post("/sign-in/social", {
        provider: "google",
        callbackURL: callbackPath,
      });
      if (url) window.location.assign(url);
    } catch {
      setState("error");
    }
  }

  if (providers && !providers.email && !providers.google) {
    return <p className="text-muted-foreground">{labels.notConfigured}</p>;
  }
  if (state === "sent") {
    return (
      <p role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-4">
        {labels.sent.replace("{email}", email)}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <form onSubmit={sendLink} className="space-y-3" lang={locale}>
        <label className="block text-sm font-medium">
          {labels.email}
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={labels.emailPlaceholder}
            className="mt-1 block h-11 w-full rounded-md border border-border bg-background px-3"
          />
        </label>
        <button
          type="submit"
          disabled={state === "sending" || providers?.email === false}
          className="h-11 w-full rounded-md bg-accent font-medium text-accent-foreground disabled:opacity-60"
        >
          {state === "sending" ? labels.sending : labels.send}
        </button>
      </form>
      {providers?.google && (
        <>
          <p className="text-center text-sm text-muted-foreground">{labels.or}</p>
          <button
            type="button"
            onClick={google}
            className="h-11 w-full rounded-md border border-border font-medium hover:bg-muted"
          >
            {labels.google}
          </button>
        </>
      )}
      {state === "error" && (
        <p role="alert" className="text-sm text-danger">
          {labels.error}
        </p>
      )}
    </div>
  );
}
