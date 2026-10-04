/**
 * Bandwidth enforcement on MikroTik simple queues (ISP.md §40).
 *
 * `Package.downloadSpeed` and `uploadSpeed` were a billing number and nothing
 * more. A customer sold 10 Mbps and one sold 50 Mbps both got whatever the router
 * felt like, and the only way to find out was to log into the device by hand. So
 * the package was, in the sense that mattered, fiction.
 *
 * ## Three flags, three different questions
 *
 * `Router.autoProvision` — may this system write PPP secrets here?
 * `Router.useRadius` — does authentication live on the router or in RADIUS?
 * `Router.autoQueues` — may this system shape the **bandwidth** here?
 *
 * All three default off, and a router can answer them differently. Nothing here
 * runs unless `autoQueues` is on, which is what makes this phase zero behaviour
 * change until an admin opts a router in.
 *
 * ## RADIUS wins
 *
 * On a router with `useRadius`, this module does nothing at all. The
 * Mikrotik-Rate-Limit attribute is already carrying the same number — it is
 * written on every Access-Request from the package — and two limiters on one
 * subscriber means the stricter one wins, which is not a decision anybody made.
 * So the check is an early return with the reason recorded, not a queue at half
 * strength.
 *
 * ## Suspend **removes** the queue rather than zeroing it
 *
 * `max-limit=0` means different things on different RouterOS versions: on some it
 * is unlimited, on others it blocks. That is a coin flip with a customer's
 * connection on it, and the failure mode — a line that is dead for a reason nobody
 * can find — is much worse than the alternative.
 *
 * Removing is also the honest inverse of adding. A suspended customer's secret is
 * already disabled by Phase A, so the queue is not what is keeping them off; it is
 * there to be taken away when they are suspended and put back when they are not,
 * and "put back" has to mean the same limits they had.
 *
 * ## No zero-speed queue, ever
 *
 * A package with null or zero speeds is **skipped with a recorded reason**. It is
 * tempting to read a missing number as 0 and shape the customer to nothing, and
 * that turns a data-entry omission into an outage for a paying customer. A package
 * with no speeds is a package nobody has finished entering, and the honest
 * outcome is that the customer is not shaped until it is.
 */

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { adapterForRouterRow } from "@/lib/services/network";
import type { NetworkAdapter } from "@/lib/services/network-adapter";

/**
 * The queue name for a subscriber.
 *
 * `isp-<username>` — the same prefix Phase A uses for the firewall address list,
 * so everything this application puts on a router is recognisable by eye and a
 * half-deleted one can be found with a single filter.
 */
export function queueName(username: string): string {
  return `isp-${username.trim()}`;
}

/** The download address a queue should target for this router's session source. */
export function targetFor(sessionSource: string, ipAddress: string | null): string {
  // A hotspot subscriber has an address on the hotspot subnet and a PPPoE one on
  // the PPPoE pool, so the target differs. A customer with no address yet cannot be
  // shaped — there is nothing to match the traffic to.
  return `${sessionSource === "hotspot" ? "hotspot" : "pppoe"}-service,${ipAddress ?? ""}`;
}

export type BandwidthDecision =
  | { go: true; router: RouterConfig; download: number; upload: number; target: string }
  | { go: false; reason: string; /** Whether this is a deliberate no-op, not a fault. */
      skipped: true };

export type RouterConfig = {
  id: string;
  name: string;
  sessionSource: string;
  autoQueues: boolean;
  useRadius: boolean;
  ipAddress?: string | null;
  apiPort?: number;
  apiUser?: string | null;
  apiSecretEnc?: string | null;
  useSsl?: boolean;
};

/**
 * Whether a queue should exist for this customer right now, and with what limits.
 *
 * Pure over its arguments, and exported, because every gate here is a rule somebody
 * will eventually want to change and the rules are the product.
 */
