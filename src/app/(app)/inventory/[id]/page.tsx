import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { getItemDetail } from "@/lib/services/inventory";
import {
  MovementHistory,
  AssignedTable,
  DeleteItemButton,
  ItemForm,
} from "@/components/inventory/inventory-views";
import { RecordStockButton } from "@/components/inventory/record-stock-button";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { AlertTriangle, History, Package, Radio, Signature } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inventory Item" };

export default async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "history";

  const detail = await getItemDetail(id);
  if (!detail) notFound();

  const { item, movements, assigned } = detail;
  const out = assigned.filter((a) => a.status === "Assigned");

  return (
    <>
      <PageHeader
        title={item.name}
        description={`${item.sku} · ${item.category} · measured in ${item.unit}`}
        breadcrumb={[
          { label: "Inventory", href: "/inventory" },
          { label: item.name },
        ]}
        actions={<RecordStockButton item={item} />}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard
            label="In stock"
            value={`${formatNumber(item.quantity)} ${item.unit}`}
            icon={Package}
            tone={item.lowStock ? "warning" : "brand"}
          />
          <StatCard
            label="Reorder at"
            value={item.reorderLevel > 0 ? formatNumber(item.reorderLevel) : "Not set"}
            icon={AlertTriangle}
            tone="neutral"
          />
          <StatCard
            label="Out with customers"
            value={formatNumber(out.length)}
            icon={Radio}
            tone={out.length > 0 ? "info" : "neutral"}
          />
          <StatCard
            label="Stock value"
            value={item.unitPrice ? formatCurrency(item.value) : "—"}
            icon={History}
            tone="success"
          />
        </StatCardGrid>

        {item.lowStock ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              At or below the reorder level of {formatNumber(item.reorderLevel)} {item.unit}. The
              figure is {formatNumber(item.quantity)}, so this needs ordering.
            </p>
          </div>
        ) : null}

        <Card>
          <CardHeader title={item.name} description={item.sku} />
          <CardBody>
            <Tabs
              items={[
                { value: "history", label: "Movement history", href: `/inventory/${item.id}?tab=history`, count: movements.length || undefined },
                { value: "assigned", label: "With customers", href: `/inventory/${item.id}?tab=assigned`, count: assigned.length || undefined },
                { value: "edit", label: "Edit", href: `/inventory/${item.id}?tab=edit` },
              ]}
              value={tab}
            />

            {tab === "history" ? (
              <div className="mt-4 space-y-4">
                <MovementHistory movements={movements} />
                <div className="flex items-center gap-2 text-xs text-fg-subtle">
                  <Signature className="size-3.5" />
                  Every figure above is a difference, not a running total — the balance is their
                  sum, which is what makes a discrepancy traceable to the movement that caused it.
                </div>
              </div>
            ) : null}

            {tab === "assigned" ? (
              <div className="mt-4">
                <AssignedTable rows={assigned} />
              </div>
            ) : null}

            {tab === "edit" ? (
              <div className="mt-4 max-w-2xl space-y-4">
                <ItemForm item={item} />
                <div className="border-t border-[var(--border)] pt-4">
                  <DeleteItemButton id={item.id} name={item.name} />
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>

      </PageContainer>
    </>
  );
}
