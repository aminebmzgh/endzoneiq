"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  analyticsEnabled,
  CONSENT_EVENT,
  CONSENT_OPEN_EVENT,
  getConsent,
  reportClientError,
  setConsent,
  track,
} from "@/lib/analytics/client";

function subscribeConsent(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The stored choice; "unknown" while rendering on the server (pages are shared HTML). */
function useConsent() {
  return useSyncExternalStore(subscribeConsent, getConsent, () => "unknown" as const);
}

/** Page views (after consent) and uncaught errors from our own scripts. Renders nothing. */
export function Telemetry() {
  const pathname = usePathname();
  const consent = useConsent();

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Only our bundles: extensions and injected scripts are not our bugs.
      if (e.filename?.startsWith(`${window.location.origin}/_next/`)) {
        reportClientError(e.error ?? e.message, "window");
      }
    };
    window.addEventListener("error", onError);
    return () => window.removeEventListener("error", onError);
  }, []);

  useEffect(() => {
    if (consent === "granted") track("$pageview");
  }, [pathname, consent]);

  return null;
}

/** GDPR consent for analytics: shown until the visitor chooses; refusing is as easy as accepting. */
export function ConsentBanner({
  labels,
  policyHref,
}: {
  labels: { text: string; accept: string; decline: string; policy: string; title: string };
  policyHref: string;
}) {
  const consent = useConsent();
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    const reopen = () => setReopened(true);
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!analyticsEnabled() || (consent !== null && !reopened)) return null;
  const choose = (v: "granted" | "denied") => {
    setConsent(v);
    setReopened(false);
  };
  const button =
    "h-10 flex-1 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted sm:flex-none";
  return (
    <section
      aria-label={labels.title}
      className="fixed inset-x-0 bottom-0 z-50 p-3 sm:right-auto sm:bottom-4 sm:left-4 sm:max-w-md"
    >
      <div className="rounded-lg border border-border bg-card p-4 text-sm shadow-lg">
        <p className="text-pretty">
          {labels.text}{" "}
          <a href={policyHref} className="text-accent underline underline-offset-4">
            {labels.policy}
          </a>
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className={button} onClick={() => choose("denied")}>
            {labels.decline}
          </button>
          <button type="button" className={button} onClick={() => choose("granted")}>
            {labels.accept}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Footer link that reopens the banner. Absent when analytics are off (nothing to choose). */
export function CookieSettingsButton({ label }: { label: string }) {
  if (!analyticsEnabled()) return null;
  return (
    <button
      type="button"
      className="hover:text-foreground hover:underline"
      onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
    >
      {label}
    </button>
  );
}
