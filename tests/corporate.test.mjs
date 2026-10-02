/**
 * Corporate and dedicated clients (ISP.md §33).
 *
 * Two things are being protected here, and the second is the one a change is most
 * likely to break by accident:
 *
 *   - the corporate flow works: identity, CIR/MIR, an SLA deadline on tickets, and
 *     the company on the invoice;
 *   - **the Home flow is untouched.** No new required field, no changed default,
 *     no behavioural difference. A phase that adds a column is easy to get right
 *     and a phase that quietly changes the residential path is how an ISP loses
 *     half its customers' records to a form validation error nobody can explain.
 */
import { test, describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { saveSettings } from "../src/lib/settings.ts";
import { customerSchema } from "../src/lib/validators.ts";
import { isCorporate, CORPORATE_TYPES, CUSTOMER_TYPES } from "../src/lib/enums.ts";
import { corporateReport, corporateCollectionReport } from "../src/lib/services/reports.ts";
import {
  corporateFieldsFor,
  slaTermsFor,
  resolveDefaultSlaHours,
} from "../src/lib/services/corporate.ts";
import { invoicePdf } from "../src/lib/services/pdf.ts";
import { slaEscalate } from "../src/lib/services/support.ts";

const stamp = Date.now();
const customerIds = [];
let pkg;
let area;

/** A customer creation payload, corporate fields omitted — the Home shape. */
function form(over = {}) {
  const n = customerIds.length + 1;
  return {
    name: `Corp Test ${n}`,
    username: `corp${stamp}${n}`,
    phone: `017${String(30000000 + n)}`,
    packageId: pkg.id,
    areaId: area.id,
    connectionDate: new Date().toISOString().slice(0, 10),
    monthlyBill: "5000",
    installationFee: "0",
    advancePayment: "0",
    previousDue: "0",
    discount: "0",
    vat: "0",
    totalPayable: "0",
    ...over,
  };
}

const company = (over = {}) =>
  form({
    customerType: "Corporate",
    companyName: "Acme Trading Ltd",
    contactPerson: "R. Khan",
    ...over,
  });

/**
 * Writes a customer straight to the table, bypassing the action.
 *
 * The form values are mapped field by field rather than spread, because they are
 * *strings* — they exist to exercise the validator, and Prisma would reject a
 * string where it wants a Float or a Date.
 */
async function makeCustomer(data) {
  const c = await prisma.customer.create({
    data: {
      customerCode: `CORP-${stamp}-${customerIds.length + 1}`,
      username: String(data.username),
      name: String(data.name),
      phone: String(data.phone),
      customerType: data.customerType ?? "Home",
      companyName: data.companyName ?? null,
      contactPerson: data.contactPerson ?? null,
      contactPhone: data.contactPhone || null,
      tradeLicenseNo: data.tradeLicenseNo ?? null,
      cirMbps: data.cirMbps ?? null,
      mirMbps: data.mirMbps ?? null,
      slaHours: data.slaHours ?? null,
      billingLabel: data.billingLabel ?? null,
      previousDue: Number(data.previousDue ?? 0),
      monthlyBill: Number(data.monthlyBill ?? 0),
      connectionStatus: "Active",
      packageId: pkg.id,
      areaId: area.id,
      connectionDate: new Date(),
    },
    select: { id: true, customerType: true },
  });
  customerIds.push(c.id);
  return c;
}

before(async () => {
  pkg = await prisma.package.create({
    data: {
      name: `Corp Test Package ${stamp}`,
      downloadSpeed: 10,
      uploadSpeed: 5,
      monthlyPrice: 5000,
      billingCycle: "Monthly",
      validityDays: 30,
      status: "Active",
    },
    select: { id: true },
  });
  area = await prisma.area.create({
    data: { name: `Corp Test Area ${stamp}`, code: `CT${stamp % 100000}`, status: "Active" },
    select: { id: true },
  });
});

beforeEach(async () => {
  await saveSettings([{ key: "corporate.defaultSlaHours", value: "4" }]);
});

after(async () => {
  const ids = customerIds;
  if (ids.length) {
    await prisma.ticket.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  }
  if (area) await prisma.area.deleteMany({ where: { id: area.id } });
  if (pkg) await prisma.package.deleteMany({ where: { id: pkg.id } });
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("which types are corporate", () => {
  test("Corporate and Dedicated carry a contract", () => {
    assert.ok(CORPORATE_TYPES.includes("Corporate"));
    assert.ok(CORPORATE_TYPES.includes("Dedicated"));
    assert.equal(isCorporate("Corporate"), true);
    assert.equal(isCorporate("Dedicated"), true);
    // Everything else is a residential or unclassified account and gets no SLA.
    for (const t of ["Home", "Business", "Bulk", "Free"]) {
      assert.equal(isCorporate(t), false, `${t} must not be treated as corporate`);
    }
  });

  test("Dedicated is a real option, not an alias somebody has to type around", () => {
    assert.ok(CUSTOMER_TYPES.includes("Dedicated"));
  });

  test("an unknown type is not corporate", () => {
    // Better to miss a contract than to invent one for an account type we do not
    // recognise.
    assert.equal(isCorporate("Something Else"), false);
    assert.equal(isCorporate(null), false);
    assert.equal(isCorporate(undefined), false);
  });
});

/* ------------------------------------------------------------------ */

describe("creating a corporate customer", () => {
  test("without a company name is refused", () => {
    const parsed = customerSchema.safeParse(company({ companyName: "" }));
    assert.equal(parsed.success, false);
    assert.ok(parsed.error.issues.some((i) => i.path.join(".") === "companyName"));
  });

  test("without a contact person is refused", () => {
    // Somebody has to be answerable on the phone. A corporate account with no
    // contact is a company the office cannot deal with.
    const parsed = customerSchema.safeParse(company({ contactPerson: "" }));
    assert.equal(parsed.success, false);
    assert.ok(parsed.error.issues.some((i) => i.path.join(".") === "contactPerson"));
  });

  test("with every field is accepted", () => {
    const parsed = customerSchema.safeParse(
      company({
        contactPhone: "01712345678",
        tradeLicenseNo: "TL-99887",
        cirMbps: "20",
        mirMbps: "50",
        slaHours: "8",
        billingLabel: "Acme Trading Ltd — monthly connectivity",
      })
    );
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.equal(parsed.data.companyName, "Acme Trading Ltd");
    assert.equal(parsed.data.cirMbps, 20);
    assert.equal(parsed.data.slaHours, 8);
  });

  test("a CIR above the MIR is refused", () => {
    // A committed rate above the maximum is a contract nobody can deliver, and
    // entry is the only time anybody reads the form.
    const parsed = customerSchema.safeParse(company({ cirMbps: "100", mirMbps: "50" }));
    assert.equal(parsed.success, false);
    assert.ok(parsed.error.issues.some((i) => i.path.join(".") === "cirMbps"));
  });

  test("a CIR below the MIR is fine, and so is having only one of them", () => {
    assert.equal(customerSchema.safeParse(company({ cirMbps: "10", mirMbps: "50" })).success, true);
    assert.equal(customerSchema.safeParse(company({ cirMbps: "10" })).success, true);
    assert.equal(customerSchema.safeParse(company({ mirMbps: "50" })).success, true);
  });

  test("a trade licence is not required here — Phase V enforces it", () => {
    const parsed = customerSchema.safeParse(company({ tradeLicenseNo: "" }));
    assert.equal(parsed.success, true, "the field exists; the KYC process is Phase V's job");
  });
});

describe("the Home flow is untouched", () => {
  test("a Home customer validates with no company fields at all", () => {
    const parsed = customerSchema.safeParse(form({ customerType: "Home" }));
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  });

  test("a Home customer with empty company fields still validates", () => {
    // The fields are visible-but-blank in a posted form; blank must not become
    // required just because they exist.
    const parsed = customerSchema.safeParse(
      form({ customerType: "Home", companyName: "", contactPerson: "", cirMbps: "", slaHours: "" })
    );
    assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  });

  test("customerType still defaults to Home", () => {
    const parsed = customerSchema.safeParse(form({}));
    assert.equal(parsed.data.customerType, "Home");
  });

  test("a Home customer stores nulls, not empty strings, in the company columns", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Home" });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    // "Not a corporate account" is a fact; "" is a value somebody has to
    // interpret later.
    assert.equal(row.companyName, null);
    assert.equal(row.contactPerson, null);
    assert.equal(row.cirMbps, null);
    assert.equal(row.slaHours, null);
  });

  test("the save path clears company fields for any non-corporate type", () => {
    // Tested on the rule rather than through a row, because the create action
    // cannot be imported from a test. An operator switching Corporate → Home must
    // leave nothing behind, including values the form still had in it.
    for (const t of ["Home", "Business", "Bulk", "Free"]) {
      const fields = corporateFieldsFor({
        customerType: t,
        companyName: "Ignored Ltd",
        contactPerson: "Someone",
        cirMbps: 20,
        slaHours: 4,
        billingLabel: "Ignored",
      });
      assert.equal(fields.companyName, null, `${t} must not collect a company name`);
      assert.equal(fields.contactPerson, null);
      assert.equal(fields.cirMbps, null);
      assert.equal(fields.slaHours, null);
      assert.equal(fields.billingLabel, null);
    }
  });

  test("the save path keeps the company fields for a corporate type", () => {
    const fields = corporateFieldsFor({
      customerType: "Corporate",
      companyName: "Kept Ltd",
      contactPerson: "P",
      contactPhone: "",
      cirMbps: 20,
      mirMbps: 50,
      slaHours: 4,
      billingLabel: "Kept",
    });
    assert.equal(fields.companyName, "Kept Ltd");
    assert.equal(fields.contactPhone, null, "a blank optional string is null, not \"\"");
    assert.equal(fields.cirMbps, 20);
    assert.equal(fields.billingLabel, "Kept");
  });
});

/* ------------------------------------------------------------------ */

describe("a corporate customer is stored with its contract", () => {
  test("every field round-trips", async () => {
    const c = await makeCustomer({
      ...form(),
      customerType: "Corporate",
      companyName: "Acme Trading Ltd",
      contactPerson: "R. Khan",
      contactPhone: "01712345678",
      tradeLicenseNo: "TL-99887",
      cirMbps: 20,
      mirMbps: 50,
      slaHours: 8,
      billingLabel: "Acme Trading Ltd — monthly connectivity",
      previousDue: 15000,
    });

    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.customerType, "Corporate");
    assert.equal(row.companyName, "Acme Trading Ltd");
    assert.equal(row.contactPerson, "R. Khan");
    assert.equal(row.contactPhone, "01712345678");
    assert.equal(row.tradeLicenseNo, "TL-99887");
    assert.equal(row.cirMbps, 20);
    assert.equal(row.mirMbps, 50);
    assert.equal(row.slaHours, 8);
    assert.equal(row.billingLabel, "Acme Trading Ltd — monthly connectivity");
    assert.equal(row.previousDue, 15000);
  });

  test("a Dedicated client stores the same fields", async () => {
    // Same operational treatment; only the commercial label differs.
    const c = await makeCustomer({
      ...form(),
      customerType: "Dedicated",
      companyName: "Northfield Bank",
      contactPerson: "S. Alam",
      cirMbps: 100,
      mirMbps: 100,
      slaHours: 2,
    });
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.customerType, "Dedicated");
    assert.equal(row.companyName, "Northfield Bank");
    assert.equal(row.slaHours, 2);
    assert.equal(isCorporate(row.customerType), true);
  });
});