export function decide(input: {
  connectionStatus: string;
  router: RouterConfig | null;
  packageSpeeds: { download: number | null; upload: number | null };
  ipAddress: string | null;
}): BandwidthDecision {
  const { connectionStatus, router, packageSpeeds, ipAddress } = input;

  if (!router) {
    return { go: false, skipped: true, reason: "No router is assigned, so there is nowhere to program a queue." };
  }
  // RADIUS first, even though `autoQueues` is the harder gate.
  //
  // A router on RADIUS almost always has `autoQueues` off as well, and reporting
  // "queues are switched off" there is technically true and completely useless: it
  // is the answer to a question the operator did not ask. What they want to know is
  // why this router behaves differently from the one they just configured.
  if (router.useRadius) {
    return {
      go: false,
      skipped: true,
      reason:
        `${router.name} authenticates through RADIUS, which already sends Mikrotik-Rate-Limit ` +
        "for this package. This router is left alone so there is only one limiter per subscriber.",
    };
  }
  if (!router.autoQueues) {
    return {
      go: false,
      skipped: true,
      reason: `Bandwidth queues are switched off for ${router.name}. Nothing was written to it.`,
    };
  }

  // Suspended or disconnected: the queue goes away. Deliberately checked *before*
  // the speeds, because removing something needs no numbers — and a customer
  // suspended on a package that has no speeds entered must still have their queue
  // taken away.
  const off = connectionStatus === "Suspended" || connectionStatus === "Disconnected";
  if (off) {
    return {
      go: true,
      router,
      download: 0,
      upload: 0,
      target: targetFor(router.sessionSource, ipAddress),
    };
  }

  const download = Number(packageSpeeds.download);
  const upload = Number(packageSpeeds.upload);
  if (!Number.isFinite(download) || download <= 0 || !Number.isFinite(upload) || upload <= 0) {
    // The whole point of this branch. `null` here is a package somebody started
    // filling in, not a customer who bought nothing, and shaping them to 0 Mbps
    // would turn a data-entry omission into an outage.
    return {
      go: false,
      skipped: true,
      reason:
        `The package has no usable speeds (download ${packageSpeeds.download ?? "unset"}, ` +
        `upload ${packageSpeeds.upload ?? "unset"}), so no queue was written. A zero limit ` +
        "would look like a dead line rather than a missing number.",
    };
  }

  return {
    go: true,
    router,
    download,
    upload,
    target: targetFor(router.sessionSource, ipAddress),
  };
}

export type BandwidthResult = {
  ok: boolean;
  detail: string;
  skipped?: boolean;
  queued?: boolean;
  actionId?: string;
  /** False when the router already had the right queue. */
  changed?: boolean;
};

/**
 * Brings one customer's queue into line with their package, or takes it away.
 *
 * The row is written to the Phase A outbox **before** the router is called, for
 * every enforcement path's reason: a crash between the two must not lose the
 * request, and the failure mode of losing it is a customer left throttled to the
 * speed of a package they upgraded from three months ago.
 *
 * The call itself is outside any transaction. Nothing here holds a database lock
 * across a network round trip, and the queue is derived state — it can be rebuilt
 * at any time, unlike the secret it sits beside.
 */
