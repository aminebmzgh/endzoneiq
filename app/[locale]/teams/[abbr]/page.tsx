import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { TeamSwatch } from "@/components/picks/badges";
import { GameCard } from "@/components/picks/game-card";
import { TEAMS } from "@/db/seed/reference-data";
import type { Locale } from "@/i18n/routing";
import { getCurrentWeek, getRecordRows, getTeamSeason, getTeamStats } from "@/lib/site/data";
import { tally } from "@/lib/site/record";
import { pageMetadata } from "@/lib/site/seo";

type Props = PageProps<"/[locale]/teams/[abbr]">;

/** Served as a static page from cache, refreshed when its data's cache tags are revalidated. */
export const ensureStatic = "navigation";

/** Placeholder for the build (404s before any data access; the DB isn't reachable there). Team pages render on their first visit. */
export function generateStaticParams() {
  return [{ abbr: "_" }];
}

const BY_SLUG = new Map(TEAMS.map((t) => [t.abbr.toLowerCase(), t]));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, abbr } = await params;
  const team = BY_SLUG.get(abbr);
  if (!team) return {};
  const t = await getTranslations({ locale, namespace: "Meta" });
  const name = `${team.city} ${team.name}`;
  return pageMetadata({
    locale,
    path: `/teams/${abbr}`,
    title: t("teamTitle", { team: name }),
    description: t("teamDescription", { team: name }),
  });
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums">{value}</dd>
      {sub && <dd className="mt-1 text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

async function TeamData({ abbr, locale }: { abbr: string; locale: Locale }) {
  const team = BY_SLUG.get(abbr)!;
  const current = await getCurrentWeek();
  const season = current?.season ?? new Date().getUTCFullYear();
  const [stats, games, rows, t, tr] = await Promise.all([
    getTeamStats(team.abbr),
    getTeamSeason(team.abbr, season, locale),
    getRecordRows(),
    getTranslations({ locale, namespace: "Teams" }),
    getTranslations({ locale, namespace: "Record" }),
  ]);
  const record = tally(rows.filter((r) => r.home === team.abbr || r.away === team.abbr));
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const epa = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  });
  const name = `${team.city} ${team.name}`;

  return (
    <div className="space-y-8">
      {stats ? (
        <div>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={t("elo")}
              value={stats.elo !== null ? num.format(stats.elo) : "–"}
              sub={t("eloHelp")}
            />
            <Stat
              label={t("offense")}
              value={stats.offEpaRank !== null ? t("rank", { rank: stats.offEpaRank }) : "–"}
              sub={stats.offEpa !== null ? `EPA/play ${epa.format(stats.offEpa)}` : undefined}
            />
            <Stat
              label={t("defense")}
              value={stats.defEpaRank !== null ? t("rank", { rank: stats.defEpaRank }) : "–"}
              sub={stats.defEpa !== null ? `EPA/play ${epa.format(stats.defEpa)}` : undefined}
            />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("statsAsOf", { week: stats.week, season: stats.season })}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("noStats")}</p>
      )}

      <section>
        <h2 className="mb-2 text-xl font-bold">{t("modelRecord", { team: team.name })}</h2>
        <p className="text-lg tabular-nums">
          {record.ties
            ? tr("wlt", { wins: record.wins, losses: record.losses, ties: record.ties })
            : tr("wl", { wins: record.wins, losses: record.losses })}
          <span className="ml-2 text-sm text-muted-foreground">
            {tr("pending", { count: record.pending })}
          </span>
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">{t("schedule", { season })}</h2>
        {games.length === 0 ? (
          <p className="text-muted-foreground">{t("noSchedule")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" aria-label={name}>
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TeamSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-3 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

async function Team({ params }: { params: Props["params"] }) {
  const { locale, abbr } = (await params) as { locale: Locale; abbr: string };
  setRequestLocale(locale);
  const team = BY_SLUG.get(abbr);
  if (!team) notFound();
  return (
    <>
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">
          {team.conference} {team.division}
        </p>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <TeamSwatch color={team.primaryColor} />
          {team.city} {team.name}
        </h1>
      </header>
      <TeamData abbr={abbr} locale={locale} />
    </>
  );
}

export default function TeamPage({ params }: Props) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <Suspense fallback={<TeamSkeleton />}>
        <Team params={params} />
      </Suspense>
    </div>
  );
}
