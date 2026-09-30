import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { logActivity } from "@/lib/services/activity";
import { adapterForRouterRow } from "@/lib/services/network";
import { syncCustomerBilling } from "@/lib/services/billing";
import type { NetworkAdapter } from "@/lib/services/network-adapter";

/**
 * Billing enforcement that actually reaches the network.
 *
 * The gap this closes: `suspendCustomer()` flipped a database column and
 * stopped. The customer kept browsing, and the only way to stop them was for
 * someone to log into the router by hand. On a network of any size that does not
 * happen, which means suspending is decorative — the single most expensive kind
 * of bug in an ISP billing system, because the report says Suspended while the
 * customer is streaming.
 *
 * Three rules shape this module:
 *
 *  - **The database is the truth, the router is the consequence.** Suspend is
 *    recorded first and committed; the router call happens afterwards. A router
 *    that is down must not stop an office suspending a non-paying customer, and
 *    must never leave the customer half-written.
 *  - **Every attempt is queued before it is tried.** A `NetworkAction` row is
 *    written first, then the call is made, then the row is resolved. If the
 *    process dies mid-call the action is still pending and the retry job finds
 *    it. Writing the row only on failure would lose exactly the case that
 *    matters: a crash during a suspend.
 *  - **A failure is reported, never swallowed.** `enforce*` returns a result
 *    rather than throwing, because a router being unreachable is a normal
 *    operating condition and must not roll back a customer's suspension.
 */

/** How many times a queued action is retried before it is given up on. */
const MAX_ATTEMPTS = 10;

/** Actions a queued row can represent. */
export type NetworkActionType =
  | "suspend"
  | "reconnect"
  | "provision"
  | "setProfile"
  | "removeSecret";

/** How each action reads on an audit log and in the enforcement queue. */
const ACTION_LABELS: Record<NetworkActionType, string> = {
  suspend: "Suspend",
  reconnect: "Reconnect",
  provision: "Provision",
  setProfile: "Set profile",
  removeSecret: "Remove secret",
};

/**
 * The actions whose *validity* depends on the customer's current state.
 *
 * Only these two get the "is this still what we want?" check in the retry job.
 * Provisioning and profile changes are idempotent by nature — a secret that
 * exists with the right profile is the desired end state whether you run the
 * action once or ten times — so re-attempting them unconditionally is correct
 * and skipping them would strand a customer whose router was briefly down.
 */
const STATE_DEPENDENT: ReadonlySet<NetworkActionType> = new Set<NetworkActionType>([
  "suspend",
  "reconnect",
]);

const isStateDependent = (action: string): boolean =>
  STATE_DEPENDENT.has(action as NetworkActionType);

/**
 * The actions that write to a router's secrets, and therefore the ones the
 * per-router `autoProvision` flag governs.
 *
 * Suspend and reconnect are absent on purpose. They disable or re-enable a
 * secret that already exists, and they are the mechanism a billing decision
 * depends on — gating those would mean a customer the office has suspended is
 * still browsing because nobody remembered a checkbox.
 */
const PROVISIONING_ACTIONS: ReadonlySet<NetworkActionType> = new Set<NetworkActionType>([
  "provision",
  "setProfile",
  "removeSecret",
]);

export type EnforcementResult = {
  ok: boolean;
  /** Human-readable, safe to show in a toast. */
  detail: string;
  /** True when nothing was attempted because the feature is switched off. */
  skipped?: boolean;
  /** True when the adapter is the simulated one — no router was actually touched. */
  simulated?: boolean;
  /** The queued action, when one is waiting or was written. */
  actionId?: string;
  queued?: boolean;
};

/* ------------------------------------------------------------------ */
/* The public entry points                                             */
/* ------------------------------------------------------------------ */

/**
 * Cuts a customer's network access.
 *
 * Works whether or not they are online: the PPP secret is disabled so the next
 * login is refused, and any live session is dropped. For a hotspot subscriber
 * there is no secret to disable, so an offline user cannot be cut off — that
 * limitation is returned in `detail` rather than reported as success.
 */
