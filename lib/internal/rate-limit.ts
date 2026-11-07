/**
 * Small in-memory fixed-window rate limiter for the internal API.
 *
 * The site runs as one Node process on Hostinger, so per-process memory is
 * good enough; the limit is generous for the pipeline (a full 2012+ backfill is
 * about 30 calls) and stops a leaked-secret flood from hammering MySQL.
 */
export interface RateLimiter {
  /** Returns seconds to wait if the key is over its limit, otherwise 0. */
  hit(key: string, nowMs?: number): number;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, nowMs = Date.now()) {
      let w = windows.get(key);
      if (!w || nowMs - w.start >= windowMs) {
        w = { start: nowMs, count: 0 };
        windows.set(key, w);
        if (windows.size > 1000) {
          for (const [k, v] of windows) if (nowMs - v.start >= windowMs) windows.delete(k);
        }
      }
      w.count += 1;
      return w.count > limit ? Math.ceil((w.start + windowMs - nowMs) / 1000) : 0;
    },
  };
}
