import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  account,
  alertPrefs,
  alertTeams,
  auditLog,
  chatMessages,
  chatThreads,
  notificationQueue,
  profiles,
  pushSubscriptions,
  session,
  subscriptions,
  teams,
  user,
} from "@/db/schema";
import { getViewer, isSignedIn, type Viewer } from "@/lib/authz";
import { sameOrigin } from "@/lib/billing/routes";
import { billingConfigured, stripe } from "@/lib/billing/stripe";
import { getDb } from "@/lib/db";
import { reportError } from "@/lib/observability/sentry";

/**
 * GDPR access/portability and erasure for the signed-in user's own account
 * (privacy policy, "Your rights"). Only ever called with the requesting viewer.
 */

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Everything stored about the account. Secrets (password hash, tokens, push keys) are left out. */
export async function exportAccount(viewer: NonNullable<Viewer>) {
  const db = getDb();
  const id = viewer.userId;
  const [
    [u],
    [p],
    logins,
    sessions,
    subs,
    threads,
    messages,
    [prefs],
    followed,
    pushes,
    notifications,
  ] = await Promise.all([
    db.select().from(user).where(eq(user.id, id)),
    db
      .select({
        role: profiles.role,
        locale: profiles.locale,
        plan: profiles.plan,
        favoriteTeam: teams.abbr,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .leftJoin(teams, eq(teams.id, profiles.favoriteTeamId))
      .where(eq(profiles.userId, id)),
    db
      .select({ provider: account.providerId, createdAt: account.createdAt })
      .from(account)
      .where(eq(account.userId, id)),
    db
      .select({
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(eq(session.userId, id)),
    db
      .select({
        status: subscriptions.status,
        priceId: subscriptions.priceId,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, id)),
    db
      .select({ id: chatThreads.id, title: chatThreads.title, createdAt: chatThreads.createdAt })
      .from(chatThreads)
      .where(eq(chatThreads.userId, id))
      .orderBy(asc(chatThreads.createdAt)),
    db
      .select({
        threadId: chatMessages.threadId,
        role: chatMessages.role,
        content: chatMessages.content,
        tokens: chatMessages.tokens,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.userId, id))
      .orderBy(asc(chatMessages.id)),
    db
      .select({
        notifyPickChange: alertPrefs.notifyPickChange,
        notifyPickChangeEmail: alertPrefs.notifyPickChangeEmail,
        notifyWeekly: alertPrefs.notifyWeekly,
      })
      .from(alertPrefs)
      .where(eq(alertPrefs.userId, id)),
    db
      .select({ team: teams.abbr })
      .from(alertTeams)
      .innerJoin(teams, eq(teams.id, alertTeams.teamId))
      .where(eq(alertTeams.userId, id)),
    db
      .select({ endpoint: pushSubscriptions.endpoint, createdAt: pushSubscriptions.createdAt })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, id)),
    db
      .select({
        channel: notificationQueue.channel,
        status: notificationQueue.status,
        payload: notificationQueue.payloadJson,
        createdAt: notificationQueue.createdAt,
        sentAt: notificationQueue.sentAt,
      })
      .from(notificationQueue)
      .where(eq(notificationQueue.userId, id)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    service: "EndzoneIQ (endzoneiq.com)",
    account: u
      ? {
          id: u.id,
          email: u.email,
          name: u.name,
          emailVerified: u.emailVerified,
          image: u.image,
          createdAt: iso(u.createdAt),
          signInMethods: logins.map((l) => ({ provider: l.provider, createdAt: iso(l.createdAt) })),
        }
      : null,
    profile: p ? { ...p, createdAt: iso(p.createdAt) } : null,
    sessions: sessions.map((s) => ({
      ...s,
      createdAt: iso(s.createdAt),
      expiresAt: iso(s.expiresAt),
    })),
    subscriptions: subs.map((s) => ({ ...s, currentPeriodEnd: iso(s.currentPeriodEnd) })),
    alerts: {
      preferences: prefs ?? null,
      followedTeams: followed.map((f) => f.team),
      pushDevices: pushes.map((x) => ({ endpoint: x.endpoint, createdAt: iso(x.createdAt) })),
      notifications: notifications.map((n) => ({
        ...n,
        createdAt: iso(n.createdAt),
        sentAt: iso(n.sentAt),
      })),
    },
    assistant: threads.map((t) => ({
      id: t.id,
      title: t.title,
      createdAt: iso(t.createdAt),
      messages: messages
        .filter((m) => m.threadId === t.id)
        .map((m) => ({
          role: m.role,
          content: m.content,
          tokens: m.tokens,
          createdAt: iso(m.createdAt),
        })),
    })),
  };
}

export interface DeleteDeps {
  /** Cancels a Stripe subscription immediately. */
  cancelSubscription: (stripeSubscriptionId: string) => Promise<void>;
}

const deleteDefaults: DeleteDeps = {
  cancelSubscription: async (subId) => {
    await stripe().subscriptions.cancel(subId);
  },
};

const ENDED = new Set(["canceled", "incomplete_expired"]);

/**
 * Erases the account. Live Stripe subscriptions are cancelled first (a failure there
 * aborts, so nobody keeps paying for a deleted account). Every user table cascades
 * from `user`; the audit log keeps only the pseudonymous user id.
 */
export async function deleteAccount(
  viewer: NonNullable<Viewer>,
  deps: DeleteDeps = deleteDefaults,
): Promise<void> {
  const db = getDb();
  const subs = await db
    .select({ id: subscriptions.stripeSubscriptionId, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, viewer.userId));
  const live = subs.filter((s) => !ENDED.has(s.status));
  if (live.length > 0) {
    if (!billingConfigured()) throw new Error("billing is not configured; cannot cancel");
    for (const s of live) await deps.cancelSubscription(s.id);
  }
  await db.transaction(async (tx) => {
    await tx.delete(user).where(eq(user.id, viewer.userId));
    await tx.insert(auditLog).values({
      actor: `user:${viewer.userId}`,
      action: "account.delete",
      entity: "user",
      entityId: viewer.userId,
      payload: { cancelledSubscriptions: live.length },
    });
  });
}

const noStore = { "Cache-Control": "no-store" };

/** GET /api/account/export: a JSON download of the viewer's own data. */
export function exportHandler(
  deps: { viewer: (req: Request) => Promise<Viewer> } = { viewer: (r) => getViewer(r.headers) },
) {
  return async (req: Request): Promise<Response> => {
    const viewer = await deps.viewer(req);
    if (!isSignedIn(viewer))
      return Response.json({ error: "sign in first" }, { status: 401, headers: noStore });
    const data = await exportAccount(viewer);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        ...noStore,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="endzoneiq-data-${day}.json"`,
      },
    });
  };
}

const deleteBody = z.object({ confirm: z.string().max(255) });

/** DELETE /api/account: the viewer deletes their own account, confirming with their email. */
export function deleteHandler(
  deps: { viewer: (req: Request) => Promise<Viewer> } & Partial<DeleteDeps> = {
    viewer: (r) => getViewer(r.headers),
  },
) {
  return async (req: Request): Promise<Response> => {
    if (!sameOrigin(req))
      return Response.json({ error: "cross-origin" }, { status: 403, headers: noStore });
    const viewer = await deps.viewer(req);
    if (!isSignedIn(viewer))
      return Response.json({ error: "sign in first" }, { status: 401, headers: noStore });
    const parsed = deleteBody.safeParse(await req.json().catch(() => null));
    if (
      !parsed.success ||
      parsed.data.confirm.trim().toLowerCase() !== viewer.email.toLowerCase()
    ) {
      return Response.json(
        { error: "confirmation does not match" },
        { status: 422, headers: noStore },
      );
    }
    try {
      await deleteAccount(viewer, {
        cancelSubscription: deps.cancelSubscription ?? deleteDefaults.cancelSubscription,
      });
    } catch (err) {
      reportError("[account] delete failed", err, { source: "account-delete" });
      return Response.json({ error: "delete failed" }, { status: 502, headers: noStore });
    }
    return Response.json({ ok: true }, { headers: noStore });
  };
}
