import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { asc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { games, injuries, players, teams } from "@/db/schema";
import { LEGACY_ABBR, TEAMS } from "@/db/seed/reference-data";
import type { Locale } from "@/i18n/routing";
import { canViewFullBreakdown, canViewProContent, type Viewer } from "@/lib/authz";
import { getDb } from "@/lib/db";
import {
  getCurrentWeek,
  getGame,
  getProDetail,
  getRecordRows,
  getTeamSeason,
  getTeamStats,
  getWeekGames,
} from "@/lib/site/data";
import { byTier, calibration, tally } from "@/lib/site/record";
import type { GameSummary } from "@/lib/site/types";
import { reportError } from "@/lib/observability/sentry";

/**
 * The assistant's tools (spec 10.2). Every tool reads EndzoneIQ's own data and applies
 * the same rules as the site (lib/authz.ts): full breakdowns on the free games or for
 * Pro, projections for Pro only. Results are compact JSON for the model.
 */

export interface ToolContext {
  viewer: Viewer;
  locale: Locale;
}

// --- Team names -------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "KC", "chiefs", "Kansas City Chiefs", "OAK" -> team abbreviation, or null. */
export function resolveTeam(input: string): string | null {
  const raw = input.trim().toUpperCase();
  const legacy = LEGACY_ABBR[raw] ?? raw;
  if (TEAMS.some((t) => t.abbr === legacy)) return legacy;
  const q = norm(input);
  if (!q) return null;
  const exact = TEAMS.find(
    (t) => norm(t.name) === q || norm(`${t.city} ${t.name}`) === q || norm(t.city) === q,
  );
  if (exact) return exact.abbr;
  const partial = TEAMS.filter((t) => q.includes(norm(t.name)));
  return partial.length === 1 ? partial[0]!.abbr : null;
}

const teamArg = z.string().min(2).max(40).describe("Team abbreviation (KC) or name (Chiefs)");
const seasonArg = z.number().int().min(2012).max(2100).optional();
const weekArg = z.number().int().min(1).max(25).optional();

// --- Helpers ----------------------------------------------------------------------

async function weekOf(season?: number, week?: number) {
  if (season && week) return { season, week };
  const cur = await getCurrentWeek();
  if (!cur) return null;
  return { season: season ?? cur.season, week: week ?? cur.week };
}

const pct = (p: number) => Math.round(p * 100);

function gameLine(g: GameSummary) {
  const winner = g.pick ? (g.pick.side === "home" ? g.home.abbr : g.away.abbr) : null;
  return {
    game: `${g.away.abbr} at ${g.home.abbr}`,
    kickoff_utc: g.kickoffAt,
    status: g.status,
    score:
      g.homeScore !== null ? `${g.away.abbr} ${g.awayScore} - ${g.homeScore} ${g.home.abbr}` : null,
    pick: winner,
    win_probability_pct: g.pick ? pct(g.pick.winProb) : null,
    confidence: g.pick?.tier ?? null,
    top_reason: g.pick?.topReason ?? null,
    pick_result: g.pick?.outcome ?? null,
    pick_updated: (g.pick?.versionNo ?? 1) > 1,
    free_full_breakdown: g.freeBreakdown,
  };
}

async function findGame(
  team: string,
  opponent: string | undefined,
  season?: number,
  week?: number,
) {
  const t = resolveTeam(team);
  if (!t) return { error: `Unknown team "${team}".` } as const;
  const o = opponent ? resolveTeam(opponent) : null;
  if (opponent && !o) return { error: `Unknown team "${opponent}".` } as const;
  const w = await weekOf(season, week);
  if (!w) return { error: "No season data yet." } as const;
  const list = await getWeekGames(w.season, w.week, "en");
  const g = list.find(
    (x) =>
      (x.home.abbr === t || x.away.abbr === t) && (!o || x.home.abbr === o || x.away.abbr === o),
  );
  if (!g) return { error: `${t} has no game in ${w.season} week ${w.week}.`, ...w } as const;
  return { game: g, ...w } as const;
}

// --- Tools ------------------------------------------------------------------------

type ToolDef<S extends z.ZodTypeAny> = {
  name: string;
  description: string;
  input: S;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
};
const tool = <S extends z.ZodTypeAny>(d: ToolDef<S>) => d;

export const TOOLS = [
  tool({
    name: "get_week_games",
    description:
      "List one week's games with EndzoneIQ's pick, win probability, confidence tier, top reason and result. Defaults to the current week.",
    input: z.object({ season: seasonArg, week: weekArg }),
    run: async ({ season, week }, ctx) => {
      const w = await weekOf(season, week);
      if (!w) return { error: "No season data yet." };
      const list = await getWeekGames(w.season, w.week, ctx.locale);
      return { season: w.season, week: w.week, games: list.map(gameLine) };
    },
  }),
  tool({
    name: "get_game_detail",
    description:
      "One game in detail: the pick, its reasons and matchup notes (as the user's plan allows), injuries, weather, venue and, for Pro users, the projected margin, total and the model's drivers. Find the game by a team and optionally its opponent; defaults to the current week.",
    input: z.object({
      team: teamArg,
      opponent: teamArg.optional(),
      season: seasonArg,
      week: weekArg,
    }),
    run: async ({ team, opponent, season, week }, ctx) => {
      const found = await findGame(team, opponent, season, week);
      if ("error" in found) return found;
      const g = await getGame(found.game.slug, ctx.locale);
      if (!g) return { error: "Game not found." };
      const full = canViewFullBreakdown(ctx.viewer, g);
      const pro = canViewProContent(ctx.viewer);
      const detail = pro || full ? await getProDetail(g.slug, ctx.locale) : null;
      return {
        season: g.season,
        week: g.week,
        ...gameLine(g),
        home: `${g.home.city} ${g.home.name} (${g.home.abbr})`,
        away: `${g.away.city} ${g.away.name} (${g.away.abbr})`,
        venue: g.venue,
        neutral_site: g.neutralSite,
        headline: g.explanation?.headline ?? null,
        reasons: full ? (g.explanation?.reasons ?? []) : (g.explanation?.reasons ?? []).slice(0, 1),
        matchup_notes: full ? (g.explanation?.matchupNotes ?? []) : [],
        locked_for_this_user: full
          ? null
          : "Reasons 2-3 and the matchup notes of this game are part of EndzoneIQ Pro.",
        pro_projection:
          pro && detail
            ? {
                projected_home_margin_pts: Math.round(detail.predSpread * 10) / 10,
                projected_total_pts: Math.round(detail.predTotal * 10) / 10,
                drivers_for_pick: detail.shap?.for?.map((d) => d.label) ?? [],
                drivers_against_pick: detail.shap?.against?.map((d) => d.label) ?? [],
              }
            : "Projected margin, total and model drivers are Pro features.",
        injuries_out_or_doubtful: g.injuries,
        weather: g.stadium?.roofType === "dome" ? "indoors" : g.weather,
        page: `/${ctx.locale}/game/${g.slug}`,
      };
    },
  }),
  tool({
    name: "get_team_stats",
    description:
      "A team's current model rating (Elo, 1500 = average), season-to-date efficiency (EPA per play) with ranks 1-32, its season schedule with picks, and how EndzoneIQ's picks have done on its games.",
    input: z.object({ team: teamArg, season: seasonArg }),
    run: async ({ team, season }, ctx) => {
      const abbr = resolveTeam(team);
      if (!abbr) return { error: `Unknown team "${team}".` };
      const w = await weekOf();
      const yr = season ?? w?.season ?? new Date().getUTCFullYear();
      const [stats, schedule, rows] = await Promise.all([
        getTeamStats(abbr),
        getTeamSeason(abbr, yr, ctx.locale),
        getRecordRows(),
      ]);
      const t = TEAMS.find((x) => x.abbr === abbr)!;
      const mine = rows.filter((r) => r.home === abbr || r.away === abbr);
      return {
        team: `${t.city} ${t.name} (${abbr})`,
        division: `${t.conference} ${t.division}`,
        rating: stats,
        model_record_on_team_games: tally(mine),
        schedule: schedule.map(gameLine),
      };
    },
  }),
  tool({
    name: "get_player_info",
    description:
      "Look up a player by name: team, position, roster status and current injury reports.",
    input: z.object({ name: z.string().min(3).max(60) }),
    run: async ({ name }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: players.id,
          name: players.name,
          position: players.position,
          status: players.status,
          team: teams.abbr,
        })
        .from(players)
        .leftJoin(teams, eq(teams.id, players.teamId))
        .where(like(players.name, `%${name.replace(/[%_]/g, "")}%`))
        .limit(5);
      if (rows.length === 0) return { error: `No player named "${name}" in EndzoneIQ's data.` };
      const reports = await db
        .select({ playerId: injuries.playerId, game: games.id, status: injuries.reportStatus })
        .from(injuries)
        .innerJoin(games, eq(games.id, injuries.gameId))
        .where(or(...rows.map((r) => eq(injuries.playerId, r.id))))
        .orderBy(asc(games.kickoffAt));
      return rows.map(({ id, ...r }) => ({
        ...r,
        injury_reports: reports
          .filter((x) => x.playerId === id)
          .map((x) => ({ game: x.game, status: x.status })),
      }));
    },
  }),
  tool({
    name: "get_injuries",
    description: "Players ruled out or doubtful for a team's game (defaults to the current week).",
    input: z.object({ team: teamArg, season: seasonArg, week: weekArg }),
    run: async ({ team, season, week }, ctx) => {
      const found = await findGame(team, undefined, season, week);
      if ("error" in found) return found;
      const g = await getGame(found.game.slug, ctx.locale);
      const abbr = resolveTeam(team);
      return {
        game: `${found.game.away.abbr} at ${found.game.home.abbr}`,
        season: found.season,
        week: found.week,
        out_or_doubtful: (g?.injuries ?? []).filter((i) => i.team === abbr),
        note:
          (g?.injuries ?? []).length === 0
            ? "No injury reports are stored for this game yet."
            : undefined,
      };
    },
  }),
  tool({
    name: "get_pick_history",
    description:
      "Every published version of the pick for a team's game: when it was published, the pick, its win probability and why it changed. Picks are permanent and lock at kickoff.",
    input: z.object({
      team: teamArg,
      opponent: teamArg.optional(),
      season: seasonArg,
      week: weekArg,
    }),
    run: async ({ team, opponent, season, week }, ctx) => {
      const found = await findGame(team, opponent, season, week);
      if ("error" in found) return found;
      const g = await getGame(found.game.slug, ctx.locale);
      return {
        game: `${found.game.away.abbr} at ${found.game.home.abbr}`,
        versions: (g?.versions ?? []).map((v) => ({
          version: v.versionNo,
          published_utc: v.publishedAt,
          pick: v.winnerAbbr,
          win_probability_pct: pct(v.winProb),
          change_reason: v.changeReason ?? "first published",
        })),
      };
    },
  }),
  tool({
    name: "get_track_record",
    description:
      "EndzoneIQ's public track record: wins, losses, ties, pending picks, Brier score, results by confidence tier and calibration. Optionally one season.",
    input: z.object({ season: seasonArg }),
    run: async ({ season }) => {
      const rows = (await getRecordRows()).filter((r) => !season || r.season === season);
      return {
        season: season ?? "all",
        overall: tally(rows),
        by_tier: byTier(rows),
        calibration: calibration(rows),
        recent: rows.slice(0, 10).map((r) => ({
          game: `${r.away} at ${r.home}`,
          season: r.season,
          week: r.week,
          pick: r.winner,
          win_probability_pct: pct(r.winProb),
          result: r.outcome ?? "pending",
        })),
      };
    },
  }),
] as const;

/** Tool definitions for the Messages API. */
export const TOOL_SCHEMAS: Anthropic.Tool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: z.toJSONSchema(t.input) as Anthropic.Tool.InputSchema,
}));

/** Run one tool call. Invalid input or errors come back as error results, never thrown. */
export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<{ content: string; isError: boolean }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = (t.input as z.ZodTypeAny).safeParse(input ?? {});
  if (!parsed.success) {
    return {
      content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      isError: true,
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- validated above
    const result = await (t.run as (a: any, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    reportError(`[chat] tool ${name} failed`, err, { source: "chat-tool", tags: { tool: name } });
    return { content: "The data lookup failed. Tell the user to try again later.", isError: true };
  }
}
