import type { Metadata } from "next";
import { getAreasSimple } from "@/lib/services/areas";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmployeeForm } from "@/components/support/forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Employee" };

export default async function NewEmployeePage() {
  const areas = await getAreasSimple();
  return (
    <>
      <PageHeader
        title="New Employee"
        description="Add a staff member. The role decides whether they appear in the support dispatch list."
        breadcrumb={[{ label: "Employees", href: "/employees" }, { label: "New" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <EmployeeForm areas={areas.map((a) => ({ id: a.id, name: a.name }))} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
