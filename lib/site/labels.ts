import type { GameType } from "./types";

type T = (key: string, values?: Record<string, string | number>) => string;

/** "Week 9", "Wild Card round", "Super Bowl" (needs the `Week` namespace). */
export function roundLabel(t: T, gameType: GameType, week: number): string {
  return gameType === "REG" ? t("regular", { week }) : t(gameType);
}

/** Probability as a whole-number percentage string for the locale ("77%", "77 %"). */
export function pct(locale: string, p: number): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(p);
}

/** Change reasons are stored in English (they're part of the hashed pick). */
export function parseChangeReason(
  reason: string | null,
):
  | { kind: "first" }
  | { kind: "winner" }
  | { kind: "moved"; points: number }
  | { kind: "other"; text: string } {
  if (!reason) return { kind: "first" };
  if (reason === "winner changed") return { kind: "winner" };
  const m = /moved (\d+) points/.exec(reason);
  if (m) return { kind: "moved", points: Number(m[1]) };
  return { kind: "other", text: reason };
}

/** Week path for links: /weeks/2026/9 */
export function weekHref(season: number, week: number): string {
  return `/weeks/${season}/${week}`;
}
