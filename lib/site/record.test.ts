import { describe, expect, it } from "vitest";
import { parseChangeReason, pct, roundLabel } from "./labels";
import { byTier, bySeason, calibration, outcome, tally } from "./record";
import type { RecordRow } from "./types";

const row = (over: Partial<RecordRow>): RecordRow => ({
  gameId: "g",
  slug: "s",
  season: 2026,
  week: 1,
  gameType: "REG",
  kickoffAt: "2026-09-10T00:20:00.000Z",
  home: "KC",
  away: "BUF",
  winner: "KC",
  winProb: 0.6,
  tier: "solid",
  homeScore: null,
  awayScore: null,
  outcome: null,
  ...over,
});

describe("outcome", () => {
  it("grades the picked side against the final score", () => {
    expect(outcome(true, 27, 20)).toBe("win");
    expect(outcome(true, 17, 20)).toBe("loss");
    expect(outcome(false, 17, 20)).toBe("win");
    expect(outcome(false, 20, 20)).toBe("tie");
  });
});

describe("track record", () => {
  const rows = [
    row({ winProb: 0.55, tier: "lean", outcome: "win" }),
    row({ winProb: 0.65, tier: "solid", outcome: "loss" }),
    row({ winProb: 0.75, tier: "strong", outcome: "win" }),
    row({ winProb: 0.8, tier: "strong", outcome: "tie", season: 2025 }),
    row({ winProb: 0.7, tier: "strong", outcome: null }),
  ];

  it("counts every graded pick, ties apart, pending apart", () => {
    const t = tally(rows);
    expect(t).toMatchObject({ wins: 2, losses: 1, ties: 1, pending: 1 });
    expect(t.winRate).toBeCloseTo(2 / 3);
    // Brier: (.55-1)^2 + (.65-0)^2 + (.75-1)^2 + (.8-.5)^2, over 4 graded picks
    expect(t.brier).toBeCloseTo((0.2025 + 0.4225 + 0.0625 + 0.09) / 4);
  });

  it("has no rate or Brier score before any game is graded", () => {
    expect(tally([row({})])).toMatchObject({ winRate: null, brier: null, pending: 1 });
  });

  it("splits by tier and season", () => {
    const tiers = byTier(rows);
    expect(tiers.strong).toMatchObject({ wins: 1, ties: 1, pending: 1 });
    expect(tiers.lean.wins).toBe(1);
    expect(bySeason(rows).map((s) => s.season)).toEqual([2026, 2025]);
  });

  it("bins calibration by predicted probability, graded picks only", () => {
    const bins = calibration(rows);
    expect(bins.map((b) => b.count)).toEqual([1, 1, 1, 1]);
    expect(bins[2]).toMatchObject({ from: 0.7, predicted: 0.75, actual: 1 });
    expect(bins[3]).toMatchObject({ to: 1, predicted: 0.8, actual: 0.5 });
  });
});

describe("labels", () => {
  const t = (key: string, v?: Record<string, string | number>) => (v ? `${key}:${v.week}` : key);
  it("names rounds", () => {
    expect(roundLabel(t, "REG", 9)).toBe("regular:9");
    expect(roundLabel(t, "SB", 22)).toBe("SB");
  });
  it("formats percentages per locale", () => {
    expect(pct("en", 0.826)).toBe("83%");
    expect(pct("fr", 0.826)).toMatch(/^83\s%$/);
  });
  it("reads the stored change reasons", () => {
    expect(parseChangeReason(null)).toEqual({ kind: "first" });
    expect(parseChangeReason("winner changed")).toEqual({ kind: "winner" });
    expect(parseChangeReason("win probability moved 7 points")).toEqual({
      kind: "moved",
      points: 7,
    });
  });
});
