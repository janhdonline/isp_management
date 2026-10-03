import type { Metadata } from "next";
import { ponUtilisationReport } from "@/lib/services/pon";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { formatNumber } from "@/lib/utils";
import { AlertTriangle, Gauge, Server, Wifi, WifiOff } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "PON utilisation" };

/**
 * PON utilisation across every cabinet, worst first.
 *
 * This is the page somebody opens when they have to answer "can we take another
 * customer here", and the answer is only useful if the cabinets with *room* are on
 * it too — so every OLT is listed, including the ones with nothing on them, and
 * they sort by how full they are. The emptiest cabinets are at the bottom, which is
 * where you want them.
 *
 * No stored figures anywhere on this page: each row is a grouped count over the
 * ONU table, recomputed on every load.
 */
export default async function PonUtilisationPage() {
  const report = await ponUtilisationReport();
  const worst = report.rows[0];
  const withRoom = report.rows.filter((r) => r.percent < 90).length;

  return (
    <>
      <PageHeader
        title="PON utilisation"
        description="How full every cabinet is, counted from the ONUs on its ports. Sorted fullest first, so the emptiest cabinet — the one that can take the next customer — is at the bottom."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "PON utilisation" }]}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Cabinets" value={formatNumber(report.totals.olts)} icon={Server} tone="brand" />
          <StatCard
            label="Network utilisation"
            value={`${report.totals.percent}%`}
            icon={Gauge}
            tone={report.totals.percent > 90 ? "danger" : "success"}
            hint={`${report.totals.onus} of ${report.totals.capacity} slots`}
          />
          <StatCard
            label="Cabinets with room"
            value={formatNumber(withRoom)}
            icon={Wifi}
            tone="info"
            hint="under 90% used"
          />
          <StatCard
            label="Full ports"
            value={formatNumber(report.rows.reduce((sum, r) => sum + r.full, 0))}
            icon={WifiOff}
            tone="warning"
          />
          <StatCard
            label="ONUs with no port"
            value={formatNumber(report.totals.unassigned)}
            icon={AlertTriangle}
            tone={report.totals.unassigned ? "warning" : "neutral"}
            hint="connected, and on no port"
          />
        </StatCardGrid>

        {worst && worst.percent >= 90 ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {worst.oltName} is {worst.percent}% used and has {worst.full} full port(s).{" "}
            <a href={`/network/olt/${worst.oltId}`} className="underline">
              Look at its ports
            </a>{" "}
            before another customer is quoted onto it.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th className="px-3 py-2">OLT</th>
                <th className="px-3 py-2">Utilisation</th>
                <th className="px-3 py-2 text-right">ONUs</th>
                <th className="px-3 py-2 text-right">Slots</th>
                <th className="px-3 py-2 text-right">Ports</th>
                <th className="px-3 py-2 text-right">Full</th>
                <th className="px-3 py-2 text-right">No port</th>
                <th className="px-3 py-2 text-right">Split</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.oltId} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">
                    <a href={`/network/olt/${r.oltId}`} className="hover:text-brand-600">
                      {r.oltName}
                    </a>
                  </td>
                  <td className="w-56 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${r.percent}%`,
                            background:
                              r.percent >= 100 ? "#dc2626" : r.percent >= 90 ? "#c99b3f" : "#16a34a",
                          }}
                        />
                      </div>
                      <span className="tnum w-10 text-right text-xs">{r.percent}%</span>
                    </div>
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs">{formatNumber(r.onus)}</td>
                  <td className="tnum px-3 py-2 text-right text-xs text-fg-muted">
                    {formatNumber(r.capacity)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs">{r.ports}</td>
                  <td className="tnum px-3 py-2 text-right text-xs">
                    {r.full > 0 ? (
                      <span className="text-red-700 dark:text-red-400">{r.full}</span>
                    ) : (
                      <span className="text-fg-subtle">0</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs">
                    {r.unassigned > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">{r.unassigned}</span>
                    ) : (
                      <span className="text-fg-subtle">0</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs text-fg-muted">1:{r.splitRatio}</td>
                </tr>
              ))}
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-fg-muted">
                    No OLTs are recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-fg-muted">
          Slots are counted as the ports seen in use times the split ratio. A port with
          nothing on it contributes zero ONUs either way, so multiplying by the
          hardware&apos;s port count would claim capacity on ports nobody has evidence
          exist. Each cabinet&apos;s own split ratio is shown in the last column — where
          it differs from 1:64, that cabinet has been reconfigured and the default
          would be wrong.
        </p>
      </PageContainer>
    </>
  );
}