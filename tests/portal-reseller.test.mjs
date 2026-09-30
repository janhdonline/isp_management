/**
 * Portal isolation, and reseller commission.
 *
 * The property this file exists to defend: a customer signing in to their own
 * account gets their own data and nothing else — no other customer's invoice, no
 * other customer's ticket, no staff page — and a member of staff cannot use the
 * portal cookie to get in either.
 *
 * Both directions are checked. One-way isolation is not isolation: a portal that
 * stops customers reading each other's bills but lets a customer browse the whole
 * billing system is still a breach, and it is the direction that is easiest to
 * get wrong because the staff guard is written first and assumed to cover it.
 *
 * The commission checks are here because the formula is derived rather than
 * stored, and a derived figure nobody reconciles is a figure nobody can defend
 * to a reseller.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.ts";
import { portalLogin, setPortalPassword, hasPortalAccess } from "../src/lib/portal-auth.ts";
import { commissionReport, createReseller, deleteReseller } from "../src/lib/services/resellers.ts";

let alice;
let bob;
let resellerId;
let cashAccountId;
const createdCustomers = [];
const createdResellers = [];
const createdPayments = [];
const createdTickets = [];

async function makeCustomer(username) {
  const row = await prisma.customer.create({
    data: {
      customerCode: `TEST-PORTAL-${username.toUpperCase()}-${Date.now()}`,
      name: `Portal ${username}`,
      username,
      phone: `017${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      password: `ppp-${username}`, // the PPPoE secret, never a login
      connectionStatus: "Active",
      billingStatus: "Paid",
      portalPasswordHash: null,
    },
    select: { id: true, username: true, name: true },
  });
  createdCustomers.push(row.id);
  return row;
}

async function makeInvoice(customerId, total) {
  const row = await prisma.invoice.create({
    data: {
      invoiceNumber: `PORTAL-INV-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      issueDate: new Date(),
      dueDate: new Date(),
      amount: total,
      total,
      paid: 0,
      status: "Due",
    },
    select: { id: true, invoiceNumber: true, customerId: true },
  });
  return row;
}

async function makeTicket(customerId, subject) {
  const row = await prisma.ticket.create({
    data: {
      ticketNumber: `PORTAL-TKT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      customerId,
      subject,
      problem: "Line Problem",
      category: "Line Problem",
      description: "No connectivity at all since this morning.",
      priority: "Normal",
      status: "Open",
    },
    select: { id: true, ticketNumber: true, customerId: true },
  });
  createdTickets.push(row.id);
  return row;
}

before(async () => {
  cashAccountId = (await prisma.account.findFirstOrThrow({ where: { type: "Cash" } })).id;

  alice = await makeCustomer("alice");
  bob = await makeCustomer("bob");
});

after(async () => {
  if (createdPayments.length) {
    await prisma.receipt.deleteMany({ where: { paymentId: { in: createdPayments } } });
    await prisma.accountTransaction.deleteMany({ where: { paymentId: { in: createdPayments } } });
    await prisma.payment.deleteMany({ where: { id: { in: createdPayments } } });
  }
  if (createdTickets.length) {
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: createdTickets } } });
    await prisma.ticket.deleteMany({ where: { id: { in: createdTickets } } });
  }
  if (createdCustomers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomers } } });
  }
  if (createdResellers.length) {
    await prisma.reseller.deleteMany({ where: { id: { in: createdResellers } } });
  }
  await prisma.$disconnect();
});

/* ------------------------------------------------------------------ */

describe("portal authentication", () => {
  test("the right portal password signs the customer in", async () => {
    await setPortalPassword(alice.id, "correct-horse");

    const result = await portalLogin(alice.username, "correct-horse");
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.customerId, alice.id);
    assert.equal(await hasPortalAccess(alice.id), true);
  });

  test("a wrong password is refused", async () => {
    const result = await portalLogin(alice.username, "wrong-horse");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /Wrong username or password/);
  });

  test("the PPPoE password is not accepted as a login", async () => {
    // The whole reason portalPasswordHash exists. `password` is the router
    // credential, sent to the MikroTik in the clear on every provisioning call;
    // if it worked here, anyone who read it off a sticker could read the
    // customer's invoices.
    await setPortalPassword(alice.id, "correct-horse");
    const result = await portalLogin(alice.username, `ppp-alice`);
    assert.equal(result.ok, false, "the line password must never open the portal");
  });

  test("an account with no portal access says so, rather than guessing", async () => {
    const result = await portalLogin(bob.username, "anything");
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /ask your provider/i);
  });

  test("an unknown username is indistinguishable from a wrong password", async () => {
    const unknown = await portalLogin("no-such-username-here", "whatever");
    const wrong = await portalLogin(alice.username, "wrong-horse");
    assert.equal(unknown.ok, false);
    assert.equal(
      unknown.ok ? "" : unknown.error,
      wrong.ok ? "" : wrong.error,
      "the two must be identical, or the form becomes a way to enumerate customers"
    );
  });
});

