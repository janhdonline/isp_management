/**
 * Zero-touch ONU provisioning over TR-069 / CWMP (ISP.md §36).
 *
 * Before this, every ONU was configured by hand: a technician logged into the
 * device's own web UI, typed PPPoE credentials into a form, set a WiFi name, and
 * hoped. It is slow, it does not scale, and it is the single largest source of
 * avoidable mistakes in the whole operation — a transposed digit in a PPPoE
 * password looks exactly like a dead line, and the diagnosis starts at the wrong
 * end.
 *
 * The device already knows how to ask for help. TR-069 lets an unconfigured ONU
 * boot, find an ACS, and send an Inform saying "I am here, this is what I am".
 * From that moment the device is in our database, and everything after it is our
 * job rather than the technician's.
 *
 * ## The two directions, and which one talks to whom
 *
 * - **Inbound.** The device POSTs an Inform to `/api/acs/inform`. That endpoint
 *   is the ACS. It is authenticated by a shared secret, and it only ever *reads*
 *   — see "An Inform may not change an existing device" below.
 * - **Outbound.** To configure a device we call its management API. Real ONUs are
 *   behind vendor ACS bridges rather than directly reachable, so the base URL is
 *   configuration (`tr069.deviceApiUrl`), not a hardcoded host. `Tr069Adapter` is
 *   the seam; `DatabaseTr069Adapter` is the stand-in used when none is configured,
 *   exactly as `DatabaseNetworkAdapter` stands in for a router.
 *
 * ## Nothing secret is ever stored by this module
 *
 * The pushed configuration contains the customer's PPPoE password in plaintext,
 * because that is the whole point of the push. Three rules follow, and they are
 * the reason this file looks the way it does:
 *
 *  - `Tr069Log` has a `payloadHash` column and **no payload column**. A SHA-256
 *    is enough to prove two pushes were identical and useless to a reader hoping
 *    for a credential.
 *  - The retry outbox stores **no payload either** — not the password, not a
 *    hash. A retry re-reads the customer's *current* password and rebuilds the
 *    config from the *current* template. That deliberately differs from Phase A,
 *    which pins a router profile on the row: a profile name is not a secret, and
 *    here it is better anyway — if the password changed while the device was
 *    unreachable, the device should end up with the one that is current, not the
 *    one that was wrong.
 *  - WiFi passwords are **derived, never stored**. See `wifiPassword()`.
 */

import { createHash, createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/services/activity";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type Tr069Settings = {
  enabled: boolean;
  secret: string;
  /** Where the device management API lives. Empty means "no adapter configured". */
  deviceApiUrl: string;
  vlanId: string;
  wifiSsidPattern: string;
  /** `pppoe` | `derived` — see `wifiPassword()`. */
  wifiPasswordPolicy: string;
  timeoutSeconds: number;
};

/**
 * Reads the TR-069 configuration.
 *
 * The secret comes from Settings, and `ACS_SECRET` from the environment is the
 * fallback so a deployment can keep it out of a database row an operator can
 * edit. Neither is ever defaulted to a value: with no secret the endpoint returns
 * 503 rather than accepting the first device that asks.
 */
