import { prisma } from "@/lib/prisma";
import { activeGateway } from "@/lib/services/payment-gateway";
import { recordPayment, syncCustomerBilling } from "@/lib/services/billing";
import { maybeAutoReconnect } from "@/lib/services/network-enforcement";
import { round2 } from "@/lib/utils";
import { logActivity, prismaLog } from "@/lib/services/activity";
import { getSettings } from "@/lib/settings";

/**
 * Payment gateway callbacks.
 *
 * A callback is an untrusted claim from the internet saying "I was paid". It
 * arrives with no authentication of its own, may be delivered more than once,
 * and may say any amount it likes. Everything about the handling here exists
 * because of one of those three facts:
 *
 *  - **The amount is re-checked against our own invoice.** If the gateway says
 *    100 and the invoice is for 1000, nothing is written. A gateway is a
 *    business partner, not an authority on what a customer owes.
 *  - **The gateway transaction id is the idempotency key.** Providers retry; a
 *    duplicate delivery must not create a second payment. The column is
 *    uniquely indexed, so even a race between two deliveries is caught by the
 *    database rather than by hope.
 *  - **Nothing is written until the provider's own validation API agrees.** The
 *    posted body is only used to find out *what to ask about*.
 *
 * The response is sent after the commit, so a provider that gets a 200 knows the
 * payment exists. A failure returns a 5xx, because a provider that is told 200
 * will not retry — and an unpaid invoice the customer believes they paid for is
 * the worst outcome available here.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ provider: string }> }
) {
  const { provider } = await ctx.params;

  const gateway = await activeGateway();
  if (!gateway) {
    // Not configured. Saying so plainly beats a generic 400, because the person
    // looking at a failed payment needs to know it is a configuration problem.
    return Response.json(
      { error: "No payment gateway is configured. See Settings → API." },
      { status: 501 }
    );
  }

  if (provider !== "sslcommerz") {
    return Response.json(
      { error: `Unknown provider "${provider}". This deployment is wired for ${gateway.name}.` },
      { status: 404 }
    );
  }

  // The raw body is required: re-serialising parsed JSON changes the bytes, and
  // anything that depends on the exact payload cannot be verified afterwards.
  const raw = await request.text();

  let callback;
  try {
    callback = await gateway.parseCallback(raw, request.headers);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not read the callback" },
      { status: 400 }
    );
  }

  if (!callback) {
    // Rejected by the gateway's own validation, or malformed. Nothing is
    // written, and the attempt is recorded so a support agent can see that a
    // customer says they paid and the system disagrees.
    await logCallbackRejection(provider, raw, "The gateway did not validate this callback");
    return Response.json({ error: "Callback could not be validated" }, { status: 400 });
  }

  if (callback.status !== "Completed") {
    await logCallbackRejection(
      provider,
      raw,
      `The gateway reported the transaction as ${callback.status}`
    );
    // A failed or cancelled attempt is a normal outcome, not an error worth a
    // 5xx — the provider should not keep retrying something that will not change.
    return Response.json({ ok: true, recorded: false, status: callback.status });
  }

  // Idempotency: has this exact transaction already been recorded?
  const existing = await prisma.payment.findUnique({
    where: { gatewayTxnId: callback.transactionId },
    select: { id: true, paymentId: true, amount: true },
  });
  if (existing) {
    return Response.json({
      ok: true,
      recorded: false,
      duplicate: true,
      paymentId: existing.paymentId,
    });
  }

  // Find the invoice from our own reference. `gatewayRef` is `<invoice>-<ts>`.
  const invoiceNumber = callback.gatewayRef.replace(/-\d{10,}$/, "");
  const invoice = await prisma.invoice.findUnique({
    where: { invoiceNumber },
    include: { customer: { select: { id: true, name: true, username: true } } },
  });

  if (!invoice) {
    await logCallbackRejection(
      provider,
      raw,
      `No invoice matches the reference "${callback.gatewayRef}"`
    );
    return Response.json(
      { error: "No invoice matches that transaction" },
      { status: 404 }
    );
  }

  const balance = round2(invoice.total - invoice.paid);
  const claimed = round2(callback.amount);

  // The check that stops a tampered amount. A gateway that reports a smaller
  // figure than the invoice is either misconfigured or being played; either way
  // the customer's bill is not settled by it.
  if (claimed <= 0 || claimed > balance + 0.009) {
    await logCallbackRejection(
      provider,
      raw,
      `Amount ${claimed} does not match the invoice balance of ${balance} on ${invoice.invoiceNumber}`
    );
    return Response.json(
      {
        error: "The settled amount does not match the invoice balance",
        invoiceBalance: balance,
        claimed,
      },
      { status: 409 }
    );
  }

  // Money taken online lands in a real account. bKash and Nagad settle into a
  // wallet, so the collection account is chosen rather than defaulted — posting
  // a mobile-money payment to the cash account would put the ledger in the wrong
  // place.
  const account = await prisma.account.findFirst({
    where: { status: "Active", type: { in: ["Mobile Wallet", "Bank", "Cash"] } },
    orderBy: [{ type: "asc" }],
    select: { id: true, name: true },
  });

  if (!account) {
    return Response.json(
      { error: "No active account is available to record the payment against" },
      { status: 503 }
    );
  }

  try {
    const paymentId = await prisma.$transaction(async (tx) => {
      const payment = await recordPayment(tx, {
        customerId: invoice.customer.id,
        invoiceId: invoice.id,
        amount: claimed,
        method: "Online",
        accountId: account.id,
        transactionId: callback.transactionId,
        paymentDate: new Date(),
        note: `Paid online via ${gateway.name} (${callback.transactionId})`,
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          gatewayProvider: provider,
          gatewayTxnId: callback.transactionId,
          gatewayStatus: callback.status,
        },
      });

      await prismaLog(
        tx,
        {
          action: "Create",
          entity: "Payment",
          entityId: payment.id,
          summary: `Online payment ${payment.paymentId} of ${claimed} via ${gateway.name} for ${invoice.invoiceNumber}`,
        },
        undefined
      );

      return payment.paymentId;
    });

    // After the commit, never inside it: this reaches the router, and a network
    // call inside a transaction holds a row lock while the router takes its time.
    await syncCustomerBilling(invoice.customer.id);
    const restored = await maybeAutoReconnect(invoice.customer.id);

    return Response.json({
      ok: true,
      recorded: true,
      paymentId,
      invoice: invoice.invoiceNumber,
      remaining: round2(balance - claimed),
      // Reported so a customer who paid a suspended account's bill knows the line
      // is coming back rather than assuming they must call the office.
      reconnected: restored?.ok ?? false,
    });
  } catch (e) {
    // A unique-constraint violation here is a duplicate that arrived between the
    // check above and this write. It is a success, not a failure.
    const message = e instanceof Error ? e.message : "";
    if (message.includes("gatewayTxnId") || message.includes("Unique constraint")) {
      return Response.json({ ok: true, recorded: false, duplicate: true });
    }
    return Response.json(
      { error: "Could not record the payment", detail: message },
      { status: 500 }
    );
  }
}

/** Every rejected callback is kept, briefly and without secrets. */
async function logCallbackRejection(provider: string, raw: string, reason: string) {
  const s = await getSettings();
  await logActivity({
    action: "Reject",
    entity: "Payment",
    entityId: undefined,
    summary: `Rejected ${provider} callback: ${reason}`,
  });
  // The body is not stored — it contains the customer's details and possibly a
  // session key. The reason is what a support agent needs.
  console.warn(`[payment] rejected ${provider} callback: ${reason} (${raw.length} bytes)`);
  void s;
}
