import { getSettings } from "@/lib/settings";

/**
 * Online payment gateways.
 *
 * The problem this solves: `PAYMENT_METHODS` has listed bKash, Nagad and Rocket
 * since the beginning, but they were only labels on a dropdown. Every online
 * payment had to be typed in by staff after the customer handed over cash, which
 * is both slow and the single largest source of collection error in a
 * Bangladeshi ISP.
 *
 * One aggregator covers all of them. SSLCommerz is the default driver because it
 * settles bKash, Nagad, Rocket and cards behind one API and one merchant
 * account; ShurjoPay is the same shape and can be added without touching a
 * caller. The rest of the system never learns which one is in use.
 *
 * The rule that matters most is in the webhook, not here: **a gateway callback is
 * a claim, not a fact.** The amount is re-checked against our own invoice, the
 * transaction id is the idempotency key, and a payment is written only after both
 * pass. A gateway that says "I was paid 100" does not get to settle a 1000 bill.
 */

export type CheckoutResult = {
  /** Where to send the customer. */
  checkoutUrl: string;
  /** Our reference for the session, echoed back on the callback. */
  gatewayRef: string;
  /** True when no gateway is configured — the caller must not pretend otherwise. */
  simulated: boolean;
};

export type GatewayCallback = {
  /** The gateway's own transaction id. Unique, and our idempotency key. */
  transactionId: string;
  amount: number;
  currency: string;
  status: "Completed" | "Failed" | "Pending" | "Cancelled";
  /** Our reference, echoed from the checkout. */
  gatewayRef: string;
  /** The provider's description of the failure, when there is one. */
  message?: string;
};

