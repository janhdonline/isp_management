import type { Metadata } from "next";
import Link from "next/link";
import { listPools, listAllocations } from "@/lib/services/ipam";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import { Network, Search } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "IP Pools" };

/**
 * Network → IP Pools.
 *
 * Utilisation per pool, and the addresses themselves. The bar is computed from the
 * rows on screen rather than from a stored percentage, so it cannot drift from the
 * table under it.
 */
export default async function IpPoolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read off the raw search params: `ListParams` has no poolId, and a
  // nonexistent filter silently returning everything is worse than reading it here.
  const raw = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const poolId = one(raw.poolId);
  const status = one(raw.status);
  const q = one(raw.q);

  const [pools, allocations] = await Promise.all([
    listPools(),
    listAllocations({ poolId, status, q, take: 500 }),
  ]);

  return (
    <>
      <PageHeader
        title="IP Pools"
        description="Every address this ISP can hand out, and who is holding it. An address in a pool can only be allocated once."
        breadcrumb={[{ label: "Network", href: "/network" }, { label: "IP Pools" }]}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Pools" value={formatNumber(pools.metrics.pools)} icon={Network} tone="brand" />
          <StatCard label="Addresses" value={formatNumber(pools.metrics.totalCapacity)} tone="info" />
          <StatCard label="Allocated" value={formatNumber(pools.metrics.totalUsed)} tone="warning" />
          <StatCard label="Free" value={formatNumber(pools.metrics.totalFree)} tone="success" />
          <StatCard
            label="Utilisation"
            value={`${pools.metrics.utilization}%`}
            tone={pools.metrics.utilization > 90 ? "danger" : "neutral"}
            hint={pools.metrics.utilization > 90 ? "a pool this full cannot absorb a new customer" : undefined}
          />
        </StatCardGrid>

        {pools.rows.length === 0 ? (
          <EmptyPools />
        ) : (
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {pools.rows.map((p) => (
              <div key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/network/ip-pools?poolId=${p.id}`}
                      className="text-sm font-medium hover:text-brand-600"
                    >
                      {p.name}
                    </Link>
                    <p className="font-mono text-[11px] text-fg-muted">
                      {p.cidr}
                      {p.gateway ? ` · gw ${p.gateway}` : ""}
                    </p>
                  </div>
                  <span className="tnum shrink-0 text-sm font-semibold">{p.utilization}%</span>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, p.utilization)}%`,
                      background:
                        p.utilization > 90 ? "#dc2626" : p.utilization > 70 ? "#c99b3f" : "#3163ff",
                    }}
                  />
                </div>

                <p className="mt-1.5 text-[11px] text-fg-subtle">
                  {p.counts.Allocated} allocated · {p.counts.Reserved} reserved ·{" "}
                  {p.counts.Free} free of {p.total}
                  {p.area ? ` · ${p.area.name}` : ""}
                  {p.router ? ` · ${p.router.name}` : ""}
                </p>
              </div>
            ))}
          </section>
        )}

        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Pool</span>
            <select
              name="poolId"
              defaultValue={poolId ?? ""}
              className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
            >
              <option value="">All pools</option>
              {pools.rows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Status</span>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
            >
              <option value="">Any</option>
              <option value="Free">Free</option>
              <option value="Allocated">Allocated</option>
              <option value="Reserved">Reserved</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Search</span>
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="10.10.10."
              className="h-9 w-48 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-sm"
            />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            <Search className="size-4" /> Filter
          </Button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Pool</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{a.ip}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {a.pool.name}
                    <span className="block font-mono text-[11px] text-fg-subtle">{a.pool.cidr}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {a.customer ? (
                      <Link href={`/customers/${a.customer.id}`} className="hover:text-brand-600">
                        {a.customer.name}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="px-3 py-2 text-[11px] text-fg-muted">{a.note ?? ""}</td>
                </tr>
              ))}
              {allocations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-fg-muted">
                    Nothing matches these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageContainer>
    </>
  );
}

function EmptyPools() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center">
      <Badge>No pools</Badge>
      <p className="mt-2 text-sm text-fg-muted">
        No address pools are defined, so nothing is being tracked for duplicates. Create a
        pool and its usable addresses appear here.
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        Customers with addresses typed in by hand keep them; adopt them into a pool when you
        are ready, rather than having a migration rewrite years of data.
      </p>
      <p className="mt-3 text-xs text-fg-muted">
        <Link href="/customers" className="text-brand-600 hover:underline">
          Customers
        </Link>{" "}
        carry an IP address today.
      </p>
    </div>
  );
}