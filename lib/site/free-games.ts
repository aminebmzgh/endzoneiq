/**
 * Free plan (spec 15): the full breakdown (all three reasons and matchup notes) of
 * 3 games a week. They are the week's night games, the most-watched ones: the three
 * latest kickoffs by US Eastern time of day (normally Thursday, Sunday and Monday
 * night). Deterministic and the same for everyone, so pages stay cacheable and the
 * free breakdowns stay indexable.
 */
export const FREE_GAMES_PER_WEEK = 3;

const eastern = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function easternMinutes(d: Date): number {
  const parts = eastern.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

export function freeBreakdownIds(
  games: { id: string; kickoffAt: Date | string }[],
  n = FREE_GAMES_PER_WEEK,
): Set<string> {
  const ranked = games
    .map((g) => {
      const d = new Date(g.kickoffAt);
      return { id: g.id, minutes: easternMinutes(d), time: d.getTime() };
    })
    .sort((a, b) => b.minutes - a.minutes || a.time - b.time || a.id.localeCompare(b.id));
  return new Set(ranked.slice(0, n).map((g) => g.id));
}
