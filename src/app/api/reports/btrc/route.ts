import { requirePermissionFromRequest, AuthError, ForbiddenError } from "@/lib/auth";
import { btrcReport, btrcCsv } from "@/lib/services/btrc";

export const dynamic = "force-dynamic";

/**
 * BTRC subscriber report as a CSV download.
 *
 *   GET /api/reports/btrc?month=2026-09
 *
 * The same query the Reports → BTRC tab renders, in the same column order, so
 * what is downloaded is what was on screen. Read-only: the handler runs one
 * select and writes nothing.
 *
 * Guarded on `reports.export`, like every other export. A report of subscriber
 * counts by area is staff-only in exactly the way a customer list is.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");

  try {
    await requirePermissionFromRequest(request, "reports.export");
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof ForbiddenError ? 403 : 403;
    return Response.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status }
    );
  }

  // A missing or malformed month is not an error here either: an empty month
  // produces a header-only file, which is safer than defaulting a filing to the
  // wrong month because a parameter was dropped.
  const report = await btrcReport(month);
  const csv = btrcCsv(report);

  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${report.csv.filename}"`,
      "cache-control": "no-store",
    },
  });
}
