"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isCorporate } from "@/lib/enums";
import {
  corporateFieldsFor,
  resolveDefaultSlaHours,
  slaHoursFor,
} from "@/lib/services/corporate";
import { requirePermission } from "@/lib/auth";
import { customerSchema, customerUpdateSchema, fieldErrors, FieldErrors } from "@/lib/validators";
import { nextNumber, Tx } from "@/lib/counter";
import { getSettings } from "@/lib/settings";
import { addDays, round2, startOfDay } from "@/lib/utils";
import { logActivity, prismaLog } from "@/lib/services/activity";
import { setPortalPassword } from "@/lib/portal-auth";
import { checkPasswordStrength } from "@/lib/password";
import { changePackage, deleteCustomer, disconnectCustomer, reconnectCustomer, renewCustomer, suspendCustomer } from "@/lib/services/customers";
import { syncCustomerBilling } from "@/lib/services/billing";
import { bookActivationAdvance } from "@/lib/services/wallet";
import {
  enforceProvision,
  enforceReconnect,
  enforceRemoveSecretByUsername,
  enforceSetProfile,
  enforceSuspend,
} from "@/lib/services/network-enforcement";

export type FormState = {
  errors?: FieldErrors;
  formError?: string;
  success?: string;
  id?: string;
};

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requirePermission("customers.create");
  const raw = Object.fromEntries(formData);

  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  // unique checks (ISP.md §17)
  const [dupUser, dupPhone, dupCode] = await Promise.all([
    prisma.customer.findUnique({ where: { username: parsed.data.username } }),
    prisma.customer.findFirst({ where: { phone: parsed.data.phone } }),
    prisma.customer.findFirst({ where: { name: parsed.data.name, phone: parsed.data.phone } }),
  ]);
  const errors: FieldErrors = {};
  if (dupUser) errors.username = ["This username is already taken"];
  if (dupPhone) errors.phone = ["A customer with this phone number already exists"];
  else if (dupCode) errors.phone = ["A customer with the same name and phone already exists"];
  if (Object.keys(errors).length) return { errors, formError: "Duplicate customer detected." };

  const d = parsed.data;
  const settings = await getSettings();
  const prefix = settings["billing.customerPrefix"] ?? "CUS";

  const result = await prisma.$transaction(async (tx) => {
    const customerCode = await nextNumber(tx, "customer", `${prefix}-`);
    const created = await tx.customer.create({
      data: {
        customerCode,
        name: d.name,
        fatherName: d.fatherName,
        motherName: d.motherName,
        phone: d.phone,
        altPhone: d.altPhone,
        email: d.email,
        nid: d.nid,
        dateOfBirth: d.dateOfBirth ?? null,
        gender: d.gender || null,
        address: d.address,
        areaId: d.areaId || null,
        resellerId: d.resellerId || null,
        customerType: d.customerType,
        // Corporate fields (Phase J). Null on a Home account rather than "", so
        // "not a corporate client" stays a fact rather than an empty string that
        // somebody later has to interpret. The SLA falls back to the Settings
        // default so every corporate client has a deadline — a ticket with no
        // slaDueAt gives the SLA tracker (Phase U) nothing to measure against.
        ...corporateFieldsFor(d),
        // The type decides whether there is an SLA at all; the Settings default only
        // fills in what one already exists and left unset. A `??` against
        // `corporateFieldsFor(...).slaHours` here would give every Home customer a
        // 4-hour commitment they never bought.
        slaHours: slaHoursFor(
          d.customerType,
          corporateFieldsFor(d).slaHours,
          resolveDefaultSlaHours((await getSettings())["corporate.defaultSlaHours"])
        ),
        photoUrl: d.photoUrl,
        username: d.username,
        password: d.password || undefined,
        connectionType: d.connectionType,
        packageId: d.packageId,
        ipType: d.ipType,
        ipAddress: d.ipAddress || null,
        macAddress: d.macAddress || null,
        routerId: d.routerId || null,
        oltId: d.oltId || null,
        onuId: d.onuId || null,
        ponPort: d.ponPort,
        connectionDate: d.connectionDate,
        billingDate: d.billingDate ?? null,
        expiryDate: d.expiryDate ?? null,
        monthlyBill: d.monthlyBill,
        installationFee: d.installationFee,
        // Zero, and raised through the wallet below. Writing the form's value here
        // would set a balance with no ledger row behind it, so the wallet's
        // invariant — SUM(amount) equals advancePayment — would be false from the
        // first customer created with money in advance, and the reconciliation
        // check would fail for the rest of the life of the database.
        advancePayment: 0,
        previousDue: 0,
        discount: d.discount,
        vat: d.vat,
        totalPayable: d.totalPayable,
        connectionStatus: "Active",
        billingStatus: "Unpaid",
        onlineStatus: "Offline",
        note: d.note,
        createdById: session.id,
      },
    });

    // If the customer paid upfront, it becomes a wallet balance through the same
    // transaction — the receipt and the ledger row, so the money has an entry the
    // moment it exists.
    await bookActivationAdvance(tx, {
      customerId: created.id,
      amount: d.advancePayment,
      packageId: d.packageId,
      reference: `ADV-${customerCode}`,
      createdById: session.id,
    });

    await prismaLog(
      tx,
      { action: "Create", entity: "Customer", entityId: created.id, summary: `Created customer ${created.name} (${created.username})` },
      session.id
    );
    return created;
  });

  await syncCustomerBilling(result.id);

  // Router provisioning happens after the commit, never inside it. Two reasons,
  // and both matter: a router call held open across a transaction holds a
  // connection and a row lock for as long as the router takes to answer, and the
  // office must be able to enter a customer even when the router is down. If the
  // call fails the action is queued and the retry job carries it out.
  const provisioned = await maybeProvisionOnRouter(result, session.id);

  revalidatePath("/customers");
  revalidatePath("/dashboard");
  revalidatePath("/network");

  const suffix = provisioned.queued
    ? " Router provisioning is queued and will be retried automatically."
    : "";

  const intent = formData.get("_intent");
  if (intent === "invoice") {
    redirect(`/billing/invoices/new?customerId=${result.id}`);
  }
  if (intent === "new") {
    return { success: `Customer ${result.customerCode} created.${suffix}` };
  }
  redirect(`/customers/${result.id}`);
}

