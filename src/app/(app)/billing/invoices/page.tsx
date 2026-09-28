import type { Metadata } from "next";
import { listInvoices, invoiceStatusMetrics } from "@/lib/services/billing-queries";
import { parseListParams } from "@/lib/query";
import { getAreasSimple } from "@/lib/services/areas";
import { getAllPackages } from "@/lib/services/packages";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { InvoicesTable } from "@/components/billing/billing-tables";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Banknote, CheckCircle2, CircleSlash, Clock, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, metrics, areas, packages] = await Promise.all([
    listInvoices(p),
    invoiceStatusMetrics(),
    getAreasSimple(),
    getAllPackages(),
  ]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Every billed amount with payment progress. Use Collect Payment from any invoice to settle it.
        </p>
      </div>

      <StatCardGrid>
        <StatCard label="Total Invoices" value={formatNumber(metrics.total)} tone="brand" icon={Banknote} hint={formatCurrency(metrics.amount)} />
        <StatCard label="Paid" value={formatNumber(metrics.paid)} tone="success" icon={CheckCircle2} hint={formatCurrency(metrics.collected)} />
        <StatCard label="Partial" value={formatNumber(metrics.partial)} tone="warning" icon={Clock} />
        <StatCard label="Due" value={formatNumber(metrics.due)} tone="warning" icon={CircleSlash} />
        <StatCard label="Overdue" value={formatNumber(metrics.overdue)} tone="danger" icon={AlertTriangle} hint={formatCurrency(metrics.outstanding)} />
      </StatCardGrid>

      <InvoicesTable
        rows={result.rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
      />
    </div>
  );
}
