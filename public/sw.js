/// <reference lib="webworker" />
/**
 * Service worker for the field app.
 *
 * A field technician is often in a server room, a cabinet, or a rooftop with
 * no usable signal. The app is already fully client-rendered once loaded, so
 * caching the shell means the last screen they had stays readable and the
 * other navigation still works — they can read a customer record, check what
 * a balance is, and queue an action rather than staring at a spinner.
 *
 * What it deliberately does not do is cache API responses. A cached balance or
 * a cached customer list is a wrong number on a billing screen, and a stale
 * "collected" badge is worse than an honest error. Only the shell and static
 * assets are cached; everything from /api is always live.
 */

declare const self: ServiceWorkerGlobalScope;

const VERSION = "v1";
const SHELL_CACHE = `isp-shell-${VERSION}`;
const STATIC_CACHE = `isp-static-${VERSION}`;

/** The minimum needed to render the app frame with no network at all. */
const SHELL = ["/dashboard", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { credentials: "include" })).catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API or the auth endpoints. A stale response there is a
  // wrong number or a session that should have ended.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/webpack-hmr")) {
    return;
  }

  // A navigation: network first so the data is current, cached shell as the
  // fallback so the app still opens offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match("/dashboard");
          if (shell) return shell;
          return new Response(
            `<!doctype html><meta charset="utf-8"><title>Offline</title>
             <body style="font-family:system-ui;padding:2rem">
             <h1>Offline</h1>
             <p>You are not connected. Screens you have already opened are still readable.</p>
             </body>`,
            { status: 503, headers: { "content-type": "text/html" } }
          );
        }
      })()
    );
    return;
  }

  // Static assets: cache first, since a hashed asset never changes.
  if (url.pathname.startsWith("/_next/static/") || /\.(png|jpg|svg|woff2?|ico)$/.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response("", { status: 504 });
        }
      })()
    );
  }
});

export {};