/**
 * Creates the PPPoE secret for a brand-new customer, when that makes sense.
 *
 * Three cases are declined on purpose, each reported rather than passed over:
 *
 *  - no router is chosen yet — there is nowhere to provision, and a customer
 *    added before the office knows which router serves them is normal;
 *  - the router terminates hotspot, which has no secret to create;
 *  - enforcement is switched off in Settings.
 *
 * Anything that *can* be provisioned is, and anything that fails is queued. The
 * customer is never blocked on a router.
 */
async function maybeProvisionOnRouter(
  customer: { id: string; routerId: string | null },
  userId: string
): Promise<{ queued: boolean; note: string }> {
  if (!customer.routerId) {
    return { queued: false, note: "No router selected, so nothing was provisioned." };
  }

  const router = await prisma.router.findUnique({
    where: { id: customer.routerId },
    select: { name: true, sessionSource: true },
  });
  if (!router) return { queued: false, note: "The chosen router no longer exists." };

  if (router.sessionSource === "hotspot") {
    await logActivity(
      {
        action: "Skip",
        entity: "Customer",
        entityId: customer.id,
        summary: `Router provisioning skipped: ${router.name} terminates hotspot, which has no PPP secret to create`,
      },
      userId
    );
    return { queued: false, note: `${router.name} is a hotspot router, so no secret was created.` };
  }

  const result = await enforceProvision(customer.id, userId);
  if (result.ok) return { queued: false, note: result.detail };
  // Queued rather than failed: the retry job will carry it out, and the queue
  // page shows it if it does not.
  return {
    queued: result.queued ?? true,
    note: result.detail,
  };
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

export async function updateCustomerAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await requirePermission("customers.edit");
  const raw = Object.fromEntries(formData);
  const id = String(raw.id ?? "");
  if (!id) return { formError: "Missing customer id." };

  const parsed = customerUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error), formError: "Please fix the highlighted fields." };
  }

  if (parsed.data.username) {
    const dup = await prisma.customer.findUnique({
      where: { username: parsed.data.username },
    });
    if (dup && dup.id !== id) return { errors: { username: ["This username is already taken"] } };
  }

  const d = parsed.data;

  await prisma.$transaction(async (tx: Tx) => {
    await tx.customer.update({
      where: { id },
      data: {
        ...d,
        areaId: d.areaId === "" ? null : (d.areaId ?? undefined),
        email: d.email === "" ? null : (d.email ?? undefined),
        altPhone: d.altPhone === "" ? null : (d.altPhone ?? undefined),
        gender: d.gender === "" ? null : (d.gender ?? undefined),
        ipAddress: d.ipAddress === "" ? null : (d.ipAddress ?? undefined),
        macAddress: d.macAddress === "" ? null : (d.macAddress ?? undefined),
        routerId: d.routerId === "" ? null : (d.routerId ?? undefined),
        oltId: d.oltId === "" ? null : (d.oltId ?? undefined),
        onuId: d.onuId === "" ? null : (d.onuId ?? undefined),
        // Corporate fields on edit too, so a Home account converted to Corporate
        // gets them and a Corporate account converted back has them cleared. The
        // `corporateFields` helper makes that symmetric, which a spread of
        // individual `?? undefined` assignments would not.
        ...corporateFieldsFor(d),
        // The type decides whether there is an SLA at all; the Settings default only
        // fills in what one already exists and left unset. A `??` against
        // `corporateFieldsFor(...).slaHours` here would give every Home customer a
        // 4-hour commitment they never bought.
        slaHours: slaHoursFor(
          d.customerType,
          corporateFieldsFor(d).slaHours,
          resolveDefaultSlaHours((await getSettings())["corporate.defaultSlaHours"])
        ),
      },
    });
    await prismaLog(
      tx,
      {
        action: "Update",
        entity: "Customer",
        entityId: id,
        summary: isCorporate(d.customerType)
          ? "Customer details updated — corporate account"
          : "Customer details updated",
      },
      session.id
    );
  });

  await syncCustomerBilling(id);
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  return { success: "Customer updated." };
}

