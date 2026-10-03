import { z } from "zod";
import {
  BILLING_CYCLES,
  CONNECTION_TYPES,
  CUSTOMER_TYPES,
  GENDERS,
  IP_TYPES,
  PAYMENT_METHODS,
  isCorporate,
} from "@/lib/enums";

const required = (label: string) => z.string().trim().min(1, `${label} is required`);

const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone is required")
  .regex(/^[0-9+\-\s()]{6,20}$/, "Enter a valid phone number");

export const emailSchema = z
  .string()
  .trim()
  .max(120)
  .refine((v) => v === "" || z.string().email().safeParse(v).success, {
    message: "Enter a valid email address",
  })
  .optional()
  .or(z.literal(""));

export const ipSchema = z
  .string()
  .trim()
  .refine((v) => {
    if (!v) return true;
    return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v);
  }, "Enter a valid IPv4 address");

export const macSchema = z
  .string()
  .trim()
  .refine((v) => {
    if (!v) return true;
    return /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(v);
  }, "Enter a valid MAC address");

const num = (label: string) =>
  z.coerce.number({ message: `${label} must be a number` }).min(0, `${label} cannot be negative`);

const dateStr = z.coerce.date({ message: "Enter a valid date" });

/**
 * A number that a blank form field turns into `null` rather than 0.
 *
 * `z.coerce.number()` coerces "" to 0, which is never what a blank field means.
 * For an optional rate that is a zero-speed contract; for an optional hour count
 * it trips a `.min(1)` and rejects the form — including on the Home form, where
 * these fields are present but unfilled. Both are silent breakage of the
 * residential path, which is the thing this is here to prevent.
 */
const nullableNumber = (label: string, min: number) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    (min === 1
      ? z.coerce.number({ message: `${label} must be a number` }).int()
      : z.coerce.number({ message: `${label} must be a number` })
    )
      .min(min, `${label} cannot be less than ${min}`)
      .nullable()
  );

/**
 * The corporate-only rules, applied only to corporate accounts.
 *
 * A `superRefine` on the shared object rather than a second schema, so the Home
 * flow keeps exactly the validation it had. Without this, a corporate account
 * could be created with no company name — and then there is no name to put on an
 * invoice, no name on a ticket, and nothing to report receivables against.
 *
 * CIR is checked against MIR where both are given: a committed rate above the
 * maximum is a contract nobody can deliver, and catching it at entry is the only
 * time anyone reads the form.
 */
const corporateRefinements = (
  data: { customerType?: string; companyName?: string; contactPerson?: string; cirMbps?: number | null; mirMbps?: number | null },
  ctx: z.RefinementCtx
) => {
  if (!isCorporate(data.customerType)) return;
  if (!data.companyName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["companyName"],
      message: "A corporate account needs the company name it bills under",
    });
  }
  if (!data.contactPerson) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contactPerson"],
      message: "A corporate account needs somebody to call",
    });
  }
  const { cirMbps, mirMbps } = data;
  if (cirMbps != null && mirMbps != null && cirMbps > mirMbps) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cirMbps"],
      message: `The committed rate cannot exceed the maximum (${cirMbps} > ${mirMbps} Mbps)`,
    });
  }
};

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------

/**
 * An empty select box arrives as "", and Prisma wants a real null for a
 * nullable relation. Normalised here so no caller has to remember.
 */
const optionalId = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : String(v)),
  z.string().nullable()
);

