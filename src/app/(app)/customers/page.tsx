import type { Metadata } from "next";
import { listCustomers, customerStatusMetrics } from "@/lib/services/customers";
import { parseListParams } from "@/lib/query";
import { getAreasSimple } from "@/lib/services/areas";
import { getAllPackages } from "@/lib/services/packages";
import { CustomerListPage } from "@/components/customers/customer-list";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseListParams(await searchParams);
  const [result, areas, packages, metrics] = await Promise.all([
    listCustomers(params),
    getAreasSimple(),
    getAllPackages(),
    customerStatusMetrics(),
  ]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          {metrics.total} total · {metrics.active} active · {metrics.online} online ·{" "}
          {metrics.suspended} suspended
        </p>
      </div>

      <CustomerListPage
        view="list"
        rows={result.rows}
        total={result.total}
        page={result.page}
        perPage={result.perPage}
        totalPages={result.totalPages}
        areas={areas}
        packages={packages}
        filterProps={{ showStatus: true, showBilling: true, showOnline: true, showExpiry: true }}
        toolbarRight={
          <div className="hidden items-center gap-3 text-xs text-fg-muted lg:flex">
            <span>
              MRR{" "}
              <strong className="tnum font-semibold text-[var(--fg)]">
                {formatCurrency(result.metrics?.monthlyBill ?? 0)}
              </strong>
            </span>
            <span>
              Due{" "}
              <strong className="tnum font-semibold text-red-600 dark:text-red-400">
                {formatCurrency(result.metrics?.due ?? 0)}
              </strong>
            </span>
          </div>
        }
      />
    </div>
  );
}
