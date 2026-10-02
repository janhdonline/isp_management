/**
 * The corporate-account rules (ISP.md §33).
 *
 * Pure functions, deliberately not inline in the server actions. Both of these
 * decide things an operator can be held to — whether a corporate customer may be
 * saved without a company name, and what deadline a ticket against one gets — and
 * a server action module cannot be imported from a test at all, because it pulls
 * in `server-only`. A rule that cannot be tested is a rule that quietly changes.
 */

import { isCorporate } from "@/lib/enums";

/** What a corporate account writes into the company columns, and what Home writes. */
export type CorporateFields = {
  companyName: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  tradeLicenseNo: string | null;
  cirMbps: number | null;
  mirMbps: number | null;
  slaHours: number | null;
  billingLabel: string | null;
};

const NONE: CorporateFields = {
  companyName: null,
  contactPerson: null,
  contactPhone: null,
  tradeLicenseNo: null,
  cirMbps: null,
  mirMbps: null,
  slaHours: null,
  billingLabel: null,
};

type CorporateInput = {
  customerType?: string;
  companyName?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  tradeLicenseNo?: string | null;
  cirMbps?: number | null;
  mirMbps?: number | null;
  slaHours?: number | null;
  billingLabel?: string | null;
};

const blank = (v: string | null | undefined) => (v ? v : null);

/**
 * The company columns for a customer being saved.
 *
 * Every field is null for anything that is not a corporate or dedicated account —
 * including one where the form still carries stale company values, which happens
 * when an operator switches the type back to Home. "Not a corporate account" has
 * to be a fact in the database, not an empty string somebody has to interpret.
 */
export function corporateFieldsFor(d: CorporateInput): CorporateFields {
  if (!isCorporate(d.customerType)) return { ...NONE };
  return {
    companyName: blank(d.companyName),
    contactPerson: blank(d.contactPerson),
    contactPhone: blank(d.contactPhone),
    tradeLicenseNo: blank(d.tradeLicenseNo),
    cirMbps: d.cirMbps ?? null,
    mirMbps: d.mirMbps ?? null,
    slaHours: d.slaHours ?? null,
    billingLabel: blank(d.billingLabel),
  };
}

/** What a ticket against this customer is entitled to. */
export type SlaTerms = {
  /** Hours promised, or null when there is no contract to breach. */
  hours: number | null;
  /** When the clock runs out, or null. */
  dueAt: Date | null;
  /** The priority the ticket starts at. */
  priority: string;
};

/**
 * The SLA terms for a ticket, given who it is against.
 *
 * A corporate ticket starts at High: the office has sold a response time, and a
 * ticket sitting at Medium in a queue sorted by priority is a contract quietly
 * not being honoured. Only a *default* Medium is raised — an operator who
 * explicitly chose Critical, or chose Medium on a corporate account for a
 * genuinely trivial request, is not overruled here.
 *
 * A Home customer gets `null` throughout: no deadline to miss, no priority to
 * raise, nothing that makes their ticket look like a breach.
 */
export function slaTermsFor(
  customer: { customerType: string | null; slaHours: number | null } | null | undefined,
  requestedPriority: string,
  defaultHours: number,
  now: Date = new Date()
): SlaTerms {
  if (!isCorporate(customer?.customerType)) {
    return { hours: null, dueAt: null, priority: requestedPriority };
  }
  const hours =
    Number.isInteger(customer?.slaHours) && (customer?.slaHours ?? 0) > 0
      ? (customer!.slaHours as number)
      : defaultHours;
  return {
    hours,
    dueAt: new Date(now.getTime() + hours * 3_600_000),
    priority: requestedPriority === "Medium" ? "High" : requestedPriority,
  };
}

/** The contract response time promised to corporate clients by default. */
export function resolveDefaultSlaHours(raw: string | undefined): number {
  const n = Number(raw ?? 4);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

/**
 * The `slaHours` a customer is saved with.
 *
 * **Null for anything that is not a corporate or dedicated account**, and that is
 * the whole point of this function existing separately.
 *
 * The bug it prevents: writing
 *
 *     slaHours: corporateFieldsFor(d).slaHours ?? defaultHours
 *
 * in the save path, where `corporateFieldsFor` returns `slaHours: null` for a Home
 * account. The `??` then falls through and every residential customer created or
 * edited through the UI lands in the database with the corporate default of 4
 * hours. Nothing breaks *today* only because every reader checks `customerType`
 * first — and that is precisely the problem: the column says a home customer is
 * SLA-bound, and the first reader that trusts the column rather than the type
 * (Phase U's tracker, a report, a CSV export) starts treating a residential
 * account as a contract.
 *
 * The type decides whether there is an SLA at all; the default only fills in what
 * one already exists and left unset. Those are different questions and they do not
 * belong on one line.
 */
export function slaHoursFor(
  customerType: string | null | undefined,
  requestedSlaHours: number | null | undefined,
  defaultHours: number
): number | null {
  if (!isCorporate(customerType)) return null;
  if (Number.isInteger(requestedSlaHours) && (requestedSlaHours ?? 0) > 0) {
    return requestedSlaHours as number;
  }
  return defaultHours;
}
