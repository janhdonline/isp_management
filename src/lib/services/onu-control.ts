/**
 * Remote ONU control (ISP.md §39).
 *
 * Rebooting an ONU used to mean a truck roll or a login to somebody's NMS. Support
 * could not fix "the ONU is hung" from their chair, which means the customer waited
 * and the ISP paid for the visit.
 *
 * The Phase N adapter already knows how to talk to a cabinet. This module is the
 * part in between: what the operator is about to do, whether it is safe, whether
 * the hardware can do it, and what happened afterwards.
 *
 * ## The four actions are not equally dangerous
 *
 * A reboot costs a customer about a minute. A **deauthorize** takes a paying
 * customer off the air entirely, and a **factory reset** wipes the device's
 * configuration — after which it needs the Phase M provisioning push to come back,
 * or it is a brick on a wall until somebody drives out. So the impact is computed
 * and shown before anything is sent, the customer-affecting ones need an explicit
 * second confirmation, and every one of them names the device in the prompt. A
 * misclick on "Reset" has to be obviously a misclick *before* it happens, because
 * the recovery is a site visit.
 *
 * ## Queued before it is sent
 *
 * Exactly Phase A's ordering: the outbox row is written **before** the device is
 * called, outside any transaction. A crash between the two must not lose the
 * request, and the failure mode of losing it is a device that stays hung until the
 * end of the shift. The same row is the retry record, so "did it work and did we
 * tell anybody" is one query rather than two.
 *
 * ## The outbox stores a device reference and nothing else
 *
 * `payload` is null. Not the command, not a parameter, not a hash. The action
 * type is the column, the device is the ONU row, and the only thing a retry needs
 * is the operator's intent — which is already two columns away. There is no
 * credential anywhere on this path: the adapter reads its community from Settings
 * at the moment of the call, and nothing it reads is ever written down.
 */

import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { oltAdapterFor } from "@/lib/olt";
import type { OltAdapter } from "@/lib/olt/adapter";

/** What an operator can ask a device to do. */
export type OnuAction = "reboot" | "authorize" | "deauthorize" | "reset";

export const ONU_ACTIONS: readonly OnuAction[] = [
  "reboot",
  "authorize",
  "deauthorize",
  "reset",
] as const;

/** The `NetworkAction.action` value each maps to. */
export const OUTBOX_ACTION: Record<OnuAction, string> = {
  reboot: "onuReboot",
  authorize: "onuAuthorize",
  deauthorize: "onuDeauthorize",
  reset: "onuReset",
};

export type ActionPlan = {
  action: OnuAction;
  /** Button label. */
  label: string;
  /** What the operator is about to have the hardware do. Plain words, no jargon. */
  effect: string;
  /** Whether this one takes a paying customer off the air. */
  affectsCustomer: boolean;
  /** Whether it needs the second confirmation. */
  needsConfirmation: boolean;
  /** Whether the hardware keeps its configuration. */
  keepsConfiguration: boolean;
};

/**
 * What each action means, in one place.
 *
 * The consequence sentences are the product. "Reset this ONU?" tells an operator
 * nothing; "Erase HWTC00000001's configuration. It will come back unconfigured and
 * need provisioning again." tells them whether they meant to press it.
 */
export const ACTION_PLANS: Record<OnuAction, ActionPlan> = {
  reboot: {
    action: "reboot",
    label: "Reboot",
    effect: "Power-cycle the device. The customer loses service for about a minute.",
    affectsCustomer: true,
    // A reboot is routine support work and its cost is a minute; making an operator
    // type anything for it would mean they do not, and the ones that matter get
    // skipped.
    needsConfirmation: false,
    keepsConfiguration: true,
  },
  authorize: {
    action: "authorize",
    label: "Authorize",
    effect: "Mark the device as approved, so it is allowed to pass traffic.",
    affectsCustomer: false,
    needsConfirmation: false,
    keepsConfiguration: true,
  },
  deauthorize: {
    action: "deauthorize",
    label: "Deauthorize",
    effect:
      "Stop the device passing traffic. If a customer is on it, their service stops now — not on the next login, now.",
    affectsCustomer: true,
    needsConfirmation: true,
    keepsConfiguration: true,
  },
  reset: {
    action: "reset",
    label: "Factory reset",
    effect:
      "Erase the device's configuration entirely. It comes back with nothing on it and will need provisioning again before it serves anyone.",
    affectsCustomer: true,
    needsConfirmation: true,
    keepsConfiguration: false,
  },
};

