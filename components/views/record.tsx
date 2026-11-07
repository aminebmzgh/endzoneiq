/** Track record content (served at /[locale]/record through the proxy rewrite, see proxy.ts). */
import { Link2 } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocalTime } from "@/components/local-time";
import { RecordTable } from "@/components/record/record-table";
import type { Locale } from "@/i18n/routing";
import { getChainHead, getRecordRows } from "@/lib/site/data";
import {
  bySeason,
  byTier,
  calibration,
  tally,
  type CalibrationBin,
  type Tally,
} from "@/lib/site/record";
import { pageMetadata } from "@/lib/site/seo";

export async function recordMetadata(locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Meta" });
  return pageMetadata({
    locale,
    path: "/record",
    title: t("recordTitle"),
    description: t("recordDescription"),
    absoluteTitle: true,
  });
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card p-4 sm:p-5 ${className}`}>
      {children}
    </section>
  );
}

function CalibrationChart({ bins, label }: { bins: CalibrationBin[]; label: string }) {
  // Reliability diagram: x = predicted, y = actual, on the 50–100% range.
  const W = 240;
  const P = 24;
  const scale = (v: number) => P + ((v - 0.5) / 0.5) * (W - 2 * P);
  const pts = bins.filter((b) => b.count > 0 && b.predicted !== null && b.actual !== null);
  return (
    <svg viewBox={`0 0 ${W} ${W}`} className="w-full max-w-60" role="img" aria-label={label}>
      <rect
        x={P}
        y={P}
        width={W - 2 * P}
        height={W - 2 * P}
        fill="none"
        className="stroke-border"
      />
      <line
        x1={scale(0.5)}
        y1={W - scale(0.5)}
        x2={scale(1)}
        y2={W - scale(1)}
        className="stroke-muted-foreground"
        strokeDasharray="4 4"
      />
      {[0.5, 0.75, 1].map((v) => (
        <text
          key={v}
          x={scale(v)}
          y={W - 6}
          textAnchor="middle"
          className="fill-muted-foreground text-[10px]"
        >
          {Math.round(v * 100)}%
        </text>
      ))}
      {pts.map((b) => (
        <circle
          key={b.from}
          cx={scale(b.predicted!)}
          cy={W - scale(Math.max(0.5, b.actual!))}
          r={Math.min(10, 3 + Math.sqrt(b.count))}
          className="fill-accent/70 stroke-accent"
        />
      ))}
    </svg>
  );
}

async function RecordContent({ locale }: { locale: Locale }) {
  const [rows, chain, t, tt] = await Promise.all([
    getRecordRows(),
    getChainHead(),
    getTranslations({ locale, namespace: "Record" }),
    getTranslations({ locale, namespace: "Tier" }),
  ]);
  const to = await getTranslations({ locale, namespace: "Outcome" });
  const pctFmt = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const p0 = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const dec = new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const all = tally(rows);
  const seasons = bySeason(rows);
  const tiers = byTier(rows);
  const bins = calibration(rows);
  const graded = all.wins + all.losses + all.ties;
  const wl = (x: Tally) =>
    x.ties
      ? t("wlt", { wins: x.wins, losses: x.losses, ties: x.ties })
      : t("wl", { wins: x.wins, losses: x.losses });

  return (
    <div className="space-y-4">
      {graded === 0 && (
        <p className="rounded-lg border border-border bg-card p-4 text-muted-foreground">
          {t("noGraded")}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <h2 className="text-sm text-muted-foreground">{t("allTime")}</h2>
          <p className="mt-1 text-3xl font-bold tabular-nums">{wl(all)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {all.winRate !== null && (
              <>
                {t("winRate")}: {pctFmt.format(all.winRate)} ·{" "}
              </>
            )}
            {t("pending", { count: all.pending })}
          </p>
        </Card>
        {seasons.slice(0, 1).map((s) => (
          <Card key={s.season}>
            <h2 className="text-sm text-muted-foreground">
              {t("seasonLabel", { season: s.season })}
            </h2>
            <p className="mt-1 text-3xl font-bold tabular-nums">{wl(s.tally)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {s.tally.winRate !== null
                ? `${t("winRate")}: ${pctFmt.format(s.tally.winRate)}`
                : t("pending", { count: s.tally.pending })}
            </p>
          </Card>
        ))}
        <Card>
          <h2 className="text-sm text-muted-foreground">{t("brier")}</h2>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {all.brier !== null ? dec.format(all.brier) : "–"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("brierHelp")}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">{t("byTier")}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="pb-2 font-medium" />
                <th scope="col" className="pb-2 text-right font-medium">
                  {t("picks")}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {t("colResult")}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {t("winRate")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(["strong", "solid", "lean"] as const).map((tier) => {
                const x = tiers[tier];
                return (
                  <tr key={tier} className="border-t border-border">
                    <th scope="row" className="py-2 text-left font-medium">
                      {tt(tier)}
                    </th>
                    <td className="py-2 text-right tabular-nums">
                      {x.wins + x.losses + x.ties + x.pending}
                    </td>
                    <td className="py-2 text-right tabular-nums">{wl(x)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {x.winRate !== null ? pctFmt.format(x.winRate) : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">{tt("help")}</p>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{t("calibration")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("calibrationHelp")}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <CalibrationChart bins={bins} label={t("calibration")} />
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="pb-2 font-medium" />
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("picks")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("predicted")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("actual")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.from} className="border-t border-border">
                    <th
                      scope="row"
                      className="py-1.5 text-left font-normal whitespace-nowrap tabular-nums"
                    >
                      {t("range", { from: p0.format(b.from), to: p0.format(b.to) })}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{b.count}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {b.predicted !== null ? p0.format(b.predicted) : "–"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {b.actual !== null ? p0.format(b.actual) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <Link2 aria-hidden className="size-4" />
            {t("chain")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("chainHelp")}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("chainLatest")}</dt>
              <dd className="font-mono text-xs break-all">{chain.head ?? "–"}</dd>
            </div>
          </dl>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("chainCount", { count: chain.count })}
            {chain.lastPublishedAt && (
              <>
                {" · "}
                {t("chainUpdated")} <LocalTime iso={chain.lastPublishedAt} locale={locale} />
              </>
            )}
          </p>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">{t("ats")}</h2>
          <p className="text-sm text-muted-foreground">{t("atsUnavailable")}</p>
        </Card>
      </div>

      {seasons.length > 1 && (
        <Card>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {seasons.map((s) => (
              <li key={s.season}>
                <span className="text-muted-foreground">{s.season}</span>{" "}
                <span className="font-medium tabular-nums">{wl(s.tally)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section aria-labelledby="all-picks" className="pt-4">
        <h2 id="all-picks" className="mb-3 text-xl font-bold">
          {t("table")}
        </h2>
        <RecordTable
          rows={rows}
          locale={locale}
          labels={{
            filterSeason: t("filterSeason"),
            filterTeam: t("filterTeam"),
            filterResult: t("filterResult"),
            all: t("all"),
            showing: t.raw("showing") as string,
            noRows: t("noRows"),
            colWeek: t("colWeek"),
            colGame: t("colGame"),
            colPick: t("colPick"),
            colProb: t("colProb"),
            colScore: t("colScore"),
            colResult: t("colResult"),
            outcome: {
              win: to("win"),
              loss: to("loss"),
              tie: to("tie"),
              pending: to("pending"),
            },
          }}
        />
      </section>
    </div>
  );
}

export async function RecordView({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "Record" });
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="mb-6 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="mt-2 text-pretty text-muted-foreground">{t("intro")}</p>
      </header>
      <RecordContent locale={locale} />
    </div>
  );
}