const customerBase = z.object({
    // personal
    name: required("Customer name"),
    // Attribution for zone collections. Optional, and never required: most
    // customers pay at the office, so a customer with no reseller is normal.
    resellerId: optionalId,
    fatherName: optionalText(120),
    motherName: optionalText(120),
    phone: phoneSchema,
    altPhone: z.string().trim().optional().or(z.literal("")),
    email: emailSchema,
    nid: optionalText(50),
    dateOfBirth: z.coerce.date().optional().nullable(),
    gender: z.enum(GENDERS).optional().or(z.literal("")),
    address: optionalText(300),
    areaId: z.string().trim().optional().or(z.literal("")),
    customerType: z.enum(CUSTOMER_TYPES).default("Home"),
    photoUrl: optionalText(500),

    // Corporate / dedicated (Phase J).
    //
    // All optional at the schema level so the Home form is untouched — a new
    // required field on the shared object would break every existing customer
    // save, which is exactly the "no behaviour change to Home" rule. The
    // conditional requirement is applied in `corporateRefinements` below, only
    // when the type says this is a corporate account.
    companyName: optionalText(160),
    contactPerson: optionalText(120),
    contactPhone: z.string().trim().max(30).optional().or(z.literal("")),
    tradeLicenseNo: optionalText(60),
    // Blanks must become null, not 0. `z.coerce.number()` turns "" into 0, which
    // would store a zero-speed CIR on a corporate client and fail `.min(1)` on a
    // blank SLA — and that failure is on the *Home* form too, where a blank SLA
    // field is simply a field nobody filled in.
    cirMbps: nullableNumber("CIR", 0),
    mirMbps: nullableNumber("MIR", 0),
    slaHours: nullableNumber("SLA", 1),
    billingLabel: optionalText(160),

    // connection
    username: z
      .string()
      .trim()
      .min(3, "Username must be at least 3 characters")
      .regex(/^[a-zA-Z0-9._-]+$/, "Only letters, numbers, dot, dash and underscore"),
    password: z.string().max(100).optional().or(z.literal("")),
    connectionType: z.enum(CONNECTION_TYPES).default("PPPoE"),
    packageId: required("Package"),
    ipType: z.enum(IP_TYPES).default("Dynamic"),
    ipAddress: z.string().trim().optional().or(z.literal("")),
    macAddress: z.string().trim().optional().or(z.literal("")),
    routerId: z.string().trim().optional().or(z.literal("")),
    oltId: z.string().trim().optional().or(z.literal("")),
  /// The device *serial*, not the ONU row id. The form has always asked for a
  /// serial under a field called `onuId`, which is a foreign key — so typing one
  /// in wrote a value that either matched nothing or blew up the constraint, and
  /// the field could not be used at all. Phase M resolves the serial to a row and
  /// stores the id.
  onuSerial: z.string().trim().max(60).optional().or(z.literal("")),
    onuId: z.string().trim().optional().or(z.literal("")),
    ponPort: optionalText(40),
    connectionDate: dateStr,
    billingDate: z.coerce.date().optional().nullable(),
    expiryDate: z.coerce.date().optional().nullable(),

    // billing
    monthlyBill: num("Monthly bill"),
    installationFee: num("Installation fee"),
    advancePayment: num("Advance payment"),
    previousDue: num("Previous due"),
    discount: num("Discount"),
    vat: num("VAT"),
    totalPayable: num("Total payable"),

  note: optionalText(1000),
});

/** Cross-field rule shared by create and update. */
function validateDates(
  data: { connectionDate?: Date; expiryDate?: Date | null },
  ctx: z.RefinementCtx
) {
  if (data.connectionDate && data.expiryDate && data.expiryDate < data.connectionDate) {
    ctx.addIssue({
      code: "custom",
      path: ["expiryDate"],
      message: "Expiry date must be after connection date",
    });
  }
}

export const customerSchema = customerBase
  .superRefine(validateDates)
  .superRefine(corporateRefinements);

export type CustomerInput = z.infer<typeof customerSchema>;

export const customerUpdateSchema = customerBase
  .partial()
  .extend({ id: required("Customer id") })
  .superRefine(validateDates)
  .superRefine(corporateRefinements);

// ---------------------------------------------------------------------------
// Package
// ---------------------------------------------------------------------------

