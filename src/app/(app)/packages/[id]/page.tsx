import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPackage } from "@/lib/services/packages";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { DonutChart, ChartLegend } from "@/components/ui/charts";
import { SubscriberTable } from "@/components/packages/subscriber-table";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { PackageRowActions } from "@/components/packages/packages-table";
import { Gauge, Package, Users, Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const pkg = await prisma.package.findUnique({ where: { id }, select: { name: true } });
  return { title: pkg?.name ?? "Package" };
}

export default async function PackageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pkg = await getPackage(id);
  if (!pkg) notFound();

  const activeSubs = pkg.customers.filter((c) => c.connectionStatus === "Active");
  const row = {
    id: pkg.id,
    name: pkg.name,
    downloadSpeed: pkg.downloadSpeed,
    uploadSpeed: pkg.uploadSpeed,
    monthlyPrice: pkg.monthlyPrice,
    installationFee: pkg.installationFee,
    validityDays: pkg.validityDays,
    billingCycle: pkg.billingCycle,
    fupLimit: pkg.fupLimit,
    mikrotikProfile: pkg.mikrotikProfile,
    fupProfile: pkg.fupProfile,
    status: pkg.status,
    _count: { customers: pkg._count.customers },
  };
  const expiring = pkg.customers.filter((c) => c.expiryDate && c.expiryDate < new Date()).length;


  return (
    <>
      <PageHeader
        title={pkg.name}
        description={`${pkg.downloadSpeed} / ${pkg.uploadSpeed} Mbps · ${pkg.billingCycle} billing · ${pkg.validityDays} day validity`}
        breadcrumb={[{ label: "Packages", href: "/packages" }, { label: pkg.name }]}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={pkg.status} />
            <Link
              href={`/packages/${pkg.id}/edit`}
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)]"
            >
              Edit
            </Link>
            <PackageRowActions row={row} />
          </div>
        }
      />

      <PageContainer>
        <StatCardGrid>
          <StatCard label="Monthly Price" value={formatCurrency(pkg.monthlyPrice)} icon={Wallet} tone="brand" />
          <StatCard label="Installation Fee" value={formatCurrency(pkg.installationFee)} icon={Package} tone="neutral" />
          <StatCard label="Subscribers" value={formatNumber(pkg._count.customers)} icon={Users} tone="info" hint={`${activeSubs.length} active`} />
          <StatCard
            label="Monthly Revenue"
            value={formatCurrency(pkg.monthlyPrice * activeSubs.length)}
            icon={Gauge}
            tone="success"
            hint={`${expiring} expired`}
          />
        </StatCardGrid>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Plan details" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {[
                  ["Package name", pkg.name],
                  ["Download", `${pkg.downloadSpeed} Mbps`],
                  ["Upload", `${pkg.uploadSpeed} Mbps`],
                  ["Monthly price", formatCurrency(pkg.monthlyPrice)],
                  ["Installation fee", formatCurrency(pkg.installationFee)],
                  ["Validity", `${pkg.validityDays} days`],
                  ["Billing cycle", pkg.billingCycle],
                  ["FUP limit", pkg.fupLimit ? `${pkg.fupLimit} GB` : "Unlimited"],
                  ["Status", pkg.status],
                  ["Created", formatDate(pkg.createdAt)],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-fg-subtle">{k}</dt>
                    <dd className="mt-0.5 text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
              {pkg.description ? (
                <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm text-fg-muted">
                  {pkg.description}
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Subscriber mix" description="Customers on this package by status" />
            <CardBody>
              <DonutChart
                data={[
                  { label: "Active", value: activeSubs.length, color: "#10b981" },
                  { label: "Expired", value: expiring, color: "#f43f5e" },
                  { label: "Other", value: Math.max(0, pkg._count.customers - activeSubs.length - expiring), color: "#94a3b8" },
                ]}
                centerValue={formatNumber(pkg._count.customers)}
                centerLabel="customers"
              />
              <ChartLegend
                data={[
                  { label: "Active", value: activeSubs.length, color: "#10b981" },
                  { label: "Expired", value: expiring, color: "#f43f5e" },
                  { label: "Other", value: Math.max(0, pkg._count.customers - activeSubs.length - expiring), color: "#94a3b8" },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Subscribers" description="Most recent customers assigned to this package" />
          <CardBody className="p-0">
            <SubscriberTable
              rows={pkg.customers.map((c) => ({
                id: c.id,
                name: c.name,
                username: c.username,
                expiryDate: c.expiryDate,
                connectionStatus: c.connectionStatus,
              }))}
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
