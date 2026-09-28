import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm, type SettingField } from "@/components/settings/settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "General Settings" };

const FIELDS: SettingField[] = [
  { key: "company.name", label: "Company Name", required: true },
  { key: "company.tagline", label: "Tagline" },
  { key: "company.address", label: "Address", type: "textarea" },
  { key: "company.phone", label: "Phone" },
  { key: "company.email", label: "Email" },
  { key: "company.website", label: "Website" },
  { key: "company.currency", label: "Currency Symbol", hint: "Used on every amount in the UI" },
  { key: "company.currencyCode", label: "Currency Code", hint: "e.g. BDT, USD, INR" },
  { key: "general.timezone", label: "Timezone", type: "select", options: ["Asia/Dhaka", "Asia/Kolkata", "Asia/Karachi", "UTC", "Europe/London"] },
  { key: "general.dateFormat", label: "Date Format", type: "select", options: ["dd MMM yyyy", "yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy"] },
  { key: "general.language", label: "Language", type: "select", options: ["en"] },
];

export default async function GeneralSettingsPage() {
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="General Settings"
        description="Company identity, currency, locale and formatting used across the whole system."
        breadcrumb={[{ label: "Settings", href: "/settings" }]}
      />
      <PageContainer className="max-w-4xl">
        <SettingsForm fields={FIELDS} values={settings} title="Company & locale" description="These values appear on invoices, receipts and SMS messages." />
      </PageContainer>
    </>
  );
}
