import type { gameTypes } from "@/db/schema";

const POSTSEASON_LABEL: Record<Exclude<(typeof gameTypes)[number], "REG">, string> = {
  WC: "wild-card",
  DIV: "divisional",
  CON: "conference",
  SB: "super-bowl",
};

/** "bal-at-kc-2024-week-1", "kc-at-phi-2024-super-bowl" (neutral sites keep the listed home team). */
export function gameSlug(g: {
  season: number;
  week: number;
  gameType: (typeof gameTypes)[number];
  homeAbbr: string;
  awayAbbr: string;
}): string {
  const label = g.gameType === "REG" ? `week-${g.week}` : POSTSEASON_LABEL[g.gameType];
  return `${g.awayAbbr}-at-${g.homeAbbr}-${g.season}-${label}`.toLowerCase();
}
