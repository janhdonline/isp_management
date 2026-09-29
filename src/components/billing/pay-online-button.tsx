"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/providers";
import { CreditCard, Loader2 } from "lucide-react";

/**
 * "Pay Online" — sends the customer to bKash, Nagad, Rocket or a card through
 * the configured aggregator.
 *
 * The wording matters here more than usual. The button does not take a payment;
 * it starts a session at the gateway and the payment only exists once the
 * gateway calls back. So the label says "Pay Online" and the toast on failure
 * distinguishes "the gateway refused" from "we could not reach the gateway",
 * because those send a customer to completely different places.
 */
export function PayOnlineButton({
  invoiceId,
  provider,
  sandbox,
  disabled,
}: {
  invoiceId: string;
  provider: string | null;
  sandbox: boolean;
  disabled?: boolean;
}) {
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!provider) {
    return (
      <Button
        variant="secondary"
        disabled
        icon={<CreditCard className="size-4" />}
        title="Add an SSLCommerz store id and password in Settings → API to enable online payment."
      >
        Pay Online
      </Button>
    );
  }

  const run = () => {
    setStarting(true);
    // The action redirects on success, so there is nothing to do on the happy
    // path — only the error branch needs handling.
    startTransition(async () => {
      const { startOnlinePayment } = await import(
        "@/app/(app)/billing/invoices/[id]/actions"
      );
      const result = await startOnlinePayment(invoiceId);
      setStarting(false);
      if (result?.error) {
        toast.error(result.error);
      }
    });
  };

  return (
    <>
      <Button
        onClick={run}
        disabled={disabled || starting || pending}
        icon={
          starting || pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CreditCard className="size-4" />
          )
        }
        title={
          sandbox
            ? `Sandbox mode — no real money moves until it is turned off in Settings → API.`
            : undefined
        }
      >
        Pay Online{sandbox ? " (sandbox)" : ""}
      </Button>
    </>
  );
}
