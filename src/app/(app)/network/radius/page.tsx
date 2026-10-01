import type { Metadata } from "next";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { RadiusTerminal, RadiusHealthBadge } from "@/components/network/radius-terminal";
import { radiusHealth, liveRadiusSessions, radiusLogSummary } from "@/lib/services/radius-queries";
import { formatNumber } from "@/lib/utils";
import { Radio, CheckCircle2, XCircle, Users, Ban, KeyRound } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "RADIUS Live" };

/**
 * Network → RADIUS Live.
 *
 * A tail of authentication, accounting and disconnect events, plus the state of
 * the RADIUS process itself. The server component renders the first page of lines
 * and the health reading; everything after that arrives over SSE, because a page
 * that waits on the database to know a customer just tried to log in is not a live
 * view.
 *
 * `force-dynamic` for the obvious reason — it is a live status page, and a cached
 * one would report a RADIUS server that died ten minutes ago as healthy.
 */
export default async function RadiusLivePage() {
  const [health, sessions, summary] = await Promise.all([
    radiusHealth(),
    liveRadiusSessions(),
    radiusLogSummary(),
  ]);

  return (
    <>
      <PageHeader
        title="RADIUS Live"
        description="Authentication, accounting and disconnect events as the routers send them, and whether this application's RADIUS process is running."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "RADIUS Live" }]}
      />
      <PageContainer className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <RadiusHealthBadge health={health} />
        </div>

        <StatCardGrid>
          <StatCard
            label="Live sessions"
            value={formatNumber(sessions.total)}
            icon={Users}
            tone={sessions.total > 0 ? "brand" : "neutral"}
          />
          <StatCard
            label="Accepted (24h)"
            value={formatNumber(summary.accept ?? 0)}
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="Rejected (24h)"
            value={formatNumber(summary.reject ?? 0)}
            icon={XCircle}
            tone={summary.reject ? "warning" : "neutral"}
          />
          <StatCard
            label="Disconnects (24h)"
            value={formatNumber(summary.disconnect ?? 0)}
            icon={Radio}
            tone="info"
          />
          <StatCard
            label="Dropped (24h)"
            value={formatNumber(summary.dropped ?? 0)}
            icon={Ban}
            tone={summary.dropped ? "danger" : "neutral"}
            hint="packets refused before authentication"
          />
          <StatCard
            label="Packets"
            value={formatNumber(health.packetsIn + health.packetsOut)}
            icon={KeyRound}
            tone="neutral"
            hint={`${health.packetsIn} in · ${health.packetsOut} out`}
          />
        </StatCardGrid>

        <RadiusTerminal />
      </PageContainer>
    </>
  );
}