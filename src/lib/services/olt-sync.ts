/**
 * Polls OLTs over SNMP and folds what they say into the local tables (ISP.md §37).
 *
 * ## The rule that shapes everything: an unreachable OLT is not an empty one
 *
 * `syncRouters` already established the principle for routers: a device we cannot
 * reach leaves its customers as "last seen", not flipped to Offline. Treating
 * unreachable as empty would tell an ISP its entire subscriber base is offline the
 * moment a link drops — and, worse, would feed Phase L's fault localization, which
 * takes an offline OLT as a trigger and opens a bulk ticket with an SMS batch to
 * every customer behind it.
 *
 * So an unreachable cabinet is recorded as **`Unknown`** with the reason on
 * `lastError`, and its ONUs are not touched at all. Not one row. A sync that
 * cannot ask a question must not answer it.
 *
 * ## What a sync may write, and what it may never write
 *
 * The sync owns four fields, because they are the four the OLT is the authority
 * on:
 *
 *   `rxPower` · `txPower` · `status` · `ponIndex` · `lastSeenAt`
 *
 * It owns **nothing else**. `serialNo` is the join key and `serialNo` is never
 * rewritten. `vendor`, `model`, `name` and the `Customer.onuId` link are not the
 * OLT's to set: a Phase M ONU checked in over TR-069 with a real vendor and model,
 * and a sync that let the cabinet restate them would slowly replace what somebody
 * verified with whatever the firmware claims. The customer link especially — a
 * row whose `serialNo` matches but whose customer is set must keep that customer,
 * or a reconnect would silently detach a subscriber from their own account.
 *
 * The rule is enforced by the upsert below, whose `update` branch lists the five
 * fields and nothing else, and by a test that asserts the others survive.
 *
 * ## A serial we do not recognise is not an ONU, it is a problem
 *
 * **The sync never creates an `Onu` row.** An earlier draft of this file did, and
 * the count of created rows came back zero every time for a reason that took a
 * moment to see: every serial it did not recognise went to the rogue path instead.
 *
 * Those two behaviours cannot coexist. Auto-creating would mean nothing is ever
 * rogue — the detection would be unreachable — and it would be the wrong answer
 * anyway. Somebody has plugged in their own equipment, and auto-registering it would
 * put unmanaged hardware into the fault-localization path, the Phase L fiber map and
 * every device count, with no customer behind it, no PPPoE secret and nobody to
 * answer for it. A silent row is far worse than an alert.
 *
 * So an unknown serial is recorded in `RogueOnu`, alerted exactly once, shown on the
 * dashboard, and left there until a person decides. Bringing it into service is a
 * deliberate act: link it to a customer, and the next sync adopts it — at which
 * point it is an ordinary ONU with signal levels like any other.
 */

import { prisma } from "@/lib/prisma";
import { prismaLog } from "@/lib/services/activity";
import { raiseAlert } from "@/lib/services/device-alerts";
import type { JobResult } from "@/lib/services/job-result";
import { oltAdapterFor } from "@/lib/olt";
import type { OltAdapter, OltRow, OnuReading } from "@/lib/olt/adapter";

/** `rogue:{oltId}:{serialNo}` — the claim that makes an alert exactly-once. */
export function rogueKey(oltId: string, serialNo: string): string {
  return `rogue:${oltId}:${serialNo.trim()}`;
}

export type OltSyncResult = {
  ok: boolean;
  olts: {
    id: string;
    name: string;
    ok: boolean;
    onus: number;
    updated: number;
    rogue: number;
    error?: string;
  }[];
  updated: number;
  rogue: number;
  skipped: string;
};

/**
 * @param adapterFor Overridable so a test can drive the fold with a fake OLT. The
 *   default resolves from the row and from Settings; nothing else in the app passes
 *   one, and exporting a `foldReadingsForTest` purely so a test could reach it would
 *   be a worse seam than an explicit parameter.
 */
export async function syncOlts(
  adapterFor: AdapterResolver = oltAdapterFor
): Promise<JobResult> {
  const result = await syncOltReports(adapterFor);
  return {
    ran: result.updated + result.rogue,
    skipped: result.skipped,
    ...(result.ok ? {} : { note: "At least one OLT could not be polled." }),
  };
}

/** How a cabinet becomes an adapter. Swappable for a fake in tests. */
export type AdapterResolver = (row: OltRow) => Promise<OltAdapter>;

