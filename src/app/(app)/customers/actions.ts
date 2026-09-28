"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { customerSchema, customerUpdateSchema, fieldErrors, FieldErrors } from "@/lib/validators";
import { nextNumber, Tx } from "@/lib/counter";
import { getSettings } from "@/lib/settings";
import { addDays, round2, startOfDay } from "@/lib/utils";
import { prismaLog } from "@/lib/services/activity";
import { changePackage, deleteCustomer, disconnectCustomer, reconnectCustomer, renewCustomer, suspendCustomer } from "@/lib/services/customers";
import { syncCustomerBilling } from "@/lib/services/billing";

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
        customerType: d.customerType,
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
        advancePayment: d.advancePayment,
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

    // If the customer paid upfront, book it as an advance (receipted later).
    if (d.advancePayment > 0) {
      await tx.invoice.create({
        data: {
          invoiceNumber: `ADV-${customerCode}`,
          customerId: created.id,
          packageId: d.packageId,
          issueDate: new Date(),
          dueDate: new Date(),
          amount: d.advancePayment,
          total: d.advancePayment,
          paid: d.advancePayment,
          status: "Paid",
          note: "Advance payment at activation",
          createdById: session.id,
        },
      });
    }

    await prismaLog(
      tx,
      { action: "Create", entity: "Customer", entityId: created.id, summary: `Created customer ${created.name} (${created.username})` },
      session.id
    );
    return created;
  });

  await syncCustomerBilling(result.id);

  revalidatePath("/customers");
  revalidatePath("/dashboard");

  const intent = formData.get("_intent");
  if (intent === "invoice") {
    redirect(`/billing/invoices/new?customerId=${result.id}`);
  }
  if (intent === "new") {
    return { success: `Customer ${result.customerCode} created.` };
  }
  redirect(`/customers/${result.id}`);
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
      },
    });
    await prismaLog(
      tx,
      { action: "Update", entity: "Customer", entityId: id, summary: "Customer details updated" },
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
  return runLifecycle(
    "customers.edit",
    (tx, userId) => suspendCustomer(tx, id, reason, userId),
    ["/customers", `/customers/${id}`, "/dashboard"],
    "Customer suspended."
  );
}

export async function reconnectCustomerAction(id: string): Promise<FormState> {
  return runLifecycle(
    "customers.edit",
    (tx, userId) => reconnectCustomer(tx, id, userId),
    ["/customers", `/customers/${id}`, "/dashboard"],
    "Customer reconnected."
  );
}

export async function disconnectCustomerAction(
  id: string,
  reason: string
): Promise<FormState> {
  if (!reason.trim()) return { formError: "A reason is required to disconnect a customer." };
  return runLifecycle(
    "customers.delete",
    (tx, userId) => disconnectCustomer(tx, id, reason, userId),
    ["/customers", `/customers/${id}`, "/dashboard"],
    "Customer disconnected."
  );
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
  return runLifecycle(
    "customers.edit",
    (tx, userId) => changePackage(tx, id, packageId, reason || "Package changed", userId),
    ["/customers", `/customers/${id}`, "/dashboard"],
    "Package changed."
  );
}

export async function deleteCustomerAction(id: string): Promise<FormState> {
  try {
    const session = await requirePermission("customers.delete");
    await deleteCustomer(id, session.id);
    revalidatePath("/customers");
    revalidatePath("/dashboard");
    return { success: "Customer deleted." };
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
