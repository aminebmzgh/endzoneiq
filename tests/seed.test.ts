import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STADIUMS, TEAMS } from "@/db/seed/reference-data";
import { renderSeedSql, SEED_MIGRATION } from "@/db/seed/render-sql";

describe("reference seed", () => {
  it("is exactly what the committed migration applies", () => {
    const file = path.resolve(import.meta.dirname, "../db/migrations", SEED_MIGRATION);
    expect(fs.readFileSync(file, "utf8")).toBe(renderSeedSql());
  });

  it("has 32 teams, 4 per division, with stable alphabetical ids", () => {
    expect(TEAMS).toHaveLength(32);
    expect(new Set(TEAMS.map((t) => t.abbr)).size).toBe(32);
    const perDivision = new Map<string, number>();
    for (const t of TEAMS) {
      const key = `${t.conference} ${t.division}`;
      perDivision.set(key, (perDivision.get(key) ?? 0) + 1);
      expect(t.primaryColor).toMatch(/^#[0-9A-F]{6}$/);
      expect(t.secondaryColor).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect([...perDivision.values()]).toEqual(Array(8).fill(4));
    expect(TEAMS.map((t) => t.abbr)).toEqual(TEAMS.map((t) => t.abbr).sort());
    expect(TEAMS.map((t) => t.id)).toEqual(TEAMS.map((_, i) => i + 1));
  });

  it("gives every team an active home stadium with sane coordinates", () => {
    const abbrs = new Set(TEAMS.map((t) => t.abbr));
    for (const s of STADIUMS) {
      if (s.team !== null) expect(abbrs.has(s.team)).toBe(true);
      expect(s.lat).toBeGreaterThan(-90);
      expect(s.lat).toBeLessThan(90);
      expect(s.lon).toBeGreaterThan(-180);
      expect(s.lon).toBeLessThan(180);
      expect(s.id).toMatch(/^[A-Z]{3}\d{2}$/);
    }
    // MetLife and SoFi are shared, so their second tenants have no own row.
    const sharedTenants = new Set(["NYJ", "LAC"]);
    for (const t of TEAMS) {
      if (sharedTenants.has(t.abbr)) continue;
      expect(
        STADIUMS.some((s) => s.team === t.abbr && s.isActive),
        t.abbr,
      ).toBe(true);
    }
  });
});