/* ------------------------------------------------------------------ */
/* Lifecycle actions                                                   */
/* ------------------------------------------------------------------ */

async function runLifecycle(
  permission: Parameters<typeof requirePermission>[0],
  action: (tx: Tx, userId: string) => Promise<unknown>,
  paths: string[],
  message: string
): Promise<FormState> {
  try {
    const session = await requirePermission(permission);
    await prisma.$transaction((tx) => action(tx, session.id));
    paths.forEach((p) => revalidatePath(p));
    return { success: message };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Action failed" };
  }
}

export async function suspendCustomerAction(
  id: string,
  reason: string
): Promise<FormState> {
  if (!reason.trim()) return { formError: "A reason is required to suspend a customer." };
  const result = await runLifecycle(
    "customers.edit",
    (tx, userId) => suspendCustomer(tx, id, reason, userId),
    ["/customers", `/customers/${id}`, "/dashboard", "/network"],
    "Customer suspended."
  );

  // The router call happens *after* the transaction has committed, never inside
  // it: a router that is offline must not roll back a suspension the office has
  // already decided on, and a network call held open across a transaction holds a
  // connection and a row lock for as long as the router takes to answer.
  if (result.success) {
    const enforced = await enforceSuspend(id);
    if (!enforced.ok && !enforced.skipped) {
      // The suspension itself stands — it is committed and correct. What failed
      // is telling the router, which is queued for retry. Saying so is the whole
      // point: an operator who believes the line is dead will not chase it.
      return {
        success: `Customer suspended in the system, but the router was not reached: ${enforced.detail} It will be retried automatically.`,
      };
    }
  }
  return result;
}

export async function reconnectCustomerAction(id: string): Promise<FormState> {
  const result = await runLifecycle(
    "customers.edit",
    (tx, userId) => reconnectCustomer(tx, id, userId),
    ["/customers", `/customers/${id}`, "/dashboard", "/network"],
    "Customer reconnected."
  );

  if (result.success) {
    const enforced = await enforceReconnect(id);
    if (!enforced.ok && !enforced.skipped) {
      return {
        success: `Customer reconnected in the system, but the router was not reached: ${enforced.detail} It will be retried automatically.`,
      };
    }
  }
  return result;
}

