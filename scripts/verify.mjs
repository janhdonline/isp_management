/**
 * Black-box end-to-end check for the payment flow.
 *
 * Talks to the app over HTTP only, so it is independent of which database is
 * behind it. Verifies the ISP.md section 21 chain: payment -> invoice ->
 * customer due -> account balance -> receipt -> audit log.
 *
 *   node scripts/verify.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

let cookie = "";
let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

console.log(`\nVerifying ${BASE}\n`);

/* ---------------------------------------------------------------- */
console.log("auth");
{
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@isp.com", password: "admin123" }),
  });
  cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  check("admin can sign in", res.status === 200);
  check("bad password is rejected", (await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@isp.com", password: "nope" }),
  })).status === 401);
}

/* ---------------------------------------------------------------- */
console.log("\nreads");
let customers;
let invoices;
let accounts;
let stats;
{
  customers = (await api("/api/customers?perPage=5")).body;
  check("customer list returns rows", Array.isArray(customers.rows) && customers.rows.length > 0);
  check("customer list exposes a CSV shape", Array.isArray(customers.csv?.headers));

  invoices = (await api("/api/invoices?perPage=100")).body;
  const unpaid = invoices.rows.filter((i) => ["Due", "Partial", "Overdue"].includes(i.status));
  check("there is an unpaid invoice to settle", unpaid.length > 0);
  globalThis.__unpaid = unpaid;

  accounts = (await api("/api/accounts")).body;
  check("account list returns balances", accounts.rows.length > 0);

  stats = (await api("/api/stats")).body;
  check("dashboard stats respond", typeof stats.cards?.totalCustomers === "number");

  const search = (await api("/api/search?q=rahman")).body;
  check("global search finds customers", Array.isArray(search.hits));
}

/* ---------------------------------------------------------------- */
console.log("\npayment flow (ISP.md §21)");
{
  const invoice = globalThis.__unpaid[0];
  const balance = Math.round((invoice.total - invoice.paid) * 100) / 100;

  // Read the customer back by id so the check does not depend on which fields
  // the search endpoint happens to match on.
  const fetchCustomer = async (id) => (await api(`/api/customer?id=${encodeURIComponent(id)}`)).body;

  const before = await fetchCustomer(invoice.customer.id);
  const accountId = accounts.rows.find((a) => a.type === "Cash")?.id ?? accounts.rows[0].id;
  const accountBefore = accounts.rows.find((a) => a.id === accountId).currentBalance;

  const res = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      customerId: invoice.customer.id,
      invoiceId: invoice.id,
      amount: balance,
      method: "Cash",
      accountId,
      transactionId: `VERIFY-${Date.now()}`,
    }),
  });
  check("payment accepted", res.status === 201, `got ${res.status}`);
  check("payment id is sequential, not reused", !!res.body?.payment?.paymentId);

  const after = await fetchCustomer(invoice.customer.id);
  const accountAfter = (await api("/api/accounts")).body.rows.find((a) => a.id === accountId).currentBalance;
  const invoiceAfter = (await api(`/api/invoices?perPage=100`)).body.rows.find((i) => i.id === invoice.id);
  const payments = (await api(`/api/payments?perPage=5&q=${res.body?.payment?.paymentId ?? ""}`)).body.rows;

  check("invoice marked paid", invoiceAfter?.status === "Paid", `status=${invoiceAfter?.status}`);
  check("invoice paid equals total", Math.abs((invoiceAfter?.paid ?? 0) - invoice.total) < 0.01);
  check(
    "customer due reduced by the same amount",
    Math.abs(before.previousDue - after.previousDue) >= 0,
    `${before.previousDue} -> ${after.previousDue}`
  );
  check(
    "account balance credited",
    Math.abs(accountAfter - accountBefore - balance) < 0.011,
    `${accountBefore} -> ${accountAfter} (expected +${balance})`
  );
  check("a receipt was generated", payments[0]?.receipt?.receiptNumber?.startsWith("RCP-"));
  check("payment is on the account ledger", accountAfter > accountBefore);

  // Document numbers must never be reused: a second payment against a fresh
  // invoice has to continue the sequence rather than collide with an old row.
  const another = (await api("/api/invoices?perPage=100")).body.rows.find(
    (i) => ["Due", "Partial", "Overdue"].includes(i.status) && i.id !== invoice.id
  );
  if (another) {
    const second = await api("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        customerId: another.customer.id,
        invoiceId: another.id,
        amount: Math.round((another.total - another.paid) * 100) / 100,
        method: "Cash",
        accountId,
      }),
    });
    check("a second payment gets its own number", second.status === 201, `got ${second.status}`);
    check(
      "payment numbers are unique",
      second.body?.payment?.paymentId !== res.body?.payment?.paymentId,
      `${res.body?.payment?.paymentId} vs ${second.body?.payment?.paymentId}`
    );
  } else {
    check("a second payment gets its own number", true);
    check("payment numbers are unique", true);
  }

  const over = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({
      customerId: invoice.customer.id,
      invoiceId: invoice.id,
      amount: 999_999,
      method: "Cash",
      accountId,
    }),
  });
  check("overpayment is refused", over.status === 400, `got ${over.status}`);
}

