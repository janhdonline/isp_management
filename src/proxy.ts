import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "isp_session";
/**
 * Reachable without a session. The reset pages belong here for the obvious
 * reason: someone who cannot sign in is the only person who ever needs them, so
 * requiring a session would make them unreachable.
 */
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/api/auth/login",
  "/api/health",
];

/**
 * Called by a third party rather than a browser, so it carries no session cookie.
 *
 * Both authenticate themselves, in their own way: the cron route with
 * `CRON_SECRET`, the gateway webhook by asking the provider's validation API what
 * it thinks happened. Neither can be session-gated — a payment provider has no
 * account here, and putting a staff session check in front of a callback means
 * every online payment is rejected and the failure looks like a provider outage.
 */
const TOKEN_PATHS = ["/api/cron", "/api/webhooks"];

/**
 * The customer portal, authenticated by its own cookie and its own guard.
 *
 * These paths are skipped by the staff session check on purpose, and the
 * direction of the skip matters. Putting a staff gate in front of them would
 * make the portal unreachable for every customer, because none of them have a
 * staff account. Putting a *portal* gate here would be worse: the proxy cannot
 * read the customer id out of the portal JWT, so it could only check that some
 * portal cookie exists — which would let any signed-in customer reach any
 * other customer's URL. So the proxy steps aside and `requirePortalCustomer()`
 * does the real work, in the page, with the customer id it needs.
 */
const PORTAL_PREFIX = "/portal";

/**
 * Paths that never belong to the application and must be let through untouched.
 *
 * `/_vercel` is the one that is easy to miss. Vercel Analytics posts to
 * `/_vercel/insights/view` from the browser; that path has no dot in it, so the
 * asset heuristic below does not catch it, and without this line the session
 * gate answers it with a redirect to the login page. The symptom is analytics
 * silently reporting nothing, on a deployment that looks otherwise healthy.
 */
const PLATFORM_PREFIXES = ["/_next", "/_vercel", "/favicon", "/robots.txt", "/sitemap.xml"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    TOKEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname === PORTAL_PREFIX ||
    pathname.startsWith(`${PORTAL_PREFIX}/`) ||
    PLATFORM_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(`${p}.`)) ||
    // Anything with a file extension is a static asset. Cuid-shaped ids contain
    // no dots, so this cannot be used to slip past a real page.
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) {
    // API clients get a 401 rather than a redirect to the login page.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
