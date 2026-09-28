import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ExpenseForm } from "@/components/accounts/accounts-views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Expense" };

export default async function NewExpensePage() {
  const accounts = await prisma.account.findMany({
    where: { status: "Active" },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="New Expense"
        description="Recording an expense posts a matching debit on the selected account."
        breadcrumb={[{ label: "Expenses", href: "/expenses" }, { label: "New Expense" }]}
      />
      <PageContainer className="max-w-3xl">
        <Card>
          <CardBody>
            <ExpenseForm accounts={accounts} />
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