export async function syncBandwidthForCustomer(
  customerId: string,
  actorId?: string
): Promise<BandwidthResult> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      username: true,
      connectionStatus: true,
      ipAddress: true,
      package: { select: { id: true, name: true, downloadSpeed: true, uploadSpeed: true } },
      router: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          apiPort: true,
          apiUser: true,
          apiSecretEnc: true,
          useSsl: true,
          sessionSource: true,
          autoQueues: true,
          useRadius: true,
        },
      },
    },
  });

  if (!customer) {
    return { ok: false, detail: "That customer no longer exists." };
  }

  const decision = decide({
    connectionStatus: customer.connectionStatus,
    router: customer.router,
    packageSpeeds: {
      download: customer.package?.downloadSpeed ?? null,
      upload: customer.package?.uploadSpeed ?? null,
    },
    ipAddress: customer.ipAddress,
  });

  if (!decision.go) {
    // Recorded rather than silently ignored: "the package has no speeds" is a
    // thing somebody has to go and fix, and it is invisible otherwise.
    await logActivity(
      {
        action: "Skip",
        entity: "Bandwidth",
        entityId: customer.id,
        summary: `No queue programmed for ${customer.name} (${customer.username}): ${decision.reason}`,
      },
      actorId
    );
    return { ok: true, skipped: true, detail: decision.reason };
  }

  const removing = customer.connectionStatus === "Suspended" || customer.connectionStatus === "Disconnected";
  const name = queueName(customer.username);
  const action = removing ? "removeBandwidth" : "setBandwidth";

  // Queued first, for the reason above. `payload` holds no speeds and no
  // credentials — the retry re-reads the package, so a customer whose package
  // changed *while the router was down* gets the current one, not the stale one.
  const row = await prisma.networkAction.create({
    data: {
      customerId: customer.id,
      routerId: decision.router.id,
      username: customer.username,
      action,
      status: "Pending",
      payload: null,
    },
    select: { id: true },
  });

  const result = await applyBandwidth(row.id);

  await logActivity(
    {
      action: removing ? "Delete" : "Update",
      entity: "Bandwidth",
      entityId: customer.id,
      summary: result.ok
        ? `${removing ? "Removed" : result.changed ? "Programmed" : "Verified"} queue ${name} on ${decision.router.name}` +
          (removing ? "" : ` (${decision.download}/${decision.upload} Mbps from ${customer.package?.name ?? "no package"})`)
        : `${removing ? "Removing" : "Programming"} queue ${name} on ${decision.router.name} failed: ${result.detail}` +
          (result.queued ? " (queued for retry)" : ""),
    },
    actorId
  );

  return { ...result, actionId: row.id };
}

/** The queue state a router currently holds for these names. */
export type ManagedQueue = {
  name: string;
  target: string;
  maxDownload: number;
  maxUpload: number;
  /** The package it was programmed from, where we can still match it. */
  packageName: string | null;
  username: string | null;
};

/**
 * The queues this system manages on a router, matched back to packages.
 *
 * Matched by name rather than stored, because a stored queue id is a reference to
 * a row on hardware that can be rebooted, re-imaged or rebuilt, and a stale id
 * fails in a way a name never does. A queue we cannot attribute to a customer is
 * reported as unmanaged rather than hidden — somebody put it there on purpose.
 */
export async function listManagedQueues(routerId: string): Promise<{
  queues: ManagedQueue[];
  managed: number;
  unmanaged: number;
  simulated: boolean;
}> {
  const router = await prisma.router.findUnique({
    where: { id: routerId },
    select: {
      id: true,
      name: true,
      ipAddress: true,
      apiPort: true,
      apiUser: true,
      apiSecretEnc: true,
      useSsl: true,
      sessionSource: true,
      autoQueues: true,
      useRadius: true,
    },
  });
  if (!router) return { queues: [], managed: 0, unmanaged: 0, simulated: false };

  const customers = await prisma.customer.findMany({
    where: { routerId, username: { not: "" } },
    select: {
      username: true,
      package: { select: { name: true } },
    },
  });
  const byQueue = new Map(
    customers.map((c) => [queueName(c.username), { username: c.username, packageName: c.package?.name ?? null }])
  );

  const adapter = await adapterForRouterRow(router);
  if (!adapter.live) {
    return { queues: [], managed: 0, unmanaged: 0, simulated: true };
  }
  const rows = await adapter.listBandwidthQueues();

  const queues: ManagedQueue[] = rows
    .filter((r) => r.name.startsWith("isp-"))
    .map((r) => {
      const owner = byQueue.get(r.name);
      return {
        ...r,
        packageName: owner?.packageName ?? null,
        username: owner?.username ?? null,
      };
    });

  return {
    queues,
    managed: queues.filter((q) => q.username !== null).length,
    unmanaged: queues.filter((q) => q.username === null).length,
    simulated: false,
  };
}