export function readTr069Settings(raw: Record<string, string>): Tr069Settings {
  const timeout = Number(raw["tr069.provisionTimeoutSec"]);
  return {
    enabled: raw["tr069.enabled"] === "true",
    secret: raw["tr069.acsSecret"] || process.env.ACS_SECRET || "",
    deviceApiUrl:
      process.env.TR069_DEVICE_API_URL || raw["tr069.deviceApiUrl"] || "",
    vlanId: raw["tr069.vlanId"] || "100",
    wifiSsidPattern: raw["tr069.wifiSsidPattern"] || "isp-{username}",
    wifiPasswordPolicy: raw["tr069.wifiPasswordPolicy"] || "pppoe",
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 20,
  };
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** What a device tells us when it boots unconfigured. */
export type Inform = {
  serialNo: string;
  vendor?: string | null;
  model?: string | null;
  /** Reported by the device, trusted only if such an OLT exists. */
  oltId?: string | null;
  ponIndex?: string | null;
  /** Reported up time; an odd signal but real devices send it. */
  uptimeSeconds?: number | null;
  ipAddress?: string | null;
};

/** What we hand back. Never logged. */
export type OnuConfig = {
  pppoeUsername: string;
  pppoePassword: string;
  vlanId: string;
  wifiEnabled: boolean;
  wifiSsid: string;
  wifiPassword: string;
  wifiChannel: number;
};

export type PushOutcome = {
  ok: boolean;
  detail: string;
  /** What the device said, for the log. Never the payload. */
  reported?: string;
};

/**
 * The adapter, mirroring `NetworkAdapter`.
 *
 * `live` is false for the simulated one so the UI can say so plainly rather than
 * reporting a simulated push as a configured device.
 */
export interface Tr069Adapter {
  readonly name: string;
  readonly live: boolean;
  /** Reconcile an Inform against the database. Both adapters share this. */
  handleInform(inform: Inform): Promise<InformOutcome>;
  pushConfig(target: { serialNo: string }, config: OnuConfig): Promise<PushOutcome>;
  reboot(target: { serialNo: string }): Promise<PushOutcome>;
  factoryReset(target: { serialNo: string }): Promise<PushOutcome>;
}

export type InformOutcome = {
  onuId: string;
  serialNo: string;
  created: boolean;
  status: string;
};

/**
 * A stable fingerprint of a configuration.
 *
 * Key order is fixed rather than taken from `Object.keys`, so two configs built
 * from the same settings hash the same however the object was assembled. The
 * point is to answer "did we try this already, unchanged", and that question is
 * unanswerable if the hash depends on insertion order.
 */
export function payloadHash(config: unknown): string {
  return createHash("sha256").update(stableStringify(config)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// The WiFi password
// ---------------------------------------------------------------------------

/**
 * The WiFi password, from a policy.
 *
 * Deliberately derived rather than random. A random WiFi password has to be
 * *stored* so it can be read back to the customer, and this module's whole
 * design is that no secret is stored by it — a plaintext WiFi key on the ONU row
 * would be exactly the kind of thing this phase refuses to do. Two policies, both
 * of which reproduce the same password forever:
 *
 *  - `pppoe` — the same string as the PPPoE password. The customer already has
 *    it, so there is nothing new to communicate, and the ISP only has to tell
 *    them once that the WiFi key is the same one.
 *  - `derived` — an HMAC of the ACS secret keyed on the serial. Support can
 *    recompute it for a customer on the phone without reading anything out of the
 *    database, and nobody else can produce it at all. Changing the ACS secret
 *    changes every derived password, which is the correct blast radius: so does
 *    every WiFi device.
 *
 * Anything else falls back to `pppoe` rather than being rejected at the device —
 * an unrecognised policy name in Settings should not leave a customer without
 * WiFi.
 */
export function wifiPassword(
  policy: string,
  serialNo: string,
  pppoePassword: string,
  acsSecret: string
): string {
  if (policy === "derived" && acsSecret) {
    // 20 hex characters of an HMAC-SHA256: 80 bits, and the longest a WPA2 PSK
    // passphrase can be while staying typable off a sticker on the box.
    return createHmac("sha256", acsSecret).update(`wifi:${serialNo}`).digest("hex").slice(0, 20);
  }
  return pppoePassword;
}

/**
 * Fills `{username}` in the SSID pattern.
 *
 * Only that one token, and the result is capped at 32 bytes because that is the
 * SSID length limit — a long pattern would otherwise produce a name the device
 * silently truncates, leaving the customer looking for a network that does not
 * exist under the name they were told.
 */
export function buildSsid(pattern: string, username: string): string {
  const raw = (pattern || "isp-{username}")
    .split("{username}")
    .join(username || "guest")
    .trim();
  return raw.slice(0, 32) || `isp-${username || "guest"}`;
}

/**
 * The configuration for one ONU.
 *
 * Throws when there is no PPPoE password: pushing a blank password produces a
 * device that shows up, associates, and then fails every login — a line that
 * looks installed and is not, which is worse than not pushing at all because
 * nobody goes looking for the reason.
 */
export function buildConfig(input: {
  serialNo: string;
  username: string;
  pppoePassword: string | null;
  template: Pick<Tr069Settings, "vlanId" | "wifiSsidPattern" | "wifiPasswordPolicy">;
  acsSecret: string;
}): OnuConfig {
  const password = input.pppoePassword;
  if (!password || !password.trim()) {
    throw new Error(
      "This customer has no PPPoE password, so there is nothing to configure the ONU with. Set one on the customer record first."
    );
  }
  return {
    pppoeUsername: input.username,
    pppoePassword: password,
    vlanId: input.template.vlanId,
    wifiEnabled: true,
    wifiSsid: buildSsid(input.template.wifiSsidPattern, input.username),
    wifiPassword: wifiPassword(
      input.template.wifiPasswordPolicy,
      input.serialNo,
      password,
      input.acsSecret
    ),
    wifiChannel: 6,
  };
}

// ---------------------------------------------------------------------------
// Inform
// ---------------------------------------------------------------------------

/**
 * Reconciles an Inform against the database.
 *
 * ## An Inform may not change an existing device
 *
 * An unknown serial **creates** a row. A known serial updates exactly two fields:
 * `lastSeenAt`, and `status` when the device reports itself online.
 *
 * Everything else — vendor, model, OLT, PON port, area, and any customer link —
 * is left alone. That is not an oversight about which columns to copy; it is the
 * point. First contact is authoritative, because it is the only contact that
 * happens on hardware somebody is standing next to. Every later Inform is an
 * unauthenticated claim from the network that happens to identify itself with
 * that serial, and a device that has been re-flashed, re-imaged or spoofed will
 * report whatever it has been told to report. Letting a routine heartbeat move an
 * ONU to another OLT's PON port would put a live subscriber's equipment on the
 * wrong card, and the wrong card is where an outage investigation starts.
 *
 * ## Two Informs at once
 *
 * `create` is attempted first and its unique-violation caught, rather than a
 * find-then-create. A check-then-create is two queries and both can pass the
 * check, and a brand-new ONU reporting in twice — which real CPEs do, because
 * Inform is retried until it is answered — is the normal case, not the exotic
 * one. The catch path then performs the same narrow update the known-serial path
 * would, so a race and a duplicate arrive at the same state.
 */
export async function recordInform(
  inform: Inform,
  now: Date = new Date()
): Promise<InformOutcome> {
  const serialNo = inform.serialNo.trim();
  if (!serialNo) throw new Error("An Inform must carry a serial number");

  const existing = await prisma.onu.findUnique({
    where: { serialNo },
    select: { id: true, status: true },
  });

  if (existing) {
    const updated = await prisma.onu.update({
      where: { id: existing.id },
      data: { lastSeenAt: now },
      select: { id: true, status: true },
    });
    await writeLog({
      serialNo,
      onuId: existing.id,
      action: "inform",
      payloadHash: payloadHash(inform),
      result: "Success",
      detail: "Known device; presence recorded, nothing else changed",
    });
    return {
      onuId: existing.id,
      serialNo,
      created: false,
      status: updated.status,
    };
  }

  // An OLT is only linked if the device named one that exists. A fabricated id
  // would otherwise be stored as a dangling reference the moment the FK is
  // dropped, and an ONU on nobody's OLT is an ONU nobody will ever be able to
  // fault-localize.
  const olt =
    inform.oltId && inform.oltId.trim()
      ? await prisma.olt.findUnique({ where: { id: inform.oltId.trim() }, select: { id: true } })
      : null;

  try {
    const created = await prisma.onu.create({
      data: {
        serialNo,
        vendor: inform.vendor?.trim() || null,
        model: inform.model?.trim() || null,
        oltId: olt?.id ?? null,
        ponIndex: inform.ponIndex?.trim() || null,
        // Provisioning, not Online: the device has announced itself and has
        // nothing working on it yet. Saying "Online" here would make an
        // unconfigured ONU look like a healthy one on the map and in every count.
        status: "Provisioning",
        lastSeenAt: now,
      },
      select: { id: true, status: true },
    });

    // Outside a transaction on purpose: the row is already committed, and this is
    // an audit note about it rather than part of creating it. A device must not be
    // left unregistered because the audit insert failed.
    await logActivity({
      action: "Create",
      entity: "Onu",
      entityId: created.id,
      summary: `ONU ${serialNo} checked in over TR-069 and is awaiting configuration${
        inform.vendor ? ` (${inform.vendor}${inform.model ? ` ${inform.model}` : ""})` : ""
      }`,
    });

    await writeLog({
      serialNo,
      onuId: created.id,
      action: "inform",
      payloadHash: payloadHash(inform),
      result: "Success",
      detail: "New device registered from its Inform",
    });

    return { onuId: created.id, serialNo, created: true, status: created.status };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Another Inform for this serial won the race. Land on the same state the
    // known-serial path would have produced.
    const winner = await prisma.onu.update({
      where: { serialNo },
      data: { lastSeenAt: now },
      select: { id: true, status: true },
    });
    await writeLog({
      serialNo,
      onuId: winner.id,
      action: "inform",
      payloadHash: payloadHash(inform),
      result: "Success",
      detail: "Duplicate Inform on a device registered a moment ago; presence recorded",
    });
    return { onuId: winner.id, serialNo, created: false, status: winner.status };
  }
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** Talks to a device management API over HTTP. */
export class HttpTr069Adapter implements Tr069Adapter {
  readonly name = "TR-069 device API";
  readonly live = true;

  constructor(
    private baseUrl: string,
    private timeoutSeconds: number
  ) {}

  async handleInform(inform: Inform): Promise<InformOutcome> {
    // Inbound, always. This adapter has no device to pull an Inform from: the
    // device is the one that calls us.
    return recordInform(inform);
  }

  async pushConfig(
    target: { serialNo: string },
    config: OnuConfig
  ): Promise<PushOutcome> {
    return this.send("config", target.serialNo, config);
  }

  async reboot(target: { serialNo: string }): Promise<PushOutcome> {
    return this.send("reboot", target.serialNo, {});
  }

  async factoryReset(target: { serialNo: string }): Promise<PushOutcome> {
    return this.send("factory-reset", target.serialNo, {});
  }

  private async send(
    op: string,
    serialNo: string,
    payload: unknown
  ): Promise<PushOutcome> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/devices/${encodeURIComponent(serialNo)}/${op}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutSeconds * 1000),
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, detail: `The device API answered ${res.status}`, reported: text.slice(0, 200) };
      }
      return { ok: true, detail: "Accepted by the device", reported: text.slice(0, 200) };
    } catch (e) {
      // A device behind a bridge is routinely unreachable. That is the whole
      // reason the push is queued rather than done inline, so this is an ordinary
      // outcome and not an exception worth propagating.
      return {
        ok: false,
        detail: e instanceof Error ? `Could not reach the device API: ${e.message}` : "Could not reach the device API",
      };
    }
  }
}

