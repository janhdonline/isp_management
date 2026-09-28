import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCustomerFull, getCustomerActivity } from "@/lib/services/customers";
import { prisma } from "@/lib/prisma";
import { getAllPackages } from "@/lib/services/packages";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { CustomerQuickActions } from "@/components/customers/customer-actions";
import { CustomerProfileHeader, CustomerProfileTabs } from "@/components/customers/customer-profile";
import { StatusTriple } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await prisma.customer.findUnique({ where: { id }, select: { name: true, customerCode: true } });
  return { title: c ? `${c.name} (${c.customerCode})` : "Customer" };
}

export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";

  const [customer, packages, activity] = await Promise.all([
    getCustomerFull(id),
    getAllPackages(),
    getCustomerActivity(id, 40),
  ]);

  if (!customer) notFound();

  const outstandingInvoices = customer.invoices.filter((i) => i.status !== "Paid" && i.status !== "Cancelled");
  const profile = toProfile(customer);
  const nextBilling = customer.expiryDate
    ? new Date(customer.expiryDate.getTime() + 30 * 86400000)
    : null;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Customers", href: "/customers" },
          { label: customer.customerCode, href: `/customers?status=${customer.connectionStatus}` },
          { label: customer.name },
        ]}
        title={customer.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{customer.customerCode}</span>
            <span>·</span>
            <span>{customer.phone}</span>
            <span>·</span>
            <span className="font-mono">{customer.username}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusTriple
              connection={customer.connectionStatus}
              online={customer.onlineStatus}
              billing={customer.billingStatus}
            />
          </div>
        }
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CustomerProfileHeader customer={profile} />
          <CustomerQuickActions
            customer={{
              id: customer.id,
              name: customer.name,
              connectionStatus: customer.connectionStatus,
              monthlyBill: customer.monthlyBill,
              previousDue: customer.previousDue,
            }}
            packages={packages.map((p) => ({ id: p.id, name: p.name }))}
          />
        </div>
      </PageHeader>

      <PageContainer>
        <CustomerProfileTabs
          tab={tab}
          customer={profile}
          activity={activity.map((a) => ({
            id: a.id,
            action: a.action,
            summary: a.summary,
            createdAt: a.createdAt,
            actor: a.actor?.name ?? "System",
          }))}
          activityHref="/settings/users?tab=logs"
          metrics={{
            outstandingInvoices: outstandingInvoices.length,
            outstandingAmount: outstandingInvoices.reduce((s, i) => s + (i.total - i.paid), 0),
            nextBilling: nextBilling ? nextBilling.toISOString() : null,
            totalPaid: customer.payments.reduce((s, p) => s + p.amount, 0),
            invoiceCount: customer.invoices.length,
            ticketCount: customer.tickets.length,
          }}
        />
      </PageContainer>
    </>
  );
}

type FullCustomer = NonNullable<Awaited<ReturnType<typeof getCustomerFull>>>;

/** Narrows BigInt columns and trims relations the profile tabs do not render. */
function toProfile(c: FullCustomer) {
  return {
    ...c,
    downloadBytes: Number(c.downloadBytes),
    uploadBytes: Number(c.uploadBytes),
    sessionLogs: c.sessionLogs.map((s) => ({
      id: s.id,
      loginTime: s.loginTime,
      logoutTime: s.logoutTime,
      downloadBytes: Number(s.downloadBytes),
      uploadBytes: Number(s.uploadBytes),
      ipAddress: s.ipAddress,
      macAddress: s.macAddress,
      username: s.username,
    })),
    invoices: c.invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      amount: i.amount,
      discount: i.discount,
      vat: i.vat,
      total: i.total,
      paid: i.paid,
      status: i.status,
      payments: i.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        paymentDate: p.paymentDate,
      })),
    })),
    payments: c.payments.map((p) => ({
      id: p.id,
      paymentId: p.paymentId,
      amount: p.amount,
      method: p.method,
      transactionId: p.transactionId,
      paymentDate: p.paymentDate,
      note: p.note,
      account: p.account,
      collectedBy: p.collectedBy,
      invoice: p.invoice,
      receipt: p.receipt,
    })),
    tickets: c.tickets.map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      problem: t.problem,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      technician: t.technician ? { name: t.technician.name } : null,
    })),
    packageLogs: c.packageLogs.map((p) => ({
      id: p.id,
      reason: p.reason,
      createdAt: p.createdAt,
      fromPkg: p.fromPkg ? { name: p.fromPkg.name } : null,
      toPkg: p.toPkg ? { name: p.toPkg.name } : null,
    })),
    notifications: c.notifications.map((n) => ({
      id: n.id,
      channel: n.channel,
      body: n.body,
      status: n.status,
      createdAt: n.createdAt,
      recipient: n.recipient,
    })),
  };
}
