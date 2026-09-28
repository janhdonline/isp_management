import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEmployeeFull } from "@/lib/services/support";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { EmployeeProfile } from "@/components/support/employee-profile";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const e = await getEmployeeFull(id);
  return { title: e ? `${e.name} (${e.employeeCode})` : "Employee" };
}

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "job";

  const employee = await getEmployeeFull(id);
  if (!employee) notFound();

  return (
    <>
      <PageHeader
        title={employee.name}
        description={`${employee.employeeCode} · ${employee.role}`}
        breadcrumb={[
          { label: "Employees", href: "/employees" },
          { label: employee.name },
        ]}
      />
      <PageContainer>
        <EmployeeProfile
          tab={tab}
          employee={{
            ...employee,
            area: employee.area
              ? { name: employee.area.name, zone: employee.area.zone ? { name: employee.area.zone.name } : null }
              : null,
          }}
        />
      </PageContainer>
    </>
  );
}