/**
 * The stand-in used when no device API is configured.
 *
 * Same shape as `DatabaseNetworkAdapter`: it makes the rest of the app work and
 * testable without hardware, and it is labelled `live: false` so nothing can
 * report a simulated push as a configured one.
 */
export class DatabaseTr069Adapter implements Tr069Adapter {
  readonly name = "Simulated (no device API configured)";
  readonly live = false;

  async handleInform(inform: Inform): Promise<InformOutcome> {
    return recordInform(inform);
  }

  async pushConfig(): Promise<PushOutcome> {
    return {
      ok: false,
      detail:
        "No TR-069 device API is configured, so nothing was pushed. Set tr069.deviceApiUrl in Settings → Network.",
    };
  }

  async reboot(): Promise<PushOutcome> {
    return { ok: false, detail: "No TR-069 device API is configured." };
  }

  async factoryReset(): Promise<PushOutcome> {
    return { ok: false, detail: "No TR-069 device API is configured." };
  }
}

/**
 * The adapter to use, from configuration.
 *
 * Reads Settings on each call rather than caching, because Settings can be
 * changed while the process is running and a half-applied change here means
 * pushes going to the wrong place.
 */
export async function tr069Adapter(): Promise<Tr069Adapter> {
  const settings = readTr069Settings(await getSettings());
  return settings.deviceApiUrl
    ? new HttpTr069Adapter(settings.deviceApiUrl, settings.timeoutSeconds)
    : new DatabaseTr069Adapter();
}

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/**
 * What happened to one device, newest first.
 *
 * The only query the UI and the tests need, kept here so "what does this log
 * contain" is one function rather than a filter that gets written slightly
 * differently at each call site.
 */