export async function enforceSuspend(
  customerId: string,
  userId?: string
): Promise<EnforcementResult> {
  return runEnforcement(customerId, "suspend", userId);
}

/**
 * Restores network access after payment clears the dues.
 */
export async function enforceReconnect(
  customerId: string,
  userId?: string
): Promise<EnforcementResult> {
  return runEnforcement(customerId, "reconnect", userId);
}

/**
 * Creates the subscriber's PPPoE secret on their router.
 *
 * Called after a new customer is committed, never before: an office must be able
 * to enter a customer even when the router is down, and the queue is what makes
 * that safe. The secret's profile comes from the customer's package unless the
 * caller states one explicitly, which is what a package change does.
 *
 * The password is read fresh from the customer row inside the transaction rather
 * than passed in by the caller. That is deliberate — a credential threaded through
 * three function signatures is a credential that ends up in a log line.
 */
export async function enforceProvision(
  customerId: string,
  userId?: string,
  profileOverride?: string
): Promise<EnforcementResult> {
  return runEnforcement(customerId, "provision", userId, undefined, {
    profile: profileOverride,
  });
}

/** Repoints an existing secret at a different rate-limit profile. */
export async function enforceSetProfile(
  customerId: string,
  profile: string,
  userId?: string
): Promise<EnforcementResult> {
  if (!profile.trim()) {
    return { ok: false, detail: "No profile was given, so nothing was changed on the router." };
  }
  return runEnforcement(customerId, "setProfile", userId, undefined, { profile });
}

/** Deletes the secret entirely, for a subscriber who has left. */
export async function enforceRemoveSecret(
  customerId: string,
  userId?: string
): Promise<EnforcementResult> {
  return runEnforcement(customerId, "removeSecret", userId);
}

/**
 * Removes a secret for a subscriber whose customer record is already gone.
 *
 * This exists because of an ordering trap. `deleteCustomerAction` deletes the
 * row and *then* tries to tell the router, so by the time the router is asked
 * the customer no longer exists — and a path that looks the customer up to find
 * the router can never work after the row it needs has been deleted. The result
 * was a live PPPoE secret for a departed customer: free service, invisible in
 * the system, and discovered by nobody until somebody tried to use that address.
 *
 * So the username and router are carried instead of looked up, and the queue row
 * holds them too — a removal has to survive the record it refers to, because
 * the whole point is that the record is not there any more.
 */
export async function enforceRemoveSecretByUsername(
  username: string,
  routerId: string | null,
  userId?: string
): Promise<EnforcementResult> {
  if (!username) {
    return { ok: false, detail: "No username was given, so the router was not told." };
  }
  if (!routerId) {
    return {
      ok: true,
      skipped: true,
      detail: `No router was on file for ${username}, so there was no secret to remove.`,
    };
  }

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
      autoProvision: true,
    },
  });

  if (!router) {
    return {
      ok: false,
      detail: `The router for ${username} no longer exists, so its secret cannot be removed.`,
    };
  }

  // Same opt-in gate as the customer-routed path, and it is more important here:
  // this path runs for a customer whose row is already gone, so nothing else
  // would stop it writing to a router that was never opted in.
  if (!router.autoProvision) {
    return {
      ok: true,
      skipped: true,
      detail:
        `Auto-provisioning is off for ${router.name}, so the secret for ${username} was left ` +
        `alone. Turn it on in Network → Routers if you want this system to manage secrets there.`,
    };
  }

  // Queued before the attempt, for the same reason as every other action: a
  // crash mid-call must not lose the removal. `customerId` is null on purpose —
  // there is no customer to point at any more, and the username is the whole
  // identity the router knows this subscriber by.
  const row = await prisma.networkAction.create({
    data: { customerId: null, routerId: router.id, username, action: "removeSecret", status: "Pending" },
  });

  let adapter: NetworkAdapter;
  try {
    adapter = await adapterForRouterRow(router);
  } catch (e) {
    return resolve(row.id, "Retry", describe(e), { name: username, username }, "removeSecret", userId);
  }

  if (!adapter.live) {
    return resolve(
      row.id,
      "Retry",
      `${router.name} has no API credentials, so the secret for ${username} was not removed. Add the API user in Network → Routers.`,
      { name: username, username },
      "removeSecret",
      userId
    );
  }

  try {
    await adapter.removeSecret(username);
  } catch (e) {
    return resolve(row.id, "Retry", describe(e), { name: username, username }, "removeSecret", userId);
  }

  return resolve(
    row.id,
    "Done",
    `Removed the secret for ${username} on ${router.name}.`,
    { name: username, username },
    "removeSecret",
    userId
  );
}

