import "server-only";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { authConfigured, googleConfigured } from "@/lib/auth";
import { canViewFullBreakdown, canViewProContent, getViewer, type Viewer } from "@/lib/authz";
import { billingConfigured } from "@/lib/billing/stripe";
import { getProDetail } from "@/lib/site/data";

const noStore = { "Cache-Control": "private, no-store" };
const json = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

const query = z.object({
  slug: z.string().regex(/^[a-z0-9-]{8,64}$/),
  locale: z.enum(routing.locales),
});

type Detail = Awaited<ReturnType<typeof getProDetail>>;
type Deps = {
  viewer: (req: Request) => Promise<Viewer>;
  detail: (slug: string, locale: (typeof routing.locales)[number]) => Promise<Detail>;
};
const defaults: Deps = { viewer: (req) => getViewer(req.headers), detail: getProDetail };

/**
 * GET /api/pro/game?slug=&locale=. Game pages are cached static HTML with only the
 * public content; this returns what the viewer may see on top of it, decided by
 * lib/authz.ts: the full breakdown (free games, or Pro) and the Pro projections.
 */
export function proGameHandler(deps: Deps = defaults) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const q = query.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) return json(422, { error: "invalid request" });
    const [viewer, detail] = await Promise.all([
      deps.viewer(req),
      deps.detail(q.data.slug, q.data.locale),
    ]);
    if (!detail) return json(404, { error: "no pick for this game" });

    const full = canViewFullBreakdown(viewer, detail);
    const pro = canViewProContent(viewer);
    return json(200, {
      signedIn: viewer !== null,
      plan: viewer?.plan ?? null,
      breakdown: full ? { reasons: detail.reasons, matchupNotes: detail.matchupNotes } : null,
      pro: pro
        ? {
            home: detail.home,
            away: detail.away,
            predSpread: detail.predSpread,
            predTotal: detail.predTotal,
            drivers: detail.shap,
          }
        : null,
    });
  };
}

/** GET /api/me: who is signed in (header button, pricing page). */
export function meHandler(deps: Pick<Deps, "viewer"> = defaults) {
  return async (req: Request): Promise<Response> => {
    const v = await deps.viewer(req);
    const providers = { email: authConfigured(), google: authConfigured() && googleConfigured() };
    const billing = billingConfigured();
    return json(
      200,
      v
        ? {
            signedIn: true,
            // The access the viewer has: admins see everything Pro sees.
            plan: canViewProContent(v) ? "pro" : "free",
            admin: v.role === "admin",
            providers,
            billing,
          }
        : { signedIn: false, providers, billing },
    );
  };
}
