import type { Metadata } from "next";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FilterSelect } from "@/components/ui/data-table";
import { listItems } from "@/lib/services/inventory";
import { CATEGORIES } from "@/lib/services/inventory";
import {
  InventoryTable,
  NewItemButton,
  LowStockNotice,
} from "@/components/inventory/inventory-views";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { AlertTriangle, Boxes, Coins, Package } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" ? sp.category : "All";
  const lowOnly = sp.low === "1";

  const { rows, metrics } = await listItems({ q, category, lowStockOnly: lowOnly });
  const lowStock = rows.filter((r) => r.lowStock);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Equipment bought, issued and returned. Stock on hand is always the sum of the movements, so the ledger explains any figure here."
        breadcrumb={[{ label: "Inventory" }]}
        actions={<NewItemButton />}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Items" value={formatNumber(metrics.total)} icon={Boxes} tone="brand" />
          <StatCard
            label="Units in stock"
            value={formatNumber(metrics.units)}
            icon={Package}
            tone="info"
          />
          <StatCard
            label="Low stock"
            value={formatNumber(metrics.lowStock)}
            icon={AlertTriangle}
            tone={metrics.lowStock > 0 ? "warning" : "neutral"}
          />
          <StatCard
            label="Stock value"
            value={metrics.value > 0 ? formatCurrency(metrics.value) : "—"}
            icon={Coins}
            tone="success"
          />
        </StatCardGrid>

        <LowStockNotice items={lowStock} />

        <Card>
          <CardHeader
            title="Items"
            description="Stock is changed with a movement, never by editing the number here."
            action={
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect
                  param="category"
                  options={["All", ...CATEGORIES].map((c) => ({
                    value: c,
                    label: c === "All" ? "All categories" : c,
                  }))}
                />
                <a
                  href={lowOnly ? "/inventory" : "/inventory?low=1"}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
                    lowOnly
                      ? "border-[var(--gold-400)] bg-[var(--gold-50)] text-[var(--gold-700)] dark:bg-[var(--gold-500)/10] dark:text-[var(--gold-300)]"
                      : "border-[var(--border)] text-fg-muted hover:text-fg"
                  }`}
                >
                  <AlertTriangle className="size-3.5" />
                  Low stock only
                </a>
              </div>
            }
          />
          <CardBody className="p-0">
            <InventoryTable rows={rows} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