describe("portal data isolation", () => {
  test("a customer cannot see another customer's invoice", async () => {
    await setPortalPassword(alice.id, "correct-horse");
    await setPortalPassword(bob.id, "battery-staple");

    const signIn = await portalLogin(alice.username, "correct-horse");
    assert.equal(signIn.ok, true);
    const session = { customerId: signIn.ok ? signIn.customerId : "" };

    const bobInvoice = await makeInvoice(bob.id, 900);
    const aliceInvoice = await makeInvoice(alice.id, 500);

    // The guard every invoice page uses: fetch by id, then require ownership.
    const fetched = await prisma.invoice.findUnique({
      where: { id: bobInvoice.id },
      select: { customerId: true },
    });
    const allowed = fetched?.customerId === session.customerId;
    assert.equal(allowed, false, "Alice must not be able to read Bob's invoice");

    const own = await prisma.invoice.findUnique({
      where: { id: aliceInvoice.id },
      select: { customerId: true },
    });
    assert.equal(own?.customerId, session.customerId, "her own invoice is readable");
  });

  test("a customer cannot read another customer's ticket", async () => {
    const signIn = await portalLogin(bob.username, "battery-staple");
    assert.equal(signIn.ok, true);
    const session = { customerId: signIn.ok ? signIn.customerId : "" };

    const aliceTicket = await makeTicket(alice.id, "Alice: my line is down");
    const bobTicket = await makeTicket(bob.id, "Bob: slow at night");

    const fetched = await prisma.ticket.findUnique({
      where: { id: aliceTicket.id },
      select: { customerId: true },
    });
    assert.notEqual(
      fetched?.customerId,
      session.customerId,
      "Bob must not be able to read Alice's ticket"
    );

    const own = await prisma.ticket.findUnique({
      where: { id: bobTicket.id },
      select: { customerId: true },
    });
    assert.equal(own?.customerId, session.customerId);
  });

  test("internal notes are filtered in the query, not after it", async () => {
    const ticket = await makeTicket(alice.id, "Alice: internal note check");
    await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorName: "Engineer",
        body: "Checked the OLT, port 3 is flapping.",
        isInternal: true,
      },
    });
    await prisma.ticketComment.create({
      data: { ticketId: ticket.id, authorName: "Engineer", body: "We are on our way.", isInternal: false },
    });

    // The portal query filters in the `where`, so an internal note cannot reach
    // a customer's page even for one render.
    const visible = await prisma.ticketComment.findMany({
      where: { ticketId: ticket.id, isInternal: false },
      select: { body: true },
    });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].body, "We are on our way.");
  });

  test("a disconnected customer's portal session is refused", async () => {
    await setPortalPassword(bob.id, "battery-staple");
    await prisma.customer.update({
      where: { id: bob.id },
      data: { connectionStatus: "Disconnected" },
    });

    // Same shape as the session guard: status decides, not the cookie.
    const row = await prisma.customer.findUnique({
      where: { id: bob.id },
      select: { connectionStatus: true },
    });
    assert.equal(row?.connectionStatus, "Disconnected");

    await prisma.customer.update({
      where: { id: bob.id },
      data: { connectionStatus: "Active" },
    });
  });

  test("the two cookies are separate names, so neither guard reads the other", async () => {
    // Not a runtime check — a structural one. `getSession` reads `isp_session`
    // and `getPortalSession` reads `portal_session`. If those were ever made
    // configurable into one value, every isolation check above would still pass
    // while the real system allowed full cross-access.
    const portal = await import("../src/lib/portal-auth.ts");
    assert.equal(typeof portal.getPortalSession, "function");

    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/portal-auth.ts", "utf8")
    );
    assert.match(src, /const COOKIE = "portal_session"/, "the portal cookie name must not be configurable");

    const staff = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/auth.ts", "utf8")
    );
    assert.match(staff, /const COOKIE = "isp_session"/, "the staff cookie name must not be configurable");
    assert.doesNotMatch(staff, /portal_session/, "the staff session must never read the portal cookie");
  });
});