export const packageSchema = z.object({
  name: required("Package name"),
  downloadSpeed: z.coerce.number().int().min(1, "Download speed must be at least 1 Mbps"),
  uploadSpeed: z.coerce.number().int().min(1, "Upload speed must be at least 1 Mbps"),
  monthlyPrice: z.coerce.number().min(0, "Price cannot be negative"),
  installationFee: num("Installation fee"),
  validityDays: z.coerce.number().int().min(1, "Validity must be at least 1 day"),
  billingCycle: z.enum(BILLING_CYCLES).default("Monthly"),
  fupLimit: z.coerce.number().min(0).optional().nullable(),
  /// The RouterOS rate-limit profile subscribers on this package are provisioned
  /// with. Optional on purpose: a package with none is provisioned with no
  /// profile, which leaves whatever the router defaults to in place.
  mikrotikProfile: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : String(v).trim()),
    z.string().max(60, "That profile name is too long for RouterOS").nullable()
  ),
  /// The RouterOS profile applied when a subscriber on this package crosses
  /// their FUP limit. Optional: without it, exceeding the limit can only notify.
  fupProfile: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : String(v).trim()),
    z.string().max(60, "That profile name is too long for RouterOS").nullable()
  ),
  description: optionalText(1000),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

// ---------------------------------------------------------------------------
// Invoice / Payment
// ---------------------------------------------------------------------------

export const invoiceSchema = z.object({
  customerId: required("Customer"),
  packageId: z.string().trim().optional().or(z.literal("")),
  issueDate: dateStr,
  dueDate: dateStr,
  amount: z.coerce.number().min(0),
  discount: num("Discount"),
  vat: num("VAT"),
  note: optionalText(500),
});

export const paymentSchema = z
  .object({
    customerId: required("Customer"),
    invoiceId: z.string().trim().optional().or(z.literal("")),
    amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
    discount: num("Discount"),
    method: z.enum(PAYMENT_METHODS, { message: "Select a payment method" }),
    transactionId: optionalText(80),
    accountId: required("Account"),
    paymentDate: dateStr,
    note: optionalText(500),
    // Set when a zone reseller took the cash. Optional — most payments are taken
    // at the office by staff — and it is what the commission report is derived
    // from, so it is recorded once at the point of collection rather than
    // inferred later.
    collectedByResellerId: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : String(v)),
      z.string().nullable()
    ),
  })
  .superRefine((d, ctx) => {
    if (d.discount > d.amount) {
      ctx.addIssue({ code: "custom", path: ["discount"], message: "Discount cannot exceed amount" });
    }
  });

export const receivePaymentSchema = z
  .object({
    invoiceId: required("Invoice"),
    amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
    discount: num("Discount"),
    method: z.enum(PAYMENT_METHODS, { message: "Select a payment method" }),
    accountId: required("Account"),
    transactionId: optionalText(80),
    paymentDate: dateStr,
    note: optionalText(500),
    // Set when a zone reseller took the cash. Optional — most payments are taken
    // at the office by staff — and it is what the commission report is derived
    // from, so it is recorded once at the point of collection rather than
    // inferred later.
    collectedByResellerId: z.preprocess(
      (v) => (v === "" || v === null || v === undefined ? null : String(v)),
      z.string().nullable()
    ),
  })
  .superRefine((d, ctx) => {
    if (d.discount > d.amount) {
      ctx.addIssue({ code: "custom", path: ["discount"], message: "Discount cannot exceed amount" });
    }
  });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

// ---------------------------------------------------------------------------
// Area / Zone
// ---------------------------------------------------------------------------

export const zoneSchema = z.object({
  name: required("Zone name"),
  description: optionalText(300),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

export const areaSchema = z.object({
  name: required("Area name"),
  code: optionalText(20),
  zoneId: z.string().trim().optional().or(z.literal("")),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  /// Written by the map picker as hidden fields (Phase L). Optional and
  /// uncoerced: an area with no position is a legitimate state, and an empty
  /// string must become null rather than NaN, or it would be stored as a
  /// coordinate that is not one. `(0, 0)` is refused by the same test the map
  /// draws with, so a stored pair is always drawable.
  latitude: z.coerce.number().min(-90).max(90).optional().or(z.literal("")),
  longitude: z.coerce.number().min(-180).max(180).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type FieldErrors = Record<string, string[] | undefined>;

/** Flatten a ZodError into `{ field: ["message"] }` for the form UI. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = [];
    out[key]!.push(issue.message);
  }
  return out;
}

export function firstError(errors: FieldErrors, key: string): string | undefined {
  return errors[key]?.[0];
}