/* ------------------------------------------------------------------ */

describe("tickets against a corporate client", () => {
  /**
   * Creates a ticket the way the action does: the SLA terms come from the rule,
   * and the row is written with them.
   *
   * The rule itself is a pure function and is tested directly; this checks that
   * what the action computes lands on the row, which is the seam Phase U reads.
   */
  const openTicket = async (customerId, { requestedPriority = "Medium", defaultHours = 4 } = {}) => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { customerType: true, slaHours: true },
    });
    const sla = slaTermsFor(customer, requestedPriority, defaultHours);
    const t = await prisma.ticket.create({
      data: {
        ticketNumber: `CORP-TKT-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
        customerId,
        subject: "Link down",
        problem: "Down",
        category: "Other",
        priority: sla.priority,
        status: "Open",
        slaDueAt: sla.dueAt,
        escalated: false,
      },
      select: { id: true, priority: true, slaDueAt: true, escalated: true, createdAt: true },
    });
    return t;
  };

  test("an SLA deadline is created from the customer's hours", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Corporate", companyName: "X Ltd", contactPerson: "P", slaHours: 6 });
    const ticket = await openTicket(c.id);

    assert.ok(ticket.slaDueAt, "a corporate ticket carries a deadline");
    assert.equal(ticket.priority, "High", "and starts above the default");
    const hours = (ticket.slaDueAt.getTime() - ticket.createdAt.getTime()) / 3_600_000;
    assert.equal(Math.round(hours), 6, "slaDueAt is createdAt + slaHours");
  });

  test("no slaHours falls back to the Settings default", async () => {
    await saveSettings([{ key: "corporate.defaultSlaHours", value: "9" }]);
    const c = await makeCustomer({ ...form(), customerType: "Corporate", companyName: "Y Ltd", contactPerson: "P", slaHours: null });
    const ticket = await openTicket(c.id, { defaultHours: resolveDefaultSlaHours("9") });

    assert.ok(ticket.slaDueAt);
    const hours = (ticket.slaDueAt.getTime() - ticket.createdAt.getTime()) / 3_600_000;
    assert.equal(Math.round(hours), 9, "the Settings default applies when the client has no own SLA");
    await saveSettings([{ key: "corporate.defaultSlaHours", value: "4" }]);
  });

  test("a Home customer's ticket has no deadline", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Home" });
    const ticket = await openTicket(c.id);
    assert.equal(ticket.slaDueAt, null, "a home customer has no contract and therefore no deadline");
    assert.equal(ticket.escalated, false);
  });

  test("the SLA rule raises a default Medium and leaves an explicit choice alone", () => {
    // An operator who picked Critical, or who marked a corporate ticket Medium
    // because it is genuinely trivial, is not overruled here.
    const corp = { customerType: "Corporate", slaHours: 3 };
    assert.equal(slaTermsFor(corp, "Medium", 4).priority, "High");
    assert.equal(slaTermsFor(corp, "Critical", 4).priority, "Critical");
    assert.equal(slaTermsFor(corp, "Low", 4).priority, "Low");

    // And a Home customer keeps whatever the form said.
    assert.equal(slaTermsFor({ customerType: "Home", slaHours: null }, "Medium", 4).priority, "Medium");
    assert.equal(slaTermsFor(null, "Medium", 4).hours, null);
  });

  test("the SLA rule falls back to the default only for a corporate client", () => {
    const noOwn = { customerType: "Corporate", slaHours: null };
    assert.equal(slaTermsFor(noOwn, "Low", 9).hours, 9);
    assert.equal(slaTermsFor({ customerType: "Home", slaHours: null }, "Low", 9).hours, null);
  });

  test("the default SLA reads the setting and falls back to 4", () => {
    assert.equal(resolveDefaultSlaHours("9"), 9);
    assert.equal(resolveDefaultSlaHours("4"), 4);
    assert.equal(resolveDefaultSlaHours(""), 4);
    assert.equal(resolveDefaultSlaHours("not-a-number"), 4);
    assert.equal(resolveDefaultSlaHours("0"), 4, "zero hours is not a commitment");
  });

  test("a Dedicated client's ticket is treated exactly like Corporate's", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Dedicated", companyName: "Z Ltd", contactPerson: "P", slaHours: 3 });
    const ticket = await openTicket(c.id);
    const hours = (ticket.slaDueAt.getTime() - ticket.createdAt.getTime()) / 3_600_000;
    assert.equal(Math.round(hours), 3);
  });

  test("a ticket past its deadline escalates, and one closed stops escalating", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Corporate", companyName: "W Ltd", contactPerson: "P", slaHours: 1 });

    // Already overdue on creation, as a ticket opened overnight would be.
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `CORP-TKT-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
        customerId: c.id,
        subject: "Outage",
        problem: "Down",
        priority: "High",
        status: "Open",
        slaDueAt: new Date(Date.now() - 60_000),
        escalated: false,
      },
      select: { id: true },
    });

    const flagged = await slaEscalate();
    assert.ok(flagged >= 1, "the breach is noticed when the queue is read");
    let row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(row.escalated, true, "an open, overdue ticket is escalated");

    // Closing it clears the flag: recomputing "overdue" from the timestamp alone
    // would call a ticket closed after breaching escalated for ever.
    await prisma.ticket.update({ where: { id: ticket.id }, data: { status: "Closed" } });
    await slaEscalate();
    row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(row.escalated, false, "a closed ticket stops being an escalation");
  });

  test("a ticket inside its deadline is not escalated", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Corporate", companyName: "V Ltd", contactPerson: "P", slaHours: 24 });
    const ticket = await openTicket(c.id, { slaDueAt: new Date(Date.now() + 24 * 3600_000) });

    await slaEscalate();
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    assert.equal(row.escalated, false);
  });
});

