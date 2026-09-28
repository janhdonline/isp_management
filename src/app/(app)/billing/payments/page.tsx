import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listPayments, paymentMetrics } from "@/lib/services/billing-queries";
import { parseListParams } from "@/lib/query";
import { getAreasSimple } from "@/lib/services/areas";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { PaymentsTable } from "@/components/billing/billing-tables";
import { DonutChart, ChartLegend, TrendChart } from "@/components/ui/charts";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { formatCurrency, startOfDay, addDays } from "@/lib/utils";
import { Banknote, CalendarDays, TrendingUp, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = parseListParams(await searchParams);
  const [result, metrics, areas] = await Promise.all([
    listPayments(p),
    paymentMetrics(),
    getAreasSimple(),
  ]);

  // last 14 days collection trend
  const from = startOfDay(addDays(new Date(), -13));
  const recent = await prisma.payment.findMany({
    where: { paymentDate: { gte: from } },
    select: { paymentDate: true, amount: true },
  });
  const buckets = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    buckets.set(startOfDay(addDays(from, i)).toISOString().slice(0, 10), 0);
  }
  for (const r of recent) {
    const key = startOfDay(r.paymentDate).toISOString().slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + r.amount);
  }
  const trend = [...buckets.entries()].map(([label, value]) => ({ label, value }));

  const m = result.metrics as unknown as Record<string, { amount: number; count: number }>;
  const methodData = Object.entries(m)
    .filter(([, v]) => v && typeof v === "object" && v.count > 0)
    .map(([method, v]) => ({ label: method, value: v.amount }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every collection with its method, account and receipt reference."
        breadcrumb={[{ label: "Billing", href: "/billing/invoices" }, { label: "Payments" }]}
        actions={
          <Link
            href="/billing/payments/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Banknote className="size-4" /> Collect Payment
          </Link>
        }
      />

      <PageContainer>
        <StatCardGrid>
          <StatCard label="Today's Collection" value={formatCurrency(metrics.today)} icon={Banknote} tone="success" hint={`${metrics.todayCount} transactions`} />
          <StatCard label="This Month" value={formatCurrency(metrics.month)} icon={CalendarDays} tone="brand" hint={`${metrics.monthCount} transactions`} />
          <StatCard label="Cash" value={formatCurrency(m["Cash"]?.amount ?? 0)} icon={Wallet} tone="neutral" hint={`${m["Cash"]?.count ?? 0} transactions`} />
          <StatCard label="Mobile Banking" value={formatCurrency((m["bKash"]?.amount ?? 0) + (m["Nagad"]?.amount ?? 0) + (m["Rocket"]?.amount ?? 0))} icon={TrendingUp} tone="info" hint="bKash + Nagad + Rocket" />
        </StatCardGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Collection Trend" description="Last 14 days" icon={<TrendingUp />} />
            <CardBody>
              {trend.some((t) => t.value > 0) ? (
                <TrendChart data={trend} series={[{ key: "value", label: "Collected", color: "#3163ff", type: "area" }]} money height={220} />
              ) : (
                <p className="py-10 text-center text-sm text-fg-muted">No collections in the last 14 days.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="By Method" description="Filtered result split" />
            <CardBody>
              {methodData.length ? (
                <>
                  <DonutChart data={methodData} centerValue={formatCurrency(metrics.month)} centerLabel="this month" />
                  <ChartLegend data={methodData} />
                </>
              ) : (
                <p className="py-10 text-center text-sm text-fg-muted">No payments in the current filter.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <PaymentsTable
          rows={result.rows}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
          areas={areas}
        />
      </PageContainer>
    </>
  );
}
