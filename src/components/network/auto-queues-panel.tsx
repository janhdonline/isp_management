"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/providers";
import { setRouterAutoQueuesAction } from "@/app/(app)/network/actions";
import { cn } from "@/lib/utils";

/**
 * The per-router opt-in for bandwidth queues, and the list of queues it manages.
 *
 * Three things have to be visible together or the switch is unsafe to flip:
 *
 *  - **What the flag does.** "Bandwidth queues" alone sounds like a convenience. A
 *    reader needs to know that turning it on lets this application shape
 *    subscriber speed from each package's `downloadSpeed` / `uploadSpeed`.
 *  - **That it is not retroactive.** Switching it on does not touch anybody until
 *    something about them changes. Rewriting a thousand queues at once, with
 *    nobody watching, is how a router becomes slow on a Tuesday afternoon.
 *  - **That RADIUS already does this.** On a router with `useRadius` on, the same
 *    number is already arriving as Mikrotik-Rate-Limit, and two limiters means the
 *    stricter one wins — which is not a decision anybody made.
 *
 * The queue list is the audit: what is on the router, at what limits, and which of
 * those we can attribute to a customer. A queue we cannot attribute is reported
 * rather than hidden, because somebody put it there on purpose.
 */
export function AutoQueuesPanel({
  routerId,
  routerName,
  enabled,
  useRadius,
  queues,
  managed,
  unmanaged,
  simulated,
}: {
  routerId: string;
  routerName: string;
  enabled: boolean;
  useRadius: boolean;
  queues: {
    name: string;
    target: string;
    maxDownload: number;
    maxUpload: number;
    username: string | null;
    packageName: string | null;
  }[];
  managed: number;
  unmanaged: number;
  simulated: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(enabled);

  const toggle = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const result = await setRouterAutoQueuesAction(routerId, next);
      if (result?.formError) {
        setOn(!next);
        toast.error(result.formError);
        return;
      }
      toast.success(
        next
          ? `${routerName} is now opted in — this app will shape subscriber speed on it.`
          : `${routerName}'s queues are left as they are; nothing new will be written.`
      );
      router.refresh();
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        on && !useRadius
          ? "border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-[var(--border)] bg-[var(--surface-2)]"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Enforce package speeds with queues</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {useRadius ? (
              <>
                Not applicable here. {routerName} authenticates through RADIUS, which already
                sends Mikrotik-Rate-Limit for every package — the same number, arriving from the
                access request. Queues are left off so there is only one limiter per subscriber.
              </>
            ) : on ? (
              <>
                On. Each subscriber gets a simple queue named <code className="font-mono">isp-&lt;username&gt;</code>{" "}
                shaped to their package&apos;s download and upload speeds. New installs, package
                changes and reconnects all reprogram it; suspending takes the queue away again.
                Switching this on does not touch existing subscribers until something about them
                changes.
              </>
            ) : (
              <>
                Off. No queue is written on {routerName}, so package speeds are a billing figure
                only and the router decides what each subscriber actually gets. Turning it on is
                per router and does not affect any other.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={on && !useRadius}
          disabled={pending || useRadius}
          onChange={(e) => toggle(e.target.checked)}
          aria-label="Enforce package speeds with bandwidth queues"
        />
      </div>

      {/*
        Shown unless this router is on RADIUS, **not** gated on the switch.

        The flag governs what this application may *write*. Hiding the queue list
        from an operator who has not opted in takes the audit away from exactly the
        person who wants it — somebody deciding whether to turn it on needs to see
        what is already programmed on that router, including that there is nothing.
      */}
      {useRadius ? null : (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-medium text-fg-muted">
            Queues on this router
            {simulated ? " (simulated — no credentials, so nothing was read)" : ""}
          </p>
          {simulated ? (
            <p className="mt-1 text-xs text-fg-subtle">
              Add MikroTik API credentials to see what is actually programmed there.
            </p>
          ) : queues.length === 0 ? (
            <p className="mt-1 text-xs text-fg-subtle">
              No <code className="font-mono">isp-</code> queues here. They appear as customers are
              assigned, packages change, or lines are reconnected.
            </p>
          ) : (
            <>
              <ul className="mt-1 max-h-64 space-y-1 overflow-y-auto text-xs">
                {queues.map((q) => (
                  <li
                    key={q.name}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded border border-[var(--border)] px-2 py-1"
                  >
                    <span className="font-mono">{q.name}</span>
                    <span className="tnum text-fg-muted">
                      {q.maxDownload}/{q.maxUpload} Mbps
                    </span>
                    {q.packageName ? (
                      <span className="text-fg-subtle">{q.packageName}</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">
                        no matching customer
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-fg-subtle">
                {managed} tied to a customer
                {unmanaged > 0
                  ? `, ${unmanaged} not tied to one — somebody put those there by hand.`
                  : "."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}