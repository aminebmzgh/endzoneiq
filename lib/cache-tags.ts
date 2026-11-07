/**
 * Cache tags shared by cached reads (`cacheTag`) and the internal API
 * (`revalidateTag(tag, "max")` after a successful ingest). Keep every tag here.
 *
 * Public pages tag their data with the coarse tags (games, picks, teams) plus the
 * specific ones (season, game), so every ingest refreshes exactly what it touched.
 */
export const tags = {
  games: "games",
  season: (year: number) => `season-${year}`,
  seasons: "seasons",
  model: "model",
  picks: "picks",
  /** Grading results: the track record and every result badge. */
  results: "results",
  teams: "teams",
  game: (id: string) => `game-${id}`,
} as const;
