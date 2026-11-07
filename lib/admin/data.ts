import "server-only";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { z } from "zod";
import {
  auditLog,
  games,
  ingestLog,
  injuries,
  modelVersions,
  picks,
  pipelineRuns,
  players,
  teams,
} from "@/db/schema";
import { isAdmin, getViewer, type Viewer } from "@/lib/authz";
import { sameOrigin } from "@/lib/billing/routes";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";

/** Admin screen (spec 11.8): overrides, re-predict, runs, logs, models. Admins only. */

const home = alias(teams, "home_team");
const away = alias(teams, "away_team");
const winner = alias(teams, "winner_team");

export async function adminOverview() {
  const db = getDb();
  const now = new Date();
  const upcoming = await db
    .select({
      id: games.id,
      season: games.season,
      week: games.week,
      kickoffAt: games.kickoffAt,
      homeId: games.homeTeamId,
      awayId: games.awayTeamId,
      home: home.abbr,
      away: away.abbr,
    })
    .from(games)
    .innerJoin(home, eq(home.id, games.homeTeamId))
    .innerJoin(away, eq(away.id, games.awayTeamId))
    .where(gt(games.kickoffAt, now))
    .orderBy(asc(games.kickoffAt))
    .limit(40);
  // Only the next week with games.
  const first = upcoming[0];
  const week = first
    ? upcoming.filter((g) => g.season === first.season && g.week === first.week)
    : [];
  const ids = week.map((g) => g.id);
  const teamIds = [...new Set(week.flatMap((g) => [g.homeId, g.awayId]))];

  const [currentPicks, reports, roster, runs, logs, models] = await Promise.all([
    ids.length
      ? db
          .select({
            gameId: picks.gameId,
            versionNo: picks.versionNo,
            winner: winner.abbr,
            winProb: picks.winProb,
          })
          .from(picks)
          .innerJoin(winner, eq(winner.id, picks.winnerTeamId))
          .where(and(inArray(picks.gameId, ids), eq(picks.isCurrent, true)))
      : [],
    ids.length
      ? db
          .select({
            gameId: injuries.gameId,
            gsisId: players.gsisId,
            source: injuries.source,
            status: injuries.reportStatus,
          })
          .from(injuries)
          .innerJoin(players, eq(players.id, injuries.playerId))
          .where(inArray(injuries.gameId, ids))
      : [],
    teamIds.length
      ? db
          .select({
            gsisId: players.gsisId,
            name: players.name,
            position: players.position,
            teamId: players.teamId,
          })
          .from(players)
          .where(inArray(players.teamId, teamIds))
          .orderBy(asc(players.position), asc(players.name))
      : [],
    db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(15),
    db.select().from(ingestLog).orderBy(desc(ingestLog.id)).limit(20),
    db
      .select({
        name: modelVersions.name,
        trainedAt: modelVersions.trainedAt,
        isActive: modelVersions.isActive,
      })
      .from(modelVersions)
      .orderBy(desc(modelVersions.trainedAt))
      .limit(5),
  ]);

  return {
    games: week.map((g) => {
      const pick = currentPicks.find((p) => p.gameId === g.id) ?? null;
      const teamPlayers = (teamId: number) =>
        roster
          .filter((p) => p.teamId === teamId)
          .map((p) => {
            const mine = reports.filter((r) => r.gameId === g.id && r.gsisId === p.gsisId);
            return {
              gsisId: p.gsisId,
              name: p.name,
              position: p.position,
              report: mine.find((r) => r.source === "nflverse")?.status ?? null,
              override: mine.find((r) => r.source === "admin")?.status ?? null,
            };
          })
          .filter((p) => p.position === "QB" || p.report || p.override);
      return {
        id: g.id,
        kickoffAt: g.kickoffAt.toISOString(),
        home: g.home,
        away: g.away,
        pick,
        players: { [g.away]: teamPlayers(g.awayId), [g.home]: teamPlayers(g.homeId) },
      };
    }),
    runs,
    logs,
    models,
    flags: {
      FEATURE_ODDS: serverEnv().FEATURE_ODDS,
      repredictConfigured: Boolean(serverEnv().GITHUB_TOKEN),
    },
  };
}

// --- GitHub Actions --------------------------------------------------------------

const GH = "https://api.github.com";
const WORKFLOW = "repredict.yml";

