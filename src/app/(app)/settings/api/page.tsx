import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm, TestButton, type SettingField } from "@/components/settings/settings-form";
import { testSmsProviderAction } from "@/app/(app)/accounts/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "SMS & API" };

const FIELDS: SettingField[] = [
  { key: "api.smsProvider", label: "SMS Provider", type: "select", options: ["BulkSMSBD", "SSLWireless", "Twilio", "Vonage", "Custom"] },
  { key: "api.smsUrl", label: "SMS API URL" },
  { key: "api.smsApiKey", label: "SMS API Key", type: "password" },
  { key: "api.smsSenderId", label: "Sender ID" },
  { key: "api.emailSmtpHost", label: "SMTP Host" },
  { key: "api.emailSmtpPort", label: "SMTP Port", type: "number" },
  { key: "api.emailSmtpUser", label: "SMTP Username" },
  { key: "api.emailSmtpPass", label: "SMTP Password", type: "password" },
  { key: "api.emailSmtpSecure", label: "Use TLS", type: "boolean" },
  { key: "api.whatsappUrl", label: "WhatsApp API URL" },
  { key: "api.whatsappToken", label: "WhatsApp Token", type: "password" },
];

export default async function ApiSettingsPage() {
  const settings = await getSettings();
  return (
    <>
      <PageHeader
        title="SMS & API Integrations"
        description="Provider credentials for messaging and email. Secrets are write-only from the browser."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "SMS / API" }]}
        actions={<TestButton action={testSmsProviderAction} label="Test connection" />}
      />
      <PageContainer className="max-w-4xl">
        <SettingsForm fields={FIELDS} values={settings} title="Provider credentials" description="After saving, secret values are masked and can only be replaced, never read back." />
      </PageContainer>
    </>
  );
}
