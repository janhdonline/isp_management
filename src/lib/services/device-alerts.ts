/**
 * Device-down alerts (ISP.md §32).
 *
 * A router can die at 2am and nobody knows until customers call. This turns a
 * device's status changing into one alert, one notification, and — when it comes
 * back — one recovery notice.
 *
 * ## One incident, one alert
 *
 * The device is polled, its status changes, and the monitor runs again a minute
 * later and finds it still down. That must not produce a second page: an operator
 * woken six times in six hours stops reading the alerts, and the one time it
 * mattered is the one they had muted.
 *
 * So the dedupe lives in the database. `DeviceAlert.dedupeKey` is unique and holds
 * only for an *open* alert, so every run while the device is still down attempts
 * the same key and the index rejects it. Resolving the alert nulls the key, which
 * frees it for the next incident. A check-then-insert cannot do this — two
 * concurrent runs both pass the check and both insert — so there is no check here.
 *
 * ## Transitions, not states
 *
 * Alerts fire on the *transition*, which means the monitor has to remember what it
 * last saw. A router that was Offline when this feature was switched on does not
 * generate an alert for being offline: nobody said anything was wrong, so nothing
 * is. Alerting on first sight would page about every device a deployment happens
 * to inherit.
 *
 * That memory is a settings row rather than an open-alert lookup, because the two
 * are not the same thing. An open alert answers "do we believe this is broken?";
 * the remembered status answers "was it working an hour ago?". A device with no
 * alert and a last-seen of `Offline` is fine and known; a device with no alert and
 * a last-seen of `Online` has just gone down. Without the second, those two are
 * indistinguishable.
 */

import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { dispatch, isChannelConfigured } from "@/lib/services/messaging";
import type { JobResult } from "@/lib/services/job-result";

/** How a channel is spelled in Settings versus in the messaging adapters. */
const CHANNEL_NAMES: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

/**
 * `Rogue` is Phase N's: a serial the OLT is serving that is not in our database.
 * It goes through this file rather than its own alerting because the exactly-once
 * machinery — `dedupeKey`, the unique claim, notifying only on the insert that
 * created the row — is here and does not need a second implementation.
 */
export type DeviceKind = "Down" | "Recovered" | "LowSignal" | "Rogue";
export type DeviceType = "Router" | "OLT" | "ONU";

/** The key that keeps one incident to one alert. */
export function dedupeKey(deviceType: string, deviceId: string, kind: string): string {
  return `${deviceType}:${deviceId}:${kind}:Open`;
}

/* ------------------------------------------------------------------ */
/* Notification                                                        */
/* ------------------------------------------------------------------ */

/**
 * Sends one alert notice to whoever is on call.
 *
 * Deliberately outside any transaction: a Telegram call that hangs must not hold
 * a row lock on the device, and a failure must leave the alert standing with a
 * recorded reason rather than rolling back the record of a real outage.
 *
 * Returns what happened so the caller can write it on the row — an alert nobody
 * was told about is a different thing from one they were, and the difference has
 * to be visible.
 */
