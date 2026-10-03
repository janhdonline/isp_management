"use client";

import { useActionState } from "react";
import { assignPortAction, type PonActionState } from "@/app/(app)/network/pon/actions";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";

/**
 * Places an ONU that has no port onto one.
 *
 * The port is preselected to the least-loaded one rather than left blank.
 * Preselected, not hidden: an operator can see what the system thinks and disagree
 * with it, which is the difference between a suggestion and an autopilot. The list
 * they choose from was counted by the server on this page load, so it is now.
 *
 * A full port is **not in the list at all**. That is usability, not safety —
 * `assignPortAction` refuses one server-side inside a transaction, and the refusal
 * comes back with somewhere else to go. The list is a convenience; the lock is the
 * rule.
 *
 * There is no OLT chooser here. The page belongs to one cabinet, so offering a
 * selector whose port list came from a different cabinet would be a control that
 * lies.
 */
export function OnuPortAssigner({
  ports,
  unassigned,
}: {
  /** Every port on this cabinet, counted. */
  ports: {
    port: string;
    used: number;
    splitRatio: number;
    percent: number;
    atCapacity: boolean;
    nearCapacity: boolean;
  }[];
  unassigned: { id: string; serialNo: string; name: string | null; vendor: string | null }[];
}) {
  const [state, formAction, isPending] = useActionState<PonActionState, FormData>(
    assignPortAction,
    {}
  );

  const open = ports.filter((p) => !p.atCapacity);
  const suggested = open.slice().sort((a, b) => a.used - b.used)[0];
  const nothingToDo = !open.length || !unassigned.length;

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field
          label="ONU"
          hint={
            unassigned.length
              ? `${unassigned.length} on this cabinet with no port`
              : "Every ONU on this cabinet already has a port"
          }
        >
          <Select
            name="onuId"
            options={unassigned.map((u) => ({
              value: u.id,
              label: `${u.serialNo}${u.name ? ` · ${u.name}` : u.vendor ? ` · ${u.vendor}` : ""}`,
            }))}
            placeholder={unassigned.length ? "Choose an ONU" : "Nothing to place"}
            required
            disabled={!unassigned.length}
          />
        </Field>

        <Field
          label="Port"
          hint={
            suggested
              ? `Least loaded is ${suggested.port} — ${suggested.used} of ${suggested.splitRatio} in use`
              : "Every port on this cabinet is full"
          }
        >
          <Select
            name="port"
            defaultValue={suggested?.port ?? ""}
            options={open.map((p) => ({
              value: p.port,
              label: `${p.port} — ${p.used}/${p.splitRatio}${p.nearCapacity ? " · nearly full" : ""}`,
            }))}
            placeholder={open.length ? "Choose a port" : "No port has room"}
            required
            disabled={!open.length}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={isPending} disabled={nothingToDo}>
          Place ONU
        </Button>
        <span className="text-xs text-fg-subtle">
          {open.length
            ? `${open.length} of ${ports.length} port(s) have room. Counts are read from the ONU table on every load.`
            : "Nothing can be placed here until a port has room, or the cabinet's split ratio is raised."}
        </span>
      </div>

      {state.formError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.success}</p>
      ) : null}
    </form>
  );
}