/**
 * Reconnects a suspended customer once their dues are cleared.
 *
 * Called after every payment. The rule is deliberately narrow: the customer must
 * be Suspended (not merely Active) and the recomputed due must be at or below
 * zero. Anything looser would reconnect someone who still owes money because of
 * a rounding difference, which is precisely the argument an ISP cannot afford to
 * have with a customer.
 *
 * Returns `null` when there is nothing to do, so the caller can tell "decided
 * not to act" from "acted and it failed".
 */
export async function maybeAutoReconnect(
  customerId: string,
  userId?: string
): Promise<EnforcementResult | null> {
  const s = await getSettings();
  if (s["billing.autoReconnect"] !== "true") return null;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, username: true, connectionStatus: true },
  });
  if (!customer || customer.connectionStatus !== "Suspended") return null;

  // The due is recomputed rather than read: it is derived from invoices and
  // payments, and a cached figure is how a customer stays suspended after
  // paying. `syncCustomerBilling` also writes `previousDue`, so the customer
  // list and this decision cannot disagree.
  const { due } = await syncCustomerBilling(customerId);

  if (due > 0) {
    return {
      ok: false,
      skipped: true,
      detail: `Still owes ${due} after payment, so the line stays suspended.`,
    };
  }

  // The status change and the router call are two separate consequences of one
  // fact. The database moves first.
  await prisma.customer.update({
    where: { id: customerId },
    data: {
      connectionStatus: "Active",
      suspendReason: null,
      suspendedAt: null,
    },
  });
  await logActivity({
    action: "Reconnect",
    entity: "Customer",
    entityId: customerId,
    summary: `Auto-reconnected ${customer.name} (${customer.username}) — dues cleared`,
  }, userId);

  return runEnforcement(customerId, "reconnect", userId);
}

/* ------------------------------------------------------------------ */
/* The shared implementation                                           */
/* ------------------------------------------------------------------ */