/* ------------------------------------------------------------------ */

describe("the invoice header", () => {
  test("a corporate invoice names the company and the billing label", async () => {
    const c = await makeCustomer({
      ...form(),
      customerType: "Corporate",
      companyName: "Acme Trading Ltd",
      contactPerson: "R. Khan",
      billingLabel: "Acme Trading Ltd — branch office link",
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `CORP-INV-${stamp}-${customerIds.length}`,
        customerId: c.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 5000,
        total: 5000,
        paid: 0,
        status: "Due",
      },
      select: { id: true },
    });

    // The PDF is a stream, so the check is that the fields reach it: the same
    // values the header renders.
    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { customer: true },
    });
    assert.equal(isCorporate(row.customer.customerType), true);
    assert.equal(row.customer.companyName, "Acme Trading Ltd");
    assert.equal(row.customer.billingLabel, "Acme Trading Ltd — branch office link");

    // And the document actually builds, which is where a missing field would
    // surface rather than at read time.
    const { buffer } = await invoicePdf(invoice.id);
    assert.ok(buffer.length > 500, "a corporate invoice renders");
  });

  test("a Home invoice is unchanged — the personal name still leads", async () => {
    const c = await makeCustomer({ ...form(), customerType: "Home" });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `HOME-INV-${stamp}-${customerIds.length}`,
        customerId: c.id,
        issueDate: new Date(),
        dueDate: new Date(),
        amount: 500,
        total: 500,
        paid: 0,
        status: "Due",
      },
      select: { id: true },
    });

    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: { customer: true },
    });
    assert.equal(row.customer.companyName, null);
    assert.equal(row.customer.billingLabel, null);
    assert.equal(isCorporate(row.customer.customerType), false);

    const { buffer } = await invoicePdf(invoice.id);
    assert.ok(buffer.length > 500, "a home invoice still renders exactly as before");
  });
});

