import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm, TestButtons, type SettingField } from "@/components/settings/settings-form";
import { testSmsProviderAction } from "@/app/(app)/accounts/actions";
import { isChannelConfigured } from "@/lib/services/messaging";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";

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

const CHANNELS = [
  { channel: "SMS", label: "Test SMS" },
  { channel: "Email", label: "Test email" },
  { channel: "WhatsApp", label: "Test WhatsApp" },
];

export default async function ApiSettingsPage() {
  const settings = await getSettings();
  const status = await Promise.all(
    CHANNELS.map(async (c) => ({ ...c, ready: await isChannelConfigured(c.channel) }))
  );

  return (
    <>
      <PageHeader
        title="SMS & API Integrations"
        description="Provider credentials for messaging and email. Secrets are write-only from the browser."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "SMS / API" }]}
        actions={<TestButtons action={testSmsProviderAction} channels={CHANNELS} />}
      />
      <PageContainer className="max-w-4xl">
        <Card>
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-3">
              {status.map((s) => (
                <li
                  key={s.channel}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                >
                  <span className="text-sm font-medium">{s.channel}</span>
                  <Badge tone={s.ready ? "success" : "warning"}>
                    {s.ready ? "Ready" : "Not configured"}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-fg-muted">
              A channel with no credentials marks new messages as <strong>Pending</strong> rather
              than Sent, so the log never claims a delivery that did not happen. Fill in the
              fields below and save, then run a test.
            </p>
          </CardBody>
        </Card>

        <div className="mt-4">
          <SettingsForm
            fields={FIELDS}
            values={settings}
            title="Provider credentials"
            description="After saving, secret values are masked and can only be replaced, never read back."
          />
        </div>
      </PageContainer>
    </>
  );
}
