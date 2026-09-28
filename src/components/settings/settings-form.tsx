"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea, Switch } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Save, TestTube2, Database } from "lucide-react";
import { useToast } from "@/components/providers";
import { saveSettingsAction, backupNowAction, AcctFormState } from "@/app/(app)/accounts/actions";

/* ------------------------------------------------------------------ */
/* Generic settings form                                               */
/* ------------------------------------------------------------------ */

export type SettingField = {
  key: string;
  label: string;
  type?: "text" | "number" | "password" | "boolean" | "select" | "textarea" | "color";
  options?: string[];
  hint?: string;
  required?: boolean;
  placeholder?: string;
};

function SaveButton({ label = "Save changes" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" icon={<Save className="size-4" />} loading={pending}>
      {pending ? "Saving..." : label}
    </Button>
  );
}

export function SettingsForm({
  fields,
  values,
  title,
  description,
}: {
  fields: SettingField[];
  values: Record<string, string>;
  title: string;
  description?: string;
}) {
  const [state, formAction] = useActionState(saveSettingsAction, {} as AcctFormState);

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

      <Card>
        <CardBody>
          <div className="mb-4">
            <h2 className="text-sm font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <SettingInput key={f.key} field={f} value={values[f.key] ?? ""} />
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SaveButton />
      </div>
    </form>
  );
}

function SettingInput({ field, value }: { field: SettingField; value: string }) {
  const [show, setShow] = useState(false);

  if (field.type === "boolean") {
    const checked = value === "true";
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 sm:col-span-2">
        <div>
          <p className="text-[13px] font-medium">{field.label}</p>
          {field.hint ? <p className="text-xs text-fg-muted">{field.hint}</p> : null}
        </div>
        <input type="hidden" name={`s.${field.key}`} value={checked ? "false" : "true"} />
        <Switch aria-label={field.label} defaultChecked={checked} className="[&>span:last-child]:hidden" />
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <Field label={field.label} required={field.required} hint={field.hint}>
        <Select name={`s.${field.key}`} defaultValue={value} options={(field.options ?? []).map((o) => ({ value: o, label: o }))} placeholder="Select" />
      </Field>
    );
  }

  if (field.type === "textarea") {
    return (
      <Field label={field.label} hint={field.hint} className="sm:col-span-2">
        <Textarea name={`s.${field.key}`} rows={3} defaultValue={value} />
      </Field>
    );
  }

  if (field.type === "password") {
    // Secrets are never sent back to the browser in plain text.
    return (
      <Field label={field.label} hint={value ? "Saved. Leave blank to keep the current value." : field.hint}>
        <div className="relative">
          <Input
            name={`s.${field.key}`}
            type={show ? "text" : "password"}
            defaultValue=""
            placeholder={value ? "••••••••" : field.placeholder}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide" : "Show"}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-subtle hover:text-[var(--fg)]"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={field.label} required={field.required} hint={field.hint}>
      <Input
        name={`s.${field.key}`}
        type={field.type === "number" ? "number" : "text"}
        defaultValue={value}
        placeholder={field.placeholder}
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Action buttons                                                      */
/* ------------------------------------------------------------------ */

export function TestButton({ action, label }: { action: () => Promise<AcctFormState>; label: string }) {
  const [busy, setBusy] = useState(false);
  const { success, error } = useToast();
  return (
    <Button
      variant="outline"
      icon={<TestTube2 className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const r = await action();
        setBusy(false);
        if (r.formError) error(r.formError);
        else success(r.success ?? "OK");
      }}
    >
      {busy ? "Testing..." : label}
    </Button>
  );
}

export function BackupNowButton() {
  const [busy, setBusy] = useState(false);
  const { success, error } = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <Button
      variant="primary"
      icon={<Database className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const r = await backupNowAction();
        setBusy(false);
        if (r.formError) error(r.formError);
        else {
          success(r.success ?? "Backup created");
          startTransition(() => router.refresh());
        }
      }}
    >
      {busy ? "Backing up..." : "Backup Now"}
    </Button>
  );
}
