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
 * Called by a scheduler rather than a browser, so it carries no session cookie
 * and authenticates with a bearer token instead. The route re-checks the token
 * itself and stays disabled when CRON_SECRET is unset.
 */
const TOKEN_PATHS = ["/api/cron"];

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