/** Statuses this module uses on the outbox, beyond Phase A's. */
const RUNNING = "Running";

export type OnuTarget = {
  onuId: string;
  serialNo: string;
  name: string | null;
  vendor: string | null;
  ponIndex: string | null;
  oltId: string | null;
  oltName: string | null;
  /**
   * The cabinet's own polling configuration, carried through to the adapter.
   *
   * It has to travel with the target. `oltAdapterFor` reads the management address,
   * the vendor and the SNMP port from the row it is given, so passing only an id
   * produced an unconfigured adapter — and an unconfigured adapter reports every
   * action unsupported, which would have made this whole feature refuse to do
   * anything on every cabinet in the country. The tests caught it; reading the code
   * did not.
   */
  olt: {
    id: string;
    name: string;
    ipAddress: string | null;
    apiVendor: string | null;
    snmpCommunityEnc: boolean;
    snmpPort: number | null;
  } | null;
  customer: { id: string; name: string; connectionStatus: string } | null;
};

export type ActionPreview = {
  target: OnuTarget | null;
  plan: ActionPlan;
  /** Whether the cabinet's adapter can do this at all. */
  supported: boolean;
  /** Why not, when `supported` is false. */
  unsupportedReason: string | null;
  /** Live customer impact, so the confirm step can quote it. */
  impact: {
    hasCustomer: boolean;
    customerName: string | null;
    /** True when the link is live enough that deauthorizing cuts service now. */
    live: boolean;
    warning: string | null;
  };
};

async function loadTarget(serialNo: string): Promise<OnuTarget | null> {
  const onu = await prisma.onu.findUnique({
    where: { serialNo: serialNo.trim() },
    select: {
      id: true,
      serialNo: true,
      name: true,
      vendor: true,
      ponIndex: true,
      oltId: true,
      olt: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          apiVendor: true,
          snmpCommunityEnc: true,
          snmpPort: true,
        },
      },
      customers: {
        take: 1,
        select: { id: true, name: true, connectionStatus: true, onlineStatus: true },
      },
    },
  });
  if (!onu) return null;
  const customer = onu.customers[0] ?? null;
  return {
    onuId: onu.id,
    serialNo: onu.serialNo,
    name: onu.name,
    vendor: onu.vendor,
    ponIndex: onu.ponIndex,
    oltId: onu.oltId,
    oltName: onu.olt?.name ?? null,
    olt: onu.olt ?? null,
    customer: customer
      ? { id: customer.id, name: customer.name, connectionStatus: customer.connectionStatus }
      : null,
  };
}

/** Is the linked customer currently receiving service through this device? */
function impactOf(
  target: OnuTarget,
  plan: ActionPlan
): ActionPreview["impact"] {
  const customer = target.customer;
  if (!customer) {
    return {
      hasCustomer: false,
      customerName: null,
      live: false,
      warning: null,
    };
  }
  // A suspended customer is not on the air, so cutting them off changes nothing
  // they can feel. Saying otherwise would train an operator to ignore the warning.
  const live = customer.connectionStatus === "Active";
  return {
    hasCustomer: true,
    customerName: customer.name,
    live,
    warning: live
      ? `${customer.name} is on this ONU and active. ${plan.label} stops their service immediately.`
      : `${customer.name} is on this ONU but ${customer.connectionStatus.toLowerCase()}, so they are not on the air at the moment.`,
  };
}