/** The same work, with the per-cabinet detail kept — what the tests read. */
export async function syncOltReports(adapterFor: AdapterResolver = oltAdapterFor): Promise<OltSyncResult> {
  const olts = await prisma.olt.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ipAddress: true,
      apiVendor: true,
      snmpCommunityEnc: true,
      snmpPort: true,
      lastSyncAt: true,
    },
  });

  const summary: OltSyncResult["olts"] = [];
  let updated = 0;
  let rogue = 0;

  for (const olt of olts) {
    const adapter = await adapterFor(olt);

    if (!adapter.live) {
      // Not polled. Recorded, not reported as broken: a cabinet with no vendor set
      // is a decision, and calling it a fault would train an operator to ignore
      // the ones that are.
      summary.push({
        id: olt.id,
        name: olt.name,
        ok: true,
        onus: 0,
        updated: 0,
        rogue: 0,
        error: "not configured — not polled",
      });
      continue;
    }

    let readings: OnuReading[];
    try {
      readings = await adapter.discoverOnus();
    } catch (e) {
      const message = e instanceof Error ? e.message : "unreachable";
      // The whole point of the module comment: status becomes Unknown, never
      // Offline, and not one ONU row is written.
      await prisma.olt.update({
        where: { id: olt.id },
        data: { status: "Unknown", lastError: message },
      });
      summary.push({
        id: olt.id,
        name: olt.name,
        ok: false,
        onus: 0,
        updated: 0,
        rogue: 0,
        error: message,
      });
      continue;
    }

    const outcome = await foldReadings(olt.id, olt.name, readings);
    updated += outcome.updated;
    rogue += outcome.rogue;

    await prisma.olt.update({
      where: { id: olt.id },
      data: { status: "Online", lastSyncAt: new Date(), lastError: null },
    });

    summary.push({
      id: olt.id,
      name: olt.name,
      ok: true,
      onus: readings.length,
      updated: outcome.updated,
      rogue: outcome.rogue,
    });
  }

  await prismaLog(prisma, {
    action: "Sync",
    entity: "OLT",
    entityId: undefined,
    summary:
      `OLT sync: ${updated} ONU(s) updated, ${rogue} rogue serials seen` +
      (summary.some((s) => !s.ok)
        ? ` — ${summary.filter((s) => !s.ok).length} cabinet(s) unreachable`
        : ""),
  });

  const unreachable = summary.filter((s) => !s.ok);
  const skipped =
    `${summary.length} cabinet(s) polled: ${updated} ONU(s) updated, ` +
    `${rogue} rogue` +
    (unreachable.length
      ? ` — ${unreachable.map((u) => `${u.name} (${u.error})`).join("; ")}`
      : "");

  return {
    ok: unreachable.length === 0,
    olts: summary,
    updated,
    rogue,
    skipped,
  };
}

/**
 * Writes one cabinet's readings.
 *
 * Upserted on `serialNo`, which is unique, so a second sync over the same data is a
 * no-op and two concurrent syncs converge on one row rather than two. There is no
 * "does this serial exist" check anywhere — that is two queries and both can pass
 * it, which is how an ONU gets duplicated.
 */
async function foldReadings(
  oltId: string,
  oltName: string,
  readings: OnuReading[]
): Promise<{ updated: number; rogue: number }> {
  const now = new Date();
  let updated = 0;
  let rogue = 0;

  // One query for the whole cabinet rather than one per ONU: a cabinet with 3,000
  // ONUs must not become 3,000 round trips a night.
  const known = await prisma.onu.findMany({
    where: { serialNo: { in: readings.map((r) => r.serialNo) } },
    select: { id: true, serialNo: true },
  });
  const knownBySerial = new Map(known.map((o) => [o.serialNo, o.id]));

  for (const reading of readings) {
    const existingId = knownBySerial.get(reading.serialNo);

    if (!existingId) {
      // A serial the OLT serves and we have never seen.
      await recordRogue(oltId, oltName, reading, now);
      rogue += 1;
      continue;
    }

    // `update` lists the five fields the OLT owns. Everything else — vendor,
    // model, name, and every customer link — is untouched by construction rather
    // than by remembering to leave it out of a wider object spread.
    await prisma.onu.updateMany({
      where: { id: existingId },
      data: {
        rxPower: reading.rxPower,
        txPower: reading.txPower,
        status: reading.status,
        ponIndex: reading.ponIndex,
        lastSeenAt: now,
      },
    });
    updated += 1;
  }

  return { updated, rogue };
}

/**
 * Records one unrecognised serial, and alerts exactly once per incident.
 *
 * `create` with a unique key, and a `P2002` caught — the same claim pattern as
 * `DeviceAlert.dedupeKey` and `Ticket.dedupeKey`, for the same reason: this runs
 * from three schedulers and an operator presses the button by hand, so
 * "have we seen this serial" is a check more than one of them can pass at once.
 *
 * Two independent claims, because they answer different questions. The
 * `(oltId, serialNo)` unique index is the *record* — a serial cannot be two rows.
 * `dedupeKey` is the *alert* — it is nulled when the rogue is resolved, so a serial
 * that was cleaned up and later reappears alerts again instead of being swallowed
 * by the index.
 */