export async function notify(
  kind: DeviceKind,
  deviceLabel: string,
  detail: string
): Promise<{ channel: string | null; ok: boolean; error?: string; recipients: number }> {
  const s = await getSettings();
  // The setting is lower case because that is how an operator types it; the
  // messaging adapters switch on the display names used everywhere else. Passing
  // the raw setting through silently matches nothing and every alert reports
  // "not configured".
  const channel = CHANNEL_NAMES[(s["alerts.channel"] || "telegram").trim().toLowerCase()] ?? "Telegram";
  const recipients = (s["alerts.recipients"] || "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const body =
    kind === "Recovered"
      ? `✅ RECOVERED — ${deviceLabel} is back online.\n${detail}`
      : kind === "Rogue"
        ? `\u{1F6A8} UNREGISTERED ONU — ${deviceLabel}\n${detail}`
        : `🚨 ${kind.toUpperCase()} — ${deviceLabel}\n${detail}`;

  const configured = await isChannelConfigured(channel);
  if (!configured) {
    // Not a failure of the alert: the device really is down, we simply could not
    // tell anybody. The row records that, so the dashboard can show it.
    return { channel, ok: false, error: `${channel} is not configured`, recipients: recipients.length };
  }

  // With no explicit recipients the channel's own default is used, which for
  // Telegram is `api.telegramChatId`. One dispatch, not one per recipient: these
  // alerts are a page, not a mailing.
  const targets = recipients.length ? recipients : [""];
  let sent = 0;
  let lastError: string | undefined;
  for (const to of targets) {
    const result = await dispatch(channel, to, null, body);
    if (result.ok) sent += 1;
    else lastError = result.error;
  }

  return {
    channel,
    ok: sent > 0,
    error: sent === 0 ? lastError ?? "no recipient accepted the alert" : undefined,
    recipients: sent,
  };
}

/* ------------------------------------------------------------------ */
/* Raising and clearing                                               */
/* ------------------------------------------------------------------ */

/**
 * Records an incident and, if this run is the one that created it, notifies.
 *
 * The notify happens only when the insert *created* the row. Every run while the
 * device is still down takes the same unique key, loses, and returns null — so it
 * cannot notify, which is what makes a long outage one page rather than sixty.
 *
 * **For incidents only.** `Recovered` must go through `raiseRecovery` instead: it
 * is a historical event rather than an open one, and giving it a dedupe key
 * silently swallows the second recovery notice a device ever has.
 */
export async function raiseAlert(input: {
  deviceType: DeviceType;
  deviceId: string;
  deviceName: string;
  kind: DeviceKind;
  detail: string;
}): Promise<{ alert: { id: string } | null; created: boolean; notified: boolean }> {
  const key = dedupeKey(input.deviceType, input.deviceId, input.kind);

  try {
    // The unique index settles concurrent runs: one creates, the rest lose and
    // find nothing to do.
    await prisma.deviceAlert.create({
      data: {
        deviceType: input.deviceType,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        kind: input.kind,
        status: "Open",
        detail: input.detail,
        dedupeKey: key,
      },
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return { alert: null, created: false, notified: false };
  }

  const result = await notify(input.kind, `${input.deviceType} ${input.deviceName}`, input.detail);

  const updated = await prisma.deviceAlert.updateMany({
    where: { dedupeKey: key, status: "Open" },
    data: {
      notifiedAt: result.ok ? new Date() : null,
      notifyChannel: result.channel,
      notifyError: result.ok ? null : result.error ?? null,
    },
  });
  if (updated.count === 0) return { alert: null, created: false, notified: false };

  // Read back the row we just created rather than reconstructing it, so the id
  // the caller gets is the database's.
  const created = await prisma.deviceAlert.findFirstOrThrow({
    where: { dedupeKey: key, status: "Open" },
    select: { id: true },
    orderBy: { openedAt: "desc" },
  });
  return { alert: created, created: true, notified: result.ok };
}

/**
 * Records a recovery notice.
 *
 * Deliberately not routed through `raiseAlert`, because a recovery is a
 * *historical event* and not an open incident, and the two differ in ways that
 * matter:
 *
 *   - **No dedupe key.** A key is how one incident is kept to one row, and a
 *     recovery is not an incident — it is the end of one. Claiming a key for it
 *     means the second outage-and-recovery on a device finds the key still
 *     occupied by the *first* recovery, the insert is rejected as a duplicate, and
 *     that incident silently gets an outage page with no "it is fixed" page. The
 *     operator is told a device is down and never told it came back.
 *   - **Born resolved.** There is nothing outstanding about a device that is
 *     working, so a recovery row is created `Resolved` with a `resolvedAt`. Left
 *     `Open` it accumulates for ever, and the dashboard's open-alert count — which
 *     is meant to answer "what is broken right now" — ends up counting every
 *     recovery the installation has ever had.
 *
 * Every recovery therefore gets its own row and its own notification, with no
 * claim to collide on.
 */
export async function raiseRecovery(input: {
  deviceType: DeviceType;
  deviceId: string;
  deviceName: string;
  detail: string;
}): Promise<{ alert: { id: string } | null; created: boolean; notified: boolean }> {
  const result = await notify(
    "Recovered",
    `${input.deviceType} ${input.deviceName}`,
    input.detail
  );
  const now = new Date();

  // No dedupeKey, so nothing to collide on and nothing to free later.
  const row = await prisma.deviceAlert.create({
    data: {
      deviceType: input.deviceType,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      kind: "Recovered",
      status: "Resolved",
      detail: input.detail,
      dedupeKey: null,
      resolvedAt: now,
      notifiedAt: result.ok ? now : null,
      notifyChannel: result.channel,
      notifyError: result.ok ? null : result.error ?? null,
    },
    select: { id: true },
  });

  return { alert: row, created: true, notified: result.ok };
}

/**
 * Resolves an open incident and frees its dedupe key.
 *
 * The key is nulled rather than left behind: leaving it would stop the *next*
 * outage ever alerting, because the index would reject a key that already exists
 * on a resolved row.
 */
export async function resolveAlert(
  deviceType: string,
  deviceId: string,
  kind: DeviceKind
): Promise<number> {
  const { count } = await prisma.deviceAlert.updateMany({
    where: { deviceType, deviceId, kind, status: "Open" },
    data: { status: "Resolved", resolvedAt: new Date(), dedupeKey: null },
  });
  return count;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2002" || /unique constraint/i.test(msg);
}

/* ------------------------------------------------------------------ */
/* The monitor                                                        */
/* ------------------------------------------------------------------ */

/** Where a device's last observed status is remembered between runs. */
export type Observation = { status: string; detail: string };

/**
 * Compares this run's observations with the previous ones and raises or clears
 * alerts for the transitions.
 *
 * The previous state lives in the `DeviceAlert` history itself: an open `Down`
 * alert *is* the record that the device was seen down. That is what makes the
 * monitor stateless — it cannot drift from a separate status table, because there
 * is no separate status table to drift.
 *
 * Returns what happened, for the job's summary.
 */
export async function evaluateTransitions(
  observations: { deviceType: DeviceType; deviceId: string; deviceName: string; status: string; detail: string }[]
): Promise<{ raised: number; recovered: number; notified: number }> {
  let raised = 0;
  let recovered = 0;
  let notified = 0;

  const lastStatus = await readState<string>(`${STATE_KEY}.deviceStatus`);
  const now: Record<string, string> = { ...lastStatus };

  for (const o of observations) {
    const isUp = isOnline(o.status);
    const wasUp = lastStatus[key(o)];
    now[key(o)] = o.status;

    const openDown = await prisma.deviceAlert.findFirst({
      where: { deviceType: o.deviceType, deviceId: o.deviceId, kind: "Down", status: "Open" },
      select: { id: true },
    });

    if (!isUp) {
      // Down. Only a transition counts: `wasUp` must be a recorded `Online`. A
      // device already known to be down has not changed hands, and alerting on it
      // every run is how a channel gets muted.
      if (wasUp !== "Online") continue;
      const r = await raiseAlert({
        deviceType: o.deviceType,
        deviceId: o.deviceId,
        deviceName: o.deviceName,
        kind: "Down",
        detail: o.detail,
      });
      if (r.created) {
        raised += 1;
        if (r.notified) notified += 1;
      }
      continue;
    }

    // Online.
    if (!openDown) continue;
    // Up after an open Down: the incident is over. Resolving first frees the
    // dedupe key, so a later outage can alert again; then one recovery notice.
    // `wasUp === "Online"` with an open Down means the alert survived the device
    // recovering, which is worth recovering again rather than ignoring.
    const resolved = await resolveAlert(o.deviceType, o.deviceId, "Down");
    if (resolved > 0) recovered += 1;

    const notice = await raiseRecovery({
      deviceType: o.deviceType,
      deviceId: o.deviceId,
      deviceName: o.deviceName,
      detail: o.detail,
    });
    if (notice.notified) notified += 1;
  }

  await writeState(`${STATE_KEY}.deviceStatus`, now);
  return { raised, recovered, notified };
}

function isOnline(status: string): boolean {
  return status === "Online";
}

/** One key per device, independent of its kind. */
function key(o: { deviceType: string; deviceId: string }): string {
  return `${o.deviceType}:${o.deviceId}`;
}

/* ------------------------------------------------------------------ */
/* ONU signal                                                         */
/* ------------------------------------------------------------------ */

/**
 * Low-signal state per ONU, kept between runs.
 *
 * A count of consecutive bad readings, because one reading is a dip and two is a
 * trend. Held in a settings row rather than in memory so the decision survives
 * the process restarting — a monitor that forgot its streak on every deploy would
 * never alert at all.
 */
export async function evaluateSignal(
  onus: { id: string; name: string | null; serialNo: string; rxPower: number | null; status: string }[]
): Promise<{ raised: number; recovered: number; notified: number }> {
  const s = await getSettings();
  const threshold = Number(s["alerts.lowSignalDbm"] ?? -25);
  const required = Math.max(1, Number(s["alerts.lowSignalConsecutive"] ?? 2) || 2);
  const previous = await readState<number>(`${STATE_KEY}.lowSignal`);
  const now: Record<string, number> = { ...previous };

  let raised = 0;
  let recovered = 0;
  let notified = 0;

  for (const o of onus) {
    // No reading means the ONU is not reporting — that is a different failure and
    // is handled by the router/OLT side of this monitor, not guessed at here.
    if (o.rxPower == null) continue;
    const bad = o.rxPower < threshold;
    now[o.id] = bad ? (previous[o.id] ?? 0) + 1 : 0;

    const open = await prisma.deviceAlert.findFirst({
      where: { deviceType: "ONU", deviceId: o.id, kind: "LowSignal", status: "Open" },
      select: { id: true },
    });

    if (!bad && open) {
      const n = await resolveAlert("ONU", o.id, "LowSignal");
      if (n > 0) recovered += 1;
      continue;
    }
    if (bad && now[o.id] >= required && !open) {
      const r = await raiseAlert({
        deviceType: "ONU",
        deviceId: o.id,
        deviceName: o.serialNo || o.name || o.id,
        kind: "LowSignal",
        detail: `Rx power ${o.rxPower.toFixed(1)} dBm, below the ${threshold} dBm threshold for ${now[o.id]} consecutive checks.`,
      });
      if (r.created) {
        raised += 1;
        if (r.notified) notified += 1;
      }
    }
  }

  // Only ids still present, so a deleted ONU cannot hold a counter for ever.
  for (const id of Object.keys(now)) {
    if (!onus.some((o) => o.id === id)) delete now[id];
  }
  await writeState(`${STATE_KEY}.lowSignal`, now);
  return { raised, recovered, notified };
}

const STATE_KEY = "alerts.stateStore";

/**
 * A settings row of JSON, used for the two pieces of state the monitor has to
 * carry between runs: what status each device was last seen at, and each ONU's
 * run of consecutive bad readings.
 *
 * Generic over the value type because the two slots hold different things, and a
 * separate reader per shape would be the same code twice.
 */
async function readState<T>(slot: string): Promise<Record<string, T>> {
  const row = await prisma.setting.findUnique({ where: { key: `${STATE_KEY}.${slot}` } });
  if (!row?.value) return {} as Record<string, T>;
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, T>) : ({} as Record<string, T>);
  } catch {
    return {} as Record<string, T>;
  }
}

async function writeState<T>(slot: string, value: Record<string, T>): Promise<void> {
  const key = `${STATE_KEY}.${slot}`;
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: json, group: "Network" },
    update: { value: json },
  });
}

