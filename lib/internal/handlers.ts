import "server-only";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import {
  games,
  injuries,
  modelVersions,
  picks,
  pipelineRuns,
  players,
  seasons,
  teams,
} from "@/db/schema";
import { tags } from "@/lib/cache-tags";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { gamesDigest } from "@/lib/games/digest";
import { seasonDigestRows, upsertGames, upsertSeasons } from "@/lib/games/repository";
import { InternalApiError, internalRoute } from "./route";
import { publishPicks } from "@/lib/picks/repository";
import { ingestGamesBody, ingestPicksBody, modelVersionBody, pipelineRunBody } from "./schemas";

/**
 * Handlers for /api/internal/*. Route files under app/api/internal only
 * re-export these (GET routes call `connection()` first so they are never
 * prerendered), which keeps them easy to test.
 */

/** POST /api/internal/ingest/games: upsert schedule, scores and status (idempotent). */
export const ingestGames = internalRoute(
  { endpoint: "ingest/games", schema: ingestGamesBody },
  async ({ body }) => {
    const result = await upsertGames(body.games);
    const seasonsChanged = await upsertSeasons(body.seasons);

    if (result.changedSeasons.length > 0) {
      revalidateTag(tags.games, "max");
      for (const year of result.changedSeasons) revalidateTag(tags.season(year), "max");
    }
    if (seasonsChanged > 0) revalidateTag(tags.seasons, "max");

    return {
      rows: result.inserted + result.updated + seasonsChanged,
      data: { ...result, received: body.games.length, seasonsChanged },
    };
  },
);

/** GET /api/internal/games/digest?season=YYYY: proves the stored season matches the source. */
export const gamesDigestHandler = internalRoute({ endpoint: "games/digest" }, async ({ url }) => {
  const season = Number(url.searchParams.get("season"));
  if (!Number.isInteger(season) || season < 1990 || season > 2100) {
    throw new InternalApiError(400, "season query parameter is required");
  }
  const rows = await seasonDigestRows(season);
  return { rows: 0, data: { season, ...gamesDigest(rows) } };
});

/** POST /api/internal/pipeline-run: report job start/end/status/error (idempotent upsert). */
export const pipelineRun = internalRoute(
  { endpoint: "pipeline-run", schema: pipelineRunBody },
  async ({ body }: { body: z.infer<typeof pipelineRunBody> }) => {
    const now = new Date();
    const finished = body.status === "running" ? null : new Date(body.finishedAt ?? now);
    await getDb()
      .insert(pipelineRuns)
      .values({
        id: body.id,
        job: body.job,
        status: body.status,
        startedAt: new Date(body.startedAt ?? now),
        finishedAt: finished,
        error: body.error ?? null,
        runUrl: body.runUrl ?? null,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: sql`VALUES(${pipelineRuns.status})`,
          finishedAt: sql`VALUES(${pipelineRuns.finishedAt})`,
          error: sql`VALUES(${pipelineRuns.error})`,
          runUrl: sql`COALESCE(VALUES(${pipelineRuns.runUrl}), ${pipelineRuns.runUrl})`,
        },
      });
    // Failure alert emails (Resend) arrive in Phase 7.
    return { rows: 1, data: { ok: true } };
  },
);

/**
 * GET /api/internal/export: the season state the pipeline needs. Admin injury
 * overrides, current pick versions for upcoming games, feature flags.
 */
export const exportState = internalRoute({ endpoint: "export" }, async () => {
  const db = getDb();
  const now = new Date();
  const [seasonRows, overrides, currentPicks, [activeModel]] = await Promise.all([
    db.select().from(seasons),
    db
      .select({
        gameId: injuries.gameId,
        gsisId: players.gsisId,
        status: injuries.reportStatus,
        updatedAt: injuries.updatedAt,
      })
      .from(injuries)
      .innerJoin(players, eq(players.id, injuries.playerId))
      .innerJoin(games, eq(games.id, injuries.gameId))
      .where(and(eq(injuries.source, "admin"), gt(games.kickoffAt, now))),
    db
      .select({
        gameId: picks.gameId,
        versionNo: picks.versionNo,
        winner: teams.abbr,
        winProb: picks.winProb,
        contentHash: picks.contentHash,
      })
      .from(picks)
      .innerJoin(games, eq(games.id, picks.gameId))
      .innerJoin(teams, eq(teams.id, picks.winnerTeamId))
      .where(and(eq(picks.isCurrent, true), gt(games.kickoffAt, now))),
    db
      .select({ name: modelVersions.name, artifactUrl: modelVersions.artifactUrl })
      .from(modelVersions)
      .where(eq(modelVersions.isActive, true))
      .limit(1),
  ]);
  return {
    rows: 0,
    data: {
      generatedAt: now.toISOString(),
      featureFlags: { odds: serverEnv().FEATURE_ODDS },
      activeModel: activeModel ?? null,
      seasons: seasonRows.map(({ year, currentWeek, phase }) => ({ year, currentWeek, phase })),
      injuryOverrides: overrides,
      currentPicks,
    },
  };
});

/**
 * POST /api/internal/ingest/model-version: register a trained model (idempotent).
 * Names are content hashes, so an existing name is never overwritten: re-sending it
 * only (re)activates it if asked. Activation leaves exactly one active version.
 */
export const ingestModelVersion = internalRoute(
  { endpoint: "ingest/model-version", schema: modelVersionBody },
  async ({ body }) => {
    const db = getDb();
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: modelVersions.id, isActive: modelVersions.isActive })
        .from(modelVersions)
        .where(eq(modelVersions.name, body.name))
        .for("update");
      let id = existing?.id;
      const created = !existing;
      if (!existing) {
        const [res] = await tx.insert(modelVersions).values({
          name: body.name,
          trainedAt: new Date(body.trainedAt),
          metricsJson: body.metrics,
          artifactUrl: body.artifactUrl ?? null,
          isActive: false,
        });
        id = res.insertId;
      }
      let activated = false;
      if (body.activate) {
        const [others] = await tx
          .update(modelVersions)
          .set({ isActive: false })
          .where(and(ne(modelVersions.name, body.name), eq(modelVersions.isActive, true)));
        const [me] = await tx
          .update(modelVersions)
          .set({ isActive: true })
          .where(and(eq(modelVersions.name, body.name), eq(modelVersions.isActive, false)));
        activated = me.affectedRows > 0 || others.affectedRows > 0;
      }
      if (created || activated) revalidateTag(tags.model, "max");
      return {
        rows: Number(created) + Number(activated),
        data: { id, name: body.name, created, activated },
      };
    });
  },
);

/**
 * POST /api/internal/ingest/picks: submit predictions with SHAP and EN/FR/ES
 * explanations. The site decides per game whether this is a new version (first
 * pick, winner changed, or win probability moved >= 5 points). Games that have
 * kicked off are locked: their picks can never change.
 */
export const ingestPicks = internalRoute(
  { endpoint: "ingest/picks", schema: ingestPicksBody },
  async ({ body }) => {
    const { results, chainHead } = await publishPicks(body.modelVersion, body.picks);
    const created = results.filter((r) => r.status === "created");
    if (created.length > 0) {
      revalidateTag(tags.picks, "max");
      for (const r of created) revalidateTag(tags.game(r.gameId), "max");
    }
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return {
      rows: created.length,
      data: {
        created: created.length,
        unchanged: count("unchanged"),
        locked: count("locked"),
        unknownGames: count("unknown_game"),
        chainHead,
        results,
      },
    };
  },
);
