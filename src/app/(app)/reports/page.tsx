import type { Metadata } from "next";
import { startOfDay, endOfDay } from "@/lib/utils";
import {
  attendanceReportData,
  billingReport,
  collectionReport,
  customerReport,
  defaultRange,
  dueReport,
  expenseReport,
  networkReport,
  profitAndLoss,
} from "@/lib/services/reports";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import {
  ReportShell,
  CustomerReport,
  BillingReport,
  CollectionReport,
  DueReport,
  ExpenseReport,
  ProfitAndLoss,
  NetworkReport,
  AttendanceReport,
} from "@/components/reports/report-views";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports" };

const TITLES: Record<string, string> = {
  customers: "Customer Report",
  billing: "Billing Report",
  collection: "Collection Report",
  due: "Due Report",
  expense: "Expense Report",
  pnl: "Profit & Loss",
  network: "Network Report",
  attendance: "Attendance Report",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "customers";

  // "due" and "network" are point-in-time snapshots, not period reports.
  const fromParam = typeof sp.from === "string" ? sp.from : null;
  const toParam = typeof sp.to === "string" ? sp.to : null;
  const range =
    fromParam || toParam
      ? {
          from: startOfDay(new Date(fromParam ?? new Date())),
          to: endOfDay(new Date(toParam ?? new Date())),
        }
      : defaultRange();

  let body: React.ReactNode = null;

  switch (tab) {
    case "customers":
      body = <CustomerReport data={await customerReport(range)} />;
      break;
    case "billing":
      body = <BillingReport data={await billingReport(range)} />;
      break;
    case "collection":
      body = <CollectionReport data={await collectionReport(range)} />;
      break;
    case "due":
      body = <DueReport data={await dueReport()} />;
      break;
    case "expense":
      body = <ExpenseReport data={await expenseReport(range)} />;
      break;
    case "pnl":
      body = <ProfitAndLoss data={await profitAndLoss(range)} />;
      break;
    case "network":
      body = <NetworkReport data={await networkReport()} />;
      break;
    case "attendance":
      body = <AttendanceReport data={await attendanceReportData(range)} />;
      break;
    default:
      body = <CustomerReport data={await customerReport(range)} />;
  }

  const periodScoped = !["due", "network"].includes(tab);

  return (
    <>
      <PageHeader
        title={TITLES[tab] ?? "Reports"}
        description={
          periodScoped
            ? `Covering ${formatDate(range.from)} to ${formatDate(range.to)}. Change the range above and the figures regenerate.`
            : "A live snapshot of the network as it is right now."
        }
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: TITLES[tab] ?? "Overview" }]}
      />
      <PageContainer>
        <ReportShell tab={tab}>{body}</ReportShell>
      </PageContainer>
    </>
  );
}
