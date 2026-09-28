import type { Metadata } from "next";
import { listPackages } from "@/lib/services/packages";
import { parseListParams } from "@/lib/query";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { PackagesTable } from "@/components/packages/packages-table";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Package, PackageCheck, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Packages" };

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await listPackages(parseListParams(await searchParams));
  const m = result.metrics;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Packages</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Speed tiers, pricing and validity rules offered to customers.
        </p>
      </div>

      <StatCardGrid>
        <StatCard label="Total Packages" value={formatNumber(m.total)} icon={Package} tone="brand" />
        <StatCard label="Active" value={formatNumber(m.active)} icon={PackageCheck} tone="success" />
        <StatCard label="Inactive" value={formatNumber(m.inactive)} icon={Package} tone="neutral" />
        <StatCard label="Total Subscribers" value={formatNumber(m.subscribers)} icon={Users} tone="info" hint={`Avg price ${formatCurrency(m.avgPrice)}`} />
      </StatCardGrid>

      <PackagesTable
        rows={result.rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
      />
    </div>
  );
}
