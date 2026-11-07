import { describe, expect, it } from "vitest";
import { safeNext } from "./sign-in-form";

describe("safeNext", () => {
  it("returns to a page of this site in this locale", () => {
    expect(safeNext("?next=/fr/pricing", "fr", "/fr/account")).toBe("/fr/pricing");
  });
  it("refuses other sites, other locales and tricks", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/en/pricing",
      "/fr/a" + String.fromCharCode(92) + "b",
    ]) {
      expect(safeNext(`?next=${encodeURIComponent(next)}`, "fr", "/fr/account")).toBe(
        "/fr/account",
      );
    }
    expect(safeNext("", "fr", "/fr/account")).toBe("/fr/account");
  });
});
