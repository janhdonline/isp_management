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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    TOKEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
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