/**
 * What would happen if this operator pressed this button, before they press it.
 *
 * Used by both the ONU row and the customer profile, so the two can never describe
 * the same action differently.
 */
export async function previewOnuAction(
  serialNo: string,
  action: OnuAction,
  adapterFor: AdapterResolver = oltAdapterFor
): Promise<ActionPreview> {
  const plan = ACTION_PLANS[action];
  const target = await loadTarget(serialNo);

  if (!target) {
    return {
      target: null,
      plan,
      supported: false,
      unsupportedReason: `No ONU with the serial ${serialNo} is in the database.`,
      impact: { hasCustomer: false, customerName: null, live: false, warning: null },
    };
  }

  if (!target.oltId || !target.olt) {
    return {
      target,
      plan,
      supported: false,
      unsupportedReason:
        "This ONU is not on an OLT, so there is no cabinet to send the command to. Check the device is registered.",
      impact: impactOf(target, plan),
    };
  }

  const adapter = await adapterFor({
    id: target.olt.id,
    name: target.olt.name,
    ipAddress: target.olt.ipAddress,
    apiVendor: target.olt.apiVendor,
    snmpCommunityEnc: target.olt.snmpCommunityEnc,
    snmpPort: target.olt.snmpPort,
  });

  const capabilities = capabilitiesOf(adapter);
  if (!capabilities.includes(action)) {
    return {
      target,
      plan,
      supported: false,
      unsupportedReason: adapter.live
        ? `${target.oltName ?? "That OLT"}'s adapter does not support ${plan.label.toLowerCase()}.`
        : `${target.oltName ?? "That OLT"} has no API vendor or SNMP community configured, so it cannot be commanded. Set one on the OLT first.`,
      impact: impactOf(target, plan),
    };
  }

  return { target, plan, supported: true, unsupportedReason: null, impact: impactOf(target, plan) };
}

function capabilitiesOf(adapter: OltAdapter): OnuAction[] {
  return typeof adapter.capabilities === "function" ? adapter.capabilities() : ONU_ACTIONS.slice();
}

export type RequestResult =
  | {
      ok: true;
      action: OnuAction;
      serialNo: string;
      detail: string;
      /** True when the device answered immediately. */
      executed: boolean;
      /** True when a row for this device and action was already waiting. */
      deduped: boolean;
      actionId: string;
    }
  | { ok: false; action: OnuAction; detail: string; deduped?: boolean };

/**
 * Asks for an action: writes the outbox row, then makes the call.
 *
 * ## Why the row is written first
 *
 * Phase A's ordering, for Phase A's reason. If the process dies between the two
 * the request is still in the queue; if we called the device first and then wrote
 * the row, a successful reboot with no record would leave an operator wondering
 * whether it had worked, and a failed one with no row would leave a device hung with
 * nothing queued to retry it.
 *
 * ## Two operators, one device
 *
 * Two concurrent reboots of the same ONU must not both reach the hardware. Two
 * claims, because there are two things to stop:
 *
 *  - **Two rows.** Inside a transaction that takes `FOR UPDATE` on the ONU row, so
 *    the two requests serialise and the second sees the row the first created. The
 *    lock is on the ONU because the requests are about the same device — the same
 *    reasoning as Phase O's lock on the OLT, and for the same reason: a check
 *    before an insert is two queries and both can pass it.
 *  - **Two executions of one row.** `executeOnuAction` claims the row by moving it
 *    from `Pending` to `Running` with a conditional update, so the loser's
 *    `count` is zero and it returns without touching the device. This is the claim
 *    Phase A's drain does *not* make, and this module needs it: a double reboot is
 *    a customer watching two outages.
 */
