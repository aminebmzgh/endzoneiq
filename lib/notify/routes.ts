import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { alertPrefs, alertTeams, pushSubscriptions, teams } from "@/db/schema";
import { canViewProContent, getViewer, isSignedIn, type Viewer } from "@/lib/authz";
import { sameOrigin } from "@/lib/billing/routes";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { pushConfigured } from "./queue";

/**
 * /api/alerts: the signed-in user's own alert preferences, followed teams and push
 * subscriptions (spec 11.7). Pick-change alerts are Pro; the weekly email is for all.
 */

const noStore = { "Cache-Control": "private, no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

type Deps = { viewer: (req: Request) => Promise<Viewer> };
const defaults: Deps = { viewer: (req) => getViewer(req.headers) };

const prefsBody = z.object({
  notifyPickChange: z.boolean(),
  notifyPickChangeEmail: z.boolean(),
  notifyWeekly: z.boolean(),
  teams: z.array(z.string().regex(/^[A-Z]{2,3}$/)).max(32),
});
const subscribeBody = z.object({
  endpoint: z.string().url().startsWith("https://").max(768),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().max(768) });

async function readPrefs(userId: string) {
  const db = getDb();
  const [[p], followed, devices] = await Promise.all([
    db.select().from(alertPrefs).where(eq(alertPrefs.userId, userId)),
    db
      .select({ abbr: teams.abbr })
      .from(alertTeams)
      .innerJoin(teams, eq(teams.id, alertTeams.teamId))
      .where(eq(alertTeams.userId, userId)),
    db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId)),
  ]);
  return {
    notifyPickChange: p?.notifyPickChange ?? true,
    notifyPickChangeEmail: p?.notifyPickChangeEmail ?? false,
    notifyWeekly: p?.notifyWeekly ?? false,
    teams: followed.map((t) => t.abbr),
    pushDevices: devices.length,
  };
}

export function alertsHandlers(deps: Deps = defaults) {
  const guard = async (req: Request, write: boolean) => {
    if (write && !sameOrigin(req)) return { error: json(403, { error: "cross-origin request" }) };
    const viewer = await deps.viewer(req);
    if (!isSignedIn(viewer)) return { error: json(401, { error: "sign in first" }) };
    return { viewer };
  };

  return {
    GET: async (req: Request) => {
      const g = await guard(req, false);
      if (g.error) return g.error;
      return json(200, {
        pro: canViewProContent(g.viewer),
        vapidPublicKey: pushConfigured() ? serverEnv().VAPID_PUBLIC_KEY : null,
        ...(await readPrefs(g.viewer.userId)),
      });
    },

    PUT: async (req: Request) => {
      const g = await guard(req, true);
      if (g.error) return g.error;
      const parsed = prefsBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json(422, { error: "invalid request" });
      const { teams: abbrs, ...prefs } = parsed.data;
      const db = getDb();
      const ids = abbrs.length
        ? await db.select({ id: teams.id }).from(teams).where(inArray(teams.abbr, abbrs))
        : [];
      if (ids.length !== new Set(abbrs).size) return json(422, { error: "unknown team" });
      const userId = g.viewer.userId;
      await db.transaction(async (tx) => {
        await tx
          .insert(alertPrefs)
          .values({ userId, ...prefs })
          .onDuplicateKeyUpdate({ set: prefs });
        await tx.delete(alertTeams).where(eq(alertTeams.userId, userId));
        if (ids.length)
          await tx.insert(alertTeams).values(ids.map((t) => ({ userId, teamId: t.id })));
      });
      return json(200, await readPrefs(userId));
    },
  };
}

export function pushHandlers(deps: Deps = defaults) {
  return {
    /** Register this device for push (an endpoint belongs to one user: the latest). */
    POST: async (req: Request) => {
      if (!sameOrigin(req)) return json(403, { error: "cross-origin request" });
      const viewer = await deps.viewer(req);
      if (!isSignedIn(viewer)) return json(401, { error: "sign in first" });
      if (!pushConfigured()) return json(503, { error: "push is not configured" });
      const parsed = subscribeBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json(422, { error: "invalid subscription" });
      await getDb()
        .insert(pushSubscriptions)
        .values({
          userId: viewer.userId,
          endpoint: parsed.data.endpoint,
          keysJson: parsed.data.keys,
        })
        .onDuplicateKeyUpdate({ set: { userId: viewer.userId, keysJson: parsed.data.keys } });
      return json(200, { ok: true });
    },
    /** Remove this device. Only the owner's own subscription is deleted. */
    DELETE: async (req: Request) => {
      if (!sameOrigin(req)) return json(403, { error: "cross-origin request" });
      const viewer = await deps.viewer(req);
      if (!isSignedIn(viewer)) return json(401, { error: "sign in first" });
      const parsed = unsubscribeBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return json(422, { error: "invalid request" });
      const [res] = await getDb()
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, parsed.data.endpoint),
            eq(pushSubscriptions.userId, viewer.userId),
          ),
        );
      return json(200, { removed: res.affectedRows });
    },
  };
}
