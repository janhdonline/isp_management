"use client";

import * as React from "react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { COMPLAINT_CATEGORIES, TICKET_PRIORITIES } from "@/lib/enums";
import { createLeaveAction, createEmployeeAction, createTicketAction, sendMessageAction, type ActionState } from "@/app/(app)/support/actions";
import { SMS_TEMPLATES } from "@/app/(app)/support/actions";
import { useToast } from "@/components/providers";

type Option = { id: string; name: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {pending ? "Saving..." : label}
    </Button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.formError) {
    return (
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <p>{state.formError}</p>
      </div>
    );
  }
  if (state.success) {
    return (
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <p>{state.success}</p>
      </div>
    );
  }
  return null;
}

/* ================================================================== */
/* Ticket form                                                         */
/* ================================================================== */

export function TicketForm({
  customers,
  technicians,
  areas,
  defaultCustomerId,
}: {
  customers: (Option & { username: string; phone: string })[];
  technicians: Option[];
  areas: Option[];
  defaultCustomerId?: string;
}) {
  const [state, formAction] = useActionState(createTicketAction, {} as ActionState);
  const [category, setCategory] = useState<string>("No Internet");

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer" hint="Leave blank for a walk-in complaint" className="sm:col-span-2">
          <Select
            name="customerId"
            defaultValue={defaultCustomerId ?? ""}
            placeholder="No customer"
            options={customers.map((c) => ({ value: c.id, label: `${c.name} — ${c.username} — ${c.phone}` }))}
          />
        </Field>
        <Field label="Subject" required error={state.errors?.subject?.[0]} className="sm:col-span-2">
          <Input name="subject" placeholder="Short summary of the problem" invalid={!!state.errors?.subject} />
        </Field>
        <Field label="Category" required error={state.errors?.category?.[0]}>
          <Select
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
        </Field>
        <Field label="Priority" required error={state.errors?.priority?.[0]}>
          <Select name="priority" defaultValue="Medium" options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Technician" error={state.errors?.technicianId?.[0]}>
          <Select name="technicianId" defaultValue="" placeholder="Unassigned" options={technicians.map((t) => ({ value: t.id, label: t.name }))} />
        </Field>
        <Field label="Area" error={state.errors?.areaId?.[0]} hint="Defaults to the customer's area">
          <Select name="areaId" defaultValue="" placeholder="Auto" options={areas.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
        <Field label="Description" className="sm:col-span-2" error={state.errors?.description?.[0]}>
          <Textarea name="description" rows={4} placeholder="What is happening, when it started, what has been tried." />
        </Field>
      </div>

      <div className="flex justify-end">
        <Submit label="Create ticket" />
      </div>
    </form>
  );
}

/* ================================================================== */
/* Employee form                                                       */
/* ================================================================== */

export function EmployeeForm({ areas }: { areas: Option[] }) {
  const [state, formAction] = useActionState(createEmployeeAction, {} as ActionState);
  const { success } = useToast();
  const router = useRouter();

  // Navigate away once the employee exists, keeping the action plain so the
  // form state stays server-driven.
  React.useEffect(() => {
    if (state.success) {
      success(state.success);
      router.push("/employees");
    }
  }, [state.success, success, router]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full Name" required error={state.errors?.name?.[0]}>
          <Input name="name" placeholder="e.g. Rahim Uddin" invalid={!!state.errors?.name} />
        </Field>
        <Field label="Role" required error={state.errors?.role?.[0]} hint="Use “Field Technician” to appear in the support dispatch list">
          <Input name="role" placeholder="Field Technician" invalid={!!state.errors?.role} />
        </Field>
        <Field label="Mobile" required error={state.errors?.phone?.[0]}>
          <Input name="phone" placeholder="01XXXXXXXXX" invalid={!!state.errors?.phone} />
        </Field>
        <Field label="Email" error={state.errors?.email?.[0]}>
          <Input name="email" type="email" placeholder="name@company.com" invalid={!!state.errors?.email} />
        </Field>
        <Field label="Area">
          <Select name="areaId" defaultValue="" placeholder="No area" options={areas.map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
        <Field label="Joining Date" required error={state.errors?.joiningDate?.[0]}>
          <Input name="joiningDate" type="date" required />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Textarea name="address" rows={2} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Submit label="Add employee" />
      </div>
    </form>
  );
}

/* ================================================================== */
/* Leave form                                                          */
/* ================================================================== */

export function LeaveForm({ employees }: { employees: Option[] }) {
  const [state, formAction] = useActionState(createLeaveAction, {} as ActionState);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" required error={state.errors?.employeeId?.[0]} className="sm:col-span-2">
          <Select name="employeeId" placeholder="Select employee" options={employees.map((e) => ({ value: e.id, label: e.name }))} invalid={!!state.errors?.employeeId} />
        </Field>
        <Field label="Leave Type" required error={state.errors?.leaveType?.[0]}>
          <Select
            name="leaveType"
            placeholder="Select type"
            options={["Casual", "Sick", "Annual", "Unpaid", "Maternity"].map((t) => ({ value: t, label: t }))}
            invalid={!!state.errors?.leaveType}
          />
        </Field>
        <Field label="Start Date" required error={state.errors?.startDate?.[0]}>
          <Input name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="End Date" required error={state.errors?.endDate?.[0]}>
          <Input name="endDate" type="date" value={end} onChange={(e) => setEnd(e.target.value)} min={start} required />
        </Field>
        <Field label="Reason" className="sm:col-span-2" error={state.errors?.reason?.[0]}>
          <Textarea name="reason" rows={2} />
        </Field>
      </div>

      <div className="flex justify-end">
        <Submit label="Submit request" />
      </div>
    </form>
  );
}

