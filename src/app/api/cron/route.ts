import { runAllJobs } from "@/lib/services/cron";

export const dynamic = "force-dynamic";

/**
 * The scheduled endpoint. Point any cron service at it:
 *
 *   curl -X POST https://your-host/api/cron -H "authorization: Bearer $CRON_SECRET"
 *
 * Requires `CRON_SECRET` in the environment. Without it the route refuses every
 * request rather than defaulting to open, because it raises invoices, sends
 * messages to customers and writes files.
 *
 * Each job is idempotent, so a retry or a double-fired timer is harmless.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not set, so this endpoint is disabled." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A scheduler can say why it fired — useful when reading the run history.
  const reason = await request
    .json()
    .then((b: { reason?: unknown }) =>
      typeof b?.reason === "string" ? b.reason.slice(0, 120) : "unspecified",
    )
    .catch(() => "unspecified");

  const { ms, results } = await runAllJobs();
  const finishedAt = new Date();

  return Response.json(
    { ok: true, ms, reason, finishedAt: finishedAt.toISOString(), results },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** A plain GET reports which jobs exist, without revealing anything or running them. */
export async function GET() {
  return Response.json({
    enabled: Boolean(process.env.CRON_SECRET),
    jobs: ["invoices", "expiry", "messages", "network", "backup"],
    method: "POST with an authorization: Bearer $CRON_SECRET header",
  });
}
