"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { BILLING_CYCLES } from "@/lib/enums";
import { createPackageAction, type PkgFormState } from "@/app/(app)/packages/actions";

export type PkgDefaults = {
  id?: string;
  name?: string;
  downloadSpeed?: number;
  uploadSpeed?: number;
  monthlyPrice?: number;
  installationFee?: number;
  validityDays?: number;
  billingCycle?: string;
  fupLimit?: number | null;
  /// The RouterOS rate-limit profile this package provisions subscribers with.
  mikrotikProfile?: string | null;
  description?: string;
  status?: string;
};

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => window.history.back()}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" loading={pending}>
        {isEdit ? "Save Changes" : "Save Package"}
      </Button>
    </div>
  );
}

export function PackageForm({
  defaults,
  isEdit,
}: {
  defaults: PkgDefaults;
  isEdit: boolean;
}) {
  const [state, formAction] = useActionState(createPackageAction, {} as PkgFormState);
  const [cycle, setCycle] = useState(defaults.billingCycle ?? "Monthly");
  const [price, setPrice] = useState(defaults.monthlyPrice ?? 0);
  const [down, setDown] = useState(defaults.downloadSpeed ?? 0);
  const [up, setUpload] = useState(defaults.uploadSpeed ?? 0);

  const err = (k: string) => state.errors?.[k]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.formError ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{state.formError}</p>
        </div>
      ) : null}
      {state.success ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>{state.success}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Package Name" required error={err("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={defaults.name} placeholder="e.g. Home Standard 20" invalid={!!err("name")} />
        </Field>

        <Field label="Download Speed (Mbps)" required error={err("downloadSpeed")}>
          <Input
            name="downloadSpeed"
            type="number"
            min={1}
            value={down}
            onChange={(e) => setDown(Number(e.target.value))}
            invalid={!!err("downloadSpeed")}
          />
        </Field>
        <Field label="Upload Speed (Mbps)" required error={err("uploadSpeed")}>
          <Input
            name="uploadSpeed"
            type="number"
            min={1}
            value={up}
            onChange={(e) => setUpload(Number(e.target.value))}
            invalid={!!err("uploadSpeed")}
          />
        </Field>

        <Field label="Monthly Price" required error={err("monthlyPrice")}>
          <Input
            name="monthlyPrice"
            type="number"
            step="0.01"
            min={0}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            invalid={!!err("monthlyPrice")}
          />
        </Field>
        <Field label="Installation Fee" error={err("installationFee")}>
          <Input name="installationFee" type="number" step="0.01" min={0} defaultValue={defaults.installationFee ?? 0} />
        </Field>

        <Field label="Validity (days)" required error={err("validityDays")}>
          <Input name="validityDays" type="number" min={1} defaultValue={defaults.validityDays ?? 30} invalid={!!err("validityDays")} />
        </Field>
        <Field label="Billing Cycle">
          <Select
            name="billingCycle"
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
            options={BILLING_CYCLES.map((c) => ({ value: c, label: c }))}
          />
        </Field>

        <Field label="FUP Limit (GB)" error={err("fupLimit")} hint="Leave blank for unlimited usage">
          <Input name="fupLimit" type="number" step="0.1" min={0} defaultValue={defaults.fupLimit ?? ""} />
        </Field>
        <Field
          label="MikroTik Profile"
          error={err("mikrotikProfile")}
          hint="The rate-limit profile on the router, e.g. 10Mbps. New subscribers and package changes are provisioned with it. Leave blank to use the router's default."
        >
          <Input
            name="mikrotikProfile"
            defaultValue={defaults.mikrotikProfile ?? ""}
            placeholder="10Mbps"
          />
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={defaults.status ?? "Active"} options={[{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }]} />
        </Field>

        <Field label="Description" className="sm:col-span-2" error={err("description")}>
          <Textarea name="description" rows={3} defaultValue={defaults.description} placeholder="Who this package is for, fair-use rules, SLA..." />
        </Field>
      </div>

      <div className="flex items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm">
        <span className="text-fg-muted">Summary</span>
        <span className="font-medium">
          {down || 0} / {up || 0} Mbps · {price || 0} per {cycle.toLowerCase()} cycle
        </span>
      </div>

      <div className="flex justify-end">
        <Submit isEdit={isEdit} />
      </div>
    </form>
  );
}
