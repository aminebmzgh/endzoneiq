import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { WeekSkeleton } from "@/components/picks/week-view";
import { HomeView, homeMetadata } from "@/components/views/home";
import { RecordView, recordMetadata } from "@/components/views/record";
import type { Locale } from "@/i18n/routing";

/**
 * Internal route behind the public home (/[locale]) and track record
 * (/[locale]/record) URLs; proxy.ts rewrites to it and 404s direct visits.
 *
 * Why: the build can't reach the database (MySQL is local to the Hostinger server),
 * and every page whose params are all known at build time (the locale) would be
 * prerendered with data. `view` is not known at build time, so these pages render on
 * their first visit, are stored as static entries, and are refreshed when the cache
 * tags of their data are revalidated by an ingest (or hourly). Under load they're
 * served from that cache instead of being rendered per request.
 */

type Props = PageProps<"/[locale]/ez-view/[view]">;

/** Served as a static page from cache, refreshed when its data's cache tags are revalidated. */
export const ensureStatic = "navigation";

/** Placeholder for the build (404s before any data access); real views render on their first visit. */
export function generateStaticParams() {
  return [{ view: "_" }];
}

const VIEWS = {
  home: { View: HomeView, metadata: homeMetadata },
  record: { View: RecordView, metadata: recordMetadata },
} as const;

function lookup(view: string) {
  return Object.hasOwn(VIEWS, view) ? VIEWS[view as keyof typeof VIEWS] : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, view } = await params;
  const v = lookup(view);
  return v ? v.metadata(locale as Locale) : {};
}

async function Content({ params }: { params: Props["params"] }) {
  const { locale, view } = (await params) as { locale: Locale; view: string };
  setRequestLocale(locale);
  const v = lookup(view);
  if (!v) notFound();
  return <v.View locale={locale} />;
}

export default function ViewPage({ params }: Props) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
          <WeekSkeleton />
        </div>
      }
    >
      <Content params={params} />
    </Suspense>
  );
}