async function recordRogue(
  oltId: string,
  oltName: string,
  reading: OnuReading,
  now: Date
): Promise<boolean> {
  const serialNo = reading.serialNo.trim();
  const key = rogueKey(oltId, serialNo);

  let rowId: string;
  try {
    const row = await prisma.rogueOnu.create({
      data: {
        oltId,
        serialNo,
        ponIndex: reading.ponIndex,
        rxPower: reading.rxPower,
        lastSeenAt: now,
        dedupeKey: key,
      },
      select: { id: true },
    });
    rowId = row.id;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;

    // The serial already has a record, which is the point of the unique index:
    // **one record per serial per OLT, for ever.**
    const existing = await prisma.rogueOnu.findUnique({
      where: { oltId_serialNo: { oltId, serialNo } },
      select: { id: true, dedupeKey: true, resolvedAt: true },
    });
    if (!existing) return false;

    // Still unresolved: refresh what the OLT just told us and stay quiet. A rogue
    // that has since been powered off still shows its last-known signal, and
    // alerting on every poll is how a channel gets muted.
    if (!existing.resolvedAt) {
      await prisma.rogueOnu.update({
        where: { id: existing.id },
        data: { ponIndex: reading.ponIndex, rxPower: reading.rxPower, lastSeenAt: now },
      });
      return false;
    }

    // Resolved, and back. **Reopen** rather than inserting a second row: the serial
    // has one record and a lifecycle, and a retained `dedupeKey` here would mean a
    // cleaned-up serial that somebody reconnects is never alerted about again —
    // silently, and for ever.
    const reopened = await prisma.rogueOnu.updateMany({
      where: { id: existing.id, resolvedAt: { not: null } },
      data: {
        resolvedAt: null,
        dedupeKey: key,
        ponIndex: reading.ponIndex,
        rxPower: reading.rxPower,
        lastSeenAt: now,
        // The first sighting is history; this one is the incident that is open now.
        firstSeenAt: now,
      },
    });
    if (reopened.count === 0) return false;

    await alertRogue(oltId, oltName, existing.id, serialNo, reading, now);
    return true;
  }

  await alertRogue(oltId, oltName, rowId, serialNo, reading, now);
  return true;
}

/** Raises the alert and records whether anyone was reached. */
async function alertRogue(
  oltId: string,
  oltName: string,
  rowId: string,
  serialNo: string,
  reading: OnuReading,
  now: Date
): Promise<void> {
  const alert = await raiseAlert({
    deviceType: "OLT",
    // The rogue row's own id, so the same serial on two cabinets is two incidents
    // rather than one silently attributed to whichever was polled first.
    deviceId: rowId,
    deviceName: `${oltName} ${serialNo}`,
    kind: "Rogue",
    detail:
      `An ONU with serial ${serialNo} is serving traffic on ${oltName} but is not in the database. ` +
      "Someone has connected equipment we do not bill for, or a customer has self-installed.",
  });

  await prisma.rogueOnu.update({
    where: { id: rowId },
    data: { notifiedAt: alert.notified ? now : null },
  });
  void oltId;
}

/**
 * Closes rogue records whose serial the OLT no longer reports.
 *
 * Separate from the sync on purpose. Someone unplugging a rogue ONU and having
 * their dashboard entry disappear on its own would leave no record that it ever
 * happened, and the "is this still happening" question is answered by history, not
 * by the present.
 */
export async function reconcileRogueOnus(
  seenSerialsByOlt: Record<string, string[]>,
  now: Date = new Date()
): Promise<number> {
  let closed = 0;
  for (const [oltId, seen] of Object.entries(seenSerialsByOlt)) {
    const open = await prisma.rogueOnu.findMany({
      where: { oltId, resolvedAt: null },
      select: { id: true, serialNo: true },
    });
    for (const row of open) {
      if (seen.includes(row.serialNo)) continue;
      // Resolving frees the dedupe key, so the same serial coming back later is a
      // new incident and alerts again.
      await prisma.rogueOnu.update({
        where: { id: row.id },
        data: { resolvedAt: now, dedupeKey: null },
      });
      closed += 1;
    }
  }
  return closed;
}

/** Unresolved rogues, newest first — the dashboard widget and the OLT page. */
export async function listRogueOnus(
  options: { take?: number; includeResolved?: boolean } = {}
) {
  return prisma.rogueOnu.findMany({
    where: options.includeResolved ? {} : { resolvedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: options.take ?? 20,
    select: {
      id: true,
      serialNo: true,
      ponIndex: true,
      rxPower: true,
      firstSeenAt: true,
      lastSeenAt: true,
      notifiedAt: true,
      olt: { select: { id: true, name: true } },
    },
  });
}

export async function openRogueCount(): Promise<number> {
  return prisma.rogueOnu.count({ where: { resolvedAt: null } });
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2002" || /unique constraint/i.test(msg);
}