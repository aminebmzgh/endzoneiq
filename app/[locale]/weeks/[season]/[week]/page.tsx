import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { WeekSkeleton, WeekView } from "@/components/picks/week-view";
import type { Locale } from "@/i18n/routing";
import { getWeeks } from "@/lib/site/data";
import { roundLabel, weekHref } from "@/lib/site/labels";
import { pageMetadata } from "@/lib/site/seo";

type Props = PageProps<"/[locale]/weeks/[season]/[week]">;

/** Served as a static page from cache, refreshed when its data's cache tags are revalidated. */
export const ensureStatic = "navigation";

/** Placeholder for the build (404s before any data access); weeks render on their first visit. */
export function generateStaticParams() {
  return [{ season: "_", week: "_" }];
}

function parse(season: string, week: string) {
  const s = Number(season);
  const w = Number(week);
  return Number.isInteger(s) && s >= 2012 && s <= 2100 && Number.isInteger(w) && w >= 1 && w <= 25
    ? { season: s, week: w }
    : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, season, week } = await params;
  const p = parse(season, week);
  if (!p) return {};
  const [tm, tw, weeks] = await Promise.all([
    getTranslations({ locale, namespace: "Meta" }),
    getTranslations({ locale, namespace: "Week" }),
    getWeeks(p.season),
  ]);
  const ref = weeks.find((w) => w.week === p.week);
  const round = roundLabel(tw, ref?.gameType ?? "REG", p.week);
  return pageMetadata({
    locale,
    path: weekHref(p.season, p.week),
    title: tm("weekTitle", { round, season: p.season }),
    description: tm("weekDescription", { round, season: p.season }),
  });
}

async function Week({ params }: { params: Props["params"] }) {
  const { locale, season, week } = (await params) as {
    locale: Locale;
    season: string;
    week: string;
  };
  setRequestLocale(locale);
  const p = parse(season, week);
  if (!p) notFound();
  const weeks = await getWeeks(p.season);
  if (!weeks.some((w) => w.week === p.week)) notFound();
  return <WeekView season={p.season} week={p.week} locale={locale} headingLevel="h1" />;
}

export default function WeekPage({ params }: Props) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <Suspense fallback={<WeekSkeleton />}>
        <Week params={params} />
      </Suspense>
    </div>
  );
}
