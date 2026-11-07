import { Check, Minus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CheckoutButtons } from "@/components/pricing/checkout-buttons";
import type { Locale } from "@/i18n/routing";
import { pageMetadata } from "@/lib/site/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/pricing">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return pageMetadata({
    locale,
    path: "/pricing",
    title: t("pricingTitle"),
    description: t("pricingDescription"),
  });
}

type Cell = string | boolean;

/** Free vs Pro (spec 15). Static; the buttons ask the server for the viewer's plan. */
export default async function PricingPage({ params }: PageProps<"/[locale]/pricing">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Pricing" });
  const rows: [string, Cell, Cell][] = [
    [t("featPicks"), t("all"), t("all")],
    [t("featBreakdown"), t("featBreakdownFree"), t("all")],
    [t("featProjections"), false, true],
    [t("featAlerts"), false, t("soon")],
    [t("featAssistant"), t("featAssistantFree"), t("featAssistantPro")],
    [t("featRecord"), true, true],
  ];
  const cell = (c: Cell) =>
    c === true ? (
      <Check aria-label="✓" className="mx-auto size-4 text-accent" />
    ) : c === false ? (
      <Minus aria-label="–" className="mx-auto size-4 text-muted-foreground" />
    ) : (
      <span className="text-sm">{c}</span>
    );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-10">
      <header className="mb-8 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">{t("free")}</h2>
          <p className="mt-2 text-3xl font-bold">{t("freePrice")}</p>
        </section>
        <section className="rounded-lg border-2 border-accent bg-card p-6">
          <h2 className="text-lg font-semibold">{t("pro")}</h2>
          <p className="mt-2 text-3xl font-bold">{t("monthly")}</p>
          <p className="text-muted-foreground">{t("season")}</p>
          <p className="mt-2 mb-4 text-sm text-accent">{t("trial")}</p>
          <CheckoutButtons
            locale={locale}
            labels={{
              monthly: t("chooseMonthly"),
              season: t("chooseSeason"),
              current: t("current"),
              signInFirst: t("signInFirst"),
              unavailable: t("unavailable"),
              error: t("error"),
            }}
          />
        </section>
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left">
          <thead className="bg-muted text-sm">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium" />
              <th scope="col" className="px-4 py-3 text-center font-medium">
                {t("free")}
              </th>
              <th scope="col" className="px-4 py-3 text-center font-medium">
                {t("pro")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([feature, free, pro]) => (
              <tr key={feature} className="border-t border-border">
                <th scope="row" className="px-4 py-3 text-sm font-normal">
                  {feature}
                </th>
                <td className="px-4 py-3 text-center">{cell(free)}</td>
                <td className="px-4 py-3 text-center">{cell(pro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("cancelAnytime")}</p>
    </div>
  );
}
