import { prisma } from "@/lib/prisma";

export const SETTING_GROUPS = [
  "General",
  "Billing",
  "Network",
  "Users",
  "API",
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
  /// How long a RADIUS Live log line is kept. An unauthenticated RADIUS port on
  /// the internet generates packets forever, so the table is pruned rather than
  /// left to grow; 7 days is long enough to investigate a disputed session.
  { key: "radius.logRetentionDays", value: "7", group: "Network" },
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