/* ================================================================== */
/* Compose message (SMS + email share this)                            */
/* ================================================================== */

const AUDIENCES = [
  { value: "customer", label: "One customer" },
  { value: "area", label: "Everyone in an area" },
  { value: "package", label: "Everyone on a package" },
  { value: "status", label: "Everyone with a status" },
  { value: "all", label: "All customers" },
];

export function ComposeMessage({
  channel,
  areas,
  packages,
  statuses,
  defaultAudience = "area",
}: {
  channel: "SMS" | "Email";
  areas: Option[];
  packages: Option[];
  statuses: string[];
  defaultAudience?: string;
}) {
  const [state, formAction] = useActionState(sendMessageAction, {} as ActionState);
  const [audience, setAudience] = useState(defaultAudience);
  const [body, setBody] = useState(SMS_TEMPLATES[0].body);
  const [scheduled, setScheduled] = useState(false);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <Feedback state={state} />
      <input type="hidden" name="channel" value={channel} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send to" required>
          <Select name="audience" value={audience} onChange={(e) => setAudience(e.target.value)} options={AUDIENCES} />
        </Field>

        {audience === "customer" ? (
          <Field label="Phone number or username" hint="Leave empty to use the audience above">
            <Input name="recipient" placeholder="01XXXXXXXXX" />
          </Field>
        ) : null}
        {audience === "area" ? (
          <Field label="Area" required>
            <Select name="areaId" placeholder="Select area" options={areas.map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
        ) : null}
        {audience === "package" ? (
          <Field label="Package" required>
            <Select name="packageId" placeholder="Select package" options={packages.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        ) : null}
        {audience === "status" ? (
          <Field label="Connection status" required>
            <Select name="connectionStatus" placeholder="Select status" options={statuses.map((s) => ({ value: s, label: s }))} />
          </Field>
        ) : null}

        {channel === "Email" ? (
          <Field label="Subject" className="sm:col-span-2">
            <Input name="subject" placeholder="Subject line" />
          </Field>
        ) : null}

        <Field
          label="Template"
          hint="Placeholders: {name} {amount} {date} {username}"
        >
          <Select
            onChange={(e) => {
              const t = SMS_TEMPLATES.find((x) => x.key === e.target.value);
              if (t) setBody(t.body);
            }}
            defaultValue=""
            placeholder="No template"
            options={SMS_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))}
          />
        </Field>

        <Field label="Schedule" hint="Leave empty to send immediately">
          <Input name="schedule" type="datetime-local" />
        </Field>

        <Field
          label={channel === "SMS" ? "Message" : "Body"}
          required
          className="sm:col-span-2"
          error={state.errors?.body?.[0]}
        >
          <Textarea name="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} invalid={!!state.errors?.body} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <p className="text-xs text-fg-muted">
          {body.length} characters
          {channel === "SMS" && body.length > 480 ? " · long messages are split" : ""}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setScheduled(!scheduled)}>
            {scheduled ? "Send now" : "Schedule"}
          </Button>
          <Submit label={scheduled ? "Schedule message" : `Send ${channel}`} />
        </div>
      </div>

    </form>
  );
}