export async function requestOnuAction(input: {
  serialNo: string;
  action: OnuAction;
  actorId: string;
  /** Why, for the ones that need a reason. */
  reason?: string | null;
  /** The second confirmation for the customer-affecting actions. */
  confirmCustomerImpact?: boolean;
  /** Swappable in tests; production always resolves from the row. */
  adapterFor?: AdapterResolver;
}): Promise<RequestResult> {
  const plan = ACTION_PLANS[input.action];
  const preview = await previewOnuAction(input.serialNo, input.action, input.adapterFor);

  if (!preview.target) {
    return { ok: false, action: input.action, detail: preview.unsupportedReason ?? "No such ONU." };
  }
  const target = preview.target;

  if (!preview.supported) {
    // Refused *before* anything is written: an unsupported action must not leave a
    // row in the queue that will fail on every retry for ever.
    await logActivity(
      {
        action: "Reject",
        entity: "Onu",
        entityId: target.onuId,
        summary: `Refused ${plan.label} on ONU ${target.serialNo}: ${preview.unsupportedReason}`,
      },
      input.actorId
    );
    return { ok: false, action: input.action, detail: preview.unsupportedReason ?? "Not supported." };
  }

  if (plan.needsConfirmation && !input.confirmCustomerImpact) {
    // The service layer refuses, not just the dialog. A UI-only check is one
    // `curl` away from not existing, and this is the one that takes a paying
    // customer off the air.
    return {
      ok: false,
      action: input.action,
      detail: `${plan.label} affects a customer on this ONU. It has to be confirmed explicitly, not just requested.`,
    };
  }

  const outbox = await enqueue({
    onuId: target.onuId,
    serialNo: target.serialNo,
    customerId: target.customer?.id ?? null,
    action: input.action,
  });

  if (outbox.deduped) {
    await logActivity(
      {
        action: "Update",
        entity: "Onu",
        entityId: target.onuId,
        summary: `${plan.label} on ONU ${target.serialNo} was already queued; not sent twice`,
      },
      input.actorId
    );
    return {
      ok: true,
      action: input.action,
      serialNo: target.serialNo,
      detail: `${plan.label} on ${target.serialNo} was already queued and is still waiting. Only one was sent.`,
      executed: false,
      deduped: true,
      actionId: outbox.id,
    };
  }

  const result = await executeOnuAction(outbox.id, input.adapterFor);

  await logActivity(
    {
      action: "Update",
      entity: "Onu",
      entityId: target.onuId,
      summary:
        `${plan.label} on ONU ${target.serialNo}` +
        (result.ok ? " — accepted by the device" : ` — failed: ${result.detail}`) +
        (result.queued ? " (queued for retry)" : "") +
        (input.reason ? ` — reason: ${input.reason}` : ""),
    },
    input.actorId
  );

  return {
    ok: result.ok,
    action: input.action,
    serialNo: target.serialNo,
    detail: result.detail,
    executed: true,
    deduped: false,
    actionId: outbox.id,
  };
}

/**
 * How long a *completed* attempt still absorbs a repeat.
 *
 * The lock on the ONU row makes genuinely overlapping requests share one row, and
 * the conditional claim in `executeOnuAction` stops one row being executed twice.
 * Neither covers the commonest accident there is: an operator double-clicking
 * Reboot, where the second request arrives *after* the first has already finished
 * and its row is `Done`.
 *
 * So a completed row absorbs a repeat within this window. It is a short window on
 * purpose, and it is a different thing from the caches this codebase argues
 * elsewhere: nothing here decides *whether a device can be reached* or *how full a
 * port is*. It only answers "was this exact command, on this exact device, sent a
 * moment ago" — and the answer being ten seconds stale costs one reboot.
 *
 * Beyond the window a repeat is a **new intent**, not a duplicate. A reboot that
 * worked thirty seconds ago and another one now is an operator who changed their
 * mind, and absorbing it would silently do nothing to a hung device.
 */
const ABSORB_COMPLETED_MS = 10_000;

/**
 * Writes the outbox row, or reports that one already covers this request.
 *
 * `payload` stays null: the action is the `action` column and the device is the ONU
 * row, so a retry has everything it needs and nothing that could be a credential.
 */