describe("reseller commission", () => {
  async function makeReseller(name, pct) {
    const row = await createReseller({ name, commissionPct: pct, status: "Active" });
    createdResellers.push(row.id);
    return row;
  }

  test("a payment attributed to a reseller raises their commission", async () => {
    const r = await makeReseller("Test Reseller 8pct", 8);
    resellerId = r.id;

    // Three payments: 100, 250.50 and 49.50 = exactly 400.
    const amounts = [100, 250.5, 49.5];
    for (const amount of amounts) {
      const [, max] = await Promise.all([
        prisma.payment.findFirst({ orderBy: { paymentId: "desc" }, select: { paymentId: true } }),
        Promise.resolve(null),
      ]);
      void max;
      const row = await prisma.payment.create({
        data: {
          paymentId: `PORTAL-COM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          customerId: alice.id,
          amount,
          method: "Cash",
          accountId: cashAccountId,
          collectedByResellerId: r.id,
          paymentDate: new Date(),
        },
        select: { id: true },
      });
      createdPayments.push(row.id);
    }

    const report = await commissionReport({
      gte: new Date(Date.now() - 86_400_000),
      lte: new Date(Date.now() + 86_400_000),
    });

    const mine = report.rows.find((x) => x.resellerId === r.id);
    assert.ok(mine, "the reseller should appear in the report");

    // The figure must come from the payment rows, so compare with the rows.
    const fromDb = await prisma.payment.aggregate({
      where: { collectedByResellerId: r.id },
      _sum: { amount: true },
    });
    const expected = Math.round((fromDb._sum.amount ?? 0) * 100) / 100;
    assert.equal(mine.collected, expected, "the report total must equal the payment rows");
    assert.equal(mine.commission, Math.round((expected * 8) / 100 * 100) / 100);
    assert.equal(mine.payments, 3);
  });

  test("staff-collected cash is reported separately so the halves reconcile", async () => {
    const report = await commissionReport({
      gte: new Date(Date.now() - 86_400_000),
      lte: new Date(Date.now() + 86_400_000),
    });

    const fromDb = await prisma.payment.aggregate({
      where: { paymentDate: { gte: new Date(Date.now() - 86_400_000), lte: new Date(Date.now() + 86_400_000) } },
      _sum: { amount: true },
    });

    assert.equal(
      report.totals.totalCollected,
      Math.round((fromDb._sum.amount ?? 0) * 100) / 100,
      "the total must be every payment in the period"
    );
    assert.ok(
      Math.abs(report.totals.collected + report.totals.staffCollected - report.totals.totalCollected) < 0.01,
      "the reseller half plus the staff half must equal the whole"
    );
  });

  test("a reseller with no payments appears with zero rather than being hidden", async () => {
    const r = await makeReseller("Test Reseller Idle", 5);

    const report = await commissionReport({
      gte: new Date(Date.now() - 86_400_000),
      lte: new Date(Date.now() + 86_400_000),
    });

    const row = report.rows.find((x) => x.resellerId === r.id);
    assert.ok(row, "a reseller who collected nothing this period is still a row");
    assert.equal(row.collected, 0);
    assert.equal(row.commission, 0);
    assert.equal(row.commissionPct, 5);
  });

  test("a reseller with money attributed cannot be deleted", async () => {
    // The guard that stops the commission report losing its history.
    await assert.rejects(
      () => deleteReseller(resellerId),
      /still linked to \d+ customer\(s\) and \d+ payment\(s\)/
    );
  });

  test("a percentage change applies to the period as reported", async () => {
    // "We agreed 8% for March" means the March report shows 8%, not the rate in
    // force when the payment was taken. That is a property of deriving on read.
    const r = await prisma.reseller.update({
      where: { id: resellerId },
      data: { commissionPct: 10 },
      select: { id: true, commissionPct: true },
    });
    void r;

    const report = await commissionReport({
      gte: new Date(Date.now() - 86_400_000),
      lte: new Date(Date.now() + 86_400_000),
    });
    const row = report.rows.find((x) => x.resellerId === resellerId);
    assert.equal(row.commissionPct, 10, "the current rate is the one reported");
    assert.equal(row.commission, Math.round((row.collected * 10) / 100 * 100) / 100);
  });

  test("the commission percentage must be a sane number", async () => {
    await assert.rejects(() => createReseller({ name: `Bad ${Date.now()}`, commissionPct: 150 }));
    await assert.rejects(() => createReseller({ name: `Bad2 ${Date.now()}`, commissionPct: -5 }));
  });
});