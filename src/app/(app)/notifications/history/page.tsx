import type { Metadata } from "next";
import { parseListParams } from "@/lib/query";
import { listMessages, messageMetrics } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { MessagesTable, type MessageRow } from "@/components/support/support-views";
import { formatNumber } from "@/lib/utils";
import { CalendarClock, MessageSquare, Send, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Message History" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [result, metrics] = await Promise.all([
    listMessages(parseListParams(await searchParams)),
    messageMetrics(),
  ]);

  return (
    <>
      <PageHeader
        title="Message History"
        description="Every SMS, email and WhatsApp message with its delivery status."
        breadcrumb={[{ label: "Notifications", href: "/notifications" }, { label: "History" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="Total Messages" value={formatNumber(result.total)} icon={MessageSquare} tone="brand" />
          <StatCard label="Sent" value={formatNumber(metrics.sent)} icon={Send} tone="success" />
          <StatCard label="Failed" value={formatNumber(metrics.failed)} icon={XCircle} tone="danger" />
          <StatCard label="Today" value={formatNumber(metrics.today)} icon={CalendarClock} tone="neutral" />
        </StatCardGrid>

        <MessagesTable
          rows={result.rows as unknown as MessageRow[]}
          total={result.total}
          page={result.page}
          perPage={result.perPage}
          totalPages={result.totalPages}
        />
      </PageContainer>
    </>
  );
}
