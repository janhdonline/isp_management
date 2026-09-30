import type { Metadata } from "next";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { DateRangePicker } from "@/components/ui/date-range";
import { commissionReport } from "@/lib/services/resellers";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Coins, Percent, Users, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseller Commission" };

/** The last 30 days, which is what "this month so far" means in practice. */
function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const fallback = defaultRange();
  const fromStr = typeof sp.from === "string" ? sp.from : fallback.from;
  const toStr = typeof sp.to === "string" ? sp.to : fallback.to;

  // Anchored to the start and the end of the named days, so "1 March to
  // 31 March" means those two days and not a single midnight.
  const gte = new Date(`${fromStr}T00:00:00`);
  const lte = new Date(`${toStr}T23:59:59.999`);
  if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime()) || gte > lte) {
    // Nonsense range: fall back rather than render a report for nothing.
    return (
      <BadRangeNotice />
    );
  }

  const report = await commissionReport({ gte, lte });

  type Row = (typeof report.rows)[number];
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Reseller",
      cell: (r) => <span className="text-sm font-medium">{r.name}</span>,
      exportValue: (r) => r.name,
    },
    {
      key: "pct",
      header: "Rate",
      align: "right",
      cell: (r) => <span className="tnum text-xs">{r.commissionPct}%</span>,
      exportValue: (r) => r.commissionPct,
    },
    {
      key: "payments",
      header: "Payments",
      align: "right",
      hideBelow: "sm",
      cell: (r) => <span className="tnum text-xs">{formatNumber(r.payments)}</span>,
      exportValue: (r) => r.payments,
    },
    {
      key: "collected",
      header: "Collected",
      align: "right",
      cell: (r) => <span className="tnum text-xs font-medium">{formatCurrency(r.collected)}</span>,
      exportValue: (r) => r.collected,
    },
    {
      key: "commission",
      header: "Commission",
      align: "right",
      cell: (r) => <span className="tnum text-sm font-semibold">{formatCurrency(r.commission)}</span>,
      exportValue: (r) => r.commission,
    },
  ];

  return (
    <>
      <PageHeader
        title="Reseller Commission"
        description="What each reseller collected in the period, and what that costs. Commission is derived from the payment rows, so it cannot drift from them."
        breadcrumb={[{ label: "Resellers", href: "/resellers" }, { label: "Commission" }]}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard
            label="Collected by resellers"
            value={formatCurrency(report.totals.collected)}
            icon={Wallet}
            tone="brand"
          />
          <StatCard
            label="Commission owed"
            value={formatCurrency(report.totals.commission)}
            icon={Coins}
            tone="warning"
          />
          <StatCard
            label="Collected by staff"
            value={formatCurrency(report.totals.staffCollected)}
            icon={Users}
            tone="info"
            hint="So the two halves add up to everything collected."
          />
          <StatCard
            label="Total collected"
            value={formatCurrency(report.totals.totalCollected)}
            icon={Percent}
            tone="success"
          />
        </StatCardGrid>

        <Card>
          <CardHeader
            title="Commission by reseller"
            description={`${fromStr} to ${toStr}`}
            action={<DateRangePicker defaultPreset="month" />}
          />
          <CardBody className="p-0">
            <DataTableShell
              columns={columns}
              rows={report.rows}
              rowKey={(r) => r.resellerId}
              empty="No reseller collected anything in this period."
              footer={
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
                  <span className="text-xs text-fg-muted">
                    Commission is collected × rate, rounded to two decimals.
                  </span>
                  <span className="tnum text-sm font-semibold">
                    {formatCurrency(report.totals.commission)} on{" "}
                    {formatCurrency(report.totals.collected)}
                  </span>
                </div>
              }
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}

/** Shown when the date range in the URL cannot be read. */
function BadRangeNotice() {
  return (
    <>
      <PageHeader
        title="Reseller Commission"
        breadcrumb={[{ label: "Resellers", href: "/resellers" }, { label: "Commission" }]}
      />
      <PageContainer>
        <Card>
          <CardBody>
            <p className="text-sm text-fg-muted">
              That date range could not be read. Pick a start and an end date to see the report.
            </p>
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}