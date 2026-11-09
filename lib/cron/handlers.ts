import "server-only";
import { timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { ingestLog, session, verification } from "@/db/schema";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { queueAdminEmail, queueWeeklyEmails } from "@/lib/notify/alerts";
import { deleteOldNotifications, processQueue, requeueStuck } from "@/lib/notify/queue";
import { verifyChain } from "@/lib/picks/hash";
import { loadChain } from "@/lib/picks/repository";
import { getCurrentWeek } from "@/lib/site/data";
import { captureError, reportError } from "@/lib/observability/sentry";

/**
 * /api/internal/cron/* (spec 12.2), called by Hostinger cron jobs with
 * `Authorization: Bearer $CRON_SECRET`. Each job finishes well under 60 s.
 */

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function cronAuthorized(req: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cronRoute(name: string, job: () => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    if (!serverEnv().CRON_SECRET) return json(503, { error: "CRON_SECRET is not set" });
    if (!cronAuthorized(req)) return json(401, { error: "unauthorized" });
    const started = Date.now();
    try {
      const result = await job();
      return json(200, { job: name, ms: Date.now() - started, result });
    } catch (err) {
      reportError(`[cron] ${name} failed`, err, { source: "cron", tags: { job: name } });
      return json(500, { job: name, error: "failed" });
    }
  };
}

/** Every 5 minutes: send queued push notifications and emails. */
export const cronNotifications = cronRoute("notifications", async () => {
  const requeued = await requeueStuck();
  return { requeued, ...(await processQueue({ budgetMs: 45_000, limit: 300 })) };
});

/** Tuesday 12:00-16:00 US Eastern: the weekly email's window (picks publish at 10:00). */
export function inWeeklyWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Tue" && hour >= 12 && hour < 16;
}

/**
 * Tuesdays: queue this week's picks email to subscribers (once per user and week). The
 * cron line can run every few minutes on Tuesdays: outside the Eastern window, or before
 * the week has picks, it does nothing; the dedupe key makes repeats harmless.
 */
export const cronWeeklyEmail = cronRoute("weekly-email", async () => {
  if (!inWeeklyWindow(new Date())) return { queued: 0, reason: "outside the Tuesday window" };
  const current = await getCurrentWeek();
  if (!current) return { queued: 0, reason: "no season" };
  const queued = await queueWeeklyEmails(current.season, current.week);
  return {
    season: current.season,
    week: current.week,
    queued,
    ...(await processQueue({ budgetMs: 40_000 })),
  };
});

/** Daily: re-verify the public hash chain; email the admins if it is broken. */
export const cronIntegrityCheck = cronRoute("integrity-check", async () => {
  const verdict = verifyChain(await loadChain());
  if (!verdict.ok) {
    const day = new Date().toISOString().slice(0, 10);
    await captureError(new Error("Hash chain verification failed"), {
      source: "integrity-check",
      extra: { verdict },
    });
    await queueAdminEmail(
      `chain-broken:${day}`,
      "Hash chain verification FAILED",
      `The picks hash chain is broken.\n\n${JSON.stringify(verdict, null, 2)}`,
    );
    await processQueue({ budgetMs: 15_000 });
  }
  return verdict;
});

/** Daily: delete expired sessions and verifications, old logs and notifications. */
export const cronCleanup = cronRoute("cleanup", async () => {
  const db = getDb();
  const now = new Date();
  const [sessions] = await db.delete(session).where(lt(session.expiresAt, now));
  const [verifications] = await db.delete(verification).where(lt(verification.expiresAt, now));
  const [logs] = await db
    .delete(ingestLog)
    .where(lt(ingestLog.createdAt, new Date(now.getTime() - 90 * 86_400_000)));
  return {
    sessions: sessions.affectedRows,
    verifications: verifications.affectedRows,
    ingestLog: logs.affectedRows,
    notifications: await deleteOldNotifications(30),
    requeued: await requeueStuck(),
  };
});
