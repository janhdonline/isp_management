import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm, type SettingField } from "@/components/settings/settings-form";
import { BILLING_CYCLES, PAYMENT_METHODS } from "@/lib/enums";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing Settings" };

const FIELDS: SettingField[] = [
  { key: "billing.cycle", label: "Default Billing Cycle", type: "select", options: [...BILLING_CYCLES] },
  { key: "billing.gracePeriod", label: "Grace Period (days)", type: "number", hint: "Days after expiry before auto suspension" },
  { key: "billing.lateFeeType", label: "Late Fee Type", type: "select", options: ["percent", "fixed"] },
  { key: "billing.lateFee", label: "Late Fee", type: "number" },
  { key: "billing.expiringDays", label: "Expiring Alert Window (days)", type: "number", hint: "Customers are flagged this many days before expiry" },
  { key: "billing.defaultTax", label: "Default Tax (%)", type: "number" },
  { key: "billing.defaultTaxLabel", label: "Tax Label", hint: "e.g. VAT, GST" },
  { key: "billing.defaultMethod", label: "Default Payment Method", type: "select", options: [...PAYMENT_METHODS] },
  { key: "billing.autoInvoice", label: "Generate invoice automatically on renewal", type: "boolean" },
  { key: "billing.autoSuspend", label: "Auto suspend when past grace period", type: "boolean" },
  { key: "billing.invoicePrefix", label: "Invoice Prefix" },
  { key: "billing.receiptPrefix", label: "Receipt Prefix" },
  { key: "billing.paymentPrefix", label: "Payment Prefix" },
  { key: "billing.customerPrefix", label: "Customer ID Prefix" },
  { key: "billing.ticketPrefix", label: "Ticket Prefix" },
];

export default async function BillingSettingsPage() {
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="Billing Settings"
        description="Numbering, tax, grace period and the rules that drive the billing engine."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Billing" }]}
      />
      <PageContainer className="max-w-4xl">
        <SettingsForm fields={FIELDS} values={settings} title="Billing rules" description="Changes affect new invoices only; existing invoices keep their original values." />
      </PageContainer>
    </>
  );
}
