import { createHash } from "node:crypto";

/**
 * Digest of a season's games, used to prove the database matches the source
 * (nflverse) exactly. The pipeline computes the same digest from its own data
 * (pipeline/endzoneiq_pipeline/digest.py); both test suites share one vector.
 *
 * One line per game, sorted by id:
 *   <id>|<HOME>|<AWAY>|<home score or "">|<away score or "">|<status>|<kickoff ISO, seconds, Z>
 */
export interface DigestRow {
  id: string;
  homeAbbr: string;
  awayAbbr: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  kickoffAt: Date;
}

export function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function digestLine(r: DigestRow): string {
  return [
    r.id,
    r.homeAbbr,
    r.awayAbbr,
    r.homeScore ?? "",
    r.awayScore ?? "",
    r.status,
    isoSeconds(r.kickoffAt),
  ].join("|");
}

export function gamesDigest(rows: DigestRow[]): { count: number; digest: string } {
  const lines = rows.map(digestLine).sort();
  const digest = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
  return { count: rows.length, digest };
}
