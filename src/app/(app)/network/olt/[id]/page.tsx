import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ponUsageFor, isUnassigned, UNASSIGNED, type PortUsage } from "@/lib/services/pon";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { OnuPortAssigner } from "@/components/network/onu-port-assigner";
import { formatNumber } from "@/lib/utils";
import { AlertTriangle, Gauge, Radio, Wifi } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const olt = await prisma.olt.findUnique({
    where: { id: (await params).id },
    select: { name: true },
  });
  return { title: olt ? `${olt.name} — PON capacity` : "PON capacity" };
}

/**
 * One OLT's PON ports, counted from the ONUs that are on them right now.
 *
 * Every bar here is a `count`, not a stored figure. That is why there is nothing
 * to refresh and nothing to fall out of date: the number on the bar is the number
 * of rows in the ONU table, and the assignment form underneath reads from the same
 * pass so the two can never disagree.
 */
export default async function OltPonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usage = await ponUsageFor(id);
  if (!usage) notFound();

  const [unassignedOnus, olt] = await Promise.all([
    prisma.onu.findMany({
      where: { oltId: id, OR: [{ ponIndex: null }, { ponIndex: "" }] },
      orderBy: { serialNo: "asc" },
      select: { id: true, serialNo: true, name: true, vendor: true },
      take: 200,
    }),
    prisma.olt.findUniqueOrThrow({
      where: { id },
      select: { name: true, model: true, vendor: true, location: true, splitRatio: true, ponPorts: true },
    }),
  ]);

  const ports = usage.ports.filter((p) => !isUnassigned(p.port));
  const flagged = ports.filter((p) => p.atCapacity || p.nearCapacity);

  return (
    <>
      <PageHeader
        title={`${olt.name} — PON capacity`}
        description={`Every port counted from the ONUs on it now. A ${usage.splitRatio}:1 split means a port takes ${usage.splitRatio} subscribers, and the ${usage.nearCapacityPercent} mark is where it is worth acting.`}
        breadcrumb={[
          { label: "Network", href: "/network" },
          { label: "OLT", href: "/network/olt" },
          { label: olt.name },
        ]}
      />
      <PageContainer className="space-y-5">
        <StatCardGrid>
          <StatCard label="ONUs on this OLT" value={formatNumber(usage.totals.onus)} icon={Wifi} tone="brand" />
          <StatCard
            label="Ports in use"
            value={formatNumber(ports.length)}
            icon={Radio}
            tone="info"
            hint={olt.ponPorts ? `${olt.ponPorts} reported by the hardware` : "hardware count not known"}
          />
          <StatCard
            label="Utilisation"
            value={`${usage.totals.percent}%`}
            icon={Gauge}
            tone={usage.totals.percent > 90 ? "danger" : "success"}
            hint={`${usage.totals.onus} of ${usage.totals.capacity} slots`}
          />
          <StatCard
            label="At or near capacity"
            value={formatNumber(flagged.length)}
            icon={AlertTriangle}
            tone={flagged.length ? "warning" : "success"}
            hint={`${usage.totals.full} full`}
          />
          <StatCard
            label="No port assigned"
            value={formatNumber(usage.unassigned)}
            icon={AlertTriangle}
            tone={usage.unassigned ? "warning" : "neutral"}
            hint={usage.unassigned ? "capacity nobody can see" : "every ONU is on a port"}
          />
        </StatCardGrid>

        {flagged.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Near capacity</h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {flagged.map((p) => (
                <li
                  key={p.port}
                  className={
                    p.atCapacity
                      ? "rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950"
                      : "rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950"
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">{p.port}</span>
                    <span className="tnum font-medium">
                      {p.used}/{p.splitRatio}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {p.atCapacity
                      ? "Full. Never suggested; the next ONU here would be refused by the OLT."
                      : `${p.percent}% used. ${p.free} slot(s) left before it is.`}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-medium">Every port</h2>
          {ports.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No ONU on this cabinet has a port, so there is nothing to draw. That is
              itself worth knowing — {usage.unassigned} device(s) are connected and
              unaccounted for.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="px-3 py-2">Port</th>
                    <th className="px-3 py-2">Usage</th>
                    <th className="px-3 py-2 text-right">Used</th>
                    <th className="px-3 py-2 text-right">Free</th>
                    <th className="px-3 py-2">State</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.ports.map((p) => (
                    <PortRow key={p.port} port={p} nearAt={usage.nearCapacityPercent} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-medium">Place an ONU</h2>
          <p className="text-xs text-fg-muted">
            The port list is counted from the ONU table on this page load and the least
            loaded one is preselected. The check that refuses a full port happens in a
            transaction on the server, not here — two operators can still pick the same
            last slot, and only one of them gets it.
          </p>
          <OnuPortAssigner ports={usage.ports} unassigned={unassignedOnus} />
        </section>
      </PageContainer>
    </>
  );
}

function PortRow({ port, nearAt }: { port: PortUsage; nearAt: number }) {
  const unassigned = isUnassigned(port.port);
  const bar = unassigned ? "#c99b3f" : port.atCapacity ? "#dc2626" : port.nearCapacity ? "#c99b3f" : "#16a34a";

  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="px-3 py-2 font-mono text-xs">
        {unassigned ? <span className="italic text-fg-subtle">{UNASSIGNED}</span> : port.port}
      </td>
      <td className="w-64 px-3 py-2">
        <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div className="h-full rounded-full" style={{ width: `${port.percent}%`, background: bar }} />
        </div>
      </td>
      <td className="tnum px-3 py-2 text-right text-xs">
        {unassigned ? port.used : `${port.used}/${port.splitRatio}`}
      </td>
      <td className="tnum px-3 py-2 text-right text-xs text-fg-muted">
        {unassigned ? "—" : port.free}
      </td>
      <td className="px-3 py-2 text-xs">
        {unassigned ? (
          <span className="text-amber-700 dark:text-amber-400">
            No port assigned — capacity nobody can see
          </span>
        ) : port.atCapacity ? (
          <span className="text-red-700 dark:text-red-400">Full</span>
        ) : port.nearCapacity ? (
          <span className="text-amber-700 dark:text-amber-400">
            Near capacity ({port.percent}%, warning at {nearAt}%)
          </span>
        ) : (
          <span className="text-fg-muted">{port.percent}%</span>
        )}
      </td>
    </tr>
  );
}