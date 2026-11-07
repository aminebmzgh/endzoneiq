import { describe, expect, it } from "vitest";
import { freeBreakdownIds } from "./free-games";

describe("free breakdown games", () => {
  it("are the week's three night games (latest Eastern kickoff times)", () => {
    const week = [
      { id: "TNF", kickoffAt: "2026-11-06T01:15:00Z" }, // Thu 8:15 PM ET
      { id: "LON", kickoffAt: "2026-11-08T14:30:00Z" }, // Sun 9:30 AM ET
      { id: "EARLY1", kickoffAt: "2026-11-08T18:00:00Z" }, // Sun 1:00 PM ET
      { id: "LATE", kickoffAt: "2026-11-08T21:25:00Z" }, // Sun 4:25 PM ET
      { id: "SNF", kickoffAt: "2026-11-09T01:20:00Z" }, // Sun 8:20 PM ET
      { id: "MNF", kickoffAt: "2026-11-10T01:15:00Z" }, // Mon 8:15 PM ET
    ];
    expect([...freeBreakdownIds(week)].sort()).toEqual(["MNF", "SNF", "TNF"]);
  });

  it("works across daylight saving time and short weeks", () => {
    const sep = [
      { id: "A", kickoffAt: "2026-09-11T00:20:00Z" }, // Thu 8:20 PM EDT
      { id: "B", kickoffAt: "2026-09-13T17:00:00Z" }, // 1:00 PM EDT
    ];
    expect([...freeBreakdownIds(sep)].sort()).toEqual(["A", "B"]);
  });
});
