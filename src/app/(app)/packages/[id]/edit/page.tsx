import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PackageForm } from "@/components/packages/package-form";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit Package" };

export default async function EditPackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pkg = await prisma.package.findUnique({ where: { id } });
  if (!pkg) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${pkg.name}`}
        description="Price changes apply to new invoices only; existing invoices keep their original amount."
        breadcrumb={[
          { label: "Packages", href: "/packages" },
          { label: pkg.name, href: `/packages/${pkg.id}` },
          { label: "Edit" },
        ]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <PackageForm
              defaults={{
                name: pkg.name,
                downloadSpeed: pkg.downloadSpeed,
                uploadSpeed: pkg.uploadSpeed,
                monthlyPrice: pkg.monthlyPrice,
                installationFee: pkg.installationFee,
                validityDays: pkg.validityDays,
                billingCycle: pkg.billingCycle,
                fupLimit: pkg.fupLimit,
                mikrotikProfile: pkg.mikrotikProfile,
                description: pkg.description ?? undefined,
                status: pkg.status,
              }}
              isEdit
            />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
