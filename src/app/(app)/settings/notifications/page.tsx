import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { isChannelConfigured } from "@/lib/services/messaging";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm, type SettingField } from "@/components/settings/settings-form";
import { Card, CardBody } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reminder Settings" };

const FIELDS: SettingField[] = [
  {
    key: "reminder.enabled",
    label: "Send reminders automatically",
    type: "boolean",
    // The wording carries the consequence, not just the state: with this on, the
    // cron job starts contacting customers today, from data already in the
    // system, whether or not anyone asked each of them.
    hint:
      "Off by default. Turning it on makes the scheduled job send expiry and payment " +
      "reminders to every customer it matches, starting the next time it runs.",
  },
  {
    key: "reminder.expiryDays",
    label: "Days before expiry",
    hint:
      "Comma-separated. Each day is a separate reminder, sent once: \"3,1\" means one " +
      "three days before expiry and another the day before, which is what gives a " +
      "customer time to arrange payment before a suspension notice.",
  },
  {
    key: "reminder.dueDays",
    label: "Days after the due date",
    hint:
      "Comma-separated, same reasoning on the other side of the due date. \"1,3,7\" " +
      "chases a bill three times without becoming the thing a customer complains about.",
  },
  {
    key: "reminder.channelOrder",
    label: "Channel order",
    hint:
      "Comma-separated, tried in order and falling through on failure. WhatsApp first " +
      "because it is free and a customer can reply to it; SMS reaches a customer who " +
      "never opens WhatsApp.",
  },
  {
    key: "reminder.quietHours",
    label: "Quiet hours",
    hint:
      "As HH:MM-HH:MM, may wrap midnight. A reminder that falls inside the window is " +
      "queued and sent when it ends rather than waking somebody at 3am about a bill. " +
      "Leave blank to send at any hour.",
  },
];

export default async function ReminderSettingsPage() {
  const settings = await getSettings();

  // Read from the same settings the job reads, so this panel cannot disagree with
  // the behaviour it is describing.
  const channels = await Promise.all(
    (settings["reminder.channelOrder"] ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
      .map(async (c) => ({ channel: c, ok: await isChannelConfigured(c) }))
  );

  return (
    <>
      <PageHeader
        title="Reminder Settings"
        description="Who gets reminded, when, and down which channel. Reminders are sent at most once per customer, invoice and day."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Notifications" }]}
      />
      <PageContainer className="max-w-4xl">
        <SettingsForm
          fields={FIELDS}
          values={settings}
          title="Automatic reminders"
          description="The scheduled job reads these. Changing them takes effect on the next run, and never re-sends a reminder that has already gone out."
        />

        <Card className="mt-4">
          <CardBody>
            <h2 className="mb-1 text-sm font-semibold">Channel readiness</h2>
            <p className="mb-3 text-xs text-fg-muted">
              A reminder is only recorded as sent when a channel actually delivered it. A
              channel that is not configured is tried and skipped, and one that fails falls
              through to the next — so a broken WhatsApp token degrades to SMS instead of
              silently losing the reminder.
            </p>
            <ul className="space-y-1.5">
              {channels.length === 0 ? (
                <li className="text-sm text-fg-muted">
                  No channel is listed in the channel order above.
                </li>
              ) : (
                channels.map(({ channel, ok }) => (
                  <li key={channel} className="flex items-center gap-2 text-sm">
                    {ok ? (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <XCircle className="size-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <span className="font-medium capitalize">{channel}</span>
                    <span className="text-fg-muted">
                      {ok
                        ? "configured and ready"
                        : "not configured in Settings → SMS / API — reminders will fall through to the next channel"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}