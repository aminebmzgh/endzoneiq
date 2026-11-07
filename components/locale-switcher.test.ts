import { describe, expect, it } from "vitest";
import { swapLocale } from "./locale-switcher";

describe("swapLocale", () => {
  it("keeps the page and swaps the locale segment", () => {
    expect(swapLocale("/en/game/nyj-at-kc-2026-week-9", "fr")).toBe(
      "/fr/game/nyj-at-kc-2026-week-9",
    );
    expect(swapLocale("/es", "en")).toBe("/en");
    expect(swapLocale("/fr/record", "es")).toBe("/es/record");
  });
  it("adds a locale to an unprefixed path", () => {
    expect(swapLocale("/", "fr")).toBe("/fr/");
    expect(swapLocale("/teams", "es")).toBe("/es/teams");
  });
});