/* ------------------------------------------------------------------ */

describe("the corporate reports", () => {
  test("list corporate clients with their CIR and MIR, and reconcile receivables", async () => {
    const a = await makeCustomer({
      ...form(),
      customerType: "Corporate",
      companyName: "Report Alpha Ltd",
      contactPerson: "A",
      cirMbps: 20,
      mirMbps: 50,
      previousDue: 12000,
      monthlyBill: 8000,
    });
    await makeCustomer({
      ...form(),
      customerType: "Dedicated",
      companyName: "Report Beta Ltd",
      contactPerson: "B",
      cirMbps: 100,
      mirMbps: 100,
      previousDue: 5000,
      monthlyBill: 20000,
    });
    // A home customer with money owed must not appear in a *corporate* report.
    await makeCustomer({ ...form(), customerType: "Home", previousDue: 99999, monthlyBill: 500 });

    const report = await corporateReport();
    const ids = report.rows.map((r) => r.id);

    assert.ok(ids.includes(a.id), "a corporate client is listed");
    assert.ok(
      report.rows.every((r) => isCorporate(r.customerType)),
      "nothing but Corporate or Dedicated"
    );

    const alpha = report.rows.find((r) => r.id === a.id);
    assert.equal(alpha.companyName, "Report Alpha Ltd");
    assert.equal(alpha.cirMbps, 20);
    assert.equal(alpha.mirMbps, 50);
    assert.equal(alpha.headroomMbps, 30, "30 Mbps of headroom above the commitment");

    // The receivables figure is the customer table's own field, not a separate
    // calculation that could drift from it.
    const fromTable = await prisma.customer.aggregate({
      where: { customerType: { in: ["Corporate", "Dedicated"] } },
      _sum: { previousDue: true, monthlyBill: true },
    });
    assert.equal(report.metrics.totalReceivables, fromTable._sum.previousDue ?? 0);
    assert.equal(report.metrics.totalMonthly, fromTable._sum.monthlyBill ?? 0);
  });

  test("headroom is null when a rate is missing, not zero", async () => {
    // "Unknown" and "no headroom" are very different things to say about a
    // contract, and a zero would read as the second.
    const c = await makeCustomer({
      ...form(),
      customerType: "Corporate",
      companyName: "Partial Rates Ltd",
      contactPerson: "P",
      cirMbps: 10,
      mirMbps: null,
    });
    const report = await corporateReport();
    const row = report.rows.find((r) => r.id === c.id);
    assert.equal(row.headroomMbps, null);
  });

  test("SLA compliance is reported as pending Phase U, not invented", async () => {
    const report = await corporateReport();
    // There is no per-ticket resolution data to measure against, so a percentage
    // here would be a number in front of an operator that means nothing.
    assert.equal(report.metrics.slaCompliance, null);
    assert.match(report.metrics.slaComplianceNote, /Phase U/);
  });

  test("the receivables report sums to the customer table", async () => {
    const c = await makeCustomer({
      ...form(),
      customerType: "Corporate",
      companyName: "Owed Ltd",
      contactPerson: "P",
      cirMbps: 25,
      mirMbps: 25,
      previousDue: 30000,
    });

    const range = {
      from: new Date(Date.now() - 30 * 86400000),
      to: new Date(),
    };
    const report = await corporateCollectionReport(range);
    const row = report.rows.find((r) => r.id === c.id);

    assert.ok(row, "the corporate client is listed");
    assert.equal(row.previousDue, 30000);
    assert.equal(row.cirMbps, 25);

    const fromTable = await prisma.customer.aggregate({
      where: { customerType: { in: ["Corporate", "Dedicated"] } },
      _sum: { previousDue: true },
    });
    assert.equal(report.metrics.totalReceivables, fromTable._sum.previousDue ?? 0);
    assert.equal(report.metrics.debtors, report.rows.filter((r) => r.previousDue > 0).length);
  });
});
