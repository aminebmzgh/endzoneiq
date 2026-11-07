import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { explanations, games, locales, modelVersions, picks, teams } from "@/db/schema";
import { getDb } from "@/lib/db";
import { isoSeconds } from "@/lib/games/digest";
import type { PickInput } from "@/lib/internal/schemas";
import { InternalApiError } from "@/lib/internal/route";
import { type ChainRow, contentHash, type PickContent, round } from "./hash";

/**
 * The picks repository. Picks are APPEND-ONLY: this module can insert a new
 * version and mark the previous one superseded (is_current 1 -> 0, the only
 * change the DB triggers allow), and nothing else. There is deliberately no
 * update or delete function.
 */

const PICKS_LOCK = "endzoneiq_picks";
/** A new version is published only if the winner changes or the probability moves this much. */
export const MATERIAL_PROB_CHANGE = 0.05;

export type PublishStatus = "created" | "unchanged" | "locked" | "unknown_game";

export interface PublishResult {
  gameId: string;
  status: PublishStatus;
  versionNo?: number;
  contentHash?: string;
  changeReason?: string | null;
}

/** P(home wins) for a stored pick. */
export function homeProb(winnerIsHome: boolean, winProb: number): number {
  return winnerIsHome ? winProb : 1 - winProb;
}

export function changeReason(
  previous: { winnerIsHome: boolean; homeProb: number } | undefined,
  next: { winnerIsHome: boolean; homeProb: number },
): string | null | undefined {
  if (!previous) return null; // first version: no change to explain
  if (previous.winnerIsHome !== next.winnerIsHome) return "winner changed";
  const moved = Math.abs(next.homeProb - previous.homeProb);
  if (moved >= MATERIAL_PROB_CHANGE - 1e-9) {
    return `win probability moved ${Math.round(moved * 100)} points`;
  }
  return undefined; // not material: keep the current version
}

