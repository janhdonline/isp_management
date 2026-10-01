import type { Metadata } from "next";
import Link from "next/link";
import { parseListParams } from "@/lib/query";
import { listReminders, describeKey, type ReminderRow } from "@/lib/services/reminder-queries";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatNumber, formatDateTime } from "@/lib/utils";
import { BellRing, CalendarClock, CheckCircle2, Send, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reminders" };

/**
 * Automatic reminders, and what happened to each one.
 *
 * The "channel" column is the interesting one. A reminder recorded as sent on SMS
 * when the ISP is a WhatsApp shop means WhatsApp failed and the fallback carried
 * it, and the `notes` column says so — otherwise a message history cannot answer
 * "why did this customer get a text message", which is a question somebody will
 * ask the first time a WhatsApp template is rejected.
 */
export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseListParams(await searchParams);
  const result = await listReminders(params);

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Expiry and payment reminders sent automatically, with the channel each one actually went out on."
        breadcrumb={[{ label: "Notifications", href: "/notifications" }, { label: "Reminders" }]}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Reminders" value={formatNumber(result.total)} icon={BellRing} tone="brand" />
          <StatCard
            label="Sent"
            value={formatNumber(result.metrics.sent)}
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="Waiting to send"
            value={formatNumber(result.metrics.scheduled)}
            icon={CalendarClock}
            tone="warning"
            hint="held for quiet hours"
          />
          <StatCard
            label="Failed"
            value={formatNumber(result.metrics.failed)}
            icon={XCircle}
            tone={result.metrics.failed ? "danger" : "neutral"}
          />
          <StatCard
            label="Expiry reminders"
            value={formatNumber(result.metrics.expiry)}
            icon={BellRing}
            tone="info"
          />
          <StatCard
            label="Payment reminders"
            value={formatNumber(result.metrics.due)}
            icon={Send}
            tone="neutral"
          />
        </StatCardGrid>

        <ReminderTable
          rows={result.rows as unknown as ReminderRow[]}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
        />

        {result.total === 0 ? (
          <p className="text-xs text-fg-muted">
            No reminders yet. They are switched off by default — turn them on in{" "}
            <Link href="/settings/notifications" className="hover:text-brand-600">
              Settings → Notifications
            </Link>
            .
          </p>
        ) : null}
      </PageContainer>
    </>
  );
}

function ReminderTable({
  rows,
  total,
  page,
  perPage,
  totalPages,
}: {
  rows: ReminderRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
            <th className="px-3 py-2">When</th>
            <th className="px-3 py-2">Customer</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Channel</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Message</th>
            <th className="px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const { kind, dayOffset } = describeKey(r.idempotencyKey);
            return (
              <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                  {formatDateTime(r.createdAt)}
                </td>
                <td className="px-3 py-2">
                  {r.customer ? (
                    <Link
                      href={`/customers/${r.customer.id}`}
                      className="text-xs hover:text-brand-600"
                    >
                      {r.customer.name}
                    </Link>
                  ) : (
                    <span className="tnum text-xs text-fg-muted">{r.recipient}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {kind === "expiry" ? (
                    <Badge>
                      expiry{dayOffset === null ? "" : ` −${dayOffset}d`}
                    </Badge>
                  ) : kind === "due" ? (
                    <Badge>due +{dayOffset === null ? "" : `${dayOffset}d`}</Badge>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">{r.channel}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="max-w-sm px-3 py-2 text-xs text-fg-muted">
                  <span className="line-clamp-2">{r.body}</span>
                </td>
                <td className="max-w-xs px-3 py-2 text-xs">
                  {r.notes ? (
                    <span className="text-fg-muted">{r.notes}</span>
                  ) : r.error ? (
                    <span className="text-red-600 dark:text-red-400">{r.error}</span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-xs text-fg-muted">
                Nothing matches these filters.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2 text-xs text-fg-subtle">
        <span>
          {rows.length} of {total}
        </span>
        <span>
          Page {page} of {totalPages}
          {totalPages > 1 ? (
            <>
              {" · "}
              <Link href={`?page=${Math.max(1, page - 1)}`} className="hover:text-brand-600">
                Previous
              </Link>
              {" · "}
              <Link href={`?page=${Math.min(totalPages, page + 1)}`} className="hover:text-brand-600">
                Next
              </Link>
            </>
          ) : null}
          {" · "}
          <span className="tnum">{perPage} per page</span>
        </span>
      </div>
    </div>
  );
}