export interface PaymentGateway {
  readonly name: string;
  readonly configured: boolean;
  createCheckout(input: {
    invoiceNumber: string;
    amount: number;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutResult>;

  /**
   * Turns a raw callback body into a decision.
   *
   * Returns `null` for anything that is not a valid, signed, known transaction —
   * the caller treats that as "not a payment" and writes nothing.
   */
  parseCallback(rawBody: string, headers: Headers): Promise<GatewayCallback | null>;
}

/* ------------------------------------------------------------------ */
/* SSLCommerz                                                          */
/* ------------------------------------------------------------------ */

/**
 * SSLCommerz, which fronts bKash, Nagad, Rocket and cards.
 *
 * The callback is validated by asking SSLCommerz what it thinks happened, rather
 * than by trusting the posted fields. That costs one request per callback and
 * removes the entire class of "someone posted a fake success to my endpoint".
 */
export class SslCommerzGateway implements PaymentGateway {
  readonly name = "SSLCommerz";

  private sandbox: boolean;
  private storeId: string;
  private storePassword: string;

  constructor(opts: { storeId: string; storePassword: string; sandbox: boolean }) {
    this.storeId = opts.storeId;
    this.storePassword = opts.storePassword;
    this.sandbox = opts.sandbox;
  }

  get configured(): boolean {
    return Boolean(this.storeId && this.storePassword);
  }

  private get base(): string {
    // An explicit override exists so the callback handler can be tested against a
    // stand-in gateway without reaching the internet. It is read from the
    // environment rather than Settings, because a database row an operator can
    // edit is not a safe place to put a URL that redirects payment traffic.
    const override = process.env.PAYMENT_GATEWAY_BASE_URL;
    if (override) return override.replace(/\/$/, "");
    return this.sandbox
      ? "https://sandbox.sslcommerz.com"
      : "https://securepay.sslcommerz.com";
  }

  async createCheckout(input: {
    invoiceNumber: string;
    amount: number;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutResult> {
    if (!this.configured) {
      throw new Error("SSLCommerz is not configured. Add the store id and password in Settings → API.");
    }

    // The session key is the invoice number: the callback carries it back, and it
    // is what ties a payment to the invoice it settles. It has to be unique per
    // attempt, so a retried payment gets a fresh session rather than colliding
    // with the one already open.
    const sessionKey = `${input.invoiceNumber}-${Date.now()}`;

    const res = await fetch(`${this.base}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        store_id: this.storeId,
        store_passwd: this.storePassword,
        total_amount: input.amount.toFixed(2),
        currency: "BDT",
        tran_id: sessionKey,
        success_url: input.returnUrl,
        fail_url: input.cancelUrl,
        cancel_url: input.cancelUrl,
        cus_name: input.customerName,
        cus_email: input.customerEmail ?? "no-email@example.invalid",
        // BD numbers are 11 digits starting 01; bKash and Nagad are 01[3-9]xxxxxxx.
        cus_phone: input.customerPhone.replace(/[^\d]/g, "").slice(0, 11) || "01700000000",
        product_category: "Bill Payment",
        product_profile: "general",
        num_of_item: "1",
        // No shipping: this is a bill, not a parcel.
        shipping_method: "NO",
        ship_country: "BD",
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      throw new Error(`SSLCommerz returned ${res.status} while starting the session.`);
    }

    const body = (await res.json()) as {
      status?: string;
      GatewayPageURL?: string;
      message?: string;
    };

    // A session that fails to start must not be handed to a customer as though
    // it were a payment page.
    if (body.status !== "SUCCESS" || !body.GatewayPageURL) {
      throw new Error(
        body.message
          ? `SSLCommerz refused the session: ${body.message}`
          : "SSLCommerz did not return a payment page."
      );
    }

    return { checkoutUrl: body.GatewayPageURL, gatewayRef: sessionKey, simulated: false };
  }

  // `headers` is accepted because some gateways sign their callbacks and the
  // signature lives there. SSLCommerz does not — it publishes a validation API,
  // which is stronger — so the argument is dropped at the boundary.
  async parseCallback(rawBody: string): Promise<GatewayCallback | null> {
    if (!this.configured) return null;

    let posted: Record<string, string>;
    try {
      posted = JSON.parse(rawBody) as Record<string, string>;
    } catch {
      return null;
    }

    const tranId = posted.tran_id ?? "";
    const valId = posted.val_id ?? "";
    if (!tranId || !valId) return null;

    // The authoritative check. Everything in `posted` is customer-controlled; the
    // only thing that cannot be forged is what SSLCommerz itself reports.
    const validation = await this.validate(valId, tranId, Number(posted.amount ?? 0));
    if (!validation) return null;

    return {
      transactionId: validation.val_id ?? valId,
      amount: Number(validation.amount ?? posted.amount ?? 0),
      currency: validation.currency ?? "BDT",
      status: normaliseStatus(validation.status),
      gatewayRef: validation.tran_id ?? tranId,
      message: validation.error ?? posted.error ?? undefined,
    };
  }

  /** SSLCommerz's own answer to "did this transaction really happen, and for how much". */
  private async validate(
    valId: string,
    tranId: string,
    amount: number
  ): Promise<Record<string, string> | null> {
    try {
      const res = await fetch(
        `${this.base}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(valId)}&store_id=${encodeURIComponent(this.storeId)}&store_passwd=${encodeURIComponent(this.storePassword)}&format=json&tran_id=${encodeURIComponent(tranId)}&amount=${encodeURIComponent(amount)}`,
        { signal: AbortSignal.timeout(20_000) }
      );
      if (!res.ok) return null;
      const body = (await res.json()) as Record<string, string>;
      // SSLCommerz answers a valid transaction with a bank reference; an invalid
      // one comes back as an array of validation errors.
      if (Array.isArray(body)) return null;
      return body;
    } catch {
      return null;
    }
  }
}

function normaliseStatus(status?: string): GatewayCallback["status"] {
  const s = (status ?? "").toUpperCase();
  if (s === "VALID" || s === "COMPLETED" || s === "SUCCESS") return "Completed";
  if (s === "FAILED" || s === "FAILURE") return "Failed";
  if (s === "CANCELLED" || s === "CANCELED") return "Cancelled";
  return "Pending";
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

/**
 * The configured gateway, or `null` when there is none.
 *
 * Returning `null` rather than a stub that pretends to work is deliberate: a
 * "Pay Online" button that quietly does nothing is worse than one that says the
 * gateway is not set up.
 */
export async function activeGateway(): Promise<PaymentGateway | null> {
  const s = await getSettings();
  const storeId = s["api.sslcommerzStoreId"];
  const storePassword = s["api.sslcommerzStorePassword"];
  if (!storeId || !storePassword) return null;

  return new SslCommerzGateway({
    storeId,
    storePassword,
    sandbox: s["api.sslcommerzSandbox"] === "true",
  });
}

/** Whether online payment is available, for the UI to decide what to render. */
export async function gatewayStatus(): Promise<{
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
