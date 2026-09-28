import type { Metadata } from "next";
import { PackageForm } from "@/components/packages/package-form";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Add Package" };

export default function NewPackagePage() {
  return (
    <>
      <PageHeader
        title="Add Package"
        description="Define a new speed tier. Price and installation fee flow straight into the customer form."
        breadcrumb={[{ label: "Packages", href: "/packages" }, { label: "Add Package" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <PackageForm defaults={{ billingCycle: "Monthly", validityDays: 30, status: "Active", installationFee: 0 }} isEdit={false} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
