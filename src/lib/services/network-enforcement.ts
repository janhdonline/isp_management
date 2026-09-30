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
  customer: { id: string; name: string; username: string },
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
