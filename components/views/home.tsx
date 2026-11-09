/** Home page content (served at /[locale] through the proxy rewrite, see proxy.ts). */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/components/locale-link";
import { WeekView } from "@/components/picks/week-view";
import { KickoffNotify } from "@/components/views/kickoff-notify";
import type { Locale } from "@/i18n/routing";
import { getCurrentWeek, getRecordRows, getSeasonPhase } from "@/lib/site/data";
import { MODEL_CARD_URL } from "@/lib/site/legal";
import { tally } from "@/lib/site/record";
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

/**
 * Offseason mode (from the Super Bowl until the next schedule): the track record, how
 * the model works and a "Notify me at kickoff" signup instead of an empty week.
 */
async function Offseason({ locale }: { locale: Locale }) {
  const [t, tr, rows] = await Promise.all([
    getTranslations({ locale, namespace: "Offseason" }),
    getTranslations({ locale, namespace: "Record" }),
    getRecordRows(),
  ]);
  const all = tally(rows);
  const card = "rounded-lg border border-border bg-card p-5";
  const link = "mt-3 inline-block text-sm text-accent underline underline-offset-4";
  return (
    <section aria-labelledby="offseason" className="space-y-6">
      <div className="max-w-2xl">
        <h2 id="offseason" className="text-xl font-semibold text-balance">
          {t("title")}
        </h2>
        <p className="mt-2 text-pretty text-muted-foreground">{t("body")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className={card}>
          <h3 className="text-sm text-muted-foreground">{t("recordLabel")}</h3>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {all.ties > 0
              ? tr("wlt", { wins: all.wins, losses: all.losses, ties: all.ties })
              : tr("wl", { wins: all.wins, losses: all.losses })}
          </p>
          <Link href="/record" prefetch={false} className={link}>
            {t("recordLink")}
          </Link>
        </div>
        <div className={card}>
          <h3 className="font-semibold">{t("methodTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("methodBody")}</p>
          <div className="flex flex-wrap gap-x-4">
            <Link href="/about" prefetch={false} className={link}>
              {t("methodLink")}
            </Link>
            <a href={MODEL_CARD_URL} rel="noopener noreferrer" className={link}>
              {t("modelCard")}
            </a>
          </div>
        </div>
        <div className={card}>
          <h3 className="font-semibold">{t("notifyTitle")}</h3>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">{t("notifyBody")}</p>
          <KickoffNotify
            locale={locale}
            labels={{
              signUp: t("notifySignUp"),
              button: t("notifyButton"),
              done: t("notifyDone"),
              error: t("notifyError"),
            }}
          />
        </div>
      </div>
    </section>
  );
}

/** The current week (the week of the next unfinished game), or offseason mode. */
async function CurrentWeek({ locale }: { locale: Locale }) {
  const [current, phase] = await Promise.all([getCurrentWeek(), getSeasonPhase()]);
  if (!current || phase === "offseason") return <Offseason locale={locale} />;
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