/** One attempt at a queued bandwidth action, by its outbox row id. */
export async function applyBandwidth(actionId: string): Promise<BandwidthResult> {
  const row = await prisma.networkAction.findUnique({
    where: { id: actionId },
    select: { id: true, action: true, status: true, customerId: true },
  });
  if (!row) return { ok: false, detail: "That queued action no longer exists." };

  const removing = row.action === "removeBandwidth";

  const customer = row.customerId
    ? await prisma.customer.findUnique({
        where: { id: row.customerId },
        select: {
          id: true,
          username: true,
          connectionStatus: true,
          ipAddress: true,
          package: { select: { downloadSpeed: true, uploadSpeed: true, name: true } },
          router: {
            select: {
            id: true,
            name: true,
            ipAddress: true,
            apiPort: true,
            apiUser: true,
            apiSecretEnc: true,
            useSsl: true,
            sessionSource: true,
            autoQueues: true,
            useRadius: true,
            },
          },
        },
      })
    : null;

  if (!customer) {
    // Terminal. A customer who has gone is not coming back to be throttled, and a
    // retry will not change that.
    await prisma.networkAction.update({
      where: { id: actionId },
      data: { status: "Failed", lastError: "The customer no longer exists" },
    });
    return { ok: false, detail: "The customer no longer exists." };
  }

  const decision = decide({
    connectionStatus: customer.connectionStatus,
    router: customer.router,
    packageSpeeds: {
      download: customer.package?.downloadSpeed ?? null,
      upload: customer.package?.uploadSpeed ?? null,
    },
    ipAddress: customer.ipAddress,
  });

  if (!decision.go) {
    // The gate can close between queuing and executing — an admin switching
    // `autoQueues` off, or moving the router onto RADIUS, while a retry waited.
    // Dropping the queue rather than forcing it is the correct answer for both.
    await prisma.networkAction.update({
      where: { id: actionId },
      data: { status: "Done", lastError: null, completedAt: new Date() },
    });
    return { ok: true, skipped: true, detail: decision.reason };
  }

  // Re-read with the connection fields: `decide` works off the gate flags alone,
  // but the adapter needs somewhere to connect to.
  const row2 = await prisma.router.findUniqueOrThrow({
    where: { id: decision.router.id },
    select: {
      id: true,
      name: true,
      ipAddress: true,
      apiPort: true,
      apiUser: true,
      apiSecretEnc: true,
      useSsl: true,
      sessionSource: true,
      autoQueues: true,
      useRadius: true,
    },
  });
  const adapter = await adapterForRouterRow(row2);
  if (!adapter.live) {
    await prisma.networkAction.update({
      where: { id: actionId },
      data: { status: "Pending", lastError: "The router has no API credentials" },
    });
    return { ok: false, detail: "The router has no API credentials.", queued: true };
  }

  const name = queueName(customer.username);

  try {
    if (removing) {
      await adapter.removeBandwidthQueue(name);
      await finish(actionId, "Done", null);
      return { ok: true, detail: `Removed queue ${name}.`, changed: true };
    }

    const outcome = await adapter.ensureBandwidthQueue({
      name,
      target: decision.target,
      maxDownload: decision.download,
      maxUpload: decision.upload,
    });
    await finish(actionId, "Done", null);
    return {
      ok: true,
      changed: outcome.changed,
      detail: outcome.changed
        ? `${outcome.created ? "Created" : "Updated"} queue ${name} at ${decision.download}/${decision.upload} Mbps.`
        : `Queue ${name} was already at ${decision.download}/${decision.upload} Mbps; nothing written.`,
    };
  } catch (e) {
    // Back to Pending with the reason. This is the Phase A backoff ladder's job to
    // pick up, and the whole reason a router being briefly unreachable is not a
    // customer silently staying on the wrong speed for ever.
    const detail = e instanceof Error ? e.message : "The router did not answer";
    await prisma.networkAction.update({
      where: { id: actionId },
      data: { status: "Pending", attempts: { increment: 1 }, lastError: detail.slice(0, 300) },
    });
    return { ok: false, detail, queued: true };
  }
}

async function finish(actionId: string, status: "Done" | "Failed", error: string | null) {
  await prisma.networkAction.update({
    where: { id: actionId },
    data: { status, completedAt: status === "Done" ? new Date() : null, lastError: error },
  });
}

/** The drain's entry point, for rows this module did not create. */
export async function retryBandwidth(row: { id: string }): Promise<boolean> {
  const result = await applyBandwidth(row.id);
  return result.ok;
}

export type { NetworkAdapter };