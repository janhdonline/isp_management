import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { CustomerForm } from "@/components/customers/customer-form";
import { freeAddresses } from "@/lib/services/ipam";
import { createCustomerAction } from "../actions";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Customer" };

export default async function NewCustomerPage() {
  const [areas, packages, routers, olts, settings, resellers, free] = await Promise.all([
    prisma.area.findMany({
      where: { status: "Active" },
      include: { zone: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.package.findMany({ where: { status: "Active" }, orderBy: { monthlyPrice: "asc" } }),
    prisma.router.findMany({ orderBy: { name: "asc" } }),
    prisma.olt.findMany({ orderBy: { name: "asc" } }),
    getSettings(),
    prisma.reseller.findMany({
      where: { status: "Active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    freeAddresses(null, 200),
  ]);

  const prefix = settings["billing.customerPrefix"] ?? "CUS";
  const last = await prisma.customer.findFirst({ orderBy: { createdAt: "desc" }, select: { customerCode: true } });
  const nextNumberGuess = last
    ? `${prefix}-${String(Number(last.customerCode.split("-").pop()) + 1).padStart(6, "0")}`
    : `${prefix}-000001`;

  return (
    <>
      <PageHeader
        title="New Customer"
        description="Create a subscriber, assign a package and record the connection details in one step."
        breadcrumb={[{ label: "Customers", href: "/customers" }, { label: "New Customer" }]}
      />

      <PageContainer className="max-w-6xl">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-xs text-fg-muted">
          Next customer ID: <span className="font-mono font-semibold text-[var(--fg)]">{nextNumberGuess}</span> ·
          username must be unique · bill and installation fee are copied from the selected package.
        </div>

        <CustomerForm
          areas={areas.map((a) => ({ id: a.id, name: a.name, zone: a.zone?.name ?? null }))}
          resellers={resellers}
          packages={packages.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.monthlyPrice,
            fee: p.installationFee,
            speed: `${p.downloadSpeed}/${p.uploadSpeed}`,
          }))}
          routers={routers.map((r) => ({ id: r.id, name: r.name }))}
          olts={olts.map((o) => ({ id: o.id, name: o.name }))}
          defaults={{ customerType: "Home", connectionType: "PPPoE", ipType: "Dynamic" }}
          defaultSlaHours={Number(settings["corporate.defaultSlaHours"]) || 4}
          pools={free.map((f) => ({ ip: f.ip, pool: f.pool.name }))}
          isEdit={false}
          action={createCustomerAction}
        />
      </PageContainer>
    </>
  );
}
