import { requirePermission, AuthError, ForbiddenError } from "@/lib/auth";
import { radiusLogTail } from "@/lib/services/radius-queries";

export const dynamic = "force-dynamic";

/**
 * The RADIUS Live stream.
 *
 *   GET /api/network/radius/stream?after=<last id>&types=accept,reject
 *
 * Server-sent events, polled against the log table rather than held open on a
 * socket that the RADIUS process would have to share. The poller runs every second
 * and asks for rows with `id` greater than the cursor, so a reconnect is
 * indistinguishable from a continuous connection: the client sends the last id it
 * saw and gets exactly what arrived since.
 *
 * The cursor is `id` and not `createdAt` for that reason. `id` is an
 * autoincrement, so it is strictly increasing and gapless; timestamps are neither —
 * two lines written in the same millisecond have an arbitrary order, and a
 * `createdAt > last` query would either repeat or skip them.
 *
 * Session-gated like every other network action: a subscriber list by IP is not
 * something an unauthenticated request should be able to tail.
 */
export async function GET(request: Request) {
  try {
    await requirePermission("network.view");
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof ForbiddenError ? 403 : 403;
    return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
  }

  const url = new URL(request.url);
  // A malformed cursor is treated as "from the beginning of what I can see"
  // rather than an error: the client is reconnecting after a network blip, and a
  // refused reconnect would leave a terminal permanently blank.
  const rawAfter = Number(url.searchParams.get("after") ?? "0");
  const after = Number.isFinite(rawAfter) && rawAfter > 0 ? Math.floor(rawAfter) : 0;

  const types = (url.searchParams.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => ["accept", "reject", "accounting", "disconnect", "dropped"].includes(t));

  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);

  const encoder = new TextEncoder();
  let lastId = after;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      // The client going away — a closed tab, a navigated page — must not leave a
      // timer polling the database forever. `request.signal` fires on abort.
      request.signal.addEventListener("abort", close);

      const tick = async () => {
        if (closed) return;
        try {
          const rows = await radiusLogTail(lastId, { types, search, limit: 200 });
          if (rows.length) {
            // The cursor advances to the highest id *seen*, not the highest id
            // matching the filter. Advancing to the last matching row would re-read
            // every non-matching line forever on the next poll.
            lastId = rows[rows.length - 1].id;
            send("lines", {
              lines: rows.map((r) => ({
                id: r.id,
                type: r.type,
                outcome: r.outcome,
                username: r.username,
                nasIp: r.nasIp,
                message: r.message,
                createdAt: r.createdAt.toISOString(),
              })),
              cursor: lastId,
            });
          }
          // A heartbeat every few polls keeps proxies from closing an idle
          // connection and gives the browser something to show as "connected".
          send("ping", { at: new Date().toISOString(), cursor: lastId });
        } catch (e) {
          send("error", { message: e instanceof Error ? e.message : "stream failed" });
          close();
        }
      };

      await tick();
      const timer = setInterval(tick, 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Nginx will buffer an SSE stream into uselessness without this.
      "x-accel-buffering": "no",
    },
  });
}