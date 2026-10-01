"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { setRouterRadiusAction } from "@/app/(app)/network/actions";
import { cn } from "@/lib/utils";

/**
 * The per-router RADIUS opt-in.
 *
 * Off by default, like auto-provisioning, and deliberately so. This switch moves
 * where a router's entire subscriber authentication happens: on, every PPPoE login
 * for the customers behind this router is answered by this application instead of
 * by a secret on the router, and suspension is enforced by CoA rather than by
 * disabling a secret. That has to be a decision somebody makes for one router at a
 * time, after `npm run radius` is running and the secret matches.
 *
 * The wording on the card is the point. "RADIUS" alone sounds like a protocol
 * choice; an operator needs to know what turning it on actually hands over, and
 * what it does *not* do — the RouterOS API path stays intact for every router
 * left off.
 */
export function RadiusToggle({
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
    // Optimistic, with the server result replacing it — this flag decides whether
    // a whole router's subscribers can authenticate at all, so it must never end
    // up disagreeing with the database.
    setOn(next);
    startTransition(async () => {
      const result = await setRouterRadiusAction(routerId, next);
      if (result?.formError) {
        setOn(!next);
        toast.error(result.formError);
        return;
      }
      toast.success(
        next
          ? `${routerName} now authenticates through this application. Make sure the RADIUS process is running and the shared secret matches on both sides.`
          : `${routerName} no longer authenticates through this application.`
      );
      router.refresh();
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        on
          ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/25"
          : "border-[var(--border)] bg-[var(--surface-2)]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Authenticate subscribers with RADIUS</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {on ? (
              <>
                On. PPPoE logins for customers on {routerName} are answered by this application
                instead of by a secret on the router, each subscriber&apos;s package speed is sent
                with the reply, and suspending a customer drops their live session by CoA. The RADIUS
                process must be running, or nobody on this router can log in.
              </>
            ) : (
              <>
                Off. {routerName} keeps its own PPP secrets and this application never answers a
                login from it. Suspension uses the RouterOS API instead, exactly as before. Turn this
                on once `npm run radius` is running and the shared secret matches on both sides.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
          aria-label="Authenticate subscribers with RADIUS"
        />
      </div>
    </div>
  );
}