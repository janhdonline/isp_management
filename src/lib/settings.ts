import { prisma } from "@/lib/prisma";

export const SETTING_GROUPS = [
  "General",
  "Billing",
  "Network",
  "Users",
  "API",
  "Notifications",
  "Backup",
] as const;

export type SettingMap = Record<string, string>;

let cache: { map: SettingMap; at: number } | null = null;
const TTL = 15_000;

export async function getSettings(): Promise<SettingMap> {
  if (cache && Date.now() - cache.at < TTL) return cache.map;
  const rows = await prisma.setting.findMany();
  const map: SettingMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = { map, at: Date.now() };
  return map;
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const all = await getSettings();
  return all[key] ?? fallback;
}

export async function saveSettings(entries: { key: string; value: string }[]) {
  await prisma.$transaction(
    entries.map((e) =>
      prisma.setting.upsert({
        where: { key: e.key },
        create: { key: e.key, value: e.value },
        update: { value: e.value },
      })
    )
  );
  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}

export const DEFAULT_SETTINGS: {
  key: string;
  value: string;
  group: (typeof SETTING_GROUPS)[number];
  isSecret?: boolean;
}[] = [
  // General
  { key: "company.name", value: "Easy Network Solution", group: "General" },
  { key: "company.tagline", value: "Internet Provider", group: "General" },
  { key: "company.address", value: "123 Main Road, Dhaka 1200", group: "General" },
  { key: "company.phone", value: "+880 1712 345678", group: "General" },
  { key: "company.email", value: "support@netlink.com.bd", group: "General" },
  { key: "company.website", value: "https://netlink.com.bd", group: "General" },
  { key: "company.currency", value: "৳", group: "General" },
  { key: "company.currencyCode", value: "BDT", group: "General" },
  { key: "general.timezone", value: "Asia/Dhaka", group: "General" },
  { key: "general.dateFormat", value: "dd MMM yyyy", group: "General" },
  { key: "general.language", value: "en", group: "General" },

  // Billing
  { key: "billing.cycle", value: "Monthly", group: "Billing" },
  { key: "billing.gracePeriod", value: "5", group: "Billing" },
  { key: "billing.lateFeeType", value: "percent", group: "Billing" },
  { key: "billing.lateFee", value: "0", group: "Billing" },
  { key: "billing.autoInvoice", value: "true", group: "Billing" },
  { key: "billing.autoSuspend", value: "true", group: "Billing" },
  { key: "billing.autoReconnect", value: "true", group: "Billing" },
  { key: "billing.autoCollect", value: "false", group: "Billing" },
  { key: "billing.gatewayUrl", value: "", group: "Billing" },
  { key: "billing.gatewayKey", value: "", group: "Billing", isSecret: true },
  { key: "app.url", value: "http://localhost:3000", group: "General" },
  { key: "billing.invoicePrefix", value: "INV", group: "Billing" },
  { key: "billing.receiptPrefix", value: "RCP", group: "Billing" },
  { key: "billing.paymentPrefix", value: "PAY", group: "Billing" },
  { key: "billing.customerPrefix", value: "CUS", group: "Billing" },
  { key: "billing.ticketPrefix", value: "TKT", group: "Billing" },
  { key: "billing.defaultTax", value: "0", group: "Billing" },
  { key: "billing.defaultTaxLabel", value: "VAT", group: "Billing" },
  { key: "billing.defaultMethod", value: "Cash", group: "Billing" },
  { key: "billing.expiringDays", value: "3", group: "Billing" },

  // Network
  { key: "network.enforceOnSuspend", value: "true", group: "Network" },
  // off | notify | throttle. Off by default: throttling changes what a paying
  // customer gets, and that should be a decision the ISP makes deliberately
  // after seeing the figures, not one inherited from installing the system.
  { key: "network.fupAction", value: "off", group: "Network" },
  // RADIUS (Phase W). These three are the *server's* configuration: what this
  // process binds and what it verifies packets with. The value a router is told to
  // point at is entered in MikroTik, not here — an ISP with several routers all
  // point at the same server address, and that address is this host's.
  { key: "network.radiusServer", value: "0.0.0.0", group: "Network" },
  { key: "network.radiusPort", value: "1812", group: "Network" },
  { key: "network.radiusSecret", value: "", group: "Network", isSecret: true },
  // Accounting and CoA *listener* ports on this host. IANA-assigned, and not
  // editable in practice: a NAS configured for anything else will not find this
  // server, so a value that looks editable but must not be is worse than none.
  { key: "network.radiusAccountingPort", value: "1813", group: "Network" },
  { key: "network.radiusCoaPort", value: "3799", group: "Network" },
  // The port a *router* listens on for Disconnect-Request. Distinct from the
  // listener above: that is where this server accepts CoA, this is where it
  // sends it. RFC 5176 puts the NAS side on 3799.
  { key: "network.nasCoaPort", value: "3799", group: "Network" },
  /// Corporate clients (Phase J): the response time committed to a corporate or
  /// dedicated account when one is created. Four hours is the usual first offer in
  /// this market — long enough to be honest about a visit, short enough to be
  /// worth paying for.
  { key: "corporate.defaultSlaHours", value: "4", group: "Billing" },

  /// Device-down alerts (Phase I).
  ///
  /// Which channel an outage page goes out on. Telegram first: it is the only one
  /// of the three somebody is likely to answer at 2am.
  { key: "alerts.channel", value: "telegram", group: "Network" },
  /// Comma-separated numbers, for SMS and WhatsApp. Empty means "the channel's own
  /// default recipient" — which for Telegram is `api.telegramChatId`.
  { key: "alerts.recipients", value: "", group: "Network" },
  /// rxPower below this (dBm) counts as low signal. -25 dBm is roughly the point
  /// where an ONU stops holding a stable PON link; below it a customer sees drops
  /// at peak time rather than a clean outage, which is why it needs an alert of its
  /// own rather than falling under "router down".
  { key: "alerts.lowSignalDbm", value: "-25", group: "Network" },
  /// How many consecutive bad syncs before an ONU is called bad. Two, not one: a
  /// single below-threshold reading is usually a momentary dip, and alerting on it
  /// trains the operator to ignore the signal.
  { key: "alerts.lowSignalConsecutive", value: "2", group: "Network" },

  /// How long per-customer daily usage is kept (Phase H). 180 days is comfortably
  /// longer than any FUP cycle and long enough for a customer to dispute a bill
  /// from the previous quarter; past that the rows cost a table scan on every
  /// profile load and cannot be read anyway.
  { key: "usage.retentionDays", value: "180", group: "Network" },

  /// How long a RADIUS Live log line is kept. An unauthenticated RADIUS port on
  /// the internet generates packets forever, so the table is pruned rather than
  /// left to grow; 7 days is long enough to investigate a disputed session.
  { key: "radius.logRetentionDays", value: "7", group: "Network" },
  /// How many sessions one username may have open at once.
  ///
  /// "0" is unlimited. The default is 1 because a PPPoE subscriber with two live
  /// sessions is nearly always credential sharing — one account, two households —
  /// and the FUP allowance is then spent by two people, with the operator
  /// billing one. Set to 0 for a flat-rate product where sharing is not a
  /// concern and a second device being refused is only a support call.
  { key: "radius.simultaneousUse", value: "1", group: "Network" },
  { key: "network.mikrotikApiHost", value: "10.10.0.2", group: "Network" },
  { key: "network.mikrotikApiPort", value: "8728", group: "Network" },
  { key: "network.mikrotikUsername", value: "apiuser", group: "Network" },
  { key: "network.mikrotikPassword", value: "", group: "Network", isSecret: true },
  { key: "network.mikrotikSsl", value: "false", group: "Network" },
  { key: "network.mikrotikSessionSource", value: "ppp", group: "Network" },
  { key: "network.oltVendor", value: "Huawei", group: "Network" },
  { key: "network.oltHost", value: "10.20.0.1", group: "Network" },
  { key: "network.oltPort", value: "8080", group: "Network" },
  { key: "network.oltUsername", value: "admin", group: "Network" },
  { key: "network.oltPassword", value: "", group: "Network", isSecret: true },
  { key: "network.defaultIpPool", value: "100.64.10.2-100.64.10.250", group: "Network" },
  { key: "network.defaultRouter", value: "Core-R1", group: "Network" },
  { key: "network.defaultPackage", value: "", group: "Network" },

  // API
  { key: "api.smsProvider", value: "BulkSMSBD", group: "API" },
  { key: "api.smsUrl", value: "https://api.bulksmsbd.com/smsapi", group: "API" },
  { key: "api.smsApiKey", value: "", group: "API", isSecret: true },
  { key: "api.smsSenderId", value: "NETLINK", group: "API" },
  { key: "api.emailSmtpHost", value: "smtp.gmail.com", group: "API" },
  { key: "api.emailSmtpPort", value: "587", group: "API" },
  { key: "api.emailSmtpUser", value: "", group: "API" },
  { key: "api.emailSmtpPass", value: "", group: "API", isSecret: true },
  { key: "api.emailSmtpSecure", value: "true", group: "API" },
  { key: "api.whatsappUrl", value: "", group: "API" }, // WhatsApp phone number id
  { key: "api.sslcommerzStoreId", value: "", group: "API" },
  { key: "api.sslcommerzStorePassword", value: "", group: "API", isSecret: true },
  { key: "api.sslcommerzSandbox", value: "true", group: "API" },
  { key: "api.whatsappToken", value: "", group: "API", isSecret: true },
  // Telegram, for alerts that have to reach somebody at 2am (Phase I). The chat
  // id is not a secret; the bot token is.
  { key: "api.telegramToken", value: "", group: "API", isSecret: true },
  { key: "api.telegramChatId", value: "", group: "API" },

  // Automatic payment reminders (Phase F)
  //
  // The day lists are comma-separated because the *day* is part of the reminder's
  // identity: "3,1" means a reminder 3 days before expiry and another 1 day
  // before, and each is sent at most once. An expiry reminder further out gives
  // the customer time to arrange payment before a suspension notice, which is
  // cheaper for both sides than restoring a cut line.
  { key: "reminder.expiryDays", value: "3,1", group: "Notifications" },
  // Days *after* the due date, same reasoning on the other side of it.
  { key: "reminder.dueDays", value: "1,3,7", group: "Notifications" },
  // WhatsApp first because it is free and reads better than a text message;
  // SMS is the fallback, and a customer with no WhatsApp still gets reached.
  { key: "reminder.channelOrder", value: "whatsapp,sms", group: "Notifications" },
  // 22:00-07:00 is the window a Bangladeshi household is asleep and will not
  // answer a phone about a bill. Wraps midnight, so it is not a simple range
  // comparison.
  { key: "reminder.quietHours", value: "22:00-07:00", group: "Notifications" },
  // Off by default: a reminder list that starts working the moment an ISP
  // upgrades, sending to customers who never agreed to it, is not a default
  // anybody should inherit. Turning it on is one click in Settings.
  { key: "reminder.enabled", value: "false", group: "Notifications" },

  // Backup
  { key: "backup.schedule", value: "Daily", group: "Backup" },
  { key: "backup.time", value: "02:00", group: "Backup" },
  { key: "backup.retention", value: "7", group: "Backup" },
];

export const SECRET_KEYS = DEFAULT_SETTINGS.filter((s) => s.isSecret).map((s) => s.key);

export async function isSecretKey(key: string) {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.isSecret ?? SECRET_KEYS.includes(key);
}

export function maskSecret(value: string) {
  if (!value) return "••••••••";
  return "•".repeat(Math.min(12, Math.max(8, value.length)));
}
