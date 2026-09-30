"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { FormState } from "@/app/(app)/customers/actions";
import { Field, Input, Select, Textarea, FormSection } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Contact, Network, Wallet } from "lucide-react";
import { CONNECTION_TYPES, CUSTOMER_TYPES, GENDERS, IP_TYPES } from "@/lib/enums";
import { addDays, round2 } from "@/lib/utils";

export type Option = { id: string; name: string };

export type CustomerFormDefaults = {
  id?: string;
  name?: string;
  fatherName?: string;
  motherName?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  nid?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  areaId?: string;
  resellerId?: string | null;
  customerType?: string;
  photoUrl?: string;
  username?: string;
  password?: string;
  connectionType?: string;
  packageId?: string;
  ipType?: string;
  ipAddress?: string;
  macAddress?: string;
  routerId?: string;
  onuId?: string;
  oltId?: string;
  ponPort?: string;
  connectionDate?: string;
  billingDate?: string;
  expiryDate?: string;
  monthlyBill?: number;
  installationFee?: number;
  advancePayment?: number;
  previousDue?: number;
  discount?: number;
  vat?: number;
  note?: string;
};

function SubmitButtons({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  const router = useRouter();

  if (isEdit) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save Changes
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="reset" variant="ghost">
        Reset
      </Button>
      <Button type="button" variant="outline" onClick={() => router.back()}>
        Cancel
      </Button>
      <Button type="submit" name="_intent" value="new" variant="outline" loading={pending}>
        Save &amp; Create Another
      </Button>
      <Button type="submit" name="_intent" value="invoice" variant="secondary" loading={pending}>
        Save &amp; Create Invoice
      </Button>
      <Button type="submit" name="_intent" value="profile" variant="primary" loading={pending}>
        Save Customer
      </Button>
    </div>
  );
}

/**
 * The full customer form (ISP.md §3). Every field is validated on the server
 * with the shared Zod schema and the same error map is rendered inline here.
 */
