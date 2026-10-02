import type { Metadata } from "next";
import { startOfDay, endOfDay } from "@/lib/utils";
import {
  attendanceReportData,
  billingReport,
  collectionReport,
  corporateReport,
  corporateCollectionReport,
  customerReport,
  defaultRange,
  dueReport,
  expenseReport,
  networkReport,
  profitAndLoss,
} from "@/lib/services/reports";
import { btrcReport, currentMonth } from "@/lib/services/btrc";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import {
  ReportShell,
  CustomerReport,
  BillingReport,
  CollectionReport,
  CorporateReport,
  CorporateCollectionReport,
  DueReport,
  ExpenseReport,
  ProfitAndLoss,
  NetworkReport,
  AttendanceReport,
  BtrcReport,
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
  btrc: "BTRC Subscriber Report",
};

/**
 * The month the BTRC tab reports on. Absent means the current month; present but
 * unusable is passed through as-is, so the report comes back empty rather than
 * silently reporting a month the user did not ask for.
 */
function selectedMonth(sp: Record<string, string | string[] | undefined>): string {
  const raw = sp.month;
  return typeof raw === "string" ? raw : currentMonth();
}

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
  let data: Awaited<ReturnType<typeof btrcReport>> | null = null;

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
    case "corporate":
      body = <CorporateReport data={await corporateReport()} />;
      break;
    case "corporate-collection":
      body = <CorporateCollectionReport data={await corporateCollectionReport(range)} />;
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
    case "btrc": {
      // The regulator wants one month at a time, so this tab has its own `month`
      // parameter rather than borrowing the arbitrary from/to range above. No
      // `month` in the URL means the current month; an unusable one reports
      // empty rather than falling back, so a blank picker cannot be read as a
      // filing for the wrong month.
      data = await btrcReport(selectedMonth(sp));
      body = <BtrcReport data={data} />;
      break;
    }
    default:
      body = <CustomerReport data={await customerReport(range)} />;
  }

  // BTRC is filed per calendar month, so the header describes the month the tab
  // actually shows rather than the arbitrary from/to range the other tabs use.
  const periodScoped = !["due", "network", "btrc", "corporate"].includes(tab);

  return (
    <>
      <PageHeader
        title={TITLES[tab] ?? "Reports"}
        description={
          periodScoped
            ? `Covering ${formatDate(range.from)} to ${formatDate(range.to)}. Change the range above and the figures regenerate.`
            : tab === "btrc"
              ? data?.label
                ? `Subscriber position for ${data.label}. Counts match the dashboard and the customer list.`
                : "Pick a month to build the return."
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
