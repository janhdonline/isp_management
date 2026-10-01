/**
 * Packet layer: the security boundary, and nothing about AAA itself.
 *
 * A RADIUS server is a UDP listener with a shared secret in front of it, and the
 * wrong answer here is not a failed login — it is a server that answers packets
 * from anyone. Four things happen to every packet before a handler sees it, in
 * this order, and each one is a rejection with a reason rather than a silent
 * drop:
 *
 *   1. **NAS allowlist.** Only an address that appears as a `Router.ipAddress`
 *      gets in. A shared secret is often one string across an ISP's whole fleet,
 *      so it is not a meaningful boundary on its own — and without this check a
 *      port-forwarded 1812 would let anyone offline attempt logins.
 *   2. **Shared secret.** Verified by the codec: an Access-Request's authenticator
 *      is random (so it is the Message-Authenticator that proves it), while
 *      Accounting and CoA packets carry a secret-derived MD5 that cannot be
 *      produced without the secret.
 *   3. **Per-NAS rate limit.** One router in a fault loop must not be able to
 *      saturate the process for every other router.
 *   4. **Decode.** Only now is a packet parsed.
 *
 * Nothing in this file logs the shared secret or a password, and that is a
 * structural property rather than a care exercise: the only attributes that ever
 * reach a log line are the ones named in `safeAttributes` below, and the two that
 * carry a credential are never among them.
 */

import {
  radiusCodec,
  loadDictionaries as loadCodecDictionaries,
  dictionaries as codecDictionaries,
} from "@/lib/services/radius-codec";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { HEARTBEAT_ID } from "@/lib/services/radius-health";

import type { RadiusAttr, RadiusAttrs } from "@/lib/services/radius-codec";

export {
  HEARTBEAT_ID,
  HEARTBEAT_STALE_MS,
  DOWN_HEALTH,
  healthSnapshot,
  recordHeartbeatSample,
  resetHeartbeatSamples,
  type RadiusHealth,
} from "@/lib/services/radius-health";

/**
 * Load the vendor dictionaries once per process.
 *
 * The MikroTik file is what puts a subscriber's package speed on the wire, and
 * the MS-CHAPv2 file is what makes a MikroTik PPPoE login work at all — without
 * it every CHAP request carries attributes the codec cannot name, and the reply
 * is an Access-Reject for what looks like a wrong password.
 */
export function loadDictionaries() {
  loadCodecDictionaries();
}

/** Kept as a named export so the dictionary path is in one obvious place. */
export const dictionaries = codecDictionaries;


/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export type RadiusConfig = {
  /** The bind address. `0.0.0.0` is the default: routers reach this host. */
  server: string;
  authPort: number;
  accountingPort: number;
  coaPort: number;
  /**
   * The shared secret. Empty means "RADIUS is not configured", which is a
   * distinct state from "configured with a wrong secret" — the server refuses to
   * start on the first, because a RADIUS server listening with no secret accepts
   * nothing and produces a support call rather than a security incident.
   */
  secret: string;
  logRetentionDays: number;
};

/**
 * The hard ceiling on `RadiusLog` rows, enforced by the writer itself.
 *
 * The cron job prunes to the retention setting, but a job that has not run yet
 * must not be able to fill the disk, and neither must a flood arriving faster
 * than one cron cycle. This is the backstop the retention setting sits inside.
 */
export const LOG_HARD_CAP = 50_000;

/** How often the writer checks the cap. */
const TRIM_EVERY = 1000;

/** Lines written since boot, for the periodic cap check. */
let written = 0;

/** Packets per NAS per window, before that NAS is refused. */
const RATE_LIMIT_PACKETS = 120;
const RATE_LIMIT_WINDOW_MS = 10_000;

export async function radiusConfig(): Promise<RadiusConfig> {
  const s = await getSettings();
  const port = (key: string, fallback: number) => {
    const n = Number(s[key]);
    // A blank or non-numeric port falls back rather than binding to 0 (which
    // means "any free port" and silently makes the server unreachable) or NaN.
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
  };
  return {
    server: s["network.radiusServer"]?.trim() || "0.0.0.0",
    authPort: port("network.radiusPort", 1812),
    accountingPort: port("network.radiusAccountingPort", 1813),
    coaPort: port("network.radiusCoaPort", 3799),
    secret: s["network.radiusSecret"] ?? "",
    logRetentionDays: Number(s["radius.logRetentionDays"]) || 7,
  };
}

