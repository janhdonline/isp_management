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

/**
 * The settings a browser is allowed to see.
 *
 * `getSettings()` returns every value in plaintext, and the settings pages used to
 * hand the whole map to a `"use client"` form. The password inputs rendered empty,
 * which looked like masking and was not: the plaintext was still in the RSC flight
 * payload, readable in React DevTools or by anyone who pastes the payload into a
 * decoder. That was true of every secret in the system — the RADIUS secret, the
 * MikroTik password, the payment gateway key — before Phase N added the SNMP
 * community to the list, and adding a secret to a known leak is not something to
 * do quietly.
 *
 * So this is the function the UI calls. A secret's value is replaced by
 * {@link maskSecret}, which preserves only *whether* one is set — the settings form
 * needs exactly that much to render "Saved. Leave blank to keep the current value."
 */
export function redactSecrets(all: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(all)) {
    safe[key] = SECRET_KEYS.includes(key) && value ? maskSecret(value) : value;
  }
  return safe;
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

  /// Phase R. Whether a mid-cycle package change settles the difference for the
  /// part of the month already served.
  ///
  /// On by default, because a customer who upgrades on the 20th and is billed for
  /// the whole month has been overcharged by ten days' difference, and one who
  /// downgrades has been undercharged. Turning it off restores the old swap-only
  /// behaviour, which is occasionally the policy an ISP actually wants: some bill
  /// on the package held at the start of the month and treat a mid-month change as
  /// effective next cycle. That is a choice, not an oversight, so both are here.
  { key: "billing.prorateOnPackageChange", value: "true", group: "Billing" },
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

  /// Fiber fault localization (Phase L).
  ///
  /// ON, because it only ever acts on a transition — a device that was already
  /// dark when the job was deployed raises nothing. Off is a choice an operator
  /// makes when they would rather dispatch by hand.
  { key: "faults.enabled", value: "true", group: "Network" },
  /// How many ONUs must drop on one PON port before it counts as a fiber cut
  /// rather than a handful of customers with their own problems. Five: a PON
  /// port carries far more than that, so five simultaneous drops is a common
  /// event upstream of it rather than five coincidences.
  { key: "faults.onuClusterThreshold", value: "5", group: "Network" },
  /// The window those drops have to fall inside. Ten minutes is about as long as
  /// it takes to walk to a nearby splice enclosure, which is the point: a burst
  /// inside one window is one incident, the same number spread over two hours is
  /// three coincidences and three separate visits.
  { key: "faults.onuClusterWindowMinutes", value: "10", group: "Network" },
  /// Off: the customers were told a team was dispatched, and "you are back" is a
  /// third message to somebody who has just had a bad hour.
  { key: "faults.notifyRecovery", value: "false", group: "Network" },

  /// Zero-touch ONU provisioning (Phase M).
  ///
  /// Off until an operator turns it on. The endpoint is the only unauthenticated-
  /// by-session route in the app that *creates* rows, so it should never be armed
  /// by accident: an unconfigured device can then appear in the database on its
  /// own. When it is off, an Inform is refused rather than ignored — a device
  /// being told "try later" retries, whereas one told nothing waits forever.
  { key: "tr069.enabled", value: "false", group: "Network" },
  /// Shared secret between this ACS and the devices. Empty means the endpoint is
  /// disabled outright. Keep it out of the database with ACS_SECRET if the
  /// Settings table is editable by anyone who should not have it.
  { key: "tr069.acsSecret", value: "", group: "Network", isSecret: true },
  /// Where the device management API lives. Vendor ACS bridges differ per
  /// deployment, so this is configuration and not a hardcoded host. Empty means
  /// the simulated adapter is used, which is labelled as simulated everywhere it
  /// appears.
  { key: "tr069.deviceApiUrl", value: "", group: "Network" },
  { key: "tr069.vlanId", value: "100", group: "Network" },
  /// `{username}` is the only token. The result is capped at 32 bytes, which is
  /// the SSID limit — a device silently truncating a longer name leaves the
  /// customer hunting for a network that is not there under the name they were
  /// given.
  { key: "tr069.wifiSsidPattern", value: "isp-{username}", group: "Network" },
  /// `pppoe` — the WiFi key equals the PPPoE password, so the customer has one
  /// credential rather than two. `derived` — an HMAC of the ACS secret keyed on
  /// the serial: recomputable by support on the phone, storable nowhere.
  /// There is no `random`, because a random key would have to be stored to be
  /// read back to the customer, and nothing in this module stores a secret.
  { key: "tr069.wifiPasswordPolicy", value: "pppoe", group: "Network" },
  { key: "tr069.provisionTimeoutSec", value: "20", group: "Network" },

  /// Phase O. How many ONUs one PON port carries, for cabinets that have not set
  /// their own.
  ///
  /// 64, because that is the GPON split ratio and what a Huawei or VSOL cabinet
  /// does out of the box. A cabinet that has been reconfigured down says so on its
  /// own row (`Olt.splitRatio`), which takes precedence — and getting that wrong is
  /// how a 1:64 port quietly passes 32 ONUs and starts dropping the far ones.
  { key: "pon.defaultSplitRatio", value: "64", group: "Network" },
  /// A port at this percentage or above is flagged before it is full. 90%, because
  /// 100% is when customers notice, and the point of the warning is to act at the
  /// stage where acting is still cheap.
  { key: "pon.nearCapacityPercent", value: "90", group: "Network" },

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
  /// Phase N. The SNMP read community used to poll OLTs.
  ///
  /// A secret because anyone holding it can read the subscriber list, the
  /// configured SSIDs and every ONU serial on the OLT — and from there, usually,
  /// a way to write to it. Kept out of the Olt row on purpose: the row records
  /// only *that* a community is configured (`snmpCommunityEnc`), exactly as
  /// `Router.apiSecretEnc` does, so no code path can select it and put it in a log.
  { key: "network.snmpCommunity", value: "", group: "Network", isSecret: true },
  /// Per-vendor overrides, for the common case of one community per supplier.
  { key: "network.snmpCommunity.huawei", value: "", group: "Network", isSecret: true },
  { key: "network.snmpCommunity.bdcom", value: "", group: "Network", isSecret: true },
  { key: "network.snmpCommunity.vsol", value: "", group: "Network", isSecret: true },
  /// The OID map per vendor, as JSON. See `src/lib/olt/oid-maps.ts` for the shape
  /// and for why these are configuration and not code.
  { key: "network.olt.oidMap.huawei", value: "", group: "Network" },
  { key: "network.olt.oidMap.bdcom", value: "", group: "Network" },
  { key: "network.olt.oidMap.vsol", value: "", group: "Network" },
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
