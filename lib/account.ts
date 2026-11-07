import "server-only";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { profiles, subscriptions, teams } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { getViewer, isSignedIn, type Viewer } from "@/lib/authz";
import { sameOrigin } from "@/lib/billing/routes";
import { getDb } from "@/lib/db";

export interface AccountView {
  locale: (typeof routing.locales)[number];
  favoriteTeam: string | null;
  plan: "free" | "pro";
  subscription: {
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  hasBillingAccount: boolean;
}

/** The viewer's own account. Only ever called with the requesting viewer. */
export async function getAccount(viewer: NonNullable<Viewer>): Promise<AccountView> {
  const db = getDb();
  const [[p], [s]] = await Promise.all([
    db
      .select({
        locale: profiles.locale,
        plan: profiles.plan,
        customer: profiles.stripeCustomerId,
        team: teams.abbr,
      })
      .from(profiles)
      .leftJoin(teams, eq(teams.id, profiles.favoriteTeamId))
      .where(eq(profiles.userId, viewer.userId)),
    db
      .select({
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, viewer.userId))
      .orderBy(desc(subscriptions.eventCreatedAt))
      .limit(1),
  ]);
  return {
    locale: p?.locale ?? "en",
    favoriteTeam: p?.team ?? null,
    plan: p?.plan ?? "free",
    subscription: s
      ? {
          status: s.status,
          currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        }
      : null,
    hasBillingAccount: Boolean(p?.customer),
  };
}

const prefsBody = z.object({
  locale: z.enum(routing.locales),
  favoriteTeam: z
    .string()
    .regex(/^[A-Z]{2,3}$/)
    .nullable(),
});

/** Preferences a user may change themselves (never role or plan). */
export async function updatePreferences(
  viewer: NonNullable<Viewer>,
  prefs: z.infer<typeof prefsBody>,
): Promise<boolean> {
  const db = getDb();
  let teamId: number | null = null;
  if (prefs.favoriteTeam) {
    const [t] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.abbr, prefs.favoriteTeam));
    if (!t) return false;
    teamId = t.id;
  }
  await db
    .update(profiles)
    .set({ locale: prefs.locale, favoriteTeamId: teamId })
    .where(eq(profiles.userId, viewer.userId));
  return true;
}

/** PATCH /api/account: the signed-in user's own preferences. */
export function preferencesHandler(
  deps: { viewer: (req: Request) => Promise<Viewer> } = { viewer: (r) => getViewer(r.headers) },
) {
  return async (req: Request): Promise<Response> => {
    const noStore = { "Cache-Control": "no-store" };
    if (!sameOrigin(req))
      return Response.json({ error: "cross-origin" }, { status: 403, headers: noStore });
    const viewer = await deps.viewer(req);
    if (!isSignedIn(viewer))
      return Response.json({ error: "sign in first" }, { status: 401, headers: noStore });
    const parsed = prefsBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !(await updatePreferences(viewer, parsed.data))) {
      return Response.json({ error: "invalid request" }, { status: 422, headers: noStore });
    }
    return Response.json({ ok: true }, { headers: noStore });
  };
}
