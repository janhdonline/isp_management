/**
 * Accounting: the traffic record, and the part of RADIUS most likely to be wrong.
 *
 * Three packet types arrive over one UDP port, and the rules for them are not
 * symmetric:
 *
 *  - **Start** opens a session. A NAS that never got the response resends it, so
 *    this has to be an upsert rather than an insert: a second Start for the same
 *    `Acct-Session-Id` restarts the row, it does not create a duplicate. A
 *    duplicate row would split one subscriber's traffic across two sessions and
 *    halve their reported usage.
 *  - **Interim-Update** is the live heartbeat, and it is the one that must never
 *    double-count. RADIUS accounting is UDP: a lost response means a resend, and
 *    resends are normal, not a fault. The octets in an Interim-Update are a
 *    *running total for the session*, not a delta — so `1000, 2000, 3000` are three
 *    views of the same session, not three thousand octets. The right behaviour is
 *    to take the largest, which is what "the latest" amounts to, and to ignore a
 *    packet whose sequence is not newer than what is stored.
 *  - **Stop** is a final statement, not a counter, and is applied whatever sequence
 *    it carries — a Stop with a stale sequence is still the end of the session, and
 *    ignoring it would leave a row that looks live forever, which is exactly the
 *    row a suspension would then try to Disconnect.
 *
 * The consequence of getting this wrong is a customer's usage being wrong in the
 * direction that earns the ISP money, which is the kind of bug nobody reports.
 */

import { prisma } from "@/lib/prisma";
import type { RadiusPacket } from "./packet";

export type AcctStatusType = "Start" | "Interim-Update" | "Stop";

export type AccountingFields = {
  username: string;
  acctSessionId: string;
  nasIp: string;
  nasIdentifier: string | null;
  /** Acct-Session-Time, seconds. */
  sessionTime: number;
  inputOctets: bigint;
  outputOctets: bigint;
  framedIpAddress: string | null;
  callingStationId: string | null;
};

export function readAccountingFields(
  packet: RadiusPacket,
  fallbackIp: string
): AccountingFields | null {
  const a = packet.attributes ?? {};
  const username = asString(a["User-Name"]);
  const acctSessionId = asString(a["Acct-Session-Id"]);
  // A packet with neither cannot be stored or matched, and guessing a session id
  // would collide with a real session.
  if (!username || !acctSessionId) return null;

  return {
    username,
    acctSessionId,
    nasIp: asString(a["NAS-IP-Address"]) ?? fallbackIp,
    nasIdentifier: asString(a["NAS-Identifier"]),
    sessionTime: Number(a["Acct-Session-Time"] ?? 0) || 0,
    // Routers send these as strings; `Number` on a 40-bit counter is exact up to
    // 2^53, which is a petabyte, so this is not a place where precision is lost.
    inputOctets: asBigInt(a["Input-Octets"]),
    outputOctets: asBigInt(a["Output-Octets"]),
    framedIpAddress: asString(a["Framed-IP-Address"]),
    callingStationId: asString(a["Calling-Station-Id"]),
  };
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length) return v;
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return null;
}

function asBigInt(v: unknown): bigint {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.max(0, Math.floor(v)));
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return 0n;
}

export type AccountingOutcome = {
  ok: boolean;
  status: AcctStatusType;
  /** True when the packet was a duplicate and changed nothing. */
  ignored: boolean;
  detail: string;
  sessionId?: string;
};

/**
 * Applies one Accounting-Request.
 *
 * `now` is a parameter so a test can drive the timestamps, and so a packet that
 * arrives with a Start time is recorded as starting when it said rather than when
 * it was received.
 */
export async function applyAccounting(
  fields: AccountingFields,
  status: AcctStatusType,
  now: Date = new Date()
): Promise<AccountingOutcome> {
  const base = {
    username: fields.username,
    nasIp: fields.nasIp,
    nasIdentifier: fields.nasIdentifier,
    framedIpAddress: fields.framedIpAddress,
    callingStationId: fields.callingStationId,
  };

  if (status === "Start") {
    // The auth path reserves the subscriber's slot with a placeholder row before
    // it answers, because by the time accounting arrives two simultaneous logins
    // have both been accepted. Now that the real session id is known, the
    // placeholder is retired — in the same transaction that opens the session, so
    // a reader can never see both the claim and the session and count a customer
    // as having two sessions where they have one.
    //
    // Scoped to `username` rather than to a session id because that is all a NAS
    // tells us: the placeholder is not linked to the request that produced it.
    // Retiring *all* of this username's claims is correct, since a second Start
    // means the earlier one did not happen.
    //
    // The upsert is what makes a resent Start reopen the same row rather than
    // duplicating it: `create` handles a first Start, `update` handles a resend,
    // and both zero the counters so a restarted session reports its own totals
    // rather than inheriting the old one's.
    // Results come back in the order the statements were queued: the delete's
    // count, then the upserted row.
    const [, session] = await prisma.$transaction([
      prisma.radiusAccounting.deleteMany({
        where: { username: fields.username, acctSessionId: { startsWith: "claim:" } },
      }),
      prisma.radiusAccounting.upsert({
        where: { acctSessionId: fields.acctSessionId },
        create: {
          ...base,
          acctSessionId: fields.acctSessionId,
          status: "Start",
          startedAt: now,
          stoppedAt: null,
          seq: fields.sessionTime,
          inputOctets: fields.inputOctets,
          outputOctets: fields.outputOctets,
        },
        update: {
          ...base,
          status: "Start",
          startedAt: now,
          stoppedAt: null,
          seq: fields.sessionTime,
          inputOctets: fields.inputOctets,
          outputOctets: fields.outputOctets,
        },
      }),
    ]);

    return {
      ok: true,
      status,
      ignored: false,
      sessionId: session.acctSessionId,
      detail: `session started`,
    };
  }

  const existing = await prisma.radiusAccounting.findUnique({
    where: { acctSessionId: fields.acctSessionId },
  });

  if (!existing) {
    // An Interim for a session that was never started — the Start was lost, which
    // UDP does. Stored rather than dropped: the NAS is clearly online, and
    // refusing the packet would not make it send a Start.
    const row = await prisma.radiusAccounting.create({
      data: {
        ...base,
        acctSessionId: fields.acctSessionId,
        status,
        startedAt: now,
        stoppedAt: status === "Stop" ? now : null,
        seq: fields.sessionTime,
        inputOctets: fields.inputOctets,
        outputOctets: fields.outputOctets,
      },
    });
    return {
      ok: true,
      status,
      ignored: false,
      sessionId: row.acctSessionId,
      detail:
        status === "Stop"
          ? `Stop for a session that was never started — recorded and closed`
          : `no Start had been seen for this session; stored as a fresh one`,
    };
  }

  if (status === "Interim-Update") {
    // The idempotence rule. A resend carries the same sequence and the same
    // totals, so anything not newer than what is stored is a duplicate and is
    // ignored — which is why this cannot double-count even though the octets are
    // absolute rather than a delta.
    if (fields.sessionTime <= existing.seq) {
      return {
        ok: true,
        status,
        ignored: true,
        sessionId: existing.acctSessionId,
        detail: `duplicate Interim-Update (sequence ${fields.sessionTime} is not newer than ${existing.seq}) — ignored`,
      };
    }

    await prisma.radiusAccounting.update({
      where: { id: existing.id },
      data: {
        status: "Interim-Update",
        seq: fields.sessionTime,
        // The NAS is authoritative about the counters; taking them as given is
        // what makes the row match the router's own reading.
        inputOctets: fields.inputOctets,
        outputOctets: fields.outputOctets,
        nasIp: fields.nasIp,
        framedIpAddress: fields.framedIpAddress,
      },
    });
    return {
      ok: true,
      status,
      ignored: false,
      sessionId: existing.acctSessionId,
      detail: `session alive at ${fields.sessionTime}s`,
    };
  }

  // Stop. Applied whatever sequence it carries, because it is the end of the
  // session and not a reading of it. Guarded on `stoppedAt` only so a resent Stop
  // is not re-closing an already-closed row.
  if (existing.stoppedAt) {
    return {
      ok: true,
      status,
      ignored: true,
      sessionId: existing.acctSessionId,
      detail: "Stop already recorded for this session — ignored",
    };
  }

  await prisma.radiusAccounting.update({
    where: { id: existing.id },
    data: {
      status: "Stop",
      stoppedAt: now,
      // A Stop whose totals are *lower* than the last Interim is a router that
      // reset its counters; the larger figures are kept, because under-reporting
      // a customer's traffic helps nobody.
      inputOctets: fields.inputOctets > existing.inputOctets ? fields.inputOctets : existing.inputOctets,
      outputOctets: fields.outputOctets > existing.outputOctets ? fields.outputOctets : existing.outputOctets,
      seq: Math.max(existing.seq, fields.sessionTime),
    },
  });
  return {
    ok: true,
    status,
    ignored: false,
    sessionId: existing.acctSessionId,
    detail: `session closed after ${Math.max(existing.seq, fields.sessionTime)}s`,
  };
}

/**
 * Closes sessions that no NAS has reported on for a while.
 *
 * A customer whose router reboots mid-session never sends a Stop — the PPP
 * interface is simply gone. Without this, that row stays `stoppedAt: null`
 * forever, the online list shows somebody online for months, and every subsequent
 * suspension for that username sends a Disconnect-Request for a session that ended
 * when the router rebooted.
 */
export async function reapStaleSessions(maxIdleSec = 300, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - maxIdleSec * 1000);
  const stale = await prisma.radiusAccounting.findMany({
    where: { stoppedAt: null, updatedAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });
  if (!stale.length) return 0;
  const { count } = await prisma.radiusAccounting.updateMany({
    where: { id: { in: stale.map((s) => s.id) } },
    data: { stoppedAt: now, status: "Stop" },
  });
  return count;
}