async function enqueue(input: {
  onuId: string;
  serialNo: string;
  customerId: string | null;
  action: OnuAction;
}): Promise<{ id: string; deduped: boolean }> {
  const outboxAction = OUTBOX_ACTION[input.action];

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Onu" WHERE id = ${input.onuId} FOR UPDATE`;

    const waiting = await tx.networkAction.findFirst({
      where: {
        action: outboxAction,
        username: input.serialNo,
        OR: [
          // Still to be done, or in the middle of being done.
          { status: { in: ["Pending", RUNNING] } },
          // Just done, and the operator has not had time to see it yet.
          {
            status: "Done",
            completedAt: { gte: new Date(Date.now() - ABSORB_COMPLETED_MS) },
          },
        ],
      },
      select: { id: true },
    });
    if (waiting) return { id: waiting.id, deduped: true };

    const created = await tx.networkAction.create({
      data: {
        customerId: input.customerId,
        routerId: null,
        // The serial is the only handle a device knows itself by.
        username: input.serialNo,
        action: outboxAction,
        status: "Pending",
        payload: null,
      },
      select: { id: true },
    });
    return { id: created.id, deduped: false };
  });
}

export type ExecuteResult = { ok: boolean; detail: string; queued: boolean };

/**
 * Makes one attempt at a queued action.
 *
 * Claims the row first, so two runs cannot both reach the device. On success the
 * row is `Done`; on failure it goes back to `Pending` with the reason and an
 * incremented attempt count, which is what Phase A's backoff ladder then picks up.
 */
export async function executeOnuAction(
  actionId: string,
  adapterFor: AdapterResolver = oltAdapterFor
): Promise<ExecuteResult> {
  const row = await prisma.networkAction.findUnique({
    where: { id: actionId },
    select: {
      id: true,
      action: true,
      username: true,
      status: true,
      attempts: true,
    },
  });
  if (!row) return { ok: false, detail: "That queued action no longer exists.", queued: false };

  const action = actionFromOutbox(row.action);
  if (!action) {
    await finish(actionId, "Failed", "Not an ONU action");
    return { ok: false, detail: "Not an ONU action.", queued: false };
  }

  // The claim. A conditional update, so the loser of a race gets `count: 0` and
  // never touches the device.
  const claimed = await prisma.networkAction.updateMany({
    where: { id: actionId, status: "Pending" },
    data: { status: RUNNING, attempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      detail: "Another run is already doing this.",
      queued: true,
    };
  }

  const onu = await prisma.onu.findUnique({
    where: { serialNo: row.username },
    select: {
      id: true,
      serialNo: true,
      oltId: true,
      olt: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          apiVendor: true,
          snmpCommunityEnc: true,
          snmpPort: true,
        },
      },
    },
  });
  if (!onu) {
    await finish(actionId, "Failed", "The ONU is no longer in the database");
    return { ok: false, detail: "The ONU is no longer in the database.", queued: false };
  }
  if (!onu.oltId || !onu.olt) {
    await finish(actionId, "Failed", "The ONU is no longer on an OLT");
    return { ok: false, detail: "The ONU is not on an OLT.", queued: false };
  }

  const adapter = await adapterFor({
    id: onu.olt.id,
    name: onu.olt.name,
    ipAddress: onu.olt.ipAddress,
    apiVendor: onu.olt.apiVendor,
    snmpCommunityEnc: onu.olt.snmpCommunityEnc,
    snmpPort: onu.olt.snmpPort,
  });
  if (!capabilitiesOf(adapter).includes(action)) {
    // Terminal. Retrying will not make an adapter grow a capability, and a row that
    // fails ten times for this reason is noise in the queue.
    await finish(actionId, "Failed", "The OLT adapter does not support this action");
    return { ok: false, detail: "The OLT adapter does not support this action.", queued: false };
  }

  let outcome: { ok: boolean; detail: string };
  try {
    outcome = await callAdapter(adapter, action, onu.serialNo);
  } catch (e) {
    outcome = {
      ok: false,
      detail: e instanceof Error ? e.message : "The adapter threw",
    };
  }

  if (outcome.ok) {
    await finish(actionId, "Done", outcome.detail);
    return { ok: true, detail: outcome.detail, queued: false };
  }

  // Back to Pending with the reason. `lastError` is what Phase A's ladder shows.
  await prisma.networkAction.update({
    where: { id: actionId },
    data: { status: "Pending", lastError: outcome.detail.slice(0, 300) },
  });

  // The device row is not touched on failure. A reboot that did not happen has not
  // rebooted anything, and nothing about the ONU changed as a result of asking.
  return { ok: false, detail: outcome.detail, queued: true };
}