function gh(path: string, init: RequestInit = {}) {
  const { GITHUB_TOKEN, GITHUB_REPO } = serverEnv();
  return fetch(`${GH}/repos/${GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "endzoneiq-admin",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

/** Start repredict.yml (one game, or the whole upcoming week when gameId is empty). */
export async function dispatchRepredict(gameId: string | null): Promise<boolean> {
  if (!serverEnv().GITHUB_TOKEN) return false;
  const res = await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { game_id: gameId ?? "" } }),
  });
  return res.status === 204;
}

export async function repredictRuns() {
  if (!serverEnv().GITHUB_TOKEN) return [];
  const res = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=5`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    workflow_runs: {
      id: number;
      status: string;
      conclusion: string | null;
      created_at: string;
      html_url: string;
      display_title: string;
    }[];
  };
  return data.workflow_runs.map((r) => ({
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    url: r.html_url,
    title: r.display_title,
  }));
}

// --- Actions ---------------------------------------------------------------------

const noStore = { "Cache-Control": "private, no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

const gameIdSchema = z.string().regex(/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/);
const overrideBody = z.object({
  gameId: gameIdSchema,
  gsisId: z.string().min(3).max(16),
  /** null removes the override. */
  status: z.enum(["out", "doubtful", "questionable", "active"]).nullable(),
  repredict: z.boolean().default(true),
});
const repredictBody = z.object({ gameId: gameIdSchema.nullable() });

type Deps = {
  viewer: (req: Request) => Promise<Viewer>;
  dispatch: (gameId: string | null) => Promise<boolean>;
};
const defaults: Deps = { viewer: (req) => getViewer(req.headers), dispatch: dispatchRepredict };

export function adminHandlers(deps: Deps = defaults) {
  const guard = async (req: Request) => {
    if (!sameOrigin(req)) return { error: json(403, { error: "cross-origin request" }) };
    const viewer = await deps.viewer(req);
    // 404 rather than 403: don't reveal the admin area to non-admins.
    if (!isAdmin(viewer)) return { error: json(404, { error: "not found" }) };
    return { viewer: viewer! };
  };

  return {
    /** POST /api/admin/override: set or clear an admin injury status, then re-predict. */
    override: async (req: Request) => {
      const g = await guard(req);
      if (g.error) return g.error;
      const parsed = overrideBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json(422, { error: "invalid request" });
      const { gameId, gsisId, status } = parsed.data;
      const db = getDb();
      const [[game], [player]] = await Promise.all([
        db
          .select({ id: games.id, kickoffAt: games.kickoffAt })
          .from(games)
          .where(eq(games.id, gameId)),
        db.select({ id: players.id }).from(players).where(eq(players.gsisId, gsisId)),
      ]);
      if (!game || !player) return json(404, { error: "unknown game or player" });
      if (game.kickoffAt <= new Date()) return json(409, { error: "the game has kicked off" });

      const where = and(
        eq(injuries.playerId, player.id),
        eq(injuries.gameId, gameId),
        eq(injuries.source, "admin"),
      );
      if (status === null) {
        await db.delete(injuries).where(where);
      } else {
        await db
          .insert(injuries)
          .values({ playerId: player.id, gameId, reportStatus: status, source: "admin" })
          .onDuplicateKeyUpdate({ set: { reportStatus: status } });
      }
      await db.insert(auditLog).values({
        actor: g.viewer.email,
        action: status === null ? "override.clear" : "override.set",
        entity: "injury",
        entityId: `${gameId}:${gsisId}`,
        payload: { gameId, gsisId, status },
      });
      const dispatched = parsed.data.repredict ? await deps.dispatch(gameId) : false;
      return json(200, { ok: true, dispatched });
    },

    /** POST /api/admin/repredict: re-run the model for one game or the upcoming week. */
    repredict: async (req: Request) => {
      const g = await guard(req);
      if (g.error) return g.error;
      const parsed = repredictBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json(422, { error: "invalid request" });
      const dispatched = await deps.dispatch(parsed.data.gameId);
      await getDb()
        .insert(auditLog)
        .values({
          actor: g.viewer.email,
          action: "repredict",
          entity: "game",
          entityId: parsed.data.gameId ?? "week",
          payload: { dispatched },
        });
      return json(dispatched ? 200 : 503, { dispatched });
    },

    /** GET /api/admin/runs: the latest repredict.yml runs. */
    runs: async (req: Request) => {
      const viewer = await deps.viewer(req);
      if (!isAdmin(viewer)) return json(404, { error: "not found" });
      return json(200, { runs: await repredictRuns() });
    },
  };
}