export function CustomerForm({
  areas,
  resellers,
  packages,
  routers,
  olts,
  defaults,
  isEdit,
  action,
}: {
  areas: (Option & { zone?: string | null })[];
  /** Optional: a customer with no reseller is the common case. */
  resellers?: Option[];
  packages: (Option & { price: number; fee: number; speed: string })[];
  routers: Option[];
  olts: Option[];
  defaults: CustomerFormDefaults;
  isEdit: boolean;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, {} as FormState);

  const [packageId, setPackageId] = useState(defaults.packageId ?? packages[0]?.id ?? "");
  const [ipType, setIpType] = useState(defaults.ipType ?? "Dynamic");
  const [connectionDate, setConnectionDate] = useState(
    defaults.connectionDate ? defaults.connectionDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [expiryDate, setExpiryDate] = useState(
    defaults.expiryDate ? defaults.expiryDate.slice(0, 10) : addDays(new Date(), 30).toISOString().slice(0, 10)
  );

  const selected = packages.find((p) => p.id === packageId);
  const monthlyBill = isEdit ? defaults.monthlyBill ?? 0 : selected?.price ?? 0;
  const installationFee = isEdit ? defaults.installationFee ?? 0 : selected?.fee ?? 0;
  const [discount, setDiscount] = useState(defaults.discount ?? 0);
  const [vat, setVat] = useState(defaults.vat ?? 0);
  const [advance, setAdvance] = useState(defaults.advancePayment ?? 0);

  const totalPayable = round2(
    Math.max(0, monthlyBill - discount) + vat + (isEdit ? (defaults.previousDue ?? 0) : 0)
  );

  const setField = (name: string) => state.errors?.[name]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

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
        <CardHeader title="Personal Information" description="Identity and contact details of the subscriber" icon={<Contact />} />
        <CardBody className="space-y-5">
          <FormSection title="Identity" columns={3}>
            <Field label="Customer Name" required error={setField("name")}>
              <Input name="name" defaultValue={defaults.name} placeholder="e.g. Rahim Uddin" invalid={!!setField("name")} />
            </Field>
            <Field label="Father / Husband Name">
              <Input name="fatherName" defaultValue={defaults.fatherName} placeholder="Full name" />
            </Field>
            <Field label="Mother Name">
              <Input name="motherName" defaultValue={defaults.motherName} />
            </Field>
            <Field label="Mobile" required error={setField("phone")}>
              <Input name="phone" defaultValue={defaults.phone} placeholder="01XXXXXXXXX" invalid={!!setField("phone")} />
            </Field>
            <Field label="Alternative Mobile">
              <Input name="altPhone" defaultValue={defaults.altPhone} placeholder="01XXXXXXXXX" />
            </Field>
            <Field label="Email" error={setField("email")}>
              <Input name="email" type="email" defaultValue={defaults.email} placeholder="name@example.com" invalid={!!setField("email")} />
            </Field>
            <Field label="NID">
              <Input name="nid" defaultValue={defaults.nid} />
            </Field>
            <Field label="Date of Birth">
              <Input type="date" name="dateOfBirth" defaultValue={defaults.dateOfBirth ? defaults.dateOfBirth.slice(0, 10) : ""} />
            </Field>
            <Field label="Gender">
              <Select name="gender" defaultValue={defaults.gender ?? ""} placeholder="Select" options={GENDERS.map((g) => ({ value: g, label: g }))} />
            </Field>
          </FormSection>

          <FormSection title="Location" columns={3}>
            <Field label="Area" error={setField("areaId")}>
              <Select
                name="areaId"
                defaultValue={defaults.areaId ?? ""}
                placeholder="Select area"
                options={areas.map((a) => ({ value: a.id, label: a.zone ? `${a.name} (${a.zone})` : a.name }))}
              />
            </Field>
            <Field label="Customer Type">
              <Select name="customerType" defaultValue={defaults.customerType ?? "Home"} options={CUSTOMER_TYPES.map((c) => ({ value: c, label: c }))} />
            </Field>
            <Field
              label="Reseller"
              error={setField("resellerId")}
              hint="Optional. Who collects this customer's cash in the zone."
            >
              <Select
                name="resellerId"
                defaultValue={defaults.resellerId ?? ""}
                placeholder="Collected at the office"
                options={(resellers ?? []).map((r) => ({ value: r.id, label: r.name }))}
              />
            </Field>
            <Field label="Photo URL" hint="Optional link to a customer photo">
              <Input name="photoUrl" defaultValue={defaults.photoUrl} placeholder="https://..." />
            </Field>
            <Field label="Address" className="sm:col-span-2 lg:col-span-3">
              <Textarea name="address" rows={2} defaultValue={defaults.address} placeholder="House, road, landmark" />
            </Field>
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Connection Information" description="PPPoE credentials, network assignment and validity" icon={<Network />} />
        <CardBody className="space-y-5">
          <FormSection title="Access" columns={3}>
            <Field label="Username" required error={setField("username")} hint="Must be unique across all customers">
              <Input name="username" defaultValue={defaults.username} placeholder="rahim101" invalid={!!setField("username")} />
            </Field>
            <Field label="Password" hint={isEdit ? "Leave blank to keep the current password" : "Auto-generated if empty"}>
              <Input name="password" type="text" defaultValue={defaults.password} placeholder="••••••" />
            </Field>
            <Field label="Connection Type">
              <Select name="connectionType" defaultValue={defaults.connectionType ?? "PPPoE"} options={CONNECTION_TYPES.map((c) => ({ value: c, label: c }))} />
            </Field>
            <Field label="Package" required error={setField("packageId")}>
              <Select
                name="packageId"
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                placeholder="Select package"
                options={packages.map((p) => ({ value: p.id, label: `${p.name} — ${p.speed} Mbps` }))}
                invalid={!!setField("packageId")}
              />
            </Field>
            <Field label="IP Type">
              <Select
                name="ipType"
                value={ipType}
                onChange={(e) => setIpType(e.target.value)}
                options={IP_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
            <Field label="IP Address" error={setField("ipAddress")} hint={ipType === "Static" ? "Required for static IP" : "Optional"}>
              <Input name="ipAddress" defaultValue={defaults.ipAddress} placeholder="100.64.10.5" invalid={!!setField("ipAddress")} />
            </Field>
            <Field label="MAC Address" error={setField("macAddress")}>
              <Input name="macAddress" defaultValue={defaults.macAddress} placeholder="A4:2B:B0:11:22:33" invalid={!!setField("macAddress")} />
            </Field>
            <Field label="Router">
              <Select name="routerId" defaultValue={defaults.routerId ?? ""} placeholder="Select router" options={routers.map((r) => ({ value: r.id, label: r.name }))} />
            </Field>
            <Field label="OLT">
              <Select name="oltId" defaultValue={defaults.oltId ?? ""} placeholder="Select OLT" options={olts.map((o) => ({ value: o.id, label: o.name }))} />
            </Field>
            <Field label="ONU">
              <Input name="onuId" defaultValue={defaults.onuId} placeholder="ONU serial" />
            </Field>
            <Field label="PON Port">
              <Input name="ponPort" defaultValue={defaults.ponPort} placeholder="0/1/2:4" />
            </Field>
          </FormSection>

          <FormSection title="Dates" columns={3}>
            <Field label="Connection Date" required error={setField("connectionDate")}>
              <Input
                type="date"
                name="connectionDate"
                value={connectionDate}
                onChange={(e) => setConnectionDate(e.target.value)}
                invalid={!!setField("connectionDate")}
              />
            </Field>
            <Field label="Billing Date" error={setField("billingDate")}>
              <Input type="date" name="billingDate" defaultValue={defaults.billingDate ? defaults.billingDate.slice(0, 10) : ""} />
            </Field>
            <Field label="Expiry Date" error={setField("expiryDate")}>
              <Input
                type="date"
                name="expiryDate"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                invalid={!!setField("expiryDate")}
              />
            </Field>
          </FormSection>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Billing Information" description="Charges applied to this subscription" icon={<Wallet />} />
        <CardBody className="space-y-5">
          <input type="hidden" name="monthlyBill" value={monthlyBill} />
          <input type="hidden" name="installationFee" value={installationFee} />
          <input type="hidden" name="totalPayable" value={totalPayable} />

          <FormSection title="Charges" columns={3}>
            <Field label="Monthly Bill" hint={`From ${selected?.name ?? "package"}`}>
              <Input value={String(monthlyBill)} readOnly disabled />
            </Field>
            <Field label="Installation Fee">
              <Input value={String(installationFee)} readOnly disabled />
            </Field>
            <Field label="Previous Due" error={setField("previousDue")}>
              <Input name="previousDue" type="number" step="0.01" defaultValue={defaults.previousDue ?? 0} />
            </Field>
            <Field label="Advance Payment" error={setField("advancePayment")} hint="Booked as a paid invoice on activation">
              <Input name="advancePayment" type="number" step="0.01" value={isEdit ? defaults.advancePayment ?? 0 : advance} onChange={(e) => setAdvance(Number(e.target.value))} readOnly={isEdit} />
            </Field>
            <Field label="Discount" error={setField("discount")}>
              <Input name="discount" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </Field>
            <Field label="VAT" error={setField("vat")}>
              <Input name="vat" type="number" step="0.01" value={vat} onChange={(e) => setVat(Number(e.target.value))} />
            </Field>
          </FormSection>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <div>
              <p className="text-xs text-fg-muted">Total Payable</p>
              <p className="text-lg font-semibold tabular-nums">{totalPayable.toLocaleString()}</p>
            </div>
            <p className="text-xs text-fg-subtle">
              {isEdit ? "Based on monthly bill, discount, VAT and previous due" : "Amount due on activation"}
            </p>
          </div>

          <Field label="Notes" error={setField("note")}>
            <Textarea name="note" rows={2} defaultValue={defaults.note} placeholder="Installation notes, special terms..." />
          </Field>
        </CardBody>
        <CardFooter>
          <SubmitButtons isEdit={isEdit} />
        </CardFooter>
      </Card>
    </form>
  );
}
