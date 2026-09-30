import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { getReseller, resellerCustomers } from "@/lib/services/resellers";
import { DeleteResellerButton } from "@/components/resellers/reseller-views";
import { ClientEdit } from "./client-edit";
import { formatCurrency, formatNumber } from "@/lib/utils";
import { Users, Percent, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reseller" };

export default async function ResellerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [reseller, customers, areas] = await Promise.all([
    getReseller(id),
    resellerCustomers(id),
    prisma.area.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!reseller) notFound();

  const commission = Math.round(reseller.collected * reseller.commissionPct) / 100;

  type Row = (typeof customers)[number];
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (c) => (
        <div>
          <span className="text-sm font-medium">{c.name}</span>
          <p className="font-mono text-[11px] text-fg-subtle">{c.customerCode}</p>
        </div>
      ),
      exportValue: (c) => c.name,
    },
    { key: "username", header: "Username", cell: (c) => <span className="font-mono text-xs">{c.username}</span>, exportValue: (c) => c.username },
    { key: "phone", header: "Phone", hideBelow: "sm", cell: (c) => <span className="text-xs">{c.phone}</span>, exportValue: (c) => c.phone },
    { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.connectionStatus} />, exportValue: (c) => c.connectionStatus },
    {
      key: "due",
      header: "Due",
      align: "right",
      cell: (c) => (
        <span className={`tnum text-xs ${c.previousDue > 0 ? "font-medium" : "text-fg-subtle"}`}>
          {formatCurrency(c.previousDue)}
        </span>
      ),
      exportValue: (c) => c.previousDue,
    },
  ];

  return (
    <>
      <PageHeader
        title={reseller.name}
        description={`${reseller.phone ?? "No phone"} · ${reseller.areaName ?? "All areas"} · ${reseller.commissionPct}% commission`}
        breadcrumb={[{ label: "Resellers", href: "/resellers" }, { label: reseller.name }]}
        actions={<ClientEdit reseller={reseller} areas={areas} />}
      />
      <PageContainer className="space-y-4">
        <StatCardGrid>
          <StatCard label="Customers" value={formatNumber(reseller.customers)} icon={Users} tone="brand" />
          <StatCard label="Commission rate" value={`${reseller.commissionPct}%`} icon={Percent} tone="info" />
          <StatCard
            label="Collected (all time)"
            value={formatCurrency(reseller.collected)}
            icon={Wallet}
            tone="success"
          />
          <StatCard
            label="Commission owed"
            value={formatCurrency(commission)}
            tone="warning"
            hint="Derived from the payments attributed to them."
          />
        </StatCardGrid>

        <Card>
          <CardHeader
            title="Assigned customers"
            description="Customers whose bills this reseller collects."
          />
          <CardBody className="p-0">
            <DataTableShell
              columns={columns}
              rows={customers}
              rowKey={(c) => c.id}
              empty="No customers are assigned to this reseller yet."
            />
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <DeleteResellerButton id={reseller.id} name={reseller.name} />
        </div>
      </PageContainer>
    </>
  );
}
