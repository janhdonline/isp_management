import type { Metadata } from "next";
import { getAreasSimple } from "@/lib/services/areas";
import { getAllPackages } from "@/lib/services/packages";
import { messageMetrics } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { ComposeMessage } from "@/components/support/forms";
import { CONNECTION_STATUSES } from "@/lib/enums";
import { formatNumber } from "@/lib/utils";
import { MessageSquare, Send, XCircle, CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SMS" };

export default async function SmsPage() {
  const [areas, packages, metrics] = await Promise.all([
    getAreasSimple(),
    getAllPackages(),
    messageMetrics(),
  ]);

  return (
    <>
      <PageHeader
        title="Send SMS"
        description="Reach a single customer or a whole segment. Every message is logged with its status."
        breadcrumb={[{ label: "Notifications", href: "/notifications" }, { label: "SMS" }]}
      />
      <PageContainer>
        <StatCardGrid>
          <StatCard label="SMS Balance" value={formatNumber(metrics.balance)} icon={MessageSquare} tone="brand" />
          <StatCard label="Sent" value={formatNumber(metrics.sent)} icon={Send} tone="success" />
          <StatCard label="Failed" value={formatNumber(metrics.failed)} icon={XCircle} tone="danger" />
          <StatCard label="Today" value={formatNumber(metrics.today)} icon={CalendarClock} tone="neutral" />
        </StatCardGrid>

        <Card className="max-w-4xl">
          <CardHeader title="Compose SMS" description="Templates expand {name}, {amount}, {date} and {username}." />
          <CardBody>
            <ComposeMessage
              channel="SMS"
              areas={areas.map((a) => ({ id: a.id, name: a.name }))}
              packages={packages.map((p) => ({ id: p.id, name: p.name }))}
              statuses={[...CONNECTION_STATUSES]}
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
