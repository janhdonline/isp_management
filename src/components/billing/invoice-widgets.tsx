"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/providers";
import { autoRenewAction } from "@/app/(app)/billing/actions";
import { RefreshCcw } from "lucide-react";

/** Generates the next cycle's invoice from the customer's current package. */
export function AutoRenewButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <>
      <Button variant="outline" icon={<RefreshCcw className="size-4" />} onClick={() => setOpen(true)}>
        Auto renew
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          const r = await autoRenewAction(customerId);
          setBusy(false);
          setOpen(false);
          if (r.formError) error(r.formError);
          else {
            success(r.success ?? "Invoice created");
            startTransition(() => router.refresh());
          }
        }}
        title="Generate renewal invoice?"
        description="Creates a new invoice for the next cycle using the customer's current package price, discount and VAT."
        confirmLabel="Generate invoice"
        variant="primary"
        loading={busy}
      />
    </>
  );
}
