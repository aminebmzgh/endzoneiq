"use client";

import { useCallback, useEffect, useState } from "react";

type Alerts = {
  pro: boolean;
  vapidPublicKey: string | null;
  notifyPickChange: boolean;
  notifyPickChangeEmail: boolean;
  notifyWeekly: boolean;
  teams: string[];
  pushDevices: number;
};

export type AlertsLabels = {
  push: string;
  pushOn: string;
  enablePush: string;
  disablePush: string;
  pushUnsupported: string;
  pushDenied: string;
  pickChange: string;
  pickChangeEmail: string;
  weekly: string;
  teams: string;
  proOnly: string;
  save: string;
  saved: string;
  error: string;
};

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

async function send(url: string, method: string, body: unknown) {
  return fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Alert preferences, followed teams and this device's push subscription. */
export function AlertsPanel({
  teams,
  labels,
}: {
  teams: { abbr: string; name: string }[];
  labels: AlertsLabels;
}) {
  const [data, setData] = useState<Alerts | null>(null);
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [pushState, setPushState] = useState<"idle" | "busy" | "denied" | "unsupported" | "error">(
    "idle",
  );
  const [saveState, setSaveState] = useState<"idle" | "busy" | "saved" | "error">("idle");

  const load = useCallback(async () => {
    const res = await fetch("/api/alerts", { credentials: "same-origin" });
    if (res.ok) setData((await res.json()) as Alerts);
    if (!supported()) {
      setPushState("unsupported");
      setSubscribed(false);
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration("/");
    setSubscribed(Boolean(await reg?.pushManager.getSubscription()));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the API
    void load();
  }, [load]);

  async function enablePush() {
    if (!data?.vapidPublicKey) return;
    setPushState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(data.vapidPublicKey),
        }));
      const res = await send("/api/alerts/push", "POST", sub.toJSON());
      if (!res.ok) throw new Error(String(res.status));
      setSubscribed(true);
      setPushState("idle");
    } catch {
      setPushState("error");
    }
  }

  async function disablePush() {
    setPushState("busy");
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await send("/api/alerts/push", "DELETE", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setSubscribed(false);
    setPushState("idle");
  }

  if (!data) return <div aria-busy="true" className="h-32" />;
  const set = (patch: Partial<Alerts>) => {
    setData({ ...data, ...patch });
    setSaveState("idle");
  };
  const box = "size-4 accent-[var(--accent)]";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium">{labels.push}</p>
        {pushState === "unsupported" ? (
          <p className="mt-1 text-sm text-muted-foreground">{labels.pushUnsupported}</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {subscribed ? (
              <>
                <span className="text-sm text-accent">{labels.pushOn}</span>
                <button
                  type="button"
                  onClick={disablePush}
                  disabled={pushState === "busy"}
                  className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
                >
                  {labels.disablePush}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={enablePush}
                disabled={pushState === "busy" || !data.vapidPublicKey}
                className="h-9 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground disabled:opacity-60"
              >
                {labels.enablePush}
              </button>
            )}
            {pushState === "denied" && (
              <span className="text-sm text-danger">{labels.pushDenied}</span>
            )}
            {pushState === "error" && <span className="text-sm text-danger">{labels.error}</span>}
          </div>
        )}
      </div>

      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaveState("busy");
          const res = await send("/api/alerts", "PUT", {
            notifyPickChange: data.notifyPickChange,
            notifyPickChangeEmail: data.notifyPickChangeEmail,
            notifyWeekly: data.notifyWeekly,
            teams: data.teams,
          });
          setSaveState(res.ok ? "saved" : "error");
        }}
      >
        {!data.pro && <p className="text-sm text-muted-foreground">{labels.proOnly}</p>}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={box}
            disabled={!data.pro}
            checked={data.notifyPickChange}
            onChange={(e) => set({ notifyPickChange: e.target.checked })}
          />
          {labels.pickChange}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={box}
            disabled={!data.pro}
            checked={data.notifyPickChangeEmail}
            onChange={(e) => set({ notifyPickChangeEmail: e.target.checked })}
          />
          {labels.pickChangeEmail}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={box}
            checked={data.notifyWeekly}
            onChange={(e) => set({ notifyWeekly: e.target.checked })}
          />
          {labels.weekly}
        </label>
        <fieldset disabled={!data.pro}>
          <legend className="mb-2 text-sm">{labels.teams}</legend>
          <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
            {teams.map((t) => {
              const on = data.teams.includes(t.abbr);
              return (
                <button
                  key={t.abbr}
                  type="button"
                  title={t.name}
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      teams: on ? data.teams.filter((x) => x !== t.abbr) : [...data.teams, t.abbr],
                    })
                  }
                  className={`h-8 rounded border text-xs disabled:opacity-50 ${
                    on ? "border-accent bg-accent/15 font-semibold" : "border-border hover:bg-muted"
                  }`}
                >
                  {t.abbr}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saveState === "busy"}
            className="h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-60"
          >
            {labels.save}
          </button>
          {saveState === "saved" && <span className="text-sm text-accent">{labels.saved}</span>}
          {saveState === "error" && <span className="text-sm text-danger">{labels.error}</span>}
        </div>
      </form>
    </div>
  );
}