export async function readLogFor(
  serialNo: string,
  limit = 50
): Promise<
  { id: string; action: string; result: string; detail: string | null; payloadHash: string | null; actionId: string | null; createdAt: Date }[]
> {
  return prisma.tr069Log.findMany({
    where: { serialNo },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      result: true,
      detail: true,
      payloadHash: true,
      actionId: true,
      createdAt: true,
    },
  });
}

/**
 * Writes one row to `Tr069Log`.
 *
 * Takes a payload *hash*, never a payload. Making the wrong thing impossible to
 * express at the type level is the only version of this rule that survives
 * contact with a future edit.
 */
export async function writeLog(entry: {
  serialNo: string;
  onuId?: string | null;
  action: string;
  payloadHash?: string | null;
  result: "Success" | "Failure";
  detail?: string | null;
  actionId?: string | null;
}): Promise<void> {
  await prisma.tr069Log.create({
    data: {
      serialNo: entry.serialNo,
      onuId: entry.onuId ?? null,
      action: entry.action,
      payloadHash: entry.payloadHash ?? null,
      result: entry.result,
      detail: entry.detail ?? null,
      actionId: entry.actionId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Pushing
// ---------------------------------------------------------------------------

export type ProvisionResult = {
  ok: boolean;
  detail: string;
  onuId?: string;
  serialNo?: string;
  /** The outbox row, so a caller can watch the retry. */
  actionId?: string;
  queued?: boolean;
};

/**
 * Configures the ONU a customer is on, or queues that to happen.
 *
 * The order is the same as Phase A's, and for the same reason: **the row is
 * written before the device is called.** A crash between the two must not lose
 * the request, because the failure mode of losing it is a customer whose line is
 * installed and does not work, with nothing in the system to show for it.
 *
 * The push itself happens outside any transaction — it is a network call, and a
 * network call inside a transaction holds a row lock for as long as the device
 * takes to answer.
 */
export async function provisionOnuForCustomer(
  customerId: string,
  options: { enqueueFirst?: boolean } = {}
): Promise<ProvisionResult> {
  const settings = readTr069Settings(await getSettings());
  if (!settings.enabled) {
    return {
      ok: false,
      detail:
        "Zero-touch provisioning is switched off in Settings → Network, so nothing was sent to the device.",
    };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      username: true,
      password: true,
      onu: { select: { id: true, serialNo: true, status: true } },
    },
  });

  if (!customer) return { ok: false, detail: "That customer no longer exists." };
  if (!customer.onu) {
    return {
      ok: false,
      detail:
        "This customer has no ONU linked, so there is no device to configure. Enter the device serial on the customer form first.",
    };
  }

  const action = await prisma.networkAction.create({
    data: {
      customerId: customer.id,
      routerId: null,
      // The device's own identity. On a router action this column holds the
      // subscriber's username; for an ONU push the only handle the device knows
      // itself by is its serial, and that is what has to survive to the retry.
      username: customer.onu.serialNo,
      action: "onuConfigure",
      status: "Pending",
      // No payload: the retry rebuilds the config from the customer's current
      // password and the current template. See the module comment.
      payload: null,
    },
    select: { id: true },
  });

  if (options.enqueueFirst === false) return { ok: false, detail: "Queued only.", actionId: action.id, queued: true };

  return attemptPush(action.id);
}

/**
 * Makes one attempt at a queued or immediate push, and resolves the outbox row.
 *
 * Exported because `retryPendingNetworkActions` calls it for rows it did not
 * create, and because it is the honest unit to test: queue, attempt, log,
 * resolve.
 */
export async function attemptPush(actionId: string): Promise<ProvisionResult> {
  const row = await prisma.networkAction.findUnique({
    where: { id: actionId },
    select: {
      id: true,
      customerId: true,
      username: true,
      action: true,
      attempts: true,
      status: true,
      customer: {
        select: {
          id: true,
          name: true,
          username: true,
          password: true,
          onu: { select: { id: true, serialNo: true } },
        },
      },
    },
  });

  if (!row) return { ok: false, detail: "That queued action no longer exists." };
  if (row.customerId && !row.customer) {
    await resolveAction(actionId, "Retry", "The customer no longer exists");
    return { ok: false, detail: "The customer no longer exists.", actionId, queued: true };
  }
  if (!row.customer?.onu) {
    // Not a retry: an unmapped device is a permanent condition, and retrying it
    // for ten attempts tells nobody anything new.
    await resolveAction(actionId, "Retry", "The ONU is no longer linked to this customer");
    return {
      ok: false,
      detail: "The ONU is no longer linked to this customer, so there is nothing to configure.",
      actionId,
      queued: true,
    };
  }

  const serialNo = row.customer.onu.serialNo;
  const onuId = row.customer.onu.id;
  const settings = readTr069Settings(await getSettings());

  let config: OnuConfig;
  try {
    config = buildConfig({
      serialNo,
      username: row.customer.username,
      pppoePassword: row.customer.password,
      template: settings,
      acsSecret: settings.secret,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Could not build a configuration";
    await writeLog({
      serialNo,
      onuId,
      action: "pushConfig",
      payloadHash: null,
      result: "Failure",
      detail,
      actionId,
    });
    // Fail, do not retry: a missing password is fixed by a person, and ten
    // retries over hours will not invent one.
    await resolveAction(actionId, "Fail", detail);
    return { ok: false, detail, onuId, serialNo, actionId };
  }

  const adapter = await tr069Adapter();
  const outcome = await adapter.pushConfig({ serialNo }, config);
  const hash = payloadHash(config);

  await writeLog({
    serialNo,
    onuId,
    action: "pushConfig",
    payloadHash: hash,
    result: outcome.ok ? "Success" : "Failure",
    detail: outcome.ok ? outcome.detail : `${outcome.detail}${outcome.reported ? `: ${outcome.reported}` : ""}`,
    actionId,
  });

  if (outcome.ok) {
    // The device has a working configuration, so it stops being a provisioning
    // problem. Only on success: flipping the status on a failed push would make
    // an unconfigured ONU look healthy, which is the exact lie this status value
    // exists to prevent.
    await prisma.onu.updateMany({
      where: { id: onuId, status: "Provisioning" },
      data: { status: "Online", lastSeenAt: new Date() },
    });
    await resolveAction(actionId, "Done", "Configuration accepted by the device");
    return { ok: true, detail: outcome.detail, onuId, serialNo, actionId };
  }

  await resolveAction(actionId, "Retry", outcome.detail);
  return { ok: false, detail: outcome.detail, onuId, serialNo, actionId, queued: true };
}

async function resolveAction(
  actionId: string,
  outcome: "Done" | "Retry" | "Fail",
  detail: string
): Promise<void> {
  await prisma.networkAction.update({
    where: { id: actionId },
    data: {
      status: outcome === "Done" ? "Done" : outcome === "Fail" ? "Failed" : "Pending",
      completedAt: outcome === "Done" ? new Date() : null,
      lastError: outcome === "Done" ? null : detail,
      attempts: { increment: 1 },
    },
  });
}

/**
 * The retry executor, called by `retryPendingNetworkActions` for rows it did not
 * create here.
 *
 * The backoff ladder and the attempt cap belong to Phase A and are not repeated:
 * this is the same queue, so a retry gets the same schedule and the same "given
 * up after too many attempts".
 */
export async function retryOnuConfigure(row: { id: string }): Promise<boolean> {
  const result = await attemptPush(row.id);
  return result.ok;
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2002" || /unique constraint/i.test(msg);
}