export async function publishPicks(
  modelVersionName: string,
  inputs: PickInput[],
  now: Date = new Date(),
): Promise<{ results: PublishResult[]; chainHead: string | null }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [[lock]] = (await tx.execute(
      sql`SELECT GET_LOCK(${PICKS_LOCK}, 10) AS got`,
    )) as unknown as [[{ got: number | null }]];
    if (lock?.got !== 1) throw new InternalApiError(503, "picks are being published, retry");
    try {
      const [model] = await tx
        .select({ id: modelVersions.id })
        .from(modelVersions)
        .where(eq(modelVersions.name, modelVersionName));
      if (!model) throw new InternalApiError(422, `unknown model version ${modelVersionName}`);

      const ids = [...new Set(inputs.map((p) => p.gameId))];
      const home = alias(teams, "home");
      const away = alias(teams, "away");
      const gameRows = ids.length
        ? await tx
            .select({
              id: games.id,
              kickoffAt: games.kickoffAt,
              homeId: games.homeTeamId,
              awayId: games.awayTeamId,
              homeAbbr: home.abbr,
              awayAbbr: away.abbr,
            })
            .from(games)
            .innerJoin(home, eq(home.id, games.homeTeamId))
            .innerJoin(away, eq(away.id, games.awayTeamId))
            .where(inArray(games.id, ids))
        : [];
      const gameById = new Map(gameRows.map((g) => [g.id, g]));
      const currentRows = ids.length
        ? await tx
            .select()
            .from(picks)
            .where(and(inArray(picks.gameId, ids), eq(picks.isCurrent, true)))
        : [];
      const current = new Map(currentRows.map((p) => [p.gameId, p]));
      const [last] = await tx
        .select({ hash: picks.contentHash })
        .from(picks)
        .orderBy(desc(picks.id))
        .limit(1);
      let prevHash: string | null = last?.hash ?? null;

      const results: PublishResult[] = [];
      for (const input of inputs) {
        const game = gameById.get(input.gameId);
        if (!game) {
          results.push({ gameId: input.gameId, status: "unknown_game" });
          continue;
        }
        // Locked once the game kicks off: no new version, ever.
        if (game.kickoffAt.getTime() <= now.getTime()) {
          results.push({ gameId: input.gameId, status: "locked" });
          continue;
        }
        const winnerIsHome = input.homeWinProb >= 0.5;
        const cur = current.get(input.gameId);
        const reason = changeReason(
          cur && {
            winnerIsHome: cur.winnerTeamId === game.homeId,
            homeProb: homeProb(cur.winnerTeamId === game.homeId, cur.winProb),
          },
          { winnerIsHome, homeProb: input.homeWinProb },
        );
        if (reason === undefined) {
          results.push({
            gameId: input.gameId,
            status: "unchanged",
            versionNo: cur!.versionNo,
            contentHash: cur!.contentHash,
          });
          continue;
        }

        const versionNo = (cur?.versionNo ?? 0) + 1;
        const publishedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
        const content: PickContent = {
          game_id: input.gameId,
          model_version: modelVersionName,
          version_no: versionNo,
          published_at: isoSeconds(publishedAt),
          winner: winnerIsHome ? game.homeAbbr : game.awayAbbr,
          win_prob: round(winnerIsHome ? input.homeWinProb : 1 - input.homeWinProb, 4),
          confidence_tier: input.tier,
          pred_spread: round(input.predMargin, 2),
          pred_total: round(input.predTotal, 2),
          features: input.features,
          shap: input.shap,
          change_reason: input.changeReason ?? reason,
        };
        const hash = contentHash(content, prevHash);

        if (cur) {
          // Supersede: the only update the append-only triggers allow.
          await tx
            .update(picks)
            .set({ isCurrent: false })
            .where(and(eq(picks.id, cur.id), eq(picks.isCurrent, true)));
        }
        const [ins] = await tx.insert(picks).values({
          gameId: input.gameId,
          modelVersionId: model.id,
          versionNo,
          publishedAt,
          winnerTeamId: winnerIsHome ? game.homeId : game.awayId,
          winProb: content.win_prob,
          confidenceTier: input.tier,
          predSpread: content.pred_spread,
          predTotal: content.pred_total,
          featuresJson: input.features as Record<string, unknown>,
          shapJson: input.shap as Record<string, unknown>,
          changeReason: content.change_reason,
          isCurrent: true,
          contentHash: hash,
          prevHash,
        });
        await tx.insert(explanations).values(
          locales.map((locale) => ({
            pickId: ins.insertId,
            locale,
            headline: input.explanations[locale].headline,
            reasonsJson: input.explanations[locale].reasons,
            matchupNotesJson: input.explanations[locale].matchupNotes,
            generatedAt: publishedAt,
            source: input.explanations[locale].source,
          })),
        );
        prevHash = hash;
        results.push({
          gameId: input.gameId,
          status: "created",
          versionNo,
          contentHash: hash,
          changeReason: content.change_reason,
        });
      }
      return { results, chainHead: prevHash };
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${PICKS_LOCK})`);
    }
  });
}

/** Every pick in id order, as hashed content, for verifyChain(). */
export async function loadChain(): Promise<ChainRow[]> {
  const winner = alias(teams, "winner");
  const rows = await getDb()
    .select({
      id: picks.id,
      gameId: picks.gameId,
      model: modelVersions.name,
      versionNo: picks.versionNo,
      publishedAt: picks.publishedAt,
      winner: winner.abbr,
      winProb: picks.winProb,
      tier: picks.confidenceTier,
      predSpread: picks.predSpread,
      predTotal: picks.predTotal,
      features: picks.featuresJson,
      shap: picks.shapJson,
      changeReason: picks.changeReason,
      contentHash: picks.contentHash,
      prevHash: picks.prevHash,
    })
    .from(picks)
    .innerJoin(modelVersions, eq(modelVersions.id, picks.modelVersionId))
    .innerJoin(winner, eq(winner.id, picks.winnerTeamId))
    .orderBy(asc(picks.id));
  return rows.map((r) => ({
    id: r.id,
    contentHash: r.contentHash,
    prevHash: r.prevHash,
    content: {
      game_id: r.gameId,
      model_version: r.model,
      version_no: r.versionNo,
      published_at: isoSeconds(r.publishedAt),
      winner: r.winner,
      win_prob: r.winProb,
      confidence_tier: r.tier,
      pred_spread: r.predSpread,
      pred_total: r.predTotal,
      features: r.features,
      shap: r.shap,
      change_reason: r.changeReason,
    },
  }));
}
