import "server-only";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import webpush from "web-push";
import { notificationQueue, pushSubscriptions, user } from "@/db/schema";
import { getDb } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { serverEnv } from "@/lib/env";

/**
 * The notification queue (spec 12.2). Alerts are queued once (unique dedupe key) and
 * sent by `processQueue`: right after the ingest that caused them, and by the
 * cron/notifications job as a backstop. Each row is claimed by exactly one worker.
 */

export const MAX_ATTEMPTS = 5;

export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type EmailPayload = { subject: string; text: string; html: string };

export type QueueRow = {
  userId?: string | null;
  toEmail?: string | null;
  channel: "push" | "email";
  dedupeKey: string;
  payload: PushPayload | EmailPayload;
};

export async function enqueue(rows: QueueRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const [res] = await getDb()
    .insert(notificationQueue)
    .ignore()
    .values(
      rows.map((r) => ({
        userId: r.userId ?? null,
        toEmail: r.toEmail ?? null,
        channel: r.channel,
        dedupeKey: r.dedupeKey.slice(0, 191),
        payloadJson: r.payload as Record<string, unknown>,
      })),
    );
  return res.affectedRows;
}

export function pushConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export interface Senders {
  push: (
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
  ) => Promise<void>;
  email: (to: string, payload: EmailPayload) => Promise<void>;
}

/** Real senders: Web Push (VAPID) and Resend. */
export function defaultSenders(): Senders {
  const env = serverEnv();
  if (pushConfigured()) {
    webpush.setVapidDetails(
      `mailto:${env.ADMIN_EMAILS[0] ?? "hello@endzoneiq.com"}`,
      env.VAPID_PUBLIC_KEY!,
      env.VAPID_PRIVATE_KEY!,
    );
  }
  return {
    push: async (sub, payload) => {
      if (!pushConfigured()) throw new Error("VAPID keys are not set");
      await webpush.sendNotification(sub, payload, {
        TTL: 6 * 3600,
        urgency: "high",
        timeout: 10_000,
      });
    },
    email: (to, p) => sendEmail({ to, ...p }),
  };
}

/** HTTP status of a push service error (404/410 = the subscription is gone). */
const statusOf = (err: unknown) => (err as { statusCode?: number })?.statusCode ?? 0;

async function deliver(
  row: typeof notificationQueue.$inferSelect,
  senders: Senders,
): Promise<"sent" | "skipped"> {
  const db = getDb();
  if (row.channel === "push") {
    if (!row.userId) return "skipped";
    const subs = await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        keys: pushSubscriptions.keysJson,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, row.userId));
    if (subs.length === 0) return "skipped";
    const payload = JSON.stringify(row.payloadJson);
    let delivered = 0;
    let lastError: unknown = null;
    for (const s of subs) {
      try {
        await senders.push({ endpoint: s.endpoint, keys: s.keys }, payload);
        delivered++;
      } catch (err) {
        if ([404, 410].includes(statusOf(err))) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        } else {
          lastError = err;
        }
      }
    }
    if (delivered > 0) return "sent";
    if (lastError) throw lastError;
    return "skipped"; // every subscription had expired
  }
  let to = row.toEmail;
  if (!to && row.userId) {
    const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, row.userId));
    to = u?.email ?? null;
  }
  if (!to) return "skipped";
  await senders.email(to, row.payloadJson as EmailPayload);
  return "sent";
}

export interface ProcessResult {
  sent: number;
  failed: number;
  skipped: number;
  remaining: boolean;
}

/** Send queued notifications until the budget or the limit runs out. */
export async function processQueue(
  opts: { budgetMs?: number; limit?: number; senders?: Senders } = {},
): Promise<ProcessResult> {
  const db = getDb();
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const limit = opts.limit ?? 200;
  const senders = opts.senders ?? defaultSenders();
  const result: ProcessResult = { sent: 0, failed: 0, skipped: 0, remaining: false };

  const candidates = await db
    .select()
    .from(notificationQueue)
    .where(eq(notificationQueue.status, "queued"))
    .orderBy(asc(notificationQueue.id))
    .limit(limit + 1);
  result.remaining = candidates.length > limit;

  for (const row of candidates.slice(0, limit)) {
    if (Date.now() > deadline) {
      result.remaining = true;
      break;
    }
    // Claim: only one worker moves a row from queued to sending.
    const [claim] = await db
      .update(notificationQueue)
      .set({ status: "sending", attempts: sql`${notificationQueue.attempts} + 1` })
      .where(and(eq(notificationQueue.id, row.id), eq(notificationQueue.status, "queued")));
    if (claim.affectedRows === 0) continue;
    try {
      const outcome = await deliver(row, senders);
      await db
        .update(notificationQueue)
        .set({ status: outcome, sentAt: new Date(), lastError: null })
        .where(eq(notificationQueue.id, row.id));
      result[outcome]++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await db
        .update(notificationQueue)
        .set({
          status: final ? "failed" : "queued",
          lastError: String((err as Error)?.message ?? err).slice(0, 255),
        })
        .where(eq(notificationQueue.id, row.id));
      if (final) result.failed++;
    }
  }
  return result;
}

/** Rows stuck in "sending" (a crashed worker) go back to the queue. */
export async function requeueStuck(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const [res] = await getDb()
    .update(notificationQueue)
    .set({ status: "queued" })
    .where(and(eq(notificationQueue.status, "sending"), lt(notificationQueue.createdAt, cutoff)));
  return res.affectedRows;
}

export async function deleteOldNotifications(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const [res] = await getDb()
    .delete(notificationQueue)
    .where(
      and(
        inArray(notificationQueue.status, ["sent", "skipped", "failed"]),
        lt(notificationQueue.createdAt, cutoff),
      ),
    );
  return res.affectedRows;
}
