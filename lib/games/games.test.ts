import { describe, expect, it } from "vitest";
import { gamesDigest, isoSeconds } from "./digest";
import { gameSlug } from "./slug";

describe("gameSlug", () => {
  it("builds readable, unique slugs", () => {
    expect(
      gameSlug({ season: 2024, week: 1, gameType: "REG", homeAbbr: "KC", awayAbbr: "BAL" }),
    ).toBe("bal-at-kc-2024-week-1");
    expect(
      gameSlug({ season: 2024, week: 22, gameType: "SB", homeAbbr: "PHI", awayAbbr: "KC" }),
    ).toBe("kc-at-phi-2024-super-bowl");
    expect(
      gameSlug({ season: 2023, week: 19, gameType: "WC", homeAbbr: "BUF", awayAbbr: "PIT" }),
    ).toBe("pit-at-buf-2023-wild-card");
  });
});

describe("gamesDigest", () => {
  // Shared with pipeline/tests/test_digest.py. Change both or neither.
  it("matches the shared test vector regardless of row order", () => {
    const rows = [
      {
        id: "2026_18_TB_NO",
        homeAbbr: "NO",
        awayAbbr: "TB",
        homeScore: null,
        awayScore: null,
        status: "scheduled",
        kickoffAt: new Date("2027-01-10T18:00:00Z"),
      },
      {
        id: "2024_01_BAL_KC",
        homeAbbr: "KC",
        awayAbbr: "BAL",
        homeScore: 27,
        awayScore: 20,
        status: "final",
        kickoffAt: new Date("2024-09-06T00:20:00Z"),
      },
    ];
    const expected = {
      count: 2,
      digest: "a73e87c515792db0a4b39d58203ac51b8851e7b1365b81598ed66a848c91764b",
    };
    expect(gamesDigest(rows)).toEqual(expected);
    expect(gamesDigest([...rows].reverse())).toEqual(expected);
  });

  it("formats kickoff to whole seconds in UTC", () => {
    expect(isoSeconds(new Date("2024-09-06T00:20:00.000Z"))).toBe("2024-09-06T00:20:00Z");
  });
});