export async function disconnectCustomerAction(
  id: string,
  reason: string
): Promise<FormState> {
  if (!reason.trim()) return { formError: "A reason is required to disconnect a customer." };
  const result = await runLifecycle(
    "customers.delete",
    (tx, userId) => disconnectCustomer(tx, id, reason, userId),
    ["/customers", `/customers/${id}`, "/dashboard", "/network"],
    "Customer disconnected."
  );

  // A disconnect is the end of the relationship, so the PPP secret is removed
  // rather than merely disabled — otherwise the next subscriber assigned the same
  // address inherits somebody else's credentials.
  if (result.success) await enforceSuspend(id);
  return result;
}

export async function renewCustomerAction(
  id: string,
  days: number
): Promise<FormState> {
  if (!days || days < 1) return { formError: "Enter a valid number of days." };
  return runLifecycle(
    "customers.edit",
    (tx, userId) => renewCustomer(tx, id, days, userId),
    ["/customers", `/customers/${id}`, "/dashboard"],
    `Subscription extended by ${days} days.`
  );
}

export async function changePackageAction(
  id: string,
  packageId: string,
  reason: string
): Promise<FormState> {
  if (!packageId) return { formError: "Select a package." };

  // Read both profiles *before* the change, so the router is only touched when
  // the rate limit actually differs. Repointing a secret to the profile it
  // already has is a wasted write and, on a busy router, a wasted lock.
  const before = await prisma.customer.findUnique({
    where: { id },
    select: { package: { select: { mikrotikProfile: true } } },
  });
  const next = await prisma.package.findUnique({
    where: { id: packageId },
    select: { mikrotikProfile: true },
  });

  const result = await runLifecycle(
    "customers.edit",
    (tx, userId) => changePackage(tx, id, packageId, reason || "Package changed", userId),
    ["/customers", `/customers/${id}`, "/dashboard", "/network"],
    "Package changed."
  );

  if (!result.success) return result;

  const oldProfile = before?.package?.mikrotikProfile ?? null;
  const newProfile = next?.mikrotikProfile ?? null;

  if (!newProfile) {
    // No profile on the new package. Nothing is applied rather than clearing the
    // one the customer has, because silently removing a rate limit is a bigger
    // change than the operator asked for.
    return {
      success: `${result.success} The new package has no MikroTik profile, so the router speed was left as it is.`,
    };
  }
  if (oldProfile === newProfile) return result;

  const applied = await enforceSetProfile(id, newProfile);
  if (!applied.ok) {
    return {
      success: `${result.success} The router profile was not changed: ${applied.detail} It is queued and will be retried.`,
    };
  }
  return result;
}

