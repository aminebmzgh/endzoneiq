import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OverrideSelect, RepredictButton, RepredictRuns } from "@/components/admin/admin-actions";
import { adminOverview } from "@/lib/admin/data";
import { getViewer, isAdmin } from "@/lib/authz";

const fmt = (d: Date | string) =>
  new Date(d).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "short",
    timeStyle: "short",
  });

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

async function Admin() {
  const viewer = await getViewer(await headers());
  if (!isAdmin(viewer)) notFound(); // non-admins never learn the page exists
  const o = await adminOverview();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Signed in as {viewer!.email}. Overrides apply to the next prediction of their game; saving
        one starts a re-prediction. Picks of kicked-off games are locked.
      </p>

      <Card title="Re-predict">
        <div className="mb-3">
          <RepredictButton gameId={null} label="Re-predict the whole week" />
        </div>
        <RepredictRuns />
      </Card>

      <Card title="This week: picks and injury overrides">
        {o.games.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming games.</p>
        ) : (
          <div className="space-y-5">
            {o.games.map((g) => (
              <div key={g.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {g.away} @ {g.home}{" "}
                    <span className="text-sm text-muted-foreground">· {fmt(g.kickoffAt)} ET</span>
                  </p>
                  <span className="flex items-center gap-3 text-sm">
                    {g.pick ? (
                      <span>
                        v{g.pick.versionNo} · {g.pick.winner} {Math.round(g.pick.winProb * 100)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">no pick</span>
                    )}
                    <RepredictButton gameId={g.id} label="Re-predict" />
                  </span>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {Object.entries(g.players).map(([team, list]) => (
                    <div key={team}>
                      <p className="mb-1 text-xs font-semibold text-muted-foreground">{team}</p>
                      {list.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No players stored yet (injury_watch).
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {list.map((p) => (
                            <li
                              key={p.gsisId}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span>
                                {p.name}{" "}
                                <span className="text-muted-foreground">({p.position})</span>
                                {p.report && (
                                  <span className="ml-1 text-xs text-danger">{p.report}</span>
                                )}
                              </span>
                              <OverrideSelect gameId={g.id} player={p} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent pipeline runs">
          <ul className="space-y-1 text-sm">
            {o.runs.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span>
                  {r.job} · {fmt(r.startedAt)}
                </span>
                <span
                  className={
                    r.status === "success"
                      ? "text-accent"
                      : r.status === "failure"
                        ? "text-danger"
                        : ""
                  }
                >
                  {r.runUrl ? (
                    <a href={r.runUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {r.status}
                    </a>
                  ) : (
                    r.status
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Ingest log">
          <ul className="space-y-1 font-mono text-xs">
            {o.logs.map((l) => (
              <li key={l.id}>
                {fmt(l.createdAt)} {l.endpoint} {l.status} rows={l.rows} {l.durationMs}ms{" "}
                {l.error && <span className="text-danger">{l.error}</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Model versions">
          <ul className="space-y-1 text-sm">
            {o.models.map((m) => (
              <li key={m.name}>
                {m.name} · {fmt(m.trainedAt)}{" "}
                {m.isActive && <span className="text-accent">active</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Feature flags">
          <ul className="space-y-1 text-sm">
            <li>FEATURE_ODDS: {String(o.flags.FEATURE_ODDS)}</li>
            <li>
              Re-predict dispatch (GITHUB_TOKEN):{" "}
              {o.flags.repredictConfigured ? "configured" : "not set"}
            </li>
            <li>Publishing on schedule: GitHub repository variable PUBLISH_ENABLED</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">
        Endzone<span className="text-accent">IQ</span> admin
      </h1>
      <Suspense
        fallback={<div aria-busy="true" className="h-64 rounded-lg border border-border bg-card" />}
      >
        <Admin />
      </Suspense>
    </main>
  );
}
