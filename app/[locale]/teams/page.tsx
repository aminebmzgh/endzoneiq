import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TeamSwatch } from "@/components/picks/badges";
import { TEAMS } from "@/db/seed/reference-data";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { pageMetadata } from "@/lib/site/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/teams">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return pageMetadata({
    locale,
    path: "/teams",
    title: t("teamsTitle"),
    description: t("teamsDescription"),
  });
}

const DIVISIONS = (["AFC", "NFC"] as const).flatMap((conf) =>
  (["East", "North", "South", "West"] as const).map((div) => ({
    key: `${conf} ${div}`,
    teams: TEAMS.filter((t) => t.conference === conf && t.division === div),
  })),
);

/** All 32 teams by division. Reference data only, so fully static. */
export default async function TeamsPage({ params }: PageProps<"/[locale]/teams">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Teams" });
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DIVISIONS.map((d) => (
          <section key={d.key} className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{d.key}</h2>
            <ul className="space-y-1">
              {d.teams.map((team) => (
                <li key={team.abbr}>
                  <Link
                    href={`/teams/${team.abbr.toLowerCase()}`}
                    prefetch={false}
                    className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <TeamSwatch color={team.primaryColor} />
                    {team.city} {team.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