export async function deleteCustomerAction(id: string): Promise<FormState> {
  try {
    const session = await requirePermission("customers.delete");

    // Read the username before the row goes, so the router can be told even
    // though the customer record will not exist to retry against.
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { username: true, routerId: true },
    });

    await deleteCustomer(id, session.id);

    // Best effort. The customer is gone either way, and refusing to delete
    // because a router is unreachable would leave the office unable to clear a
    // record they need gone. A disabled-but-present secret is a nuisance; a
    // live one is a working line someone is still using for free.
    let note = "";
    if (customer?.username) {
      // The username-based path, not the customer-id one. The row is gone by
      // now, so anything that looks the customer up to find the router finds
      // nothing — which meant the secret was never removed and a departed
      // subscriber kept a working line for free.
      const removed = await enforceRemoveSecretByUsername(
        customer.username,
        customer.routerId,
        session.id
      );
      if (!removed.ok) {
        note = ` The router was not reached (${removed.detail}) — that secret should be removed by hand.`;
      }
    }

    revalidatePath("/customers");
    revalidatePath("/dashboard");
    revalidatePath("/network");
    return { success: `Customer deleted.${note}` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Delete failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Support + notification side effects                                 */
/* ------------------------------------------------------------------ */

export async function createTicketAction(
  customerId: string,
  subject: string,
  description: string,
  priority: string
): Promise<FormState> {
  try {
    const session = await requirePermission("support.create");
    if (!subject.trim()) return { formError: "A subject is required." };

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const ticket = await prisma.$transaction(async (tx) => {
      const ticketNumber = await nextNumber(tx, "ticket", "TKT-");
      return tx.ticket.create({
        data: {
          ticketNumber,
          customerId,
          areaId: customer.areaId,
          packageId: customer.packageId,
          subject,
          problem: subject,
          description,
          category: "Other",
          priority: ["Low", "Medium", "High", "Critical"].includes(priority) ? priority : "Medium",
          status: "Open",
          createdById: session.id,
        },
      });
    });

    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/support/tickets");
    return { success: `Ticket ${ticket.ticketNumber} created.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Ticket creation failed" };
  }
}

export async function sendSmsAction(customerId: string, body: string): Promise<FormState> {
  try {
    const session = await requirePermission("billing.approve");
    if (!body.trim()) return { formError: "Message cannot be empty." };

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { id: true, name: true, phone: true },
    });

    await prisma.notification.create({
      data: {
        channel: "SMS",
        recipient: customer.phone,
        customerId: customer.id,
        body,
        status: "Sent",
        sentById: session.id,
        sentAt: new Date(),
      },
    });

    const today = startOfDay(new Date());
    const existing = await prisma.smsCredit.findFirst({ where: { date: today } });
    if (existing) {
      await prisma.smsCredit.update({ where: { id: existing.id }, data: { sent: { increment: 1 } } });
    } else {
      await prisma.smsCredit.create({ data: { date: today, sent: 1, balance: 0 } });
    }

    revalidatePath("/notifications");
    return { success: `SMS sent to ${customer.phone}.` };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "SMS failed" };
  }
}

export async function createInvoiceForCustomerAction(
  id: string,
  amount: number
): Promise<FormState> {
  try {
    const session = await requirePermission("billing.create");
    if (!amount || amount <= 0) return { formError: "Enter a valid amount." };

    const settings = await getSettings();
    const prefix = settings["billing.invoicePrefix"] ?? "INV";

    const invoice = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUniqueOrThrow({ where: { id } });
      const number = await nextNumber(tx, "invoice", `${prefix}-`);
      return tx.invoice.create({
        data: {
          invoiceNumber: number,
          customerId: id,
          packageId: customer.packageId,
          issueDate: new Date(),
          dueDate: startOfDay(new Date()),
          billingFrom: customer.expiryDate,
          billingTo: addDays(customer.expiryDate ?? new Date(), 30),
          amount: round2(amount),
          total: round2(amount),
          status: "Due",
          note: "Invoice created from customer profile",
          createdById: session.id,
        },
      });
    });

    revalidatePath("/billing/invoices");
    revalidatePath(`/customers/${id}`);
    return { success: `Invoice ${invoice.invoiceNumber} created.`, id: invoice.id };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Invoice creation failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Portal access                                                       */
/* ------------------------------------------------------------------ */

/**
 * Sets or clears a customer's portal password on their behalf.
 *
 * Staff do this because most customers cannot create a portal account
 * themselves — they do not know they have one. The version bump is what makes
 * the change real: a customer who was reading their bills in the portal while
 * staff reset their password would otherwise stay signed in under the old one.
 *
 * The PPPoE password is never involved. It is a network credential the router
 * needs in the clear, and it is not a login.
 */
export async function setPortalPasswordAction(
  customerId: string,
  password: string
): Promise<FormState & { cleared?: boolean }> {
  try {
    const session = await requirePermission("customers.edit");

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, username: true },
    });
    if (!customer) return { formError: "That customer no longer exists." };

    const clearing = password === "__clear__";
    if (clearing) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { portalPasswordHash: null, portalTokenVersion: { increment: 1 } },
      });
      await logActivity(
        {
          action: "Update",
          entity: "Customer",
          entityId: customerId,
          summary: `Portal access removed for ${customer.name} (${customer.username}); all portal sessions ended`,
        },
        session.id
      );
      revalidatePath(`/customers/${customerId}`);
      return { success: "Portal access removed.", cleared: true };
    }

    const weakness = checkPasswordStrength(password);
    if (weakness) return { formError: weakness };

    await setPortalPassword(customerId, password);
    await logActivity(
      {
        action: "Update",
        entity: "Customer",
        entityId: customerId,
        summary: `Portal password set for ${customer.name} (${customer.username}); all portal sessions ended`,
      },
      session.id
    );
    revalidatePath(`/customers/${customerId}`);
    return { success: "Portal password set. Tell the customer to sign in at /portal/login." };
  } catch (e) {
    return { formError: e instanceof Error ? e.message : "Could not set the portal password" };
  }
}
