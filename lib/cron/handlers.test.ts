import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), revalidateTag: vi.fn() }));

describe("weekly email window", () => {
  it("is Tuesday 12:00-16:00 US Eastern, across daylight saving time", async () => {
    const { inWeeklyWindow } = await import("@/lib/cron/handlers");
    expect(inWeeklyWindow(new Date("2026-11-10T17:30:00Z"))).toBe(true); // Tue 12:30 EST
    expect(inWeeklyWindow(new Date("2026-11-10T21:30:00Z"))).toBe(false); // Tue 16:30 EST
    expect(inWeeklyWindow(new Date("2026-09-15T16:00:00Z"))).toBe(true); // Tue 12:00 EDT
    expect(inWeeklyWindow(new Date("2026-11-11T17:30:00Z"))).toBe(false); // Wednesday
  });
});