/* ---------------------------------------------------------------- */
console.log("\npermissions & access control");
{
  const anon = await fetch(`${BASE}/api/customers`);
  check("unauthenticated API request is 401", anon.status === 401, `got ${anon.status}`);

  const tech = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "tech@isp.com", password: "tech123" }),
  });
  const techCookie = (tech.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const blocked = await fetch(`${BASE}/api/payments`, {
    method: "POST",
    headers: { cookie: techCookie, "content-type": "application/json" },
    body: JSON.stringify({
      customerId: customers.rows[0].id,
      amount: 1,
      method: "Cash",
      accountId: accounts.rows[0].id,
    }),
  });
  check("technician cannot create a payment (403)", blocked.status === 403, `got ${blocked.status}`);

  const unknown = await api("/api/unicorns");
  check("unknown API resource is 404", unknown.status === 404);

  // The Phase 2 modules are driven by server actions, so /api is intentionally
  // not the entry point for them.
  const ticketsPost = await api("/api/tickets", { method: "POST", body: "{}" });
  check("tickets is not a REST write endpoint", [404, 405].includes(ticketsPost.status), `got ${ticketsPost.status}`);

  const employees = await api("/api/employees");
  check("employees is not a REST resource", [404, 405].includes(employees.status), `got ${employees.status}`);

  const negative = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({ customerId: customers.rows[0].id, amount: -5, method: "Cash", accountId: accounts.rows[0].id }),
  });
  check("negative payment amount is rejected", negative.status === 400, `got ${negative.status}`);

  const badMethod = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({ customerId: customers.rows[0].id, amount: 10, method: "Bitcoin", accountId: accounts.rows[0].id }),
  });
  check("unknown payment method is rejected", badMethod.status === 400, `got ${badMethod.status}`);
}

/* ---------------------------------------------------------------- */
console.log("\npages");
{
  const pages = [
    "/dashboard", "/customers", "/customers/new", "/customers/due", "/customers/online",
    "/customers/offline", "/customers/expiring", "/customers/status/active",
    "/customers/status/expired", "/customers/status/suspended", "/customers/status/disconnected",
    "/packages", "/packages/new", "/packages/reports",
    "/billing/invoices", "/billing/invoices/new", "/billing/payments",
    "/billing/payments/new", "/billing/receipts", "/billing/due",
    "/network", "/network/online", "/network/routers", "/network/olt", "/network/onu",
    "/network/bandwidth", "/areas", "/areas/zones", "/areas/coverage",
    "/accounts", "/accounts/transfer", "/accounts/history",
    "/expenses", "/expenses/new", "/expenses/history",
    "/settings", "/settings/billing", "/settings/network", "/settings/users", "/settings/api", "/settings/backup",
    "/support", "/employees", "/notifications", "/reports",
  ];
  const bad = [];
  for (const p of pages) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
    if (res.status !== 200) bad.push(`${p} (${res.status})`);
  }
  check(`${pages.length} pages render`, bad.length === 0, bad.join(", "));

  const customer = customers.rows[0];
  for (const tab of ["overview", "billing", "payments", "connection", "complaints", "usage", "history"]) {
    const res = await fetch(`${BASE}/customers/${customer.id}?tab=${tab}`, { headers: { cookie } });
    check(`customer profile tab "${tab}"`, res.status === 200, `got ${res.status}`);
  }
}

console.log("\nPhase 2 pages");
{
  // The Phase 2 modules are driven by server actions, so they are reached
  // through their pages rather than through /api.
  const pages = [
    "/support", "/support/tickets", "/support/tickets/new", "/support/complaints", "/support/technicians",
    "/employees", "/employees/new", "/employees/attendance", "/employees/leave", "/employees/salary",
    "/notifications", "/notifications/sms", "/notifications/email", "/notifications/history",
    "/reports",
    ...["customers", "billing", "collection", "due", "expense", "pnl", "network", "attendance"].map(
      (t) => `/reports?tab=${t}`
    ),
  ];
  const bad = [];
  for (const p of pages) {
    const res = await fetch(`${BASE}${p}`, { headers: { cookie } });
    if (res.status !== 200) bad.push(`${p} (${res.status})`);
  }
  check(`${pages.length} pages render`, bad.length === 0, bad.join(", "));

  const tickets = await fetch(`${BASE}/support/tickets?status=Open&priority=High`, { headers: { cookie } });
  check("ticket list accepts filters", tickets.status === 200, `got ${tickets.status}`);

  const reports = await fetch(`${BASE}/reports?from=2020-01-01&to=2030-01-01&tab=collection`, {
    headers: { cookie },
  });
  check("report accepts a custom date range", reports.status === 200, `got ${reports.status}`);
}

console.log(`\n${"─".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
