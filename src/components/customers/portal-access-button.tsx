"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/providers";
import { setPortalPasswordAction } from "@/app/(app)/customers/actions";
import { checkPasswordStrength } from "@/lib/password";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";

/**
 * Staff-side control of a customer's portal access.
 *
 * Staff do this because most customers cannot create a portal account
 * themselves — they do not know one exists. The dialog says plainly which
 * password is being set, because the mistake this invites is real: a member of
 * staff who assumes the box is the PPPoE password will set it to the line
 * credential, and then a customer who reads their PPPoE password off a sticker on
 * the router can sign in and read their invoices.
 *
 * Setting or clearing it ends every portal session that customer has, which is
 * what makes the change actually take effect.
 */
export function PortalAccessButton({
  customerId,
  customerName,
  hasAccess,
}: {
  customerId: string;
  customerName: string;
  hasAccess: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const weakness = password && password !== "__clear__" ? checkPasswordStrength(password) : null;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await setPortalPasswordAction(customerId, password);
      if (result?.formError) {
        setError(result.formError);
        return;
      }
      toast.success(result.success ?? "Done.");
      setOpen(false);
      setPassword("");
    });
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} icon={<KeyRound className="size-4" />}>
        {hasAccess ? "Reset portal access" : "Set portal password"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${hasAccess ? "Reset" : "Set"} portal access for ${customerName}`}
        description="This is the password they use on this website. It is not their PPPoE password."
        icon={<KeyRound className="size-4" />}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={submit}>
              {hasAccess ? "Reset password" : "Set password"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <Field
            label="New portal password"
            required
            error={weakness ?? undefined}
            hint="Give it to the customer directly. They can change it themselves once signed in."
          >
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Something they will remember"
              autoComplete="off"
            />
          </Field>

          <p className="text-xs text-fg-muted">
            Do not use the PPPoE password. That one is stored on the router and works on the line
            itself; using it here would give anyone who knows it access to this account.
          </p>

          {hasAccess ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setPassword("__clear__")}
              icon={<ShieldOff className="size-4" />}
            >
              {password === "__clear__" ? "Will be removed on save" : "Remove portal access instead"}
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <ShieldCheck className="size-3.5" />
              The customer signs in at /portal/login with this password.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}