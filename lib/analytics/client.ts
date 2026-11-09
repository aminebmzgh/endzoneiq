/**
 * Browser analytics and error reporting, without SDKs (a few hundred bytes instead of
 * posthog-js / @sentry/browser, which would cost Lighthouse TBT on every page).
 *
 * Analytics: PostHog's capture API, only after the visitor accepts (ez-consent), with a
 * random id in localStorage (ez-aid) and anonymous events ($process_person_profile:
 * false). Never an email or user id, and URLs never carry their query string (reset and
 * sign-in links hold tokens). Without NEXT_PUBLIC_POSTHOG_KEY nothing is sent and the
 * consent banner never shows (the site then sets only strictly necessary storage).
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

export const CONSENT_KEY = "ez-consent";
export const ID_KEY = "ez-aid";
/** Fired on window when the visitor changes their choice. */
export const CONSENT_EVENT = "ez-consent-change";
/** Fired on window to reopen the banner ("Cookie settings" in the footer). */
export const CONSENT_OPEN_EVENT = "ez-consent-open";

export type Consent = "granted" | "denied" | null;

export const analyticsEnabled = (): boolean => Boolean(KEY);

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getConsent(): Consent {
  const v = storage()?.getItem(CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

export function setConsent(value: "granted" | "denied"): void {
  const s = storage();
  s?.setItem(CONSENT_KEY, value);
  if (value === "denied") s?.removeItem(ID_KEY);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

function distinctId(s: Storage): string {
  let id = s.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    s.setItem(ID_KEY, id);
  }
  return id;
}

/** Product events. Keep this list short; it is documented in docs/runbook.md. */
export type AnalyticsEvent =
  | "$pageview"
  | "sign_up"
  | "sign_in"
  | "chat_question"
  | "push_enabled"
  | "checkout_started"
  | "offseason_notify";

export function track(event: AnalyticsEvent, props: Record<string, string | number> = {}): void {
  if (!KEY || getConsent() !== "granted") return;
  const s = storage();
  if (!s) return;
  const path = window.location.pathname;
  let referrer: string | undefined;
  try {
    const r = document.referrer ? new URL(document.referrer) : null;
    if (r && r.origin !== window.location.origin) referrer = r.origin;
  } catch {
    // no referrer
  }
  const body = JSON.stringify({
    api_key: KEY,
    event,
    distinct_id: distinctId(s),
    timestamp: new Date().toISOString(),
    properties: {
      $current_url: window.location.origin + path,
      $pathname: path,
      $host: window.location.host,
      ...(referrer ? { $referrer: referrer, $referring_domain: new URL(referrer).host } : {}),
      $screen_width: window.screen.width,
      locale: document.documentElement.lang,
      $process_person_profile: false,
      ...props,
    },
  });
  fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}

/** Sends a browser error to our own /api/client-error (the server forwards it to Sentry). */
export function reportClientError(
  error: unknown,
  source: "boundary" | "global-boundary" | "window",
): void {
  try {
    // Errors with a digest came from the server, which already reported them
    // (instrumentation.ts onRequestError); the browser only sees a generic message.
    if (typeof error === "object" && error !== null && "digest" in error) return;
    const e = error instanceof Error ? error : new Error(String(error));
    fetch("/api/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        name: e.name,
        message: e.message.slice(0, 2000),
        stack: e.stack?.slice(0, 8000),
        path: window.location.pathname,
        source,
      }),
    }).catch(() => {});
  } catch {
    // never let reporting throw
  }
}
