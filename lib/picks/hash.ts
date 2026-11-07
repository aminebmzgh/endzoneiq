/**
 * Public hash chain over every published pick (spec Section 9).
 *
 *   content_hash = SHA-256( canonical(content) + "|" + (prev_hash ?? "") )
 *
 * `canonical` is JSON with object keys sorted recursively and no whitespace.
 * `content` holds exactly the fields below, with the values stored in MySQL, so
 * anyone with the published rows can recompute every hash, and changing any past
 * pick breaks every hash after it. prev_hash is the content_hash of the previous
 * pick (by id) across all games, so the latest hash covers the whole history.
 */
import { createHash } from "node:crypto";

export interface PickContent {
  game_id: string;
  model_version: string;
  version_no: number;
  published_at: string; // ISO 8601, whole seconds, UTC ("2026-11-07T12:00:00Z")
  winner: string; // team abbreviation
  win_prob: number; // P(winner wins), 4 decimals
  confidence_tier: string;
  pred_spread: number; // projected home margin, 2 decimals
  pred_total: number; // 2 decimals
  features: unknown;
  shap: unknown;
  change_reason: string | null;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("non-finite number in pick content");
    }
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function contentHash(content: PickContent, prevHash: string | null): string {
  return createHash("sha256")
    .update(`${canonical(content)}|${prevHash ?? ""}`, "utf8")
    .digest("hex");
}

export interface ChainRow {
  id: number;
  content: PickContent;
  contentHash: string;
  prevHash: string | null;
}

export type ChainVerdict =
  | { ok: true; count: number; head: string | null }
  | { ok: false; count: number; brokenAtId: number; reason: string };

/** Re-verify the whole chain (rows ordered by id). Used by the integrity check. */
export function verifyChain(rows: ChainRow[]): ChainVerdict {
  let prev: string | null = null;
  for (const row of rows) {
    if (row.prevHash !== prev) {
      return { ok: false, count: rows.length, brokenAtId: row.id, reason: "prev_hash mismatch" };
    }
    if (contentHash(row.content, row.prevHash) !== row.contentHash) {
      return { ok: false, count: rows.length, brokenAtId: row.id, reason: "content changed" };
    }
    prev = row.contentHash;
  }
  return { ok: true, count: rows.length, head: prev };
}

export const round = (v: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
