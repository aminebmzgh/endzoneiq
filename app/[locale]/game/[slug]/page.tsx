import { ArrowLeft, CloudSun, Lock, UserX } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { AfterKickoff } from "@/components/after-kickoff";
import { LocalTime } from "@/components/local-time";
import { OutcomeBadge, TeamSwatch, TierBadge, UpdatedBadge } from "@/components/picks/badges";
import { ProbabilityBar } from "@/components/picks/probability-bar";
import { ProPanel } from "@/components/pro/pro-panel";
import { Link } from "@/components/locale-link";
import type { Locale } from "@/i18n/routing";
import { getGame } from "@/lib/site/data";
import { parseChangeReason, pct, roundLabel, weekHref } from "@/lib/site/labels";
import { jsonLd, pageMetadata, siteUrl } from "@/lib/site/seo";
import type { GameDetail, PickVersion } from "@/lib/site/types";

type Props = PageProps<"/[locale]/game/[slug]">;

const SLUG = /^[a-z0-9-]{8,64}$/;

/** SHAP concepts the model reports (pipeline model/explain.py), named in messages "Drivers". */
const DRIVER_CONCEPTS = [
  "home_field",
  "team_strength",
  "qb_change",
  "efficiency",
  "pass_matchup",
  "run_matchup",
  "big_plays",
  "turnovers",
  "injuries",
  "rest",
  "travel",
  "venue",
  "rivalry",
  "playoffs",
  "weather",
] as const;

/** Served as a static page from cache, refreshed when its data's cache tags are revalidated. */
export const ensureStatic = "navigation";

/**
 * Real slugs aren't known at build time (no DB there). A placeholder satisfies the
 * build (it fails the slug check before any data access); real games are generated on
 * their first visit and then served as static pages.
 */
