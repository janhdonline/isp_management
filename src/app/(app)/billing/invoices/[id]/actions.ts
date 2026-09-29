"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { activeGateway } from "@/lib/services/payment-gateway";
import { round2 } from "@/lib/utils";

/**
 * Starting an online payment.
 *
 * Two things this deliberately does not do. It does not mark anything paid — the
 * payment exists only once the gateway's callback arrives, because a customer
 * who closes the tab halfway through a bKash payment has not paid. And it does
 * not trust the invoice's stored total blindly: the balance is recomputed from
 * `total - paid` at the moment the checkout starts, so a customer cannot be sent
 * to pay a figure that was already settled.
 */
export async function startOnlinePayment(invoiceId: string): Promise<{ error?: string }> {
  let invoice;
  try {
    await requirePermission("payments.create");
    invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });
  } catch {
    return { error: "You do not have permission to take payments." };
  }

  if (!invoice) return { error: "That invoice no longer exists." };

  const balance = round2(invoice.total - invoice.paid);
  if (balance <= 0) {
    return { error: "This invoice is already settled." };
  }

  const gateway = await activeGateway();
  if (!gateway) {
    return {
      error:
        "Online payment is not set up yet. Add your SSLCommerz store id and password in Settings → API.",
    };
  }

  // The return and cancel URLs have to be absolute and have to be the real
  // deployment, or the customer lands on a page that does not exist. APP_URL is
  // the source of truth; the request host is only a fallback for a developer
  // running it on a laptop.
  const s = await getSettings();
  const h = await headers();
  const configured = s["app.url"];
  const host = configured || h.get("host") || "localhost:3000";
  const protocol = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = host.startsWith("http") ? host : `${protocol}://${host}`;

  try {
    const checkout = await gateway.createCheckout({
      invoiceNumber: invoice.invoiceNumber,
      amount: balance,
      customerName: invoice.customer.name,
      customerEmail: invoice.customer.email,
      customerPhone: invoice.customer.phone,
      returnUrl: `${origin}/billing/invoices/${invoice.id}?paid=1`,
      cancelUrl: `${origin}/billing/invoices/${invoice.id}?cancelled=1`,
    });

    // Recorded so the session can be traced if a customer says the page never
    // loaded. The URL itself is not stored — it is a bearer token for the
    // checkout session.
    await prisma.activityLog.create({
      data: {
        action: "Checkout",
        entity: "Invoice",
        entityId: invoice.id,
        summary: `Started a ${gateway.name} checkout for ${invoice.invoiceNumber} (${balance})`,
      },
    });

    redirect(checkout.checkoutUrl);
  } catch (e) {
    // `redirect` throws a control-flow signal; it must not be reported as a
    // failure to the customer.
    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
    return {
      error: e instanceof Error ? e.message : "Could not start the payment",
    };
  }
}

/** Used by the invoice page to decide whether to offer the button at all. */
export async function onlinePaymentAvailability(): Promise<{
  available: boolean;
  provider: string | null;
  sandbox: boolean;
}> {
  const s = await getSettings();
  const configured = Boolean(s["api.sslcommerzStoreId"] && s["api.sslcommerzStorePassword"]);
  return {
    available: configured,
    provider: configured ? "SSLCommerz" : null,
    sandbox: s["api.sslcommerzSandbox"] === "true",
  };
}

export { revalidatePath };
