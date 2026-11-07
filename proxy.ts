import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

const LOCALES = routing.locales.join("|");
/** Public URL -> internal cached view (see app/[locale]/ez-view/[view]/page.tsx). */
const VIEW_ROUTES: [RegExp, string][] = [
  [new RegExp(`^/(${LOCALES})/?$`), "home"],
  [new RegExp(`^/(${LOCALES})/record/?$`), "record"],
];
const INTERNAL = new RegExp(`^/(${LOCALES})/ez-view(/|$)`);

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The internal route is only reachable through the rewrite below.
  if (INTERNAL.test(pathname)) {
    return new NextResponse("Not found", { status: 404 });
  }
  for (const [pattern, view] of VIEW_ROUTES) {
    const m = pattern.exec(pathname);
    if (m) {
      const url = req.nextUrl.clone();
      url.pathname = `/${m[1]}/ez-view/${view}`;
      return NextResponse.rewrite(url);
    }
  }
  return intl(req);
}

export const config = {
  // Localize everything except API routes, the admin area, Next internals and static files.
  matcher: ["/((?!api|admin|_next|_vercel|.*\\..*).*)"],
};
