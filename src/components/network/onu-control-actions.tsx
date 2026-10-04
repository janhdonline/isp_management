"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  onuControlAction,
  previewControlAction,
  type OnuControlState,
} from "@/app/(app)/network/onu/actions";
import type { OnuAction } from "@/lib/services/onu-control";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

/**
 * Reboot / Authorize / Deauthorize / Factory reset, from anywhere that knows a
 * serial.
 *
 * ## The confirm step is the product
 *
 * Nothing is sent on the first click. The second click opens a dialog that says
 * **which device** and **which action**, in a sentence rather than a verb:
 *
 *     Factory-reset HWTC00000001?
 *     Erase the device's configuration entirely. It comes back with nothing on it
 *     and will need provisioning again before it serves anyone.
 *     On OLT-01, PON 0/1/1. Rahim Uddin is on this ONU and active.
 *
 * A misclick on "Reset" has to be obviously a misclick *before* it happens, because
 * the recovery is a site visit. That is why the device name is in the dialog title
 * and not just in the body, and why the consequence is prose instead of "Are you
 * sure?".
 *
 * ## The dangerous ones need a second, deliberate act
 *
 * `deauthorize` and `factory reset` do not submit on the second click either. They
 * need a tick whose label names the customer who will be affected — and the service
 * refuses them without it, so a `curl` gets the same answer the dialog does.
 *
 * The buttons are not rendered at all for a reader without `network.edit`. Hiding
 * rather than disabling, because a disabled button invites the question and the
 * answer to it is already on the page.
 */

const ACTIONS: { key: OnuAction; label: string; tone: "default" | "danger" }[] = [
  { key: "reboot", label: "Reboot", tone: "default" },
  { key: "authorize", label: "Authorize", tone: "default" },
  { key: "deauthorize", label: "Deauthorize", tone: "danger" },
  { key: "reset", label: "Factory reset", tone: "danger" },
];

export function OnuControlActions({
  serialNo,
  canControl,
}: {
  serialNo: string;
  /** False for a read-only role, and the buttons are simply not there. */
  canControl: boolean;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState<OnuControlState, FormData>(
    onuControlAction,
    {}
  );
  const [open, setOpen] = useState<OnuAction | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewControlAction>> | null>(null);
  const [confirmImpact, setConfirmImpact] = useState(false);

  // Re-render once the action has been sent and answered. The server action has
  // already revalidated the paths; without this the row behind the dialog would
  // still show the state from before the reboot.
  //
  // The dialog is closed by the submit handler's own path rather than here —
  // resetting local state inside this effect would be a side effect of a data
  // refresh, and the lint rule is right to complain.
  const answered = Boolean(state.success);
  useEffect(() => {
    if (answered) router.refresh();
  }, [answered, router]);

  if (!canControl) {
    return (
      <span className="text-xs text-fg-subtle">
        Read-only — controlling a device needs the network.edit permission.
      </span>
    );
  }

  async function begin(action: OnuAction) {
    setOpen(action);
    setConfirmImpact(false);
    setPreview(null);
    // Asked before anything is sent, so the dialog can say whether the cabinet can
    // do this at all instead of finding out from a failure.
    const detail = await previewControlAction(serialNo, action);
    setPreview(detail);
  }

  function close() {
    setOpen(null);
    setPreview(null);
    setConfirmImpact(false);
  }

  const plan = preview?.plan;
  const needsConfirm = plan?.needsConfirmation ?? false;
  const blocked = preview ? !preview.supported : false;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {ACTIONS.map((a) => (
          <Button
            key={a.key}
            size="sm"
            variant={a.tone === "danger" ? "outline" : "ghost"}
            onClick={() => begin(a.key)}
          >
            {a.label}
          </Button>
        ))}
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl">
            {/* The device is in the title. That is deliberate: it is the thing
                most likely to be wrong about, and it has to be visible without
                reading the body. */}
            <h2 className="text-sm font-semibold">
              {plan?.label ?? "Control"} {serialNo}?
            </h2>

            {blocked ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {preview?.unsupportedReason}
              </p>
            ) : (
              <>
                <p className="text-sm text-fg-muted">{plan?.effect}</p>

                <p className="text-xs text-fg-subtle">
                  On{" "}
                  {preview?.target?.oltName ?? "an unknown OLT"}
                  {preview?.target?.ponIndex ? `, PON ${preview.target.ponIndex}` : ""}
                  {preview?.target?.name ? ` · ${preview.target.name}` : ""}
                  .{plan?.keepsConfiguration ? "" : " Its configuration will not survive this."}
                </p>

                {preview?.impact.warning ? (
                  <p
                    className={
                      preview.impact.live
                        ? "rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                        : "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-fg-muted"
                    }
                  >
                    {preview.impact.warning}
                  </p>
                ) : null}

                <form action={formAction} className="space-y-2">
                  <input type="hidden" name="serialNo" value={serialNo} />
                  <input type="hidden" name="action" value={open} />

                  {needsConfirm ? (
                    <>
                      <Field
                        label={`Type I understand this ${plan?.label.toLowerCase()}d`}
                        hint={
                          preview?.impact.customerName
                            ? `${preview.impact.customerName} is affected.`
                            : undefined
                        }
                      >
                        <Input name="reason" placeholder="Support ticket, customer asked, replaced unit…" />
                      </Field>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="confirmImpact"
                          checked={confirmImpact}
                          onChange={(e) => setConfirmImpact(e.target.checked)}
                          className="mt-1"
                        />
                        <span>
                          {preview?.impact.customerName
                            ? `${preview.impact.customerName} may lose service immediately. Do it anyway.`
                            : "Do it anyway, knowing the device may need visiting afterwards."}
                        </span>
                      </label>
                    </>
                  ) : (
                    <input type="hidden" name="reason" value="" readOnly />
                  )}

                  {state.formError ? (
                    <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                      {state.formError}
                    </p>
                  ) : null}
                  {state.success ? (
                    <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.success}</p>
                  ) : null}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button type="button" variant="ghost" onClick={close}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant={plan?.needsConfirmation ? "danger" : "primary"}
                      loading={isPending}
                      disabled={blocked || (needsConfirm && !confirmImpact)}
                    >
                      {plan?.needsConfirmation ? `Yes, ${plan.label.toLowerCase()} it` : plan?.label}
                    </Button>
                  </div>
                </form>
              </>
            )}

            {blocked ? (
              <div className="flex justify-end">
                <Button variant="ghost" onClick={close}>
                  Close
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <span className="sr-only" aria-live="polite">
        {state.success ?? ""}
      </span>
    </>
  );
}