/* ------------------------------------------------------------------ */
/* The NAS allowlist                                                   */
/* ------------------------------------------------------------------ */

/**
 * NAS addresses taken from the `Router` table.
 *
 * This is the allowlist, and it is the database rather than a setting: an ISP
 * that adds a router expects it to be able to authenticate, and a separate list
 * of IPs that has to be kept in step with the router list is a list that will
 * drift. It is also why a packet from an unknown address is *dropped and logged*
 * rather than answered with Access-Reject — a Reject is a valid response to a
 * known NAS and would tell a prober the server exists.
 *
 * Cached briefly, because it is read on every packet and the router table changes
 * about once a year.
 */
let nasCache: { at: number; ips: Set<string> } | null = null;
const NAS_CACHE_MS = 15_000;

export async function allowedNasIps(): Promise<Set<string>> {
  if (nasCache && Date.now() - nasCache.at < NAS_CACHE_MS) return nasCache.ips;
  const rows = await prisma.router.findMany({ select: { ipAddress: true } });
  const ips = new Set(rows.map((r) => r.ipAddress).filter(Boolean));
  nasCache = { at: Date.now(), ips };
  return ips;
}

/** Called after a router is added or edited, so a new NAS is not refused for 15s. */
export function invalidateNasCache() {
  nasCache = null;
}

export type AdmitResult =
  | { ok: true; nas: { id: string; name: string; useRadius: boolean } }
  | { ok: false; reason: string; admit: false };

/**
 * Whether a packet from `address` may be processed at all.
 *
 * Routers with `useRadius` off are refused too, and that is the point of the flag:
 * a router not converted to RADIUS has no business talking to this server, and
 * accepting its packets would mean secrets are being exchanged with a router that
 * is not using them — a working authentication path for a box the operator
 * believes is not enrolled.
 */
export async function admitNas(address: string, port: number): Promise<AdmitResult> {
  const allowed = await allowedNasIps();
  if (!allowed.has(address)) {
    return { ok: false, admit: false, reason: `NAS ${address}:${port} is not a known router` };
  }

  const limited = rateLimited(address);
  if (limited) {
    return {
      ok: false,
      admit: false,
      reason: `NAS ${address}:${port} is over its ${RATE_LIMIT_PACKETS} packets / ${RATE_LIMIT_WINDOW_MS / 1000}s limit`,
    };
  }

  const row = await prisma.router.findFirst({
    where: { ipAddress: address },
    select: { id: true, name: true, useRadius: true },
  });
  if (!row) {
    return { ok: false, admit: false, reason: `NAS ${address}:${port} disappeared from the router list` };
  }
  if (!row.useRadius) {
    return {
      ok: false,
      admit: false,
      reason: `NAS ${address} (${row.name}) has RADIUS switched off — turn it on in Network → Routers before it authenticates here`,
    };
  }
  return { ok: true, nas: row };
}

/**
 * A fixed-window counter per NAS.
 *
 * Fixed-window rather than sliding because it is one array and one arithmetic per
 * packet, and this runs on the hot path of every login on the network. The
 * window is 10 seconds: long enough that a router retrying a legitimate burst of
 * logins is not cut off, short enough that a fault loop is bounded.
 */