async function callAdapter(
  adapter: OltAdapter,
  action: OnuAction,
  serialNo: string
): Promise<{ ok: boolean; detail: string }> {
  switch (action) {
    case "reboot": {
      const r = await adapter.rebootOnu(serialNo);
      return { ok: r, detail: r ? "The device accepted the reboot." : "The device refused the reboot." };
    }
    case "authorize": {
      const r = await adapter.authorizeOnu(serialNo);
      return { ok: r, detail: r ? "The device is now authorized." : "The device refused the authorization." };
    }
    case "deauthorize": {
      const r = await adapter.deauthorizeOnu(serialNo);
      return { ok: r, detail: r ? "The device was deauthorized." : "The device refused the command." };
    }
    case "reset": {
      const r = await adapter.factoryReset(serialNo);
      return { ok: r, detail: r ? "The device is resetting to factory defaults." : "The device refused the reset." };
    }
  }
}

async function finish(actionId: string, status: "Done" | "Failed" | "Pending", detail: string) {
  await prisma.networkAction.update({
    where: { id: actionId },
    data: {
      status,
      completedAt: status === "Done" ? new Date() : null,
      lastError: status === "Done" ? null : detail.slice(0, 300),
    },
  });
}

/** `onuReboot` → `reboot`. */
export function actionFromOutbox(action: string): OnuAction | null {
  const found = (Object.keys(OUTBOX_ACTION) as OnuAction[]).find(
    (a) => OUTBOX_ACTION[a] === action
  );
  return found ?? null;
}

/** True when an action name belongs to this module — used by the drain. */
export function isOnuOutboxAction(action: string): boolean {
  return actionFromOutbox(action) !== null;
}

/**
 * How a cabinet becomes an adapter.
 *
 * A parameter rather than a hardcoded `oltAdapterFor` so a test can drive the whole
 * path — preview, queue, execute, log — against a device that records what it was
 * told. The alternative, exporting the internals as `…ForTest`, is a seam nobody can
 * later change; this one is a real dependency and the default is the production
 * behaviour.
 */
export type AdapterResolver = (row: {
  id: string;
  name: string;
  ipAddress: string | null;
  apiVendor: string | null;
  snmpCommunityEnc: boolean;
  snmpPort: number | null;
}) => Promise<OltAdapter>;

/**
 * The retry entry point, called by `retryPendingNetworkActions` for rows this
 * module did not create.
 *
 * The ladder, the attempt cap and the backoff belong to Phase A and are not
 * repeated here.
 */
export async function retryOnuAction(
  row: { id: string },
  adapterFor?: AdapterResolver
): Promise<boolean> {
  const result = await executeOnuAction(row.id, adapterFor);
  return result.ok;
}

/**
 * A row stuck in `Running` is a process that died mid-call.
 *
 * Without this the status would be a permanent hole: the drain selects `Pending`,
 * so a `Running` row from a crash would sit for ever and the operator's reboot
 * would never happen again. Anything older than a few minutes is older than any
 * plausible device call, so it goes back in the queue.
 */
export async function reclaimStaleOnuActions(
  olderThanMs = 5 * 60_000
): Promise<number> {
  const { count } = await prisma.networkAction.updateMany({
    where: { status: RUNNING, updatedAt: { lt: new Date(Date.now() - olderThanMs) } },
    data: { status: "Pending" },
  });
  return count;
}