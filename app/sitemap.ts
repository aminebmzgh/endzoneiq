import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { DOC_PATHS } from "@/content/legal";
import { TEAMS } from "@/db/seed/reference-data";
import { routing } from "@/i18n/routing";
import { getPublishedGames } from "@/lib/site/data";
import { siteUrl } from "@/lib/site/seo";

/** Every localized page, with hreflang alternates. Games are listed once they have a pick. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection(); // the DB isn't reachable at build time
  const base = siteUrl();
  const entry = (
    path: string,
    opts: Partial<MetadataRoute.Sitemap[number]> = {},
  ): MetadataRoute.Sitemap =>
    routing.locales.map((locale) => ({
      url: `${base}/${locale}${path}`,
      alternates: {
        languages: Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}${path}`])),
      },
      ...opts,
    }));

  const games = await getPublishedGames().catch(() => []);
  return [
    ...entry("", { changeFrequency: "daily", priority: 1 }),
    ...entry("/record", { changeFrequency: "daily", priority: 0.8 }),
    ...entry("/teams", { changeFrequency: "weekly", priority: 0.5 }),
    ...TEAMS.flatMap((t) =>
      entry(`/teams/${t.abbr.toLowerCase()}`, { changeFrequency: "weekly", priority: 0.5 }),
    ),
    ...Object.values(DOC_PATHS).flatMap((path) =>
      entry(path, { changeFrequency: "monthly", priority: path === "/about" ? 0.5 : 0.2 }),
    ),
    ...games.flatMap((g) =>
      entry(`/game/${g.slug}`, {
        lastModified: g.publishedAt,
        changeFrequency: "daily",
        priority: 0.7,
      }),
    ),
  ];
}
