"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { setRouterAutoProvisionAction } from "@/app/(app)/network/actions";
import { cn } from "@/lib/utils";

/**
 * The per-router opt-in for writing PPP secrets.
 *
 * The switch is off by default and stays there until an admin turns it on,
 * because creating and deleting credentials on someone else's router is a
 * capability that has to be granted deliberately — not something that happens
 * because someone filled in an API password.
 *
 * The wording on the card is the point of the component. "Auto-provisioning"
 * alone sounds like a convenience; a reader needs to know that turning it on lets
 * this application create, reprofile and delete PPP secrets, and that
 * suspension is unaffected either way.
 */
export function AutoProvisionToggle({
  routerId,
  routerName,
  enabled,
}: {
  routerId: string;
  routerName: string;
  enabled: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(enabled);

  const toggle = (next: boolean) => {
    // Optimistic, with the server result replacing it. The flag is the thing an
    // operator is most likely to leave in the wrong state, so the switch must
    // never end up disagreeing with what the database believes.
    setOn(next);
    startTransition(async () => {
      const result = await setRouterAutoProvisionAction(routerId, next);
      if (result?.formError) {
        setOn(!next);
        toast.error(result.formError);
        return;
      }
      toast.success(
        next
          ? `${routerName} is now opted in — this app will create, reprofile and delete PPP secrets on it.`
          : `${routerName} will no longer be written to.`
      );
      router.refresh();
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        on
          ? "border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-[var(--border)] bg-[var(--surface-2)]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Auto-provision PPP secrets</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {on ? (
              <>
                On. New customers get their PPPoE secret created automatically, package changes
                update the profile, and deleting a customer removes the secret. Disconnecting and
                suspending a customer is not affected by this switch.
              </>
            ) : (
              <>
                Off. This app never creates, reprofiles or deletes PPP secrets on {routerName}.
                Subscribers have to be configured by hand. Disconnecting and suspending a customer
                still works.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          aria-label="Auto-provision PPP secrets"
        />
      </div>
    </div>
  );
}