async function runEnforcement(
  customerId: string,
  action: NetworkActionType,
  userId?: string,
  /**
   * An existing queue row to carry out in place.
   *
   * A retry must reuse its own row. Creating a fresh one on each attempt would
   * leave the original Pending forever, so the queue would grow by one row per
   * attempt and the same work would be re-run from a new row every cycle.
   */
  existingActionId?: string,
  /**
   * Action-specific detail. The profile for a `setProfile` lives here so a
   * queued action carries the profile it was created for; without it a retry
   * would have to re-derive it, and a package change since then would silently
   * apply the wrong speed to a router.
   */
  options?: { profile?: string }
): Promise<EnforcementResult> {
  const s = await getSettings();

  if (s["network.enforceOnSuspend"] !== "true") {
    return {
      ok: true,
      skipped: true,
      detail:
        action === "suspend" || action === "reconnect"
          ? "Router enforcement is off, so the line was changed in the database only. See Settings → Network."
          : "Router enforcement is off, so nothing was configured on the router. See Settings → Network.",
    };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      username: true,
      // Read fresh rather than passed in: the credential is re-read at the moment
      // of provisioning so a rotated password is what reaches the router.
      password: true,
      routerId: true,
      package: { select: { mikrotikProfile: true } },
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
          autoProvision: true,
        },
      },
    },
  });

  if (!customer) {
    return { ok: false, detail: "That customer no longer exists." };
  }

  // No router means there is nothing to enforce against. Saying "done" would be
  // a lie, but blocking the suspension would be worse — the office must be able
  // to suspend a customer whose router has not been recorded yet.
  if (!customer.router) {
    return {
      ok: true,
      skipped: true,
      detail: `${customer.name} has no router on file, so there was nothing to change on the network.`,
    };
  }

  // The opt-in gate, and the reason it exists: this system writing to a router is
  // a capability an admin grants per router, not a side effect of using a
  // billing system. Without it, installing the software and filling in a router's
  // API credentials was enough to start creating and deleting PPP secrets on
  // hardware nobody had agreed this app should touch.
  //
  // Checked before the queue row is written, so a skipped action leaves no
  // trace to be retried — there is nothing pending, because nothing was wanted.
  // Suspension and reconnect are deliberately not gated: a customer the office
  // has decided to cut off should be cut off whatever this flag says, and Phase
  // A's own `network.enforceOnSuspend` is the switch for that.
  if (!customer.router.autoProvision && PROVISIONING_ACTIONS.has(action)) {
    return {
      ok: true,
      skipped: true,
      detail:
        `Auto-provisioning is off for ${customer.router.name}, so no secret was created, ` +
        `changed or removed there. Turn it on in Network → Routers if you want this system ` +
        `to manage secrets on that router.`,
    };
  }

  const enabled = action === "reconnect";

  // A caller-stated profile wins over the package's current one, because that is
  // how a package change pins the profile it wants applied.
  const profile = options?.profile?.trim() || customer.package?.mikrotikProfile || undefined;

  // Queued before the attempt. If this process dies here, the action is still
  // pending and the retry job picks it up — the alternative loses the one case
  // where a customer was meant to be cut off.
  const row = existingActionId
    ? await prisma.networkAction.update({
        where: { id: existingActionId },
        data: {
          routerId: customer.router.id,
          username: customer.username,
          ...(profile ? { payload: profile } : {}),
        },
      })
    : await prisma.networkAction.create({
        data: {
          customerId: customer.id,
          routerId: customer.router.id,
          username: customer.username,
          action,
          status: "Pending",
          // The profile is carried on the row so a retry applies the profile the
          // action was created for, not whatever the package says by then.
          payload: profile ?? null,
        },
      });

  let adapter: NetworkAdapter;
  try {
    adapter = await adapterForRouterRow(customer.router);
  } catch (e) {
    const detail = describe(e);
    return resolve(row.id, "Retry", detail, customer, action, userId);
  }

  if (!adapter.live) {
    // No credentials on the router row and none in Settings. Report it as
    // skipped rather than done, so nobody believes a subscriber was cut off.
    return resolve(
      row.id,
      "Retry",
      `${customer.router.name} has no API credentials, so ${customer.username} was not ${
        enabled ? "restored" : "disconnected"
      } on the router. Add the API user in Network → Routers.`,
      customer,
      action,
      userId
    );
  }

  try {
    switch (action) {
      case "suspend":
      case "reconnect":
        await adapter.setAccess(customer.username, enabled);
        break;

      case "provision": {
        // A subscriber with no password cannot be provisioned, and inventing one
        // would mean a credential nobody knows. Reported rather than attempted.
        if (!customer.password) {
          return resolve(
            row.id,
            "Retry",
            `${customer.name} has no PPPoE password set, so no secret could be created. Set the password on the customer record first.`,
            customer,
            action,
            userId
          );
        }
        await adapter.provisionSecret(customer.username, customer.password, profile);
        break;
      }

      case "setProfile": {
        if (!profile) {
          return resolve(
            row.id,
            "Retry",
            `No MikroTik profile was given for ${customer.username}, so nothing was changed. Set one on the package.`,
            customer,
            action,
            userId
          );
        }
        await adapter.setSecretProfile(customer.username, profile);
        break;
      }

      case "removeSecret":
        await adapter.removeSecret(customer.username);
        break;
    }
  } catch (e) {
    const detail = describe(e);
    // Still queued: a router that is off for the night gets picked up by the
    // next cron run without anyone touching the customer record again.
    return resolve(row.id, "Retry", detail, customer, action, userId);
  }

  return resolve(
    row.id,
    "Done",
    `${describeOutcome(action, enabled)} ${customer.username} on ${customer.router.name}.`,
    customer,
    action,
    userId
  );
}

