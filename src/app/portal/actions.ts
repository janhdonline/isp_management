"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/services/activity";
import { getSettings } from "@/lib/settings";
import { activeGateway } from "@/lib/services/payment-gateway";
import { round2 } from "@/lib/utils";
import {
  portalLogin,
  setPortalSessionCookie,
  clearPortalSessionCookie,
  getPortalSession,
  changePortalPassword,
} from "@/lib/portal-auth";
import { checkPasswordStrength } from "@/lib/password";

export type PortalState = {
  error?: string;
  success?: string;
  errors?: Record<string, string[]>;
};

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  username: z.string().trim().min(1, "Enter your username"),
  password: z.string().min(1, "Enter your password"),
});

export async function portalLoginAction(
  _prev: PortalState,
  formData: FormData
): Promise<PortalState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), [i.message]])
      ),
      error: "Enter your username and password.",
    };
  }

  const result = await portalLogin(parsed.data.username, parsed.data.password);
  if (!result.ok) {
    // portalLogin decides the wording; this layer only reports it.
    return { error: result.error };
  }

  await setPortalSessionCookie(result.customerId);
  redirect("/portal");
}

export async function logoutPortalAction() {
  await clearPortalSessionCookie();
  redirect("/portal/login");
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/**
 * Starts an online payment for one of the signed-in customer's own invoices.
 *
 * The authority here is the session, not a permission. A customer has no staff
 * permissions and must not be able to acquire any by calling this, so the check
 * is ownership: the invoice must belong to them, or the call is a 403. Without
 * that check, changing the id in the URL would let a customer pay another
 * customer's bill — and read its amount.
 */
export async function portalPayOnlineAction(invoiceId: string): Promise<PortalState> {
  const session = await getPortalSession();
  if (!session) return { error: "Please sign in again." };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: { select: { id: true, name: true, email: true, phone: true } } },
  });

  if (!invoice || invoice.customerId !== session.customerId) {
    // 403-shaped by content: the message does not confirm whether the invoice
    // exists, only that it is not theirs.
    return { error: "You do not have access to that invoice." };
  }

  const balance = round2(invoice.total - invoice.paid);
  if (balance <= 0) return { error: "This invoice is already settled." };

  const gateway = await activeGateway();
  if (!gateway) {
    return {
      error:
        "Online payment is not set up yet. Please contact your provider to pay this invoice.",
    };
  }

  const s = await getSettings();
  const origin = (s["app.url"] || "http://localhost:3000").replace(/\/$/, "");

  try {
    const checkout = await gateway.createCheckout({
      invoiceNumber: invoice.invoiceNumber,
      amount: balance,
      customerName: invoice.customer.name,
      customerEmail: invoice.customer.email,
      customerPhone: invoice.customer.phone,
      // Back to the portal, not the staff console: a customer who finishes
      // paying should not be dropped into the operator's interface.
      returnUrl: `${origin}/portal/invoices/${invoice.id}?paid=1`,
      cancelUrl: `${origin}/portal/invoices/${invoice.id}?cancelled=1`,
    });

    await logActivity({
      action: "Checkout",
      entity: "Invoice",
      entityId: invoice.id,
      summary: `Customer started a ${gateway.name} checkout for ${invoice.invoiceNumber} (${balance}) from the portal`,
    });

    redirect(checkout.checkoutUrl);
  } catch (e) {
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return { error: e instanceof Error ? e.message : "Could not start the payment" };
  }
}

/* ------------------------------------------------------------------ */
/* Support                                                             */
/* ------------------------------------------------------------------ */

const ticketSchema = z.object({
  subject: z.string().trim().min(4, "Give the problem a subject").max(160),
  category: z.string().trim().min(1, "Choose a category"),
  description: z.string().trim().min(10, "Describe the problem").max(4000),
});

/**
 * Raises a support request.
 *
 * `customerId` comes from the session and is never read from the form. A field
 * on a form is a field a caller can set.
 */
