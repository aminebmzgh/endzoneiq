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

/** Better Auth's session cookie (the __Secure- prefix is used over HTTPS). */
const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The admin area: no session, no page (real 404, nothing rendered). The page itself
  // checks the admin role; this only keeps anonymous visitors out cheaply.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
    return hasSession ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  }
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
  // Everything except API routes, Next internals and static files (admin: see above).
  matcher: ["/((?!api|icon|_next|_vercel|.*\\..*).*)"],
};
