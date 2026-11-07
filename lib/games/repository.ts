import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { LEGACY_ABBR } from "@/db/seed/reference-data";
import { games, seasons, stadiums, teams } from "@/db/schema";
import { getDb } from "@/lib/db";
import type { GameInput } from "@/lib/internal/schemas";
import { InternalApiError } from "@/lib/internal/route";
import type { DigestRow } from "./digest";
import { gameSlug } from "./slug";

type GameRow = typeof games.$inferInsert;

// Teams and stadiums are reference data that only change through migrations,
// so one lookup per process is enough.
let teamCache: Map<string, number> | undefined;
let stadiumCache: Set<string> | undefined;

async function teamIds(): Promise<Map<string, number>> {
  if (!teamCache) {
    const rows = await getDb().select({ id: teams.id, abbr: teams.abbr }).from(teams);
    teamCache = new Map(rows.map((r) => [r.abbr, r.id]));
  }
  return teamCache;
}

async function stadiumIds(): Promise<Set<string>> {
  if (!stadiumCache) {
    const rows = await getDb().select({ id: stadiums.id }).from(stadiums);
    stadiumCache = new Set(rows.map((r) => r.id));
  }
  return stadiumCache;
}

/** Columns compared to decide whether an incoming game changes anything. */
function fingerprint(g: GameRow): string {
  return JSON.stringify([
    g.season,
    g.week,
    g.gameType,
    g.homeTeamId,
    g.awayTeamId,
    g.stadiumId ?? null,
    Boolean(g.neutralSite),
    g.kickoffAt instanceof Date ? g.kickoffAt.getTime() : null,
    g.status,
    g.homeScore ?? null,
    g.awayScore ?? null,
    Boolean(g.overtime),
    g.slug,
  ]);
}

export interface UpsertGamesResult {
  inserted: number;
  updated: number;
  unchanged: number;
  /** Stadium ids not in the seed; those games are stored with stadium_id NULL. */
  unknownStadiums: string[];
  /** Seasons that had at least one change (for cache revalidation). */
  changedSeasons: number[];
}

/**
 * Idempotent upsert keyed on the nflverse game id. Rows are compared with what
 * is stored first and only new or changed rows are written, so sending the same
 * payload twice writes nothing at all.
 */
export async function upsertGames(input: GameInput[]): Promise<UpsertGamesResult> {
  const ids = await teamIds();
  const knownStadiums = await stadiumIds();
  const unknownStadiums = new Set<string>();
  const unknownTeams = new Set<string>();

  const resolveTeam = (abbr: string) => {
    const id = ids.get(LEGACY_ABBR[abbr] ?? abbr);
    if (id === undefined) unknownTeams.add(abbr);
    return id ?? 0;
  };

  const rows: GameRow[] = input.map((g) => {
    const home = LEGACY_ABBR[g.homeTeam] ?? g.homeTeam;
    const away = LEGACY_ABBR[g.awayTeam] ?? g.awayTeam;
    let stadiumId = g.stadiumId;
    if (stadiumId && !knownStadiums.has(stadiumId)) {
      unknownStadiums.add(stadiumId);
      stadiumId = null;
    }
    return {
      id: g.id,
      season: g.season,
      week: g.week,
      gameType: g.gameType,
      homeTeamId: resolveTeam(g.homeTeam),
      awayTeamId: resolveTeam(g.awayTeam),
      stadiumId,
      neutralSite: g.neutralSite,
      kickoffAt: new Date(g.kickoffAt),
      status: g.status,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      overtime: g.overtime,
      slug: gameSlug({ ...g, homeAbbr: home, awayAbbr: away }),
    };
  });
  if (unknownTeams.size > 0) {
    throw new InternalApiError(422, "unknown team abbreviations", [...unknownTeams]);
  }
  if (rows.length === 0) {
    return { inserted: 0, updated: 0, unchanged: 0, unknownStadiums: [], changedSeasons: [] };
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(games)
    .where(
      inArray(
        games.id,
        rows.map((r) => r.id),
      ),
    );
  const stored = new Map(existing.map((r) => [r.id, fingerprint(r)]));

  const toWrite = rows.filter((r) => stored.get(r.id) !== fingerprint(r));
  const inserted = toWrite.filter((r) => !stored.has(r.id)).length;

  if (toWrite.length > 0) {
    await db
      .insert(games)
      .values(toWrite)
      .onDuplicateKeyUpdate({
        set: {
          season: sql`VALUES(${games.season})`,
          week: sql`VALUES(${games.week})`,
          gameType: sql`VALUES(${games.gameType})`,
          homeTeamId: sql`VALUES(${games.homeTeamId})`,
          awayTeamId: sql`VALUES(${games.awayTeamId})`,
          stadiumId: sql`VALUES(${games.stadiumId})`,
          neutralSite: sql`VALUES(${games.neutralSite})`,
          kickoffAt: sql`VALUES(${games.kickoffAt})`,
          status: sql`VALUES(${games.status})`,
          homeScore: sql`VALUES(${games.homeScore})`,
          awayScore: sql`VALUES(${games.awayScore})`,
          overtime: sql`VALUES(${games.overtime})`,
          slug: sql`VALUES(${games.slug})`,
        },
      });
  }

  return {
    inserted,
    updated: toWrite.length - inserted,
    unchanged: rows.length - toWrite.length,
    unknownStadiums: [...unknownStadiums].sort(),
    changedSeasons: [...new Set(toWrite.map((r) => r.season))].sort(),
  };
}

export async function upsertSeasons(input: Array<typeof seasons.$inferInsert>): Promise<number> {
  if (input.length === 0) return 0;
  const db = getDb();
  const existing = await db
    .select()
    .from(seasons)
    .where(
      inArray(
        seasons.year,
        input.map((s) => s.year),
      ),
    );
  const stored = new Map(existing.map((s) => [s.year, `${s.currentWeek}|${s.phase}`]));
  const changed = input.filter((s) => stored.get(s.year) !== `${s.currentWeek}|${s.phase}`);
  if (changed.length > 0) {
    await db
      .insert(seasons)
      .values(changed)
      .onDuplicateKeyUpdate({
        set: {
          currentWeek: sql`VALUES(${seasons.currentWeek})`,
          phase: sql`VALUES(${seasons.phase})`,
        },
      });
  }
  return changed.length;
}

/** Rows for gamesDigest(), with team abbreviations as stored. */
export async function seasonDigestRows(season: number): Promise<DigestRow[]> {
  const home = alias(teams, "home");
  const away = alias(teams, "away");
  return getDb()
    .select({
      id: games.id,
      homeAbbr: home.abbr,
      awayAbbr: away.abbr,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      status: games.status,
      kickoffAt: games.kickoffAt,
    })
    .from(games)
    .innerJoin(home, eq(home.id, games.homeTeamId))
    .innerJoin(away, eq(away.id, games.awayTeamId))
    .where(eq(games.season, season))
    .orderBy(asc(games.id));
}