export async function portalCreateTicketAction(
  _prev: PortalState,
  formData: FormData
): Promise<PortalState> {
  const session = await getPortalSession();
  if (!session) return { error: "Please sign in again." };

  const parsed = ticketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), [i.message]])
      ),
      error: "Please check the highlighted fields.",
    };
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const number = await (await import("@/lib/counter")).nextNumber(tx, "ticket", "TKT-");
    const created = await tx.ticket.create({
      data: {
        ticketNumber: number,
        customerId: session.customerId,
        subject: parsed.data.subject,
        problem: parsed.data.category,
        description: parsed.data.description,
        category: parsed.data.category,
        priority: "Normal",
        status: "Open",
      },
    });
    await (await import("@/lib/services/activity")).prismaLog(
      tx,
      {
        action: "Create",
        entity: "Ticket",
        entityId: created.id,
        summary: `Ticket ${number} raised from the customer portal: ${parsed.data.subject}`,
      },
      undefined
    );
    return created;
  });

  revalidatePath("/portal/tickets");
  redirect(`/portal/tickets/${ticket.id}`);
}

const commentSchema = z.object({
  ticketId: z.string().min(1),
  body: z.string().trim().min(2, "Write something first").max(4000),
});

/** Adds a comment to a ticket the customer owns. */
export async function portalAddCommentAction(
  _prev: PortalState,
  formData: FormData
): Promise<PortalState> {
  const session = await getPortalSession();
  if (!session) return { error: "Please sign in again." };

  const parsed = commentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Write a message first." };

  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.data.ticketId },
    select: { id: true, customerId: true, ticketNumber: true },
  });
  if (!ticket || ticket.customerId !== session.customerId) {
    return { error: "You do not have access to that ticket." };
  }

  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: session.customerId },
    select: { name: true },
  });

  await prisma.ticketComment.create({
    data: {
      ticketId: ticket.id,
      authorName: customer.name,
      body: parsed.data.body,
      // Staff-only notes are not the customer's business, and the portal only
      // ever renders `isInternal: false` comments anyway.
      isInternal: false,
    },
  });

  revalidatePath(`/portal/tickets/${ticket.id}`);
  return { success: "Message sent." };
}

/* ------------------------------------------------------------------ */
/* Password                                                            */
/* ------------------------------------------------------------------ */

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(8, "Use at least 8 characters"),
    confirm: z.string().min(1, "Confirm the new password"),
  })
  .refine((d) => d.next === d.confirm, {
    message: "The two passwords do not match",
    path: ["confirm"],
  });

export async function portalChangePasswordAction(
  _prev: PortalState,
  formData: FormData
): Promise<PortalState> {
  const session = await getPortalSession();
  if (!session) return { error: "Please sign in again." };

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      errors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), [i.message]])
      ),
      error: "Please check the highlighted fields.",
    };
  }

  const weakness = checkPasswordStrength(parsed.data.next);
  if (weakness) {
    return { errors: { next: [weakness] }, error: "Please choose a stronger password." };
  }

  const result = await changePortalPassword(
    session.customerId,
    parsed.data.current,
    parsed.data.next
  );
  if (!result.ok) return { error: result.error };

  // Changing the password ends every session, including this one — that is what
  // the version bump does. Signing in again with the new password is the only
  // way forward, and it is the behaviour every other service expects.
  redirect("/portal/login?changed=1");
}


/**
 * The form-shaped entry point for the pay button.
 *
 * `useActionState` needs `(prevState, formData)`, and this keeps the id in the
 * form rather than closing over it in the browser — so the invoice that gets
 * paid is the one the server reads, not the one the page happened to render.
 */
export async function portalPayOnlineFormAction(
  _prev: PortalState,
  formData: FormData
): Promise<PortalState> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return { error: "No invoice was given." };
  return portalPayOnlineAction(invoiceId);
}
