import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { games, pickResults, picks } from "@/db/schema";
import { getDb } from "@/lib/db";
import { outcome } from "@/lib/site/record";

/**
 * Grading (spec 12.1 grade_picks). A game is graded once it is final, against the
 * pick that was current at kickoff. Picks lock at kickoff, so that is simply the
 * current version. Grading uses the scores stored by the games ingest, so the
 * track record can never disagree with the scores shown on the site.
 *
 * A tie counts as an incorrect winner pick in `correct_winner` (the column is not
 * nullable); the record shows ties separately, from the scores.
 *
 * Spread and total results stay NULL until market lines exist (FEATURE_ODDS):
 * "covered" only means something against a market number.
 */

export interface GradeResult {
  graded: number;
  gameIds: string[];
  seasons: number[];
}

/** Grade every final game whose current pick has no result yet. Idempotent. */
export async function gradeFinishedGames(
  opts: { seasons?: number[]; now?: Date } = {},
): Promise<GradeResult> {
  const db = getDb();
  const rows = await db
    .select({
      pickId: picks.id,
      winnerTeamId: picks.winnerTeamId,
      gameId: games.id,
      season: games.season,
      homeTeamId: games.homeTeamId,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
    })
    .from(picks)
    .innerJoin(games, eq(games.id, picks.gameId))
    .leftJoin(pickResults, eq(pickResults.pickId, picks.id))
    .where(
      and(
        eq(picks.isCurrent, true),
        eq(games.status, "final"),
        isNotNull(games.homeScore),
        isNotNull(games.awayScore),
        isNull(pickResults.pickId),
      ),
    );

  const wanted = opts.seasons ? new Set(opts.seasons) : null;
  const todo = rows.filter((r) => !wanted || wanted.has(r.season));
  if (todo.length === 0) return { graded: 0, gameIds: [], seasons: [] };

  const gradedAt = opts.now ?? new Date();
  // INSERT IGNORE: a concurrent grading run can't create a second result.
  const [res] = await db
    .insert(pickResults)
    .ignore()
    .values(
      todo.map((r) => ({
        pickId: r.pickId,
        correctWinner:
          outcome(r.winnerTeamId === r.homeTeamId, r.homeScore!, r.awayScore!) === "win",
        coveredSpread: null,
        totalResult: null,
        gradedAt,
      })),
    );
  return {
    graded: res.affectedRows,
    gameIds: todo.map((r) => r.gameId),
    seasons: [...new Set(todo.map((r) => r.season))],
  };
}
