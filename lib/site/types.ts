/**
 * Plain, serializable view models for the public pages. Shared by server data
 * functions ("use cache") and client components, so no server-only imports here.
 * Dates are ISO strings.
 */
import type { confidenceTiers, gameStatuses, gameTypes, roofTypes } from "@/db/schema";

export type Tier = (typeof confidenceTiers)[number];
export type GameType = (typeof gameTypes)[number];
export type GameStatus = (typeof gameStatuses)[number];
export type Outcome = "win" | "loss" | "tie";

export interface TeamLite {
  abbr: string;
  city: string;
  name: string;
  color: string;
}

export interface PickSummary {
  side: "home" | "away";
  winProb: number;
  tier: Tier;
  versionNo: number;
  publishedAt: string;
  headline: string | null;
  topReason: string | null;
  /** Null until the game is graded. */
  outcome: Outcome | null;
}

export interface GameSummary {
  id: string;
  slug: string;
  season: number;
  week: number;
  gameType: GameType;
  kickoffAt: string;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  home: TeamLite;
  away: TeamLite;
  venue: string | null;
  neutralSite: boolean;
  /**
   * Kickoff has passed, as of when the cached data was read (at most about an hour
   * stale). Cards use it; the game page re-checks in the browser.
   */
  kickedOff: boolean;
  /** One of the week's free full-breakdown games (lib/site/free-games.ts). */
  freeBreakdown: boolean;
  pick: PickSummary | null;
}

export interface PickVersion {
  versionNo: number;
  publishedAt: string;
  winnerAbbr: string;
  winProb: number;
  tier: Tier;
  changeReason: string | null;
  contentHash: string;
}

export interface GameDetail extends GameSummary {
  stadium: { name: string; roofType: (typeof roofTypes)[number]; timezone: string } | null;
  explanation: {
    headline: string;
    reasons: string[];
    matchupNotes: string[];
    source: "claude" | "template";
  } | null;
  versions: PickVersion[];
  injuries: { team: string; name: string; position: string; status: string }[];
  weather: { tempC: number | null; windKph: number | null; condition: string | null } | null;
}

export interface WeekRef {
  season: number;
  week: number;
  gameType: GameType;
}

/** One row of the public track record: the pick that was current at kickoff. */
export interface RecordRow {
  gameId: string;
  slug: string;
  season: number;
  week: number;
  gameType: GameType;
  kickoffAt: string;
  home: string;
  away: string;
  winner: string;
  winProb: number;
  tier: Tier;
  homeScore: number | null;
  awayScore: number | null;
  outcome: Outcome | null;
}

export interface ChainHead {
  count: number;
  head: string | null;
  lastPublishedAt: string | null;
}

export interface TeamStats {
  season: number;
  week: number;
  elo: number | null;
  offEpa: number | null;
  defEpa: number | null;
  offEpaRank: number | null;
  defEpaRank: number | null;
}
