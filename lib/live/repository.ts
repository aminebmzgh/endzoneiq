import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { games, injuries, players, teams, weather } from "@/db/schema";
import { LEGACY_ABBR } from "@/db/seed/reference-data";
import { getDb } from "@/lib/db";
import type { ingestPlayersInjuriesBody, ingestWeatherBody } from "@/lib/internal/schemas";

/**
 * Live data from the watchers (spec 12.1 injury_watch / weather_watch). Only rows that
 * really change are written, so a watcher run with nothing new touches nothing.
 */

export interface LiveResult {
  changedGames: string[];
  rows: number;
}

export async function upsertPlayersInjuries(
  body: z.infer<typeof ingestPlayersInjuriesBody>,
): Promise<LiveResult> {
  const db = getDb();
  const teamIds = new Map(
    (await db.select({ id: teams.id, abbr: teams.abbr }).from(teams)).map((t) => [t.abbr, t.id]),
  );
  const known = new Set(
    (await db.select({ id: games.id }).from(games).where(inArray(games.id, body.games))).map(
      (g) => g.id,
    ),
  );
  let rows = 0;

  // Players: insert new ones, update name/position/team when they change.
  if (body.players.length > 0) {
    const [res] = await db
      .insert(players)
      .values(
        body.players.map((p) => ({
          gsisId: p.gsisId,
          name: p.name,
          position: p.position || "?",
          teamId: teamIds.get(LEGACY_ABBR[p.team] ?? p.team) ?? null,
        })),
      )
      .onDuplicateKeyUpdate({
        set: {
          name: sql`VALUES(${players.name})`,
          position: sql`VALUES(${players.position})`,
          teamId: sql`VALUES(${players.teamId})`,
        },
      });
    rows += res.affectedRows;
  }

  const gsis = [...new Set(body.injuries.map((i) => i.gsisId))];
  const playerIds = new Map(
    gsis.length
      ? (
          await db
            .select({ id: players.id, gsis: players.gsisId })
            .from(players)
            .where(inArray(players.gsisId, gsis))
        ).map((p) => [p.gsis, p.id])
      : [],
  );

  const changed = new Set<string>();
  await db.transaction(async (tx) => {
    const stored = known.size
      ? await tx
          .select({
            id: injuries.id,
            gameId: injuries.gameId,
            playerId: injuries.playerId,
            status: injuries.reportStatus,
          })
          .from(injuries)
          .where(and(inArray(injuries.gameId, [...known]), eq(injuries.source, "nflverse")))
      : [];
    const want = new Map<
      string,
      { gameId: string; playerId: number; status: (typeof body.injuries)[number]["status"] }
    >();
    for (const i of body.injuries) {
      const playerId = playerIds.get(i.gsisId);
      if (!known.has(i.gameId) || playerId === undefined) continue;
      want.set(`${i.gameId}|${playerId}`, { gameId: i.gameId, playerId, status: i.status });
    }
    const have = new Map(stored.map((s) => [`${s.gameId}|${s.playerId}`, s]));
    const gone = stored.filter((s) => !want.has(`${s.gameId}|${s.playerId}`));
    if (gone.length) {
      await tx.delete(injuries).where(
        inArray(
          injuries.id,
          gone.map((g) => g.id),
        ),
      );
      gone.forEach((g) => changed.add(g.gameId));
      rows += gone.length;
    }
    for (const [key, w] of want) {
      const old = have.get(key);
      if (old && old.status === w.status) continue;
      if (old) {
        await tx.update(injuries).set({ reportStatus: w.status }).where(eq(injuries.id, old.id));
      } else {
        await tx.insert(injuries).values({ ...w, reportStatus: w.status, source: "nflverse" });
      }
      changed.add(w.gameId);
      rows++;
    }
  });
  return { changedGames: [...changed], rows };
}

export async function upsertWeather(body: z.infer<typeof ingestWeatherBody>): Promise<LiveResult> {
  const db = getDb();
  const ids = body.forecasts.map((f) => f.gameId);
  const known = new Set(
    (await db.select({ id: games.id }).from(games).where(inArray(games.id, ids))).map((g) => g.id),
  );
  const stored = new Map(
    (await db.select().from(weather).where(inArray(weather.gameId, ids))).map((w) => [w.gameId, w]),
  );
  const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  const changed: string[] = [];
  const now = new Date();
  for (const f of body.forecasts) {
    if (!known.has(f.gameId)) continue;
    const next = {
      tempC: round(f.tempC),
      windKph: round(f.windKph),
      precipMm: round(f.precipMm),
      condition: f.condition,
    };
    const old = stored.get(f.gameId);
    if (
      old &&
      old.tempC === next.tempC &&
      old.windKph === next.windKph &&
      old.precipMm === next.precipMm &&
      old.condition === next.condition
    ) {
      continue;
    }
    await db
      .insert(weather)
      .values({ gameId: f.gameId, ...next, fetchedAt: now })
      .onDuplicateKeyUpdate({ set: { ...next, fetchedAt: now } });
    changed.push(f.gameId);
  }
  return { changedGames: changed, rows: changed.length };
}
