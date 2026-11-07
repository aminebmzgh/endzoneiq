"use cache";
/**
 * Cached reads for the public pages. Every function is a `use cache` entry tagged
 * with the cache tags the internal API revalidates after an ingest, so pages are
 * served from memory and refreshed only when their data changes (plus an hourly
 * safety net).
 *
 * The DB is never reachable at build time (it's local to the Hostinger server), so
 * nothing that calls these is prerendered: pages render on their first visit and are
 * then stored as static entries carrying these tags (see app/[locale]/layout.tsx).
 */
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { cacheLife, cacheTag } from "next/cache";
import {
  explanations,
  games,
  injuries,
  pickResults,
  picks,
  players,
  seasons,
  stadiums,
  teams,
  teamWeekStats,
  weather,
  type locales,
} from "@/db/schema";
import { tags } from "@/lib/cache-tags";
import { getDb } from "@/lib/db";
import { outcome } from "./record";
import type { ChainHead, GameDetail, GameSummary, RecordRow, TeamStats, WeekRef } from "./types";

type Locale = (typeof locales)[number];

const home = alias(teams, "home_team");
const away = alias(teams, "away_team");

const iso = (d: Date) => d.toISOString();

function summarySelect(locale: Locale) {
  return getDb()
    .select({
      id: games.id,
      slug: games.slug,
      season: games.season,
      week: games.week,
      gameType: games.gameType,
      kickoffAt: games.kickoffAt,
      status: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      neutralSite: games.neutralSite,
      venue: stadiums.name,
      homeTeamId: games.homeTeamId,
      home: { abbr: home.abbr, city: home.city, name: home.name, color: home.primaryColor },
      away: { abbr: away.abbr, city: away.city, name: away.name, color: away.primaryColor },
      pickWinnerId: picks.winnerTeamId,
      pickWinProb: picks.winProb,
      pickTier: picks.confidenceTier,
      pickVersion: picks.versionNo,
      pickPublishedAt: picks.publishedAt,
      headline: explanations.headline,
      reasons: explanations.reasonsJson,
      graded: pickResults.pickId,
    })
    .from(games)
    .innerJoin(home, eq(home.id, games.homeTeamId))
    .innerJoin(away, eq(away.id, games.awayTeamId))
    .leftJoin(stadiums, eq(stadiums.id, games.stadiumId))
    .leftJoin(picks, and(eq(picks.gameId, games.id), eq(picks.isCurrent, true)))
    .leftJoin(explanations, and(eq(explanations.pickId, picks.id), eq(explanations.locale, locale)))
    .leftJoin(pickResults, eq(pickResults.pickId, picks.id));
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summarySelect>["execute"]>>[number];

function toSummary(r: SummaryRow): GameSummary {
  const pickedHome = r.pickWinnerId === r.homeTeamId;
  return {
    id: r.id,
    slug: r.slug,
    season: r.season,
    week: r.week,
    gameType: r.gameType,
    kickoffAt: iso(r.kickoffAt),
    status: r.status,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    home: r.home,
    away: r.away,
    venue: r.venue,
    neutralSite: r.neutralSite,
    // Inside "use cache": part of the cached result, refreshed with it.
    kickedOff: r.kickoffAt.getTime() <= Date.now(),
    pick:
      r.pickWinnerId === null
        ? null
        : {
            side: pickedHome ? "home" : "away",
            winProb: r.pickWinProb!,
            tier: r.pickTier!,
            versionNo: r.pickVersion!,
            publishedAt: iso(r.pickPublishedAt!),
            headline: r.headline,
            topReason: r.reasons?.[0] ?? null,
            outcome:
              r.graded !== null && r.homeScore !== null && r.awayScore !== null
                ? outcome(pickedHome, r.homeScore, r.awayScore)
                : null,
          },
  };
}

/** The week the home page shows: the week of the next unfinished game. */
export async function getCurrentWeek(): Promise<WeekRef | null> {
  cacheLife("hours");
  cacheTag(tags.seasons, tags.games);
  const [s] = await getDb()
    .select({ year: seasons.year, week: seasons.currentWeek })
    .from(seasons)
    .orderBy(desc(seasons.year))
    .limit(1);
  if (!s) return null;
  const [g] = await getDb()
    .select({ gameType: games.gameType, week: games.week })
    .from(games)
    .where(and(eq(games.season, s.year), sql`${games.week} <= ${s.week}`))
    .orderBy(desc(games.week))
    .limit(1);
  return g ? { season: s.year, week: g.week, gameType: g.gameType } : null;
}

/** Every week of a season, for the week selector. */
export async function getWeeks(season: number): Promise<WeekRef[]> {
  cacheLife("hours");
  cacheTag(tags.games, tags.season(season));
  return getDb()
    .selectDistinct({ season: games.season, week: games.week, gameType: games.gameType })
    .from(games)
    .where(eq(games.season, season))
    .orderBy(asc(games.week));
}

export async function getWeekGames(
  season: number,
  week: number,
  locale: Locale,
): Promise<GameSummary[]> {
  cacheLife("hours");
  cacheTag(tags.games, tags.picks, tags.results, tags.season(season));
  const rows = await summarySelect(locale)
    .where(and(eq(games.season, season), eq(games.week, week)))
    .orderBy(asc(games.kickoffAt), asc(games.id));
  return rows.map(toSummary);
}

export async function getGame(slug: string, locale: Locale): Promise<GameDetail | null> {
  cacheLife("hours");
  const db = getDb();
  const [row] = await summarySelect(locale).where(eq(games.slug, slug)).limit(1);
  if (!row) {
    cacheTag(tags.games);
    return null;
  }
  cacheTag(tags.game(row.id), tags.games, tags.season(row.season));
  const winner = alias(teams, "winner");
  const [stadium, expl, versions, injuryRows, wx] = await Promise.all([
    db
      .select({ name: stadiums.name, roofType: stadiums.roofType, timezone: stadiums.timezone })
      .from(stadiums)
      .innerJoin(games, eq(games.stadiumId, stadiums.id))
      .where(eq(games.id, row.id)),
    db
      .select({
        headline: explanations.headline,
        reasons: explanations.reasonsJson,
        matchupNotes: explanations.matchupNotesJson,
        source: explanations.source,
      })
      .from(explanations)
      .innerJoin(picks, eq(picks.id, explanations.pickId))
      .where(
        and(eq(picks.gameId, row.id), eq(picks.isCurrent, true), eq(explanations.locale, locale)),
      ),
    db
      .select({
        versionNo: picks.versionNo,
        publishedAt: picks.publishedAt,
        winnerAbbr: winner.abbr,
        winProb: picks.winProb,
        tier: picks.confidenceTier,
        changeReason: picks.changeReason,
        contentHash: picks.contentHash,
      })
      .from(picks)
      .innerJoin(winner, eq(winner.id, picks.winnerTeamId))
      .where(eq(picks.gameId, row.id))
      .orderBy(desc(picks.versionNo)),
    db
      .select({
        team: teams.abbr,
        name: players.name,
        position: players.position,
        status: injuries.reportStatus,
        source: injuries.source,
      })
      .from(injuries)
      .innerJoin(players, eq(players.id, injuries.playerId))
      .leftJoin(teams, eq(teams.id, players.teamId))
      .where(and(eq(injuries.gameId, row.id), inArray(injuries.reportStatus, ["out", "doubtful"])))
      .orderBy(asc(teams.abbr), asc(players.name)),
    db
      .select({ tempC: weather.tempC, windKph: weather.windKph, condition: weather.condition })
      .from(weather)
      .where(eq(weather.gameId, row.id)),
  ]);

  // Admin overrides win over the nflverse report for the same player.
  const byPlayer = new Map<string, (typeof injuryRows)[number]>();
  for (const i of injuryRows) {
    const key = `${i.team}|${i.name}`;
    if (!byPlayer.has(key) || i.source === "admin") byPlayer.set(key, i);
  }

  return {
    ...toSummary(row),
    stadium: stadium[0] ?? null,
    explanation: expl[0] ?? null,
    versions: versions.map((v) => ({ ...v, publishedAt: iso(v.publishedAt) })),
    injuries: [...byPlayer.values()].map(({ team, name, position, status }) => ({
      team: team ?? "",
      name,
      position,
      status,
    })),
    weather: wx[0] ?? null,
  };
}

/** Every published game's pick as it stood at kickoff, with its result once graded. */
export async function getRecordRows(): Promise<RecordRow[]> {
  cacheLife("hours");
  cacheTag(tags.picks, tags.results, tags.games);
  const winner = alias(teams, "winner");
  const rows = await getDb()
    .select({
      gameId: games.id,
      slug: games.slug,
      season: games.season,
      week: games.week,
      gameType: games.gameType,
      kickoffAt: games.kickoffAt,
      home: home.abbr,
      away: away.abbr,
      homeTeamId: games.homeTeamId,
      winnerId: picks.winnerTeamId,
      winner: winner.abbr,
      winProb: picks.winProb,
      tier: picks.confidenceTier,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      graded: pickResults.pickId,
    })
    .from(picks)
    .innerJoin(games, eq(games.id, picks.gameId))
    .innerJoin(home, eq(home.id, games.homeTeamId))
    .innerJoin(away, eq(away.id, games.awayTeamId))
    .innerJoin(winner, eq(winner.id, picks.winnerTeamId))
    .leftJoin(pickResults, eq(pickResults.pickId, picks.id))
    .where(eq(picks.isCurrent, true))
    .orderBy(desc(games.kickoffAt), asc(games.id));
  return rows.map(({ homeTeamId, winnerId, graded, kickoffAt, ...r }) => ({
    ...r,
    kickoffAt: iso(kickoffAt),
    outcome:
      graded !== null && r.homeScore !== null && r.awayScore !== null
        ? outcome(winnerId === homeTeamId, r.homeScore, r.awayScore)
        : null,
  }));
}

/** The latest link of the public hash chain. */
export async function getChainHead(): Promise<ChainHead> {
  cacheLife("hours");
  cacheTag(tags.picks);
  const [row] = await getDb()
    .select({
      count: sql<number>`COUNT(*)`.mapWith(Number),
      head: sql<string | null>`(SELECT content_hash FROM picks ORDER BY id DESC LIMIT 1)`,
      last: sql<Date | null>`MAX(${picks.publishedAt})`,
    })
    .from(picks);
  const last = row?.last ? new Date(row.last) : null;
  return {
    count: row?.count ?? 0,
    head: row?.head ?? null,
    lastPublishedAt: last ? iso(last) : null,
  };
}

/** A team's games in one season, with picks (team page schedule). */
export async function getTeamSeason(
  abbr: string,
  season: number,
  locale: Locale,
): Promise<GameSummary[]> {
  cacheLife("hours");
  cacheTag(tags.games, tags.picks, tags.results, tags.season(season));
  const rows = await summarySelect(locale)
    .where(and(eq(games.season, season), or(eq(home.abbr, abbr), eq(away.abbr, abbr))))
    .orderBy(asc(games.kickoffAt));
  return rows.map(toSummary);
}

/** Latest Elo and season-to-date efficiency for a team (posted by the pipeline). */
export async function getTeamStats(abbr: string): Promise<TeamStats | null> {
  cacheLife("hours");
  cacheTag(tags.teams);
  const [row] = await getDb()
    .select({
      season: teamWeekStats.season,
      week: teamWeekStats.week,
      elo: teamWeekStats.elo,
      offEpa: teamWeekStats.offEpa,
      defEpa: teamWeekStats.defEpa,
      offEpaRank: teamWeekStats.offEpaRank,
      defEpaRank: teamWeekStats.defEpaRank,
    })
    .from(teamWeekStats)
    .innerJoin(teams, eq(teams.id, teamWeekStats.teamId))
    .where(eq(teams.abbr, abbr))
    .orderBy(desc(teamWeekStats.season), desc(teamWeekStats.week))
    .limit(1);
  return row ?? null;
}

/** Slugs and kickoff of every game with a published pick (sitemap). */
export async function getPublishedGames(): Promise<{ slug: string; publishedAt: string }[]> {
  cacheLife("hours");
  cacheTag(tags.picks);
  const rows = await getDb()
    .select({ slug: games.slug, publishedAt: sql<Date>`MAX(${picks.publishedAt})` })
    .from(games)
    .innerJoin(picks, eq(picks.gameId, games.id))
    .where(isNotNull(picks.id))
    .groupBy(games.slug)
    .orderBy(desc(sql`MAX(${picks.publishedAt})`));
  return rows.map((r) => ({ slug: r.slug, publishedAt: iso(new Date(r.publishedAt)) }));
}
