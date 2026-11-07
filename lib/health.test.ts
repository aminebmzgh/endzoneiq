import { describe, expect, it } from "vitest";
import { buildHealthReport } from "./health";

const build = { sha: "abc123", builtAt: "2026-11-07T00:00:00Z" };

describe("buildHealthReport", () => {
  it("reports ok with the db version and the deployed sha", async () => {
    const report = await buildHealthReport(async () => ({ version: "11.8.3-MariaDB" }), build);
    expect(report.status).toBe("ok");
    expect(report.sha).toBe("abc123");
    expect(report.db).toMatchObject({ ok: true, version: "11.8.3-MariaDB" });
  });

  it("reports degraded when the db probe fails, without leaking credentials", async () => {
    const report = await buildHealthReport(async () => {
      throw new Error("connect failed for mysql://user:secret@localhost:3306/db");
    }, build);
    expect(report.status).toBe("degraded");
    expect(report.db.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("times out a hanging db probe", async () => {
    const report = await buildHealthReport(() => new Promise(() => {}), build);
    expect(report.db).toMatchObject({ ok: false, error: expect.stringContaining("timed out") });
  }, 10_000);
});
