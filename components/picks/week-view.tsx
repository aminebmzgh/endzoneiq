import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/components/locale-link";
import { getWeekGames, getWeeks } from "@/lib/site/data";
import { roundLabel, weekHref } from "@/lib/site/labels";
import type { Locale } from "@/i18n/routing";
import { GameCard } from "./game-card";

/** A week of games as cards, with the week selector (spec 11.1). */
export async function WeekView({
  season,
  week,
  locale,
  headingLevel = "h2",
}: {
  season: number;
  week: number;
  locale: Locale;
  headingLevel?: "h1" | "h2";
}) {
  const [games, weeks, t] = await Promise.all([
    getWeekGames(season, week, locale),
    getWeeks(season),
    getTranslations({ locale, namespace: "Week" }),
  ]);
  const idx = weeks.findIndex((w) => w.week === week);
  const current = weeks[idx];
  const round = current ? roundLabel(t, current.gameType, week) : t("regular", { week });
  const prev = idx > 0 ? weeks[idx - 1] : undefined;
  const next = idx >= 0 && idx < weeks.length - 1 ? weeks[idx + 1] : undefined;
  const Heading = headingLevel;
  const anyPick = games.some((g) => g.pick);

  return (
    <section aria-labelledby="week-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{t("season", { season })}</p>
          <Heading id="week-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t("heading", { round })}
          </Heading>
        </div>
        <div className="flex gap-1">
          {prev ? (
            <Link
              href={weekHref(season, prev.week)}
              prefetch={false}
              className="rounded-md border border-border p-2 hover:bg-muted"
              aria-label={t("previous")}
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
          ) : null}
          {next ? (
            <Link
              href={weekHref(season, next.week)}
              prefetch={false}
              className="rounded-md border border-border p-2 hover:bg-muted"
              aria-label={t("next")}
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>

      {weeks.length > 0 && (
        <nav aria-label={t("selector")} className="-mx-4 mt-4 overflow-x-auto px-4">
          <ul className="flex gap-1.5 pb-2">
            {weeks.map((w) => {
              const active = w.week === week;
              return (
                <li key={w.week}>
                  <Link
                    href={weekHref(season, w.week)}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-full px-3 py-1 text-sm whitespace-nowrap ${
                      active
                        ? "bg-foreground text-background"
                        : "border border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {w.gameType === "REG" ? w.week : roundLabel(t, w.gameType, w.week)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {games.length === 0 ? (
        <p className="mt-8 text-muted-foreground">{t("noGames")}</p>
      ) : (
        <>
          {!anyPick && <p className="mt-6 text-muted-foreground">{t("picksPending")}</p>}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function WeekSkeleton() {
  return (
    <div aria-busy="true">
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="mt-2 h-8 w-56 rounded bg-muted" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-44 rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}