function describeOutcome(action: NetworkActionType, enabled: boolean): string {
  switch (action) {
    case "suspend":
      return "Suspended";
    case "reconnect":
      return "Restored";
    case "provision":
      return "Provisioned";
    case "setProfile":
      return "Reprofiled";
    case "removeSecret":
      return "Removed the secret for";
  }
  void enabled;
}

/**
 * Records the outcome of an attempt.
 *
 * A router failure leaves the row **Pending**, not Failed. That is the whole
 * mechanism: `Failed` is terminal, and a terminal row is one the retry job will
 * never look at again — so marking a router failure as failed would mean the
 * enforcement is never retried, and the customer stays online indefinitely while
 * the system confidently reports a completed attempt. `Pending` with an attempt
 * count and a backoff is what "waiting for the router" looks like in a database.
 */
async function resolve(
  actionId: string,
  outcome: "Done" | "Retry",
  detail: string,
  /** `id` is absent for a removal queued after the customer row was deleted. */
  customer: { id?: string; name: string; username: string },
  action: NetworkActionType,
  userId: string | undefined,
  extra: { queued?: boolean } = {}
): Promise<EnforcementResult> {
  await prisma.networkAction.update({
    where: { id: actionId },
    data: {
      status: outcome === "Done" ? "Done" : "Pending",
      completedAt: outcome === "Done" ? new Date() : null,
      lastError: outcome === "Done" ? null : detail,
      attempts: { increment: 1 },
    },
  });

  await logActivity({
    action: ACTION_LABELS[action],
    entity: "Network",
    entityId: actionId,
    summary: `${ACTION_LABELS[action]} ${customer.name} (${customer.username}): ${detail}`,
  }, userId);

  return {
    ok: outcome === "Done",
    detail,
    actionId,
    ...(outcome === "Retry" ? { queued: true } : {}),
    ...extra,
  };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error talking to the router";
}

/* ------------------------------------------------------------------ */
/* The retry job                                                       */
/* ------------------------------------------------------------------ */

/**
 * Re-attempts every queued router action.
 *
 * Idempotent: a row that succeeds becomes `Done` and is never picked up again,
 * and a router action is by nature idempotent anyway (a secret is either
 * disabled or it is not). Failures back off — a router that is down stays down,
 * and hammering it every minute does not bring it back, it just fills the log.
 */
