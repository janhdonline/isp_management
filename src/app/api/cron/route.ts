import { runAllJobs } from "@/lib/services/cron";

export const dynamic = "force-dynamic";

const JOBS = [
  "invoices",
  "expiry",
  "messages",
  "reminders",
  "enforcement",
  "collection",
  "network",
  "fup",
  "backup",
  "radiusLogs",
] as const;

/**
 * The scheduled endpoint.
 *
 * **Two methods, and the reason is Vercel.** Vercel Cron Jobs issue a **GET**
 * request to the configured path, and they send
 * `Authorization: Bearer $CRON_SECRET` automatically when that environment
 * variable is set. Every other scheduler here (GitHub Actions, a plain cron) uses
 * POST.
 *
 * So both are accepted, and both require the same bearer token. Having only POST
 * would have been the worse kind of bug to ship: on Vercel the cron would appear
 * to be firing, return a healthy 200 with a job list, and never raise an invoice,
 * suspend anybody or take a backup — the scheduled work would simply be absent
 * and nothing would say so.
 *
 * Requires `CRON_SECRET` in the environment. Without it the route refuses every
 * request rather than defaulting to open, because it raises invoices, sends
 * messages to customers, reprofiles routers and writes files.
 *
 * Each job is idempotent, so a retry or a double-fired timer is harmless.
 */

/** Shared by both methods: the token check, and the run itself. */
async function run(request: Request, reason: string) {
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

  const { ms, results } = await runAllJobs();
  const finishedAt = new Date();

  return Response.json(
    { ok: true, ms, reason, finishedAt: finishedAt.toISOString(), results },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // A scheduler can say why it fired — useful when reading the run history.
  const reason = await request
    .json()
    .then((b: { reason?: unknown }) =>
      typeof b?.reason === "string" ? b.reason.slice(0, 120) : "unspecified",
    )
    .catch(() => "unspecified");

  return run(request, reason);
}

/**
 * Vercel Cron's method.
 *
 * With the token it runs the jobs; without one it reports which jobs exist and
 * says nothing sensitive, so a plain browser visit to the URL is a useful check
 * and not a way to trigger a night's billing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (secret && token === secret) {
    return run(request, "scheduled (Vercel Cron)");
  }

  return Response.json(
    {
      enabled: Boolean(secret),
      jobs: JOBS,
      method:
        "GET or POST with an authorization: Bearer $CRON_SECRET header runs the jobs; without the header this only lists them.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