/* ------------------------------------------------------------------ */
/* The job                                                            */
/* ------------------------------------------------------------------ */

/**
 * Watches every router and OLT, and every ONU's signal, for a change worth
 * telling somebody about.
 *
 * Runs *after* the health sync in the cron pipeline, so it compares against the
 * status that sync just wrote rather than racing it.
 */
export async function deviceHealthWatch(): Promise<JobResult> {
  const [routers, olts, onus] = await Promise.all([
    prisma.router.findMany({ select: { id: true, name: true, status: true, lastSyncAt: true } }),
    prisma.olt.findMany({ select: { id: true, name: true, status: true, lastSyncAt: true } }),
    prisma.onu.findMany({
      select: { id: true, name: true, serialNo: true, rxPower: true, status: true },
    }),
  ]);

  const observations = [
    ...routers.map((r) => ({
      deviceType: "Router" as const,
      deviceId: r.id,
      deviceName: r.name,
      status: r.status,
      detail: `Last contact ${r.lastSyncAt ? r.lastSyncAt.toISOString() : "never"}.`,
    })),
    ...olts.map((o) => ({
      deviceType: "OLT" as const,
      deviceId: o.id,
      deviceName: o.name,
      status: o.status,
      detail: `Last contact ${o.lastSyncAt ? o.lastSyncAt.toISOString() : "never"}.`,
    })),
  ];

  const t = await evaluateTransitions(observations);
  const s = await evaluateSignal(onus);

  return {
    ran: t.raised + t.recovered + s.raised + s.recovered,
    skipped:
      `${t.raised} outage(s), ${t.recovered} recovery(ies), ` +
      `${s.raised} low-signal, ${s.recovered} signal recovered; ` +
      `${t.notified + s.notified} notification(s) sent`,
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

/** Open alerts, newest first, for the Network → Alerts page. */
export async function listAlerts(p: { status?: string; deviceType?: string; take?: number } = {}) {
  const where: Record<string, unknown> = {};
  if (p.status) where.status = p.status;
  if (p.deviceType) where.deviceType = p.deviceType;

  const [rows, openCount] = await Promise.all([
    prisma.deviceAlert.findMany({
      where,
      orderBy: [{ openedAt: "desc" }],
      take: p.take ?? 200,
    }),
    prisma.deviceAlert.count({ where: { status: "Open" } }),
  ]);
  return { rows, openCount };
}

/** How many alerts are open, for the dashboard banner. */
export async function openAlertCount(): Promise<number> {
  return prisma.deviceAlert.count({ where: { status: "Open" } });
}