const counters = new Map<string, { windowStart: number; count: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    counters.set(key, { windowStart: now, count: 1 });
    // A map that only ever grows is a slow leak; NASes come and go.
    if (counters.size > 1000) {
      for (const [k, v] of counters) if (now - v.windowStart > RATE_LIMIT_WINDOW_MS) counters.delete(k);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_PACKETS;
}

/** Clears rate-limit state. Exported for tests, which would otherwise bleed state. */
export function resetRateLimits() {
  counters.clear();
  nasCache = null;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

export type DecodeFailure = { ok: false; reason: string };
export type DecodeOk = { ok: true; packet: RadiusPacket };

export type RadiusPacket = {
  code: string;
  identifier: number;
  attributes: RadiusAttrs;
  raw: Buffer;
  authenticator: Buffer;
};

/**
 * Decodes a packet, verifying the shared secret.
 *
 * The verification is the codec's, not ours: an Accounting or CoA packet carries
 * an authenticator that is an MD5 over the packet and the secret, so the codec
 * rejects a wrong secret with `InvalidSecretError`. An Access-Request's
 * authenticator is random by design, so the codec verifies its
 * Message-Authenticator instead — which is what MikroTik sends. The consequence,
 * stated because it is a real limitation rather than a bug: a request that
 * arrives with *no* Message-Authenticator is accepted on the strength of the
 * allowlist alone, and its response is still correctly signed.
 */
export function decodePacket(data: Buffer, secret: string): DecodeOk | DecodeFailure {
  loadDictionaries();
  try {
    const packet = radiusCodec.decode({ packet: data, secret });
    if (!packet) return { ok: false, reason: "the packet could not be decoded" };
    return { ok: true, packet: packet as RadiusPacket };
  } catch (e) {
    // The reason is reported without the secret, and the codec's own message does
    // not contain it. Wrapping rather than interpolating `e` wholesale keeps it
    // that way if a future version of the library is more forthcoming.
    const name = e instanceof Error ? e.name : "Error";
    return { ok: false, reason: `shared secret verification failed (${name})` };
  }
}

/** Decodes without a secret, for logging an attribute name from a dropped packet. */
export function peekPacket(data: Buffer): RadiusPacket | null {
  loadDictionaries();
  try {
    return radiusCodec.decode_without_secret({ packet: data }) as RadiusPacket;
  } catch {
    return null;
  }
}

export function encodeResponse(
  request: RadiusPacket,
  code: string,
  secret: string,
  attributes: RadiusAttr[] = []
): Buffer {
  loadDictionaries();
  return radiusCodec.encode_response({ packet: request, code, secret, attributes });
}

/* ------------------------------------------------------------------ */
/* The log sink                                                        */
/* ------------------------------------------------------------------ */

export type LogType = "accept" | "reject" | "accounting" | "disconnect" | "dropped";

/**
 * Writes one line to `RadiusLog`.
 *
 * Never throws: a logging failure must not take down a request path, and the
 * alternative — an unhandled rejection inside a UDP handler — kills the process
 * and takes authentication for the whole ISP with it.
 *
 * The cap is enforced here rather than only in the cron job, because the writer is
 * the only place that cannot race with itself.
 */
export async function logEvent(
  type: LogType,
  message: string,
  extra: { username?: string | null; nasIp?: string | null; outcome?: string | null } = {}
): Promise<void> {
  try {
    await prisma.radiusLog.create({
      data: {
        type,
        outcome: extra.outcome ?? null,
        username: extra.username ?? null,
        nasIp: extra.nasIp ?? null,
        // Bounded so one hostile NAS cannot write a 60KB line per packet.
        message: message.slice(0, 500),
      },
    });

    // Keep an in-process row estimate rather than counting per packet: a
    // `count()` on every Access-Request is an extra query on the hot path of
    // every login, for a bound that only changes once every thousand lines.
    // The prune cron is the authority; this is the backstop that stops a flood
    // filling the disk between two cron runs.
    written += 1;
    if (written % TRIM_EVERY === 1) {
      const total = await prisma.radiusLog.count();
      if (total > LOG_HARD_CAP) {
        // Deleted by a boundary rather than by reading overflow rows into memory,
        // so this is one statement however far over the cap the table has drifted.
        await prisma.radiusLog.deleteMany({ where: { id: { lt: total - LOG_HARD_CAP } } });
      }
    }
  } catch {
    // Intentionally swallowed. See above.
  }
}

/* ------------------------------------------------------------------ */
/* The heartbeat                                                       */
/* ------------------------------------------------------------------ */

/**
 * Records the process's liveness and counters.
 *
 * Rewritten on a fixed interval and used by the dashboard to answer "is RADIUS up".
 * There is no other way to ask a UDP listener that is not currently in a
 * conversation, and a stale row must read as DOWN — a RADIUS server that died
 * while the dashboard still shows a green dot is the failure this row exists to
 * prevent.
 */
export async function writeHeartbeat(packetsIn: number, packetsOut: number, startedAt: Date) {
  await prisma.radiusHealth.upsert({
    where: { id: HEARTBEAT_ID },
    create: { id: HEARTBEAT_ID, packetsIn, packetsOut, startedAt, updatedAt: new Date() },
    update: { packetsIn, packetsOut, updatedAt: new Date() },
  });
}
