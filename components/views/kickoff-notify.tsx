"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";

type Prefs = {
  notifyPickChange: boolean;
  notifyPickChangeEmail: boolean;
  notifyWeekly: boolean;
  teams: string[];
};

/**
 * Offseason "Notify me at kickoff": the weekly picks email, which goes out the first
 * Tuesday a week has picks. Signed-out visitors are sent to sign-up first (an account
 * confirms the email address, so nobody can subscribe someone else).
 */
export function KickoffNotify({
  locale,
  labels,
}: {
  locale: string;
  labels: { signUp: string; button: string; done: string; error: string };
}) {
  const [state, setState] = useState<"loading" | "signedOut" | "ready" | "busy" | "done" | "error">(
    "loading",
  );
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    fetch("/api/alerts", { credentials: "same-origin" })
      .then(async (r) => {
        if (r.status === 401) return setState("signedOut");
        if (!r.ok) return setState("error");
        const p = (await r.json()) as Prefs;
        setPrefs(p);
        setState(p.notifyWeekly ? "done" : "ready");
      })
      .catch(() => setState("error"));
  }, []);

  const button =
    "inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60";

  if (state === "loading") return <div aria-busy="true" className="h-10" />;
  if (state === "signedOut") {
    const next = encodeURIComponent(`/${locale}/account`);
    return (
      <a href={`/${locale}/signin?mode=signup&next=${next}`} className={button}>
        {labels.signUp}
      </a>
    );
  }
  if (state === "done")
    return (
      <p role="status" className="text-sm text-accent">
        {labels.done}
      </p>
    );
  return (
    <div>
      <button
        type="button"
        className={button}
        disabled={state === "busy" || !prefs}
        onClick={async () => {
          if (!prefs) return;
          setState("busy");
          const r = await fetch("/api/alerts", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              notifyPickChange: prefs.notifyPickChange,
              notifyPickChangeEmail: prefs.notifyPickChangeEmail,
              notifyWeekly: true,
              teams: prefs.teams,
            }),
          }).catch(() => null);
          if (r?.ok) {
            track("offseason_notify");
            setState("done");
          } else setState("error");
        }}
      >
        {labels.button}
      </button>
      {state === "error" && <p className="mt-2 text-sm text-danger">{labels.error}</p>}
    </div>
  );
}
