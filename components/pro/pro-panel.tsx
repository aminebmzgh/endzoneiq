"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Driver = { concept: string; label: string; impact: number };
type ProData = {
  signedIn: boolean;
  plan: "free" | "pro" | null;
  breakdown: { reasons: string[]; matchupNotes: string[] } | null;
  pro: {
    home: string;
    away: string;
    predSpread: number;
    predTotal: number;
    drivers: { pick: "home" | "away"; for: Driver[]; against: Driver[] };
  } | null;
};

export type ProPanelLabels = {
  reasonsHeading: string;
  matchupHeading: string;
  modelNote: string;
  locked: string;
  unlock: string;
  heading: string;
  teaser: string;
  margin: string;
  /** Template with {team} and {points}. */
  marginValue: string;
  total: string;
  /** Template with {points}. */
  totalValue: string;
  drivers: string;
  driversHelp: string;
  forPick: string;
  againstPick: string;
  concepts: Record<string, string>;
  teams: Record<string, string>;
};

const fill = (tpl: string, v: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/**
 * The parts of a game page that depend on who is looking. The cached HTML has the
 * public content; this asks /api/pro/game (authorized on the server by lib/authz.ts)
 * for the rest: reasons 2-3 and matchup notes on non-free games, and Pro projections.
 */
export function ProPanel({
  slug,
  locale,
  freeBreakdown,
  labels,
}: {
  slug: string;
  locale: string;
  freeBreakdown: boolean;
  labels: ProPanelLabels;
}) {
  const [data, setData] = useState<ProData | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/pro/game?slug=${encodeURIComponent(slug)}&locale=${locale}`, {
      credentials: "same-origin",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ProData | null) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, locale]);

  const pricing = `/${locale}/pricing`;
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const pro = data?.pro ?? null;
  const extra = !freeBreakdown ? (data?.breakdown ?? null) : null;

  return (
    <>
      {!freeBreakdown &&
        (extra ? (
          <>
            <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold">{labels.reasonsHeading}</h2>
              <ol className="space-y-3" start={2}>
                {extra.reasons.slice(1).map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
                    >
                      {i + 2}
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
              <h2 className="mb-3 text-base font-semibold">{labels.matchupHeading}</h2>
              <ul className="list-disc space-y-2 pl-5">
                {extra.matchupNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">{labels.modelNote}</p>
            </section>
          </>
        ) : (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock aria-hidden className="size-4 shrink-0" />
              {labels.locked}
            </p>
            <Link
              href={pricing}
              prefetch={false}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
            >
              {labels.unlock}
            </Link>
          </section>
        ))}

      <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          {labels.heading}
          <span className="rounded bg-accent px-1 text-[10px] font-bold text-accent-foreground">
            PRO
          </span>
        </h2>
        {pro ? (
          <ProDetails pro={pro} labels={labels} fmt={fmt} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{labels.teaser}</p>
            <Link
              href={pricing}
              prefetch={false}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              {labels.unlock}
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

function ProDetails({
  pro,
  labels,
  fmt,
}: {
  pro: NonNullable<ProData["pro"]>;
  labels: ProPanelLabels;
  fmt: Intl.NumberFormat;
}) {
  const leader = pro.predSpread >= 0 ? pro.home : pro.away;
  const drivers = [
    ...pro.drivers.for.map((d) => ({ ...d, side: "for" as const })),
    ...pro.drivers.against.map((d) => ({ ...d, side: "against" as const })),
  ];
  const max = Math.max(...drivers.map((d) => Math.abs(d.impact)), 0.0001);
  const name = (d: Driver) => labels.concepts[d.concept] ?? d.label;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">{labels.margin}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {fill(labels.marginValue, {
              team: labels.teams[leader] ?? leader,
              points: fmt.format(Math.abs(pro.predSpread)),
            })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{labels.total}</dt>
          <dd className="text-lg font-semibold tabular-nums">
            {fill(labels.totalValue, { points: fmt.format(pro.predTotal) })}
          </dd>
        </div>
      </dl>
      {drivers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{labels.drivers}</h3>
          <p className="mb-3 text-xs text-muted-foreground">{labels.driversHelp}</p>
          <ul className="space-y-2">
            {drivers.map((d) => (
              <li key={`${d.side}-${d.concept}`} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span>{name(d)}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.side === "for" ? labels.forPick : labels.againstPick}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-track">
                  <div
                    className={`h-1.5 rounded-full ${d.side === "for" ? "bg-accent" : "bg-danger"}`}
                    style={{ width: `${(Math.abs(d.impact) / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
