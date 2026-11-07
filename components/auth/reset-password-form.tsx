"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type ResetLabels = {
  newPassword: string;
  confirmPassword: string;
  passwordHint: string;
  mismatch: string;
  tooShort: string;
  savePassword: string;
  saving: string;
  resetDone: string;
  invalidLink: string;
  signInButton: string;
  error: string;
};

/**
 * Lands here from the emailed link: Better Auth checks the token and redirects to this
 * page with ?token= (or ?error=INVALID_TOKEN). The new password is posted with it.
 */
export function ResetPasswordForm({ locale, labels }: { locale: string; labels: ResetLabels }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the URL once
    setToken(q.get("error") ? null : q.get("token"));
  }, []);

  const signIn = (
    <Link
      href={`/${locale}/signin`}
      prefetch={false}
      className="inline-flex h-11 items-center rounded-md bg-accent px-4 font-medium text-accent-foreground"
    >
      {labels.signInButton}
    </Link>
  );

  if (token === undefined) return <div aria-busy="true" className="h-40" />;
  if (token === null) {
    return (
      <div className="space-y-4">
        <p role="alert">{labels.invalidLink}</p>
        {signIn}
      </div>
    );
  }
  if (state === "done") {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-4">
          {labels.resetDone}
        </p>
        {signIn}
      </div>
    );
  }

  const field = "mt-1 block h-11 w-full rounded-md border border-border bg-background px-3";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) return setError(labels.tooShort);
        if (password !== confirm) return setError(labels.mismatch);
        setState("busy");
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newPassword: password, token }),
        }).catch(() => null);
        if (res?.ok) setState("done");
        else {
          setState("idle");
          setError(res?.status === 400 ? labels.invalidLink : labels.error);
        }
      }}
    >
      <label className="block text-sm font-medium">
        {labels.newPassword}
        <input
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {labels.passwordHint}
        </span>
      </label>
      <label className="block text-sm font-medium">
        {labels.confirmPassword}
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={field}
        />
      </label>
      <button
        type="submit"
        disabled={state === "busy"}
        className="h-11 w-full rounded-md bg-accent font-medium text-accent-foreground disabled:opacity-60"
      >
        {state === "busy" ? labels.saving : labels.savePassword}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
