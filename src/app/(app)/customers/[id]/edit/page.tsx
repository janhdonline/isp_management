import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAllPackages } from "@/lib/services/packages";
import { listRouters, listOlts } from "@/lib/services/network";
import { getAreasSimple } from "@/lib/services/areas";
import { CustomerForm } from "@/components/customers/customer-form";
import { updateCustomerAction } from "../../actions";
import { PageHeader, PageContainer } from "@/components/layout/page-header";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, areas, packages, routers, olts, resellers] = await Promise.all([
    prisma.customer.findUnique({
      where: { id },
      // The ONU is included only for its serial, which is what the form shows.
      include: { onu: { select: { serialNo: true } } },
    }),
    getAreasSimple(),
    getAllPackages(),
    listRouters(),
    listOlts(),
    prisma.reseller.findMany({
      where: { status: "Active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!customer) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${customer.name}`}
        description="Update identity, connection and billing details. Every change is recorded in the audit log."
        breadcrumb={[
          { label: "Customers", href: "/customers" },
          { label: customer.name, href: `/customers/${customer.id}` },
          { label: "Edit" },
        ]}
      />

      <PageContainer className="max-w-6xl">
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
          defaults={{
            id: customer.id,
            name: customer.name,
            fatherName: customer.fatherName ?? undefined,
            motherName: customer.motherName ?? undefined,
            phone: customer.phone,
            altPhone: customer.altPhone ?? undefined,
            email: customer.email ?? undefined,
            nid: customer.nid ?? undefined,
            dateOfBirth: customer.dateOfBirth ? customer.dateOfBirth.toISOString() : undefined,
            gender: customer.gender ?? undefined,
            address: customer.address ?? undefined,
            areaId: customer.areaId ?? undefined,
            customerType: customer.customerType,
            username: customer.username,
            connectionType: customer.connectionType,
            packageId: customer.packageId ?? undefined,
            ipType: customer.ipType,
            ipAddress: customer.ipAddress ?? undefined,
            macAddress: customer.macAddress ?? undefined,
            routerId: customer.routerId ?? undefined,
            oltId: customer.oltId ?? undefined,
            // The form field is a serial (Phase M): the operator reads it off the
            // device, not out of the database.
            onuSerial: customer.onu?.serialNo ?? undefined,
            ponPort: customer.ponPort ?? undefined,
            connectionDate: customer.connectionDate.toISOString(),
            billingDate: customer.billingDate ? customer.billingDate.toISOString() : undefined,
            expiryDate: customer.expiryDate ? customer.expiryDate.toISOString() : undefined,
            monthlyBill: customer.monthlyBill,
            installationFee: customer.installationFee,
            advancePayment: customer.advancePayment,
            previousDue: customer.previousDue,
            discount: customer.discount,
            vat: customer.vat,
            note: customer.note ?? undefined,
          }}
          isEdit
          action={updateCustomerAction}
        />
      </PageContainer>
    </>
  );
}