export function generateStaticParams() {
  return [{ slug: "_" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!SLUG.test(slug)) return {};
  const game = await getGame(slug, locale as Locale);
  if (!game) return {};
  const [tm, tw] = await Promise.all([
    getTranslations({ locale, namespace: "Meta" }),
    getTranslations({ locale, namespace: "Week" }),
  ]);
  const round = roundLabel(tw, game.gameType, game.week);
  const base = { away: game.away.name, home: game.home.name, round, season: game.season };
  const pick = game.pick;
  const winner = pick ? (pick.side === "home" ? game.home : game.away) : null;
  return pageMetadata({
    locale,
    path: `/game/${slug}`,
    title:
      pick && winner
        ? tm("gameTitle", { ...base, winner: winner.name, pct: pct(locale, pick.winProb) })
        : `${game.away.name} @ ${game.home.name} | ${round} ${game.season}`,
    description:
      pick && game.explanation
        ? tm("gameDescription", { headline: game.explanation.headline })
        : tm("gameNoPickDescription", base),
  });
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

async function History({ versions, locale }: { versions: PickVersion[]; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "Game" });
  return (
    <Section title={t("history")} icon={<Lock aria-hidden className="size-4" />}>
      <p className="mb-4 text-sm text-muted-foreground">{t("historyHelp")}</p>
      <ol className="space-y-3">
        {versions.map((v) => {
          const r = parseChangeReason(v.changeReason);
          const label =
            r.kind === "first"
              ? t("firstPublished")
              : r.kind === "winner"
                ? t("winnerChanged")
                : r.kind === "moved"
                  ? t("probMoved", { points: r.points })
                  : r.text;
          return (
            <li key={v.versionNo} className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium">
                  v{v.versionNo} ·{" "}
                  {t("versionLine", { winner: v.winnerAbbr, pct: pct(locale, v.winProb) })}
                </span>
                <LocalTime iso={v.publishedAt} locale={locale} className="text-muted-foreground" />
              </div>
              <div className="text-muted-foreground">{label}</div>
              <div
                className="truncate font-mono text-xs text-muted-foreground"
                title={v.contentHash}
              >
                {t("hash")}: {v.contentHash}
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function eventLd(game: GameDetail, locale: string) {
  const status =
    game.status === "canceled"
      ? "https://schema.org/EventCancelled"
      : game.status === "postponed"
        ? "https://schema.org/EventPostponed"
        : "https://schema.org/EventScheduled";
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${game.away.city} ${game.away.name} at ${game.home.city} ${game.home.name}`,
    startDate: game.kickoffAt,
    eventStatus: status,
    sport: "American football",
    url: `${siteUrl()}/${locale}/game/${game.slug}`,
    homeTeam: { "@type": "SportsTeam", name: `${game.home.city} ${game.home.name}` },
    awayTeam: { "@type": "SportsTeam", name: `${game.away.city} ${game.away.name}` },
    ...(game.venue ? { location: { "@type": "Place", name: game.venue } } : {}),
  };
}

async function GameContent({ params }: { params: Props["params"] }) {
  const { locale, slug } = (await params) as { locale: Locale; slug: string };
  setRequestLocale(locale);
  if (!SLUG.test(slug)) notFound();
  const game = await getGame(slug, locale);
  if (!game) notFound();

  const [t, tc, tw, tp, td] = await Promise.all([
    getTranslations({ locale, namespace: "Game" }),
    getTranslations({ locale, namespace: "Card" }),
    getTranslations({ locale, namespace: "Week" }),
    getTranslations({ locale, namespace: "Pro" }),
    getTranslations({ locale, namespace: "Drivers" }),
  ]);
  const round = roundLabel(tw, game.gameType, game.week);
  const { pick, explanation } = game;
  const picked = pick ? (pick.side === "home" ? game.home : game.away) : null;
  const homeProb = pick ? (pick.side === "home" ? pick.winProb : 1 - pick.winProb) : 0.5;
  const final = game.status === "final" && game.homeScore !== null && game.awayScore !== null;
  const indoor = game.stadium?.roofType === "dome";

  return (
    <article className="space-y-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(eventLd(game, locale)) }}
      />
      <Link
        href={weekHref(game.season, game.week)}
        prefetch={false}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t("back", { round: `${round} ${game.season}` })}
      </Link>

      <header>
        <h1 className="flex flex-wrap items-center gap-x-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <span className="flex items-center gap-2">
            <TeamSwatch color={game.away.color} />
            {game.away.city} {game.away.name}
          </span>
          <span className="font-normal text-muted-foreground">{tc("at")}</span>
          <span className="flex items-center gap-2">
            <TeamSwatch color={game.home.color} />
            {game.home.city} {game.home.name}
          </span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <LocalTime iso={game.kickoffAt} locale={locale} />
          {game.venue && <> · {game.venue}</>}
          {game.neutralSite && <> · {tc("neutral")}</>}
        </p>
        {final && (
          <p className="mt-3 flex items-center gap-3 text-lg font-semibold tabular-nums">
            {tc("final")}: {game.away.abbr} {game.awayScore} – {game.homeScore} {game.home.abbr}
            {pick?.outcome && <OutcomeBadge outcome={pick.outcome} />}
          </p>
        )}
      </header>

      {pick && picked ? (
        <section
          className="rounded-lg border border-border bg-card p-4 sm:p-5"
          aria-labelledby="pick"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pick" className="text-sm font-medium text-muted-foreground">
              {tc("pick")}
            </h2>
            <span className="flex items-center gap-1.5">
              {pick.versionNo > 1 && <UpdatedBadge />}
              <TierBadge tier={pick.tier} />
            </span>
          </div>
          <p className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-bold">{picked.name}</span>
            <span className="text-3xl font-bold text-accent tabular-nums">
              {pct(locale, pick.winProb)}
            </span>
          </p>
          <div className="mt-3">
            <ProbabilityBar
              homeProb={homeProb}
              homeName={game.home.name}
              awayName={game.away.name}
              pickedSide={pick.side}
            />
            <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
              <span>
                {game.away.abbr} {pct(locale, 1 - homeProb)}
              </span>
              <span>
                {game.home.abbr} {pct(locale, homeProb)}
              </span>
            </div>
          </div>
          {explanation && (
            <p className="mt-4 text-lg font-medium text-balance">{explanation.headline}</p>
          )}
          {!final && (
            <AfterKickoff
              iso={game.kickoffAt}
              after={
                <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock aria-hidden className="size-3" />
                  {tc("locked")}
                </p>
              }
            />
          )}
        </section>
      ) : (
        <p className="rounded-lg border border-border bg-card p-4 text-muted-foreground">
          {game.status === "scheduled" ? (
            <AfterKickoff iso={game.kickoffAt} before={t("noPick")} after={tc("noPickPast")} />
          ) : (
            tc("noPickPast")
          )}
        </p>
      )}

      {pick && picked && explanation && (
        <>
          {/* Cached HTML: all reasons on the week's free games, the top reason otherwise.
              The rest is authorized per viewer by /api/pro/game (ProPanel). */}
          <Section title={t("reasons", { team: picked.name })}>
            <ol className="space-y-3">
              {(game.freeBreakdown ? explanation.reasons : explanation.reasons.slice(0, 1)).map(
                (r, i) => (
                  <li key={i} className="flex gap-3">
                    <span
                      aria-hidden
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
                    >
                      {i + 1}
                    </span>
                    <span>{r}</span>
                  </li>
                ),
              )}
            </ol>
            {game.freeBreakdown && (
              <p className="mt-3 text-xs text-muted-foreground">{tp("freeGame")}</p>
            )}
          </Section>
          {game.freeBreakdown && (
            <Section title={t("matchup")}>
              <ul className="list-disc space-y-2 pl-5">
                {explanation.matchupNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">{t("modelNote")}</p>
            </Section>
          )}
          <ProPanel
            slug={game.slug}
            locale={locale}
            freeBreakdown={game.freeBreakdown}
            labels={{
              reasonsHeading: t("reasons", { team: picked.name }),
              matchupHeading: t("matchup"),
              modelNote: t("modelNote"),
              locked: tp("locked"),
              unlock: tp("unlock"),
              heading: tp("heading"),
              teaser: tp("teaser"),
              margin: tp("margin"),
              marginValue: tp.raw("marginValue") as string,
              total: tp("total"),
              totalValue: tp.raw("totalValue") as string,
              drivers: tp("drivers"),
              driversHelp: tp("driversHelp"),
              forPick: tp("forPick"),
              againstPick: tp("againstPick"),
              concepts: Object.fromEntries(DRIVER_CONCEPTS.map((c) => [c, td(c)])),
              teams: { [game.home.abbr]: game.home.name, [game.away.abbr]: game.away.name },
            }}
          />
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={t("injuries")} icon={<UserX aria-hidden className="size-4" />}>
          {game.injuries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noInjuries")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {game.injuries.map((i) => (
                <li key={`${i.team}-${i.name}`} className="flex justify-between gap-2">
                  <span>
                    <span className="text-muted-foreground">{i.team}</span> {i.name}{" "}
                    <span className="text-muted-foreground">({i.position})</span>
                  </span>
                  <span>{t(`injuryStatus.${i.status}` as "injuryStatus.out")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("weather")} icon={<CloudSun aria-hidden className="size-4" />}>
          {indoor ? (
            <p className="text-sm text-muted-foreground">{t("indoor")}</p>
          ) : game.weather ? (
            <p className="text-sm">
              {game.weather.condition && <>{game.weather.condition} · </>}
              {game.weather.tempC !== null && t("temp", { temp: Math.round(game.weather.tempC) })}
              {game.weather.windKph !== null && (
                <> · {t("wind", { wind: Math.round(game.weather.windKph) })}</>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noForecast")}</p>
          )}
        </Section>
      </div>

      {game.versions.length > 0 && <History versions={game.versions} locale={locale} />}
    </article>
  );
}

function GameSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="h-4 w-32 rounded bg-muted" />
      <div className="h-9 w-3/4 rounded bg-muted" />
      <div className="h-40 rounded-lg border border-border bg-card" />
      <div className="h-32 rounded-lg border border-border bg-card" />
    </div>
  );
}

export default function GamePage({ params }: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <Suspense fallback={<GameSkeleton />}>
        <GameContent params={params} />
      </Suspense>
    </div>
  );
}
