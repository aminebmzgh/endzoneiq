"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";

export type SignInLabels = {
  intro: string;
  introSignUp: string;
  email: string;
  emailPlaceholder: string;
  password: string;
  passwordHint: string;
  signInButton: string;
  signingIn: string;
  createAccount: string;
  creating: string;
  noAccount: string;
  haveAccount: string;
  forgot: string;
  forgotIntro: string;
  sendReset: string;
  /** Template with {email}. */
  resetSent: string;
  /** Template with {email}. */
  signUpSent: string;
  useLink: string;
  send: string;
  sending: string;
  /** Template with {email}. */
  sent: string;
  backToSignIn: string;
  or: string;
  google: string;
  error: string;
  invalidCredentials: string;
  notVerified: string;
  exists: string;
  tooShort: string;
  tooMany: string;
  notConfigured: string;
};

type Providers = { email: boolean; google: boolean };
type Mode = "signin" | "signup" | "forgot" | "link";

/** ?next= from the URL, only if it is a path on this site in this locale. */
export function safeNext(search: string, locale: string, fallback: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith(`/${locale}/`) && !next.startsWith("//") && !next.includes("\\")
    ? next
    : fallback;
}

/** Map a Better Auth error status to a message. */
export function authError(status: number, labels: SignInLabels): string {
  if (status === 401) return labels.invalidCredentials;
  if (status === 403) return labels.notVerified;
  if (status === 422) return labels.exists;
  if (status === 429) return labels.tooMany;
  return labels.error;
}

const input = "mt-1 block h-11 w-full rounded-md border border-border bg-background px-3";
const primary =
  "h-11 w-full rounded-md bg-accent font-medium text-accent-foreground disabled:opacity-60";
const linkButton =
  "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/**
 * Email + password sign-in (the default), account creation, password reset and the
 * one-time emailed link, through Better Auth's HTTP endpoints (plain fetch: no auth
 * client library in the browser).
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
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const target = safeNext(window.location.search, locale, fallbackPath);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the URL once
    setCallbackPath(target);
    // ?mode=signup opens the sign-up form directly (offseason "Notify me at kickoff").
    if (new URLSearchParams(window.location.search).get("mode") === "signup") setMode("signup");
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((m: { signedIn: boolean; providers: Providers }) => {
        if (m.signedIn) window.location.replace(target);
        else setProviders(m.providers);
      })
      .catch(() => setProviders({ email: false, google: false }));
  }, [locale, fallbackPath]);

  const post = (path: string, body: unknown) =>
    fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        const res = await post("/sign-in/email", {
          email,
          password,
          callbackURL: callbackPath,
          rememberMe: true,
        });
        if (res.ok) {
          track("sign_in", { method: "password" });
          // Full load: the header and every cached page re-check who is signed in.
          window.location.replace(callbackPath);
          return;
        }
        setError(authError(res.status, labels));
      } else if (mode === "signup") {
        if (password.length < 8) {
          setError(labels.tooShort);
          return;
        }
        const res = await post("/sign-up/email", {
          email,
          password,
          name: email.split("@")[0]!.slice(0, 60),
          callbackURL: callbackPath,
        });
        if (res.ok) {
          track("sign_up", { method: "password" });
          setNotice(labels.signUpSent.replace("{email}", email));
        } else setError(res.status === 400 ? labels.tooShort : authError(res.status, labels));
      } else if (mode === "forgot") {
        const res = await post("/request-password-reset", {
          email,
          redirectTo: `/${locale}/reset-password`,
        });
        if (res.ok) setNotice(labels.resetSent.replace("{email}", email));
        else setError(authError(res.status, labels));
      } else {
        const res = await post("/sign-in/magic-link", { email, callbackURL: callbackPath });
        if (res.ok) setNotice(labels.sent.replace("{email}", email));
        else setError(authError(res.status, labels));
      }
    } catch {
      setError(labels.error);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const res = await post("/sign-in/social", { provider: "google", callbackURL: callbackPath });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (res.ok && data.url) window.location.assign(data.url);
    else setError(labels.error);
  }

  if (providers && !providers.email && !providers.google) {
    return <p className="text-muted-foreground">{labels.notConfigured}</p>;
  }

  const needsPassword = mode === "signin" || mode === "signup";
  const submitLabel =
    mode === "signin"
      ? busy
        ? labels.signingIn
        : labels.signInButton
      : mode === "signup"
        ? busy
          ? labels.creating
          : labels.createAccount
        : mode === "forgot"
          ? labels.sendReset
          : busy
            ? labels.sending
            : labels.send;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {mode === "signup"
          ? labels.introSignUp
          : mode === "forgot"
            ? labels.forgotIntro
            : labels.intro}
      </p>

      {notice ? (
        <p role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-4">
          {notice}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium">
            {labels.email}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={labels.emailPlaceholder}
              className={input}
            />
          </label>
          {needsPassword && (
            <label className="block text-sm font-medium">
              <span className="flex items-baseline justify-between">
                {labels.password}
                {mode === "signin" && (
                  <button type="button" onClick={() => switchTo("forgot")} className={linkButton}>
                    {labels.forgot}
                  </button>
                )}
              </span>
              <input
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                maxLength={128}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
              />
              {mode === "signup" && (
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {labels.passwordHint}
                </span>
              )}
            </label>
          )}
          <button type="submit" disabled={busy || providers?.email === false} className={primary}>
            {submitLabel}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col items-center gap-2 pt-1">
        {mode === "signin" ? (
          <>
            <button type="button" onClick={() => switchTo("signup")} className={linkButton}>
              {labels.noAccount}
            </button>
            <button type="button" onClick={() => switchTo("link")} className={linkButton}>
              {labels.useLink}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => switchTo("signin")} className={linkButton}>
            {mode === "signup" ? labels.haveAccount : labels.backToSignIn}
          </button>
        )}
      </div>

      {providers?.google && (mode === "signin" || mode === "signup") && (
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
    </div>
  );
}
