/**
 * Cache tags shared by cached reads (`cacheTag`) and the internal API
 * (`revalidateTag(tag, "max")` after a successful ingest). Keep every tag here.
 */
export const tags = {
  games: "games",
  season: (year: number) => `season-${year}`,
  seasons: "seasons",
} as const;
