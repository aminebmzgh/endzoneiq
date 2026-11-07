/**
 * Every permission rule lives here (spec 9, "Authorization"). Server actions and API
 * routes resolve the viewer with `getViewer()` and ask these functions; nothing is
 * gated in the UI alone. The rules themselves are pure so they are unit-tested.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { profiles, user } from "@/db/schema";
import { authConfigured, getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";

export type Role = "user" | "admin";
export type Plan = "free" | "pro";

/** The signed-in person making a request, or null for anonymous visitors. */
export type Viewer = {
  userId: string;
  email: string;
  role: Role;
  plan: Plan;
} | null;

// --- Rules (pure) --------------------------------------------------------------

export function isSignedIn(v: Viewer): v is NonNullable<Viewer> {
  return v !== null;
}

export function isAdmin(v: Viewer): boolean {
  return v?.role === "admin";
}

/** Pro content: predicted spread/total, all reasons on every game, SHAP drivers. */
export function canViewProContent(v: Viewer): boolean {
  return v?.plan === "pro" || isAdmin(v);
}

/**
 * The full breakdown (all three reasons and matchup notes) of one game. Free for
 * everyone on the week's free games (spec 15: "3 games/week"), Pro on all games.
 */
export function canViewFullBreakdown(v: Viewer, game: { freeBreakdown: boolean }): boolean {
  return game.freeBreakdown || canViewProContent(v);
}

/** A user's own chats, alerts, subscriptions... Admins don't read other users' data. */
export function ownsResource(v: Viewer, ownerUserId: string): boolean {
  return v !== null && v.userId === ownerUserId;
}

export function canManageBilling(v: Viewer): boolean {
  return isSignedIn(v);
}

// --- Resolving the viewer --------------------------------------------------------

/** Profile -> viewer. Creates a missing profile; ADMIN_EMAILS always wins for admin. */
export async function viewerForUser(userId: string, email: string): Promise<NonNullable<Viewer>> {
  const db = getDb();
  let [p] = await db
    .select({ role: profiles.role, plan: profiles.plan })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!p) {
    await db.insert(profiles).ignore().values({ userId });
    p = { role: "user", plan: "free" };
  }
  const admin = p.role === "admin" || serverEnv().ADMIN_EMAILS.includes(email.toLowerCase());
  return { userId, email, role: admin ? "admin" : "user", plan: p.plan };
}

/** The viewer for a request (from its session cookie), or null. */
export async function getViewer(headers: Headers): Promise<Viewer> {
  if (!authConfigured()) return null;
  const s = await getAuth().api.getSession({ headers });
  if (!s) return null;
  return viewerForUser(s.user.id, s.user.email);
}

/** For tests and admin tools: the viewer of a user id. */
export async function viewerById(userId: string): Promise<Viewer> {
  const [u] = await getDb().select({ email: user.email }).from(user).where(eq(user.id, userId));
  return u ? viewerForUser(userId, u.email) : null;
}
