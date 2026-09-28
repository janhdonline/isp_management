import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query";
import { listTickets, ticketMetrics } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { TicketsTable, type TicketRow } from "@/components/support/support-views";
import { formatNumber } from "@/lib/utils";
import { CheckCircle2, CircleDot, Clock, Ticket as TicketIcon, TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support Tickets" };

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, metrics, technicians] = await Promise.all([
    listTickets(p),
    ticketMetrics(),
    prisma.employee.findMany({ where: { role: { contains: "Technician" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Support Tickets"
        description="Open issues, who owns them and how long they have been waiting."
        breadcrumb={[{ label: "Support", href: "/support" }, { label: "Tickets" }]}
        actions={
          <Link
            href="/support/tickets/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <TicketIcon className="size-4" /> New Ticket
          </Link>
        }
      />

      <PageContainer>
        <StatCardGrid>
          <StatCard label="Open" value={formatNumber(metrics.open)} icon={CircleDot} tone="brand" />
          <StatCard label="Pending" value={formatNumber(metrics.pending)} icon={Clock} tone="warning" />
          <StatCard label="In Progress" value={formatNumber(metrics.inProgress)} icon={CircleDot} tone="info" />
          <StatCard label="Resolved (7 days)" value={formatNumber(metrics.resolvedThisWeek)} icon={CheckCircle2} tone="success" />
        </StatCardGrid>

        {metrics.slaBreached > 0 ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              <strong>{metrics.slaBreached}</strong> critical ticket(s) have been open for more than 2
              days. The oldest has been waiting <strong>{metrics.oldestAge} days</strong>.
            </span>
          </div>
        ) : null}

        <TicketsTable
          rows={result.rows as unknown as TicketRow[]}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
          technicians={technicians}
        />
      </PageContainer>
    </>
  );
}
