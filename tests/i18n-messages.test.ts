import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("translations", () => {
  const base = keys(en).sort();
  it.each([
    ["fr", fr],
    ["es", es],
  ])("%s has exactly the same keys as en", (_locale, messages) => {
    expect(keys(messages).sort()).toEqual(base);
  });

  it.each([
    ["en", en],
    ["fr", fr],
    ["es", es],
  ])("%s footer carries the non-affiliation notice", (_locale, messages) => {
    expect(messages.Footer.disclaimer.length).toBeGreaterThan(20);
    expect(messages.Footer.disclaimer).toMatch(/NFL/);
  });
});
