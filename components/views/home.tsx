/** Home page content (served at /[locale] through the proxy rewrite, see proxy.ts). */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { WeekView } from "@/components/picks/week-view";
import type { Locale } from "@/i18n/routing";
import { getCurrentWeek } from "@/lib/site/data";
import { jsonLd, pageMetadata, SITE_NAME, siteUrl } from "@/lib/site/seo";

export async function homeMetadata(locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Meta" });
  return pageMetadata({
    locale,
    path: "",
    title: t("title"),
    description: t("description"),
    absoluteTitle: true,
  });
}

/** The current week (the week of the next unfinished game). */
async function CurrentWeek({ locale }: { locale: Locale }) {
  const current = await getCurrentWeek();
  if (!current) {
    const t = await getTranslations({ locale, namespace: "Home" });
    return <p className="text-muted-foreground">{t("offseason")}</p>;
  }
  return <WeekView season={current.season} week={current.week} locale={locale} />;
}

export async function HomeView({ locale }: { locale: Locale }) {
  const [t, tm] = await Promise.all([
    getTranslations({ locale, namespace: "Home" }),
    getTranslations({ locale, namespace: "Meta" }),
  ]);
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${siteUrl()}/${locale}`,
    inLanguage: locale,
    description: tm("description"),
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          {t("tagline")}
        </h1>
        <p className="mt-3 text-pretty text-muted-foreground">{t("intro")}</p>
      </header>
      <CurrentWeek locale={locale} />
    </div>
  );
}