export async function retryPendingNetworkActions(max = 50): Promise<{
  retried: number;
  done: number;
  failed: number;
  givenUp: number;
}> {
  const pending = await prisma.networkAction.findMany({
    where: { status: "Pending", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: max,
  });

  const stats = { retried: pending.length, done: 0, failed: 0, givenUp: 0 };
  if (!pending.length) return stats;

  for (const row of pending) {
    // Backoff: after the first few tries, stop trying every cycle. A router
    // offline for a day is not going to be fixed by the twentieth attempt.
    if (!isDueForRetry(row)) continue;

    // Re-read the customer: a row can outlive the subscription it was for, and
    // acting on a customer's current status rather than the old one is the only
    // way to avoid re-suspending somebody who has already paid.
    const customer = row.customerId
      ? await prisma.customer.findUnique({
          where: { id: row.customerId },
          select: { id: true, name: true, username: true, connectionStatus: true },
        })
      : null;

    if (!customer) {
      // A `removeSecret` action legitimately has no customer: it exists to clean
      // up a router *after* the customer record is gone. Writing it off here
      // would guarantee the secret survives — which is the exact free line this
      // phase is meant to close. The row carries the username and the router, so
      // the work can still be done.
      if (row.action === "removeSecret") {
        const result = await retryOrphanedRemoval(row);
        if (result.ok) stats.done += 1;
        else stats.failed += 1;
        continue;
      }

      await prisma.networkAction.update({
        where: { id: row.id },
        data: { status: "Failed", lastError: "The customer no longer exists" },
      });
      stats.failed += 1;
      continue;
    }

    // If the database says the opposite of what this action wanted, the action
    // is obsolete. Disabling a secret for someone who has since paid is worse
    // than doing nothing.
    //
    // Only for suspend/reconnect. Provisioning and profile changes are not
    // statements about whether the customer *may* be online — they say what
    // their access should look like, which stays true regardless of status, and
    // applying that check to them would silently drop a queued provision for a
    // customer who was suspended between creating the record and the router
    // coming back.
    if (isStateDependent(row.action)) {
      const shouldBeEnabled = customer.connectionStatus === "Active";
      if ((row.action === "suspend") === shouldBeEnabled) {
        await prisma.networkAction.update({
          where: { id: row.id },
          data: {
            status: "Done",
            completedAt: new Date(),
            lastError: null,
            attempts: { increment: 1 },
          },
        });
        stats.done += 1;
        continue;
      }
    }

    const result = await runEnforcement(
      customer.id,
      row.action as NetworkActionType,
      undefined,
      row.id,
      // The profile the row was queued with, so a retry after a further package
      // change still applies what was originally asked for.
      row.payload ? { profile: row.payload } : undefined
    );
    if (result.ok) stats.done += 1;
    else stats.failed += 1;
  }

  // Anything past the attempt cap is marked failed so the queue does not grow
  // without limit and a human can look at it.
  const expired = await prisma.networkAction.updateMany({
    where: { status: "Pending", attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "Failed", lastError: "Given up after too many attempts" },
  });
  stats.givenUp = expired.count;

  return stats;
}

/**
 * Carries out a queued secret removal for a customer who no longer exists.
 *
 * Reuses its own row rather than creating a new one, for the same reason every
 * retry does: a fresh row per attempt would leave the original Pending forever
 * and grow the queue by one per cycle.
 */
async function retryOrphanedRemoval(row: {
  id: string;
  username: string;
  routerId: string | null;
}): Promise<{ ok: boolean }> {
  const router = row.routerId
    ? await prisma.router.findUnique({
        where: { id: row.routerId },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          apiPort: true,
          apiUser: true,
          apiSecretEnc: true,
          useSsl: true,
          sessionSource: true,
          autoProvision: true,
        },
      })
    : null;

  if (!router) {
    await prisma.networkAction.update({
      where: { id: row.id },
      data: { status: "Failed", lastError: "The router this secret was on no longer exists" },
    });
    return { ok: false };
  }

  const target = { name: row.username, username: row.username };

  let adapter: NetworkAdapter;
  try {
    adapter = await adapterForRouterRow(router);
  } catch (e) {
    return resolve(row.id, "Retry", describe(e), target, "removeSecret", undefined);
  }

  if (!adapter.live) {
    return resolve(
      row.id,
      "Retry",
      `${router.name} has no API credentials, so the secret for ${row.username} was not removed.`,
      target,
      "removeSecret",
      undefined
    );
  }

  try {
    await adapter.removeSecret(row.username);
  } catch (e) {
    return resolve(row.id, "Retry", describe(e), target, "removeSecret", undefined);
  }

  return resolve(
    row.id,
    "Done",
    `Removed the secret for ${row.username} on ${router.name}.`,
    target,
    "removeSecret",
    undefined
  );
}

/** Minutes to wait after the Nth failure: 1, 5, 15, 30, then hourly. */
function isDueForRetry(row: { attempts: number; updatedAt: Date }): boolean {
  const ladder = [1, 5, 15, 30, 60, 60, 120, 240, 480, 720];
  const waitMinutes = ladder[Math.min(row.attempts, ladder.length - 1)];
  return Date.now() - row.updatedAt.getTime() >= waitMinutes * 60_000;
}

/**
 * A count of work waiting, for the dashboard. An ISP owner needs to know the
 * database and the routers have drifted apart, because that drift is unbilled
 * service.
 */
export async function pendingEnforcementCount(): Promise<number> {
  return prisma.networkAction.count({ where: { status: "Pending" } });
}
