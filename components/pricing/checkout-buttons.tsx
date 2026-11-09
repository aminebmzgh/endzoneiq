"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/client";

type Me = { signedIn: boolean; plan?: "free" | "pro"; billing?: boolean };

/**
 * Start Stripe Checkout. Not signed in: go to sign-in and come back here. Already Pro:
 * show the current plan. The server re-checks everything (lib/billing/routes.ts).
 */
export function CheckoutButtons({
  locale,
  labels,
}: {
  locale: string;
  labels: {
    monthly: string;
    season: string;
    current: string;
    signInFirst: string;
    unavailable: string;
    error: string;
  };
}) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState<"monthly" | "season" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe({ signedIn: false }));
  }, []);

  if (me?.plan === "pro") {
    return (
      <p className="rounded-md border border-accent px-3 py-2 text-center text-sm font-medium">
        {labels.current}
      </p>
    );
  }

  if (me && !me.billing) {
    return (
      <p className="rounded-md border border-border px-3 py-2 text-center text-sm text-muted-foreground">
        {labels.unavailable}
      </p>
    );
  }

  async function start(plan: "monthly" | "season") {
    if (me && !me.signedIn) {
      router.push(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/pricing`)}`);
      return;
    }
    setBusy(plan);
    setError(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, locale }),
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string };
    if (res.ok && data.url) {
      track("checkout_started", { plan });
      window.location.assign(data.url);
      return;
    }
    setBusy(null);
    if (res.status === 401) {
      router.push(`/${locale}/signin?next=${encodeURIComponent(`/${locale}/pricing`)}`);
    } else {
      setError(res.status === 503 ? labels.unavailable : labels.error);
    }
  }

  const base = "h-11 w-full rounded-md font-medium disabled:opacity-60";
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => start("monthly")}
        className={`${base} bg-accent text-accent-foreground`}
      >
        {labels.monthly}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => start("season")}
        className={`${base} border border-accent`}
      >
        {labels.season}
      </button>
      {me && !me.signedIn && (
        <p className="text-center text-xs text-muted-foreground">{labels.signInFirst}</p>
      )}
      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
