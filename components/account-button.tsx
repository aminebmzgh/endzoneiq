"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Me = { signedIn: boolean; plan?: "free" | "pro" };

/**
 * Header link: "Sign in" or "Account" (+ Pro badge). Pages are cached HTML shared by
 * everyone, so who is signed in is asked in the browser.
 */
export function AccountButton({
  locale,
  labels,
}: {
  locale: string;
  labels: { signIn: string; account: string };
}) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((m: Me) => alive && setMe(m))
      .catch(() => alive && setMe({ signedIn: false }));
    return () => {
      alive = false;
    };
  }, []);

  const signedIn = me?.signedIn ?? false;
  return (
    <Link
      href={signedIn ? `/${locale}/account` : `/${locale}/signin`}
      prefetch={false}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-muted"
    >
      {signedIn ? labels.account : labels.signIn}
      {me?.plan === "pro" && (
        <span className="rounded bg-accent px-1 text-[10px] font-bold text-accent-foreground">
          PRO
        </span>
      )}
    </Link>
  );
}
