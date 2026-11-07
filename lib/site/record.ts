/**
 * Track-record statistics (spec 11.3). Pure functions over graded picks, so the
 * numbers on the record page are unit-tested. Honest by construction: every graded
 * pick counts, ties are shown separately, nothing is filtered out.
 */
import type { Outcome, RecordRow, Tier } from "./types";

/** Result of a winner pick from the final score. */
export function outcome(pickedHome: boolean, homeScore: number, awayScore: number): Outcome {
  if (homeScore === awayScore) return "tie";
  return homeScore > awayScore === pickedHome ? "win" : "loss";
}

export interface Tally {
  wins: number;
  losses: number;
  ties: number;
  pending: number;
  /** Wins / (wins + losses); null with no decided games. */
  winRate: number | null;
  /** Mean (p - outcome)^2 over graded picks, p = the pick's win probability; ties = 0.5. */
  brier: number | null;
}

export interface CalibrationBin {
  /** Inclusive lower bound of the predicted probability, e.g. 0.5. */
  from: number;
  to: number;
  count: number;
  /** Mean predicted probability in the bin. */
  predicted: number | null;
  /** Share of picks in the bin that won (ties count half). */
  actual: number | null;
}

export const CALIBRATION_EDGES = [0.5, 0.6, 0.7, 0.8, 1.0001] as const;

export function tally(rows: RecordRow[]): Tally {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pending = 0;
  let brierSum = 0;
  for (const r of rows) {
    if (r.outcome === null) {
      pending++;
      continue;
    }
    const y = r.outcome === "win" ? 1 : r.outcome === "tie" ? 0.5 : 0;
    brierSum += (r.winProb - y) ** 2;
    if (r.outcome === "win") wins++;
    else if (r.outcome === "loss") losses++;
    else ties++;
  }
  const graded = wins + losses + ties;
  return {
    wins,
    losses,
    ties,
    pending,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    brier: graded > 0 ? brierSum / graded : null,
  };
}

export function byTier(rows: RecordRow[]): Record<Tier, Tally> {
  return {
    lean: tally(rows.filter((r) => r.tier === "lean")),
    solid: tally(rows.filter((r) => r.tier === "solid")),
    strong: tally(rows.filter((r) => r.tier === "strong")),
  };
}

export function bySeason(rows: RecordRow[]): { season: number; tally: Tally }[] {
  const seasons = [...new Set(rows.map((r) => r.season))].sort((a, b) => b - a);
  return seasons.map((season) => ({
    season,
    tally: tally(rows.filter((r) => r.season === season)),
  }));
}

export function calibration(rows: RecordRow[]): CalibrationBin[] {
  const graded = rows.filter((r) => r.outcome !== null);
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < CALIBRATION_EDGES.length - 1; i++) {
    const from = CALIBRATION_EDGES[i]!;
    const to = CALIBRATION_EDGES[i + 1]!;
    const inBin = graded.filter((r) => r.winProb >= from && r.winProb < to);
    const n = inBin.length;
    bins.push({
      from,
      to: Math.min(to, 1),
      count: n,
      predicted: n ? inBin.reduce((s, r) => s + r.winProb, 0) / n : null,
      actual: n
        ? inBin.reduce((s, r) => s + (r.outcome === "win" ? 1 : r.outcome === "tie" ? 0.5 : 0), 0) /
          n
        : null,
    });
  }
  return bins;
}
