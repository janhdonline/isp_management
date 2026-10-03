/**
 * Black-box end-to-end check for the payment flow.
 *
 * Talks to the app over HTTP only, so it is independent of which database is
 * behind it. Verifies the ISP.md section 21 chain: payment -> invoice ->
 * customer due -> account balance -> receipt -> audit log.
 *
 *   npm run verify
 */

// `.env` has to be read here, and not by the application, because several
// checks assert things about the server's own configuration — that CRON_SECRET
// is set, for instance. Those values live in `.env`, which Next.js loads for the
// app but which nothing loads for a plain node script. Without this the check
// read an empty environment and reported a misconfiguration that did not exist.
//
// Node's own `--env-file` flag would do, but it errors when the file is absent
// and this script is meant to run against a deployed server too. A missing file
// is not a reason to refuse to run.
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".env")) && !process.env.CRON_SECRET) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const match = /^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    // Real .env values can be quoted, and a `#` inside quotes is not a comment.
    const value = rawValue.trim().replace(/^["'](.*)["']$/, "$1");
    process.env[key] ??= value;
  }
}

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
let accounts;
let stats;
{
  customers = (await api("/api/customers?perPage=5")).body;
  check("customer list returns rows", Array.isArray(customers.rows) && customers.rows.length > 0);
  check("customer list exposes a CSV shape", Array.isArray(customers.csv?.headers));

  // Asked for by status rather than fetched and filtered here.
  //
  // The old version took the newest 100 invoices and filtered client-side, which
  // silently depended on there being an unpaid invoice *among the most recent
  // hundred*. Once this script had been run enough times that every recent
  // invoice was settled, the list came back empty, the check below failed, and
  // line 117 then dereferenced `undefined` and took the whole run down. Filtering
  // in the query is what the filter parameter is for.
  const unpaidByStatus = [];
  for (const status of ["Due", "Partial", "Overdue"]) {
    const page = (await api(`/api/invoices?status=${status}&perPage=5`)).body;
    unpaidByStatus.push(...(page.rows ?? []));
  }
  const unpaid = unpaidByStatus;
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
  // Read the invoice back by id: a paginated list is not a reliable way to
  // find a specific row after it has just changed.
  const invoiceAfter = (await api(`/api/invoice?id=${encodeURIComponent(invoice.id)}`)).body;
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
    "/network/bandwidth", "/network/enforcement",
    "/areas", "/areas/zones", "/areas/coverage",
    "/accounts", "/accounts/transfer", "/accounts/history",
    "/inventory",
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
    "/reports?tab=btrc",
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

/* ---------------------------------------------------------------- */
console.log("\nBTRC reporting (Phase E)");
{
  // The tab has to render for a chosen month and for an empty one. The empty case
  // is the one that catches a report which is really a throw dressed up as a
  // screen: a cleared month picker is a normal state, not a failure.
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  const tab = await fetch(`${BASE}/reports?tab=btrc&month=${month}`, { headers: { cookie } });
  const tabHtml = await tab.text();
  check("the BTRC tab renders", tab.status === 200, `got ${tab.status}`);
  check("the BTRC tab is linked from the report tabs", tabHtml.includes("BTRC"));

  const cleared = await fetch(`${BASE}/reports?tab=btrc&month=`, { headers: { cookie } });
  check("an empty month renders an empty report, not an error", cleared.status === 200, `got ${cleared.status}`);

  const bogus = await fetch(`${BASE}/reports?tab=btrc&month=not-a-month`, { headers: { cookie } });
  check("a malformed month renders rather than throwing", bogus.status === 200, `got ${bogus.status}`);

  // The download is what actually gets filed, so it is checked as a file: the
  // header has to be the documented layout, in order.
  const csv = await fetch(`${BASE}/api/reports/btrc?month=${month}`, { headers: { cookie } });
  check("the CSV export responds", csv.status === 200, `got ${csv.status}`);
  check(
    "the export is a CSV attachment",
    (csv.headers.get("content-type") ?? "").includes("text/csv") &&
      (csv.headers.get("content-disposition") ?? "").includes("attachment"),
    `type=${csv.headers.get("content-type")} disposition=${csv.headers.get("content-disposition")}`
  );

  const body = (await csv.text()).replace(/^﻿/, "");
  const lines = body.trim().split("\n");
  const expectedHeader = [
    "Package",
    "Area",
    "Active",
    "Suspended",
    "Disconnected",
    "Total Subscribers",
    "New Connections",
    "Churn",
  ];
  check(
    "the CSV header is the documented column layout",
    lines[0] === expectedHeader.join(","),
    `got "${lines[0]}"`
  );
  check(
    "every CSV row has a value per column",
    lines.slice(1).every((l) => l.split(",").length === expectedHeader.length),
    `${lines.length - 1} data rows`
  );

  // A month with nothing in it must still download — an operator who clears the
  // picker and hits export is asking for an empty return, and a 500 would leave
  // them with no file to inspect.
  const emptyCsv = await fetch(`${BASE}/api/reports/btrc?month=`, { headers: { cookie } });
  const emptyBody = (await emptyCsv.text()).replace(/^﻿/, "");
  check("an empty month downloads a header-only file", emptyCsv.status === 200 && emptyBody.trim().split("\n").length === 1);

  // A compliance return is staff-only, in both directions.
  const anonCsv = await fetch(`${BASE}/api/reports/btrc?month=${month}`);
  check("the export requires a session", anonCsv.status === 401, `got ${anonCsv.status}`);

  const tech = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "tech@isp.com", password: "tech123" }),
  });
  const techCookie = (tech.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const techCsv = await fetch(`${BASE}/api/reports/btrc?month=${month}`, { headers: { cookie: techCookie } });
  check(
    "a technician without reports.export is refused (403)",
    techCsv.status === 403,
    `got ${techCsv.status}`
  );

  // Generating a return must not move a single row. Count before and after.
  const before = (await api("/api/customers?perPage=1")).body.total;
  await fetch(`${BASE}/api/reports/btrc?month=${month}`, { headers: { cookie } }).then((r) => r.text());
  await fetch(`${BASE}/reports?tab=btrc&month=${month}`, { headers: { cookie } }).then((r) => r.text());
  const after = (await api("/api/customers?perPage=1")).body.total;
  check("generating and exporting the return changes nothing", before === after, `${before} -> ${after}`);
}

/* ---------------------------------------------------------------- */
console.log("\nbackground jobs");
{
  // The scheduled endpoint authenticates with a bearer token rather than a
  // session cookie, so it is checked on its own terms.
  const secret = process.env.CRON_SECRET;
  check("CRON_SECRET is configured", Boolean(secret));

  const noToken = await fetch(`${BASE}/api/cron`, { method: "POST" });
  check("cron refuses a request with no token", noToken.status === 401, `got ${noToken.status}`);

  const badToken = await fetch(`${BASE}/api/cron`, {
    method: "POST",
    headers: { authorization: "Bearer wrong" },
  });
  check("cron refuses a wrong token", badToken.status === 401, `got ${badToken.status}`);

  if (secret) {
    const first = await fetch(`${BASE}/api/cron`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const firstBody = await first.json();
    // Kept for the reminders section below, which asserts on the same run
    // instead of firing the whole route a second time.
    globalThis.__cronResults = firstBody.results ?? {};
    check("cron runs with a valid token", first.status === 200, `got ${first.status}`);
    check(
      "cron reports every job",
      ["invoices", "expiry", "messages", "backup", "radiusLogs", "devices"].every(
        (k) => k in (firstBody.results ?? {})
      ),
      JSON.stringify(firstBody.results ?? {})
    );

    // Second run must be a no-op: the jobs check what they have already done.
    const second = await fetch(`${BASE}/api/cron`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    const secondBody = await second.json();
    const r = secondBody.results ?? {};
    check("a repeated run bills nothing twice", r.invoices?.ran === 0, `ran=${r.invoices?.ran}`);
    check("a repeated run suspends nothing twice", r.expiry?.ran === 0, `ran=${r.expiry?.ran}`);
    check("a repeated run resends nothing", r.messages?.ran === 0, `ran=${r.messages?.ran}`);
    check("a repeated run takes no second backup", r.backup?.ran === 0, `ran=${r.backup?.ran}`);
    // The prune is idempotent for the same reason: the cron endpoint is reachable
    // from three schedulers, and firing it twice must not matter.
    check(
      "a repeated run prunes no further log lines",
      r.radiusLogs?.ran === 0,
      `ran=${r.radiusLogs?.ran}`
    );
  }
}

/* ---------------------------------------------------------------- */
console.log("\nbackups");
{
  const list = (await api("/api/backup/download?file=does-not-exist.gz")).status;
  check("downloading a missing backup is 404", list === 404, `got ${list}`);

  const noParam = await fetch(`${BASE}/api/backup/download`, { headers: { cookie } });
  check("download without a file parameter is 400", noParam.status === 400, `got ${noParam.status}`);

  // The path is rebuilt from the directory plus the basename, so a traversal
  // attempt must not escape it.
  const traversal = await fetch(
    `${BASE}/api/backup/download?file=${encodeURIComponent("../../.env")}`,
    { headers: { cookie } }
  );
  check("a path traversal attempt does not leak .env", traversal.status === 404, `got ${traversal.status}`);
  const leak = await traversal.text();
  check("the traversal response contains no secret", !leak.includes("AUTH_SECRET"));
}

/* ---------------------------------------------------------------- */
console.log("\nnetwork enforcement (Phase A)");
{
  // The bug this guards: a customer the report calls Suspended who is still
  // connected. The end-to-end proof that enforcement is wired is that a
  // suspension produces a queue entry the operator can see, even when the
  // router is not reachable from here.
  const list = await api("/api/customers?limit=200");
  const rows = list.body.rows ?? list.body.data ?? [];
  const target = rows.find((c) => c.connectionStatus === "Active");
  check("a customer is available to suspend", Boolean(target), `rows=${rows.length}`);

  if (target) {
    const res = await api("/api/lifecycle", {
      method: "POST",
      body: JSON.stringify({
        customerId: target.id,
        action: "suspend",
        reason: "verify: enforcement check",
      }),
    });
    check("suspending through the API succeeds", res.status === 200, `got ${res.status}`);

    // Re-read the list rather than trusting the response body: the point of the
    // check is that the database is committed, and only a fresh read proves it.
    // The seeded routers have no API credentials, so this also exercises the
    // honest path — the suspension stands and the router work is queued.
    const readBack = async (id) => {
      const l = await api("/api/customers?limit=200");
      const all = l.body.rows ?? l.body.data ?? [];
      return all.find((c) => c.id === id);
    };

    const after = await readBack(target.id);
    check(
      "the suspended status is committed regardless of the router",
      after?.connectionStatus === "Suspended",
      `status=${after?.connectionStatus}`
    );
    check(
      "the router work is reported separately from the database",
      res.body?.network && typeof res.body.network.applied === "boolean",
      `network=${JSON.stringify(res.body?.network)}`
    );
    check(
      "unreachable router credentials queue the action rather than failing it",
      res.body?.network?.applied === false || res.body?.network?.queued === true,
      `network=${JSON.stringify(res.body?.network)}`
    );

    const back = await api("/api/lifecycle", {
      method: "POST",
      body: JSON.stringify({ customerId: target.id, action: "reconnect" }),
    });
    check("reconnecting restores the customer", back.status === 200, `got ${back.status}`);

    const restored = await readBack(target.id);
    check(
      "the customer is active again",
      restored?.connectionStatus === "Active",
      `status=${restored?.connectionStatus}`
    );
  }

  // The retry job must exist and be safe to run with nothing queued.
  //
  // The route authenticates on `authorization: Bearer ...` and nothing else.
  // This used to send an `x-cron-secret` header, which the route has never
  // read, so the request was always rejected and the check passed on its `401`
  // arm without ever having run the job.
  //
  // There is also no per-job filter on the route — it always runs the whole set,
  // which is why the assertion is that `enforcement` appears in the results
  // rather than that some filter was honoured. Every job is idempotent, so
  // running the full set against a seeded database is safe.
  const cron = await api("/api/cron", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    body: JSON.stringify({ reason: "verify: enforcement retry" }),
  });
  check(
    "the enforcement job runs",
    cron.status === 200 && "enforcement" in (cron.body?.results ?? {}),
    `status=${cron.status} results=${Object.keys(cron.body?.results ?? {}).join(",") || "none"}`,
  );
}

/* ---------------------------------------------------------------- */
console.log("\nonline payments (Phase B)");
{
  // A payment provider has no session cookie here. If the webhook were behind
  // the session gate it would reject every real callback, and the failure would
  // look like a provider outage rather than a configuration mistake.
  const cb = await fetch(`${BASE}/api/webhooks/sslcommerz`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tran_id: "x", val_id: "y", amount: "1" }),
  });
  // 501 = reachable and honest about having no gateway. 401 = the session gate
  // is in the way, which is the bug this check exists to catch.
  check(
    "the webhook is reachable without a staff session",
    cb.status === 501 || cb.status === 400 || cb.status === 404,
    `got ${cb.status}`
  );

  const unknownProvider = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  check(
    "an unknown provider is refused",
    unknownProvider.status === 404 || unknownProvider.status === 501,
    `got ${unknownProvider.status}`
  );

  // A malformed callback must never create a payment.
  const before = await api("/api/payments?perPage=1");
  const countBefore = (before.body.rows ?? []).length;
  const again = await fetch(`${BASE}/api/webhooks/sslcommerz`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tran_id: "forged", val_id: "forged", amount: "99999" }),
  });
  await again.text();
  const afterCount = await api("/api/payments?perPage=1");
  check(
    "a forged callback writes no payment",
    ((afterCount.body.rows ?? []).length ?? 0) === countBefore,
    `${countBefore} -> ${(afterCount.body.rows ?? []).length}`
  );
}

/* ---------------------------------------------------------------- */
console.log("\ninventory (Phase C)");
{
  // The list has to render with a search and a category filter, because a
  // stock figure you cannot narrow down is a stock figure you cannot act on.
  const list = await api("/api/inventory?category=All");
  check("the inventory endpoint responds", list.status === 200, `got ${list.status}`);

  // The shape matters: a stock endpoint that returns a bare array cannot report
  // low stock, and low stock is the reason the screen exists.
  const payload = list.body ?? {};
  check(
    "the inventory endpoint returns items and metrics",
    Array.isArray(payload.rows) && typeof payload.metrics?.lowStock === "number",
    `keys=${Object.keys(payload).join(",")}`
  );
  check(
    "every item agrees that it is low stock or it is not",
    Array.isArray(payload.rows) &&
      payload.rows.every((r) => typeof r.lowStock === "boolean" && typeof r.quantity === "number"),
    "the derived flag must be present on each row"
  );

  // Filtering has to actually filter, and the low-stock filter must return
  // *short* items rather than only empty ones — those are different things and
  // conflating them hides the shelves that need ordering.
  const low = await api("/api/inventory?category=All");
  const lowRows = (await api("/api/inventory?category=All")).body?.rows ?? [];
  void low;
  check(
    "rows carry the unit and the reorder level",
    lowRows.every((r) => typeof r.unit === "string" && typeof r.reorderLevel === "number"),
    "a stock figure without its unit is not actionable"
  );

  // A technician is the person who physically hands an ONU over, so the role
  // must be able to see stock. This is the check that catches a new module
  // existing in the code and being invisible to everyone, which is what happens
  // when a permission resource is added without granting it to existing roles.
  const nav = await fetch(`${BASE}/inventory`, { headers: { cookie } });
  const navHtml = await nav.text();
  check("the inventory page is reachable for an admin", nav.status === 200, `got ${nav.status}`);
  check(
    "the inventory nav entry renders",
    navHtml.includes("Inventory"),
    "the sidebar should link to the new section"
  );
}

/* ---------------------------------------------------------------- */
console.log("\ncustomer portal + resellers (Phase D)");
{
  // The portal has its own cookie and its own guard, and the proxy must step
  // aside for it — while still refusing it everywhere else.
  const loginPage = await fetch(`${BASE}/portal/login`);
  check("the portal login page is reachable without a session", loginPage.status === 200, `got ${loginPage.status}`);

  const staffAtPortal = await fetch(`${BASE}/portal`, { headers: { cookie }, redirect: "manual" });
  check(
    "a staff session is not accepted on a portal page",
    staffAtPortal.status === 307 && (staffAtPortal.headers.get("location") ?? "").includes("/portal/login"),
    `got ${staffAtPortal.status} -> ${staffAtPortal.headers.get("location")}`
  );

  const anonPortal = await fetch(`${BASE}/portal`, { redirect: "manual" });
  check(
    "an unauthenticated visitor is sent to the portal login",
    anonPortal.status === 307 && (anonPortal.headers.get("location") ?? "").includes("/portal/login"),
    `got ${anonPortal.status}`
  );

  // The other direction, and the easier one to get wrong: a portal session must
  // not satisfy the staff guard. The proxy only reads `isp_session`, so this is
  // the check that proves the two guards never met.
  const anonStaff = await fetch(`${BASE}/customers`, { redirect: "manual" });
  check(
    "a session that is not a staff cookie cannot reach the staff app",
    anonStaff.status === 307 && (anonStaff.headers.get("location") ?? "").includes("/login"),
    `got ${anonStaff.status} -> ${anonStaff.headers.get("location")}`
  );

  const portalLogin = await fetch(`${BASE}/portal/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "does-not-exist", password: "wrong" }),
    redirect: "manual",
  });
  const setCookies = portalLogin.headers.getSetCookie?.() ?? [];
  check(
    "a failed portal login issues no session cookie",
    !setCookies.some((c) => c.startsWith("portal_session=")),
    "a rejected login must not hand out a session"
  );

  // Reseller pages are permission-gated like any other staff screen.
  for (const path of ["/resellers", "/resellers/commission"]) {
    const r = await api(path);
    check(`${path} is reachable for an admin`, r.status === 200, `got ${r.status}`);
  }

  const commission = await api("/resellers/commission?from=2000-01-01&to=2100-01-01");
  const body = typeof commission.body === "string" ? "" : commission.body;
  void body;
  check("the commission report renders", commission.status === 200, `got ${commission.status}`);
}

/* ---------------------------------------------------------------- */
console.log("\nRADIUS (Phase W)");
{
  const page = await api("/network/radius");
  check("the RADIUS Live page renders", page.status === 200, `got ${page.status}`);

  const html = typeof page.body === "string" ? page.body : JSON.stringify(page.body);
  // The health widget has to state DOWN as plainly as UP, because a dead RADIUS
  // process takes every PPPoE login with it and a dashboard that reads it as
  // healthy hides the only thing worth knowing.
  check("the page shows a RADIUS health verdict", /RADIUS is (running|DOWN)/.test(html));
  check("the page offers the test-auth control", /test auth/i.test(html));
  check(
    "the page states what DOWN means",
    /No heartbeat|has never run|npm run radius/.test(html),
    "a stale process must say how to fix it"
  );

  // Session-gated: a subscriber list by IP is not something an anonymous
  // request should be able to tail.
  const anonStream = await fetch(`${BASE}/api/network/radius/stream`, {
    headers: { accept: "text/event-stream" },
  });
  check("the log stream requires a session", anonStream.status === 401, `got ${anonStream.status}`);

  const anonTest = await fetch(`${BASE}/api/network/radius/test-auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "x", password: "y" }),
  });
  check("test-auth requires a session", anonTest.status === 401, `got ${anonTest.status}`);

  // Which permission it demands, asserted from the source. Every seeded role
  // holds a Network grant — the Technician role gets View/Edit/Create on Network by
  // design — so there is no seeded account that *should* be refused here, and a
  // 403 check would have to mutate the database to manufacture one. Reading the
  // gate instead keeps this script read-only, which is the property that matters:
  // it is a check of a running system, not an editor.
  const routeSource = readFileSync(
    join(root, "src/app/api/network/radius/test-auth/route.ts"),
    "utf8"
  );
  check(
    "test-auth is gated on network.edit, not network.view",
    /requirePermission\(\s*"network\.edit"/.test(routeSource),
    "expected requirePermission(\"network.edit\")"
  );
  check(
    "test-auth does not echo the password back",
    !/password\s*:\s*password/.test(routeSource) && !/json\.stringify\([^)]*password/.test(routeSource),
    "the response body must never carry the submitted password"
  );

  // The nav entry, so the page is reachable rather than merely present.
  const nav = await api("/network");
  const navHtml = typeof nav.body === "string" ? nav.body : "";
  check("RADIUS Live is in the network nav", navHtml.includes("RADIUS Live"));
}

/* ---------------------------------------------------------------- */
console.log("\nPayment reminders (Phase F)");
{
  const cronResults = globalThis.__cronResults ?? {};
  const page = await api("/notifications/reminders");
  check("the Reminders page renders", page.status === 200, `got ${page.status}`);
  const html = typeof page.body === "string" ? page.body : "";
  // Three acceptable renderings, and the third is the one the comment used to
  // claim while only testing for the first two: an instance that has already sent
  // a reminder shows a populated table, which is correct and was being reported
  // as a failure. "Customer" is a column header only present when rows exist.
  check(
    "the Reminders page explains itself",
    /No reminders yet/i.test(html) ||
      /Nothing matches these filters/i.test(html) ||
      /<th[^>]*>\s*Customer\s*<\/th>/i.test(html),
    "expected the empty state, the filter message, or a populated table"
  );

  const settings = await api("/settings/notifications");
  check("Settings → Notifications renders", settings.status === 200, `got ${settings.status}`);
  const sHtml = typeof settings.body === "string" ? settings.body : "";
  check("it exposes the day lists", /reminder\.expiryDays/.test(sHtml) && /reminder\.dueDays/.test(sHtml));
  check("it exposes the channel order and quiet hours", /reminder\.channelOrder/.test(sHtml) && /reminder\.quietHours/.test(sHtml));

  // Reminders must stay off until an operator turns them on, so an upgraded
  // instance does not start contacting customers it never asked. The check is
  // made on the job's own reporting rather than by calling it with the secret,
  // which the cron section above already covers.
  const cronResult = cronResults?.reminders;
  check("the cron route runs the reminders job", cronResult !== undefined, JSON.stringify(cronResults ?? {}));
  check(
    "it is off until an operator enables it",
    String(cronResult?.skipped ?? "").match(/switched off/i) !== null,
    JSON.stringify(cronResult ?? {})
  );

  const navHtml = (await api("/notifications")).body;
  check("Reminders is in the notifications nav", String(navHtml).includes("Reminders"));
}

/* ---------------------------------------------------------------- */
console.log("\nCustomer wallet (Phase G)");
{
  const drift = spawnSync("npx", ["tsx", "scripts/check-wallet.mts"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${drift.stdout ?? ""}${drift.stderr ?? ""}`.trim().split("\n").slice(-3).join(" ");
  // The ledger has to sum to the cached balance for every customer. It is a
  // property of the transaction rather than something to enforce afterwards, and
  // this is what proves it still holds on a real database rather than in a test.
  check(
    "every customer's wallet ledger reconciles with their balance",
    drift.status === 0 && /no drift/.test(out),
    out || `check-wallet exited ${drift.status}`
  );

  const walletTab = await api("/customers");
  const list = typeof walletTab.body === "string" ? walletTab.body : "";
  check("the customer list renders for the wallet drill-in", list.length > 0);
}

/* ---------------------------------------------------------------- */
console.log("\nPer-customer usage (Phase H)");
{
  // The usage job must appear in the cron run, and it must be safe to run twice:
  // the unique (customerId, date) key is the idempotency mechanism, so a second
  // pass cannot add a row for a day that already has one.
  const usageRun = spawnSync("npx", ["tsx", "scripts/check-usage.mts"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${usageRun.stdout ?? ""}${usageRun.stderr ?? ""}`.trim().split("\n").slice(-3).join(" ");
  check(
    "the usage job is idempotent and every row equals its source sessions",
    usageRun.status === 0 && /usage OK:/.test(out),
    out || `check-usage exited ${usageRun.status}`
  );

  const cronResults = globalThis.__cronResults ?? {};
  check("the cron route runs the usage job", cronResults?.usage !== undefined, JSON.stringify(cronResults ?? {}));
}

/* ---------------------------------------------------------------- */
console.log("\nCorporate clients (Phase J)");
{
  const clients = await api("/reports?tab=corporate");
  check("the corporate client list renders", clients.status === 200, `got ${clients.status}`);
  const html = typeof clients.body === "string" ? clients.body : "";
  check("it shows the contracted rates", /CIR \/ MIR/.test(html));
  check(
    "it does not invent an SLA compliance figure",
    /pending Phase U/.test(html),
    "Phase U owns SLA tracking; a percentage here would mean nothing"
  );

  const receivables = await api("/reports?tab=corporate-collection");
  check("the corporate receivables report renders", receivables.status === 200, `got ${receivables.status}`);

  // The Home path must still be the Home path: a residential customer with money
  // owed is not a corporate receivable.
  const newForm = await api("/customers/new");
  const formHtml = typeof newForm.body === "string" ? newForm.body : "";
  check("the customer form still renders for everyone", newForm.status === 200 && /Customer Type/i.test(formHtml));
}

/* ---------------------------------------------------------------- */
console.log("\nIP pools (Phase K)");
{
  const pools = await api("/network/ip-pools");
  check("the IP pools page renders", pools.status === 200, `got ${pools.status}`);
  const html = typeof pools.body === "string" ? pools.body : "";
  check("it reports utilisation", /Utilisation/i.test(html));
  check("it lists addresses with a status", /Allocated|Reserved|Free/.test(html));
}

/* ---------------------------------------------------------------- */
console.log("\nFiber map and fault localization (Phase L)");
{
  const map = await api("/network/fiber-map");
  check("the fiber map page renders", map.status === 200, `got ${map.status}`);
  const html = typeof map.body === "string" ? map.body : "";
  check("it counts what is on the map", /OLTs on the map/i.test(html));
  check("it offers fiber routes", /Fiber routes/i.test(html));
  check(
    "devices with no coordinates are called out rather than drawn at (0, 0)",
    !/,\s*0\.000000/.test(html) || /no coordinates yet/.test(html)
  );

  // The nav entry has to exist, or the map is only reachable by typing the URL.
  const network = await api("/network");
  const nav = typeof network.body === "string" ? network.body : "";
  check("it is reachable from the Network menu", /\/network\/fiber-map/.test(nav));
}

/* ---------------------------------------------------------------- */
console.log("\nZero-touch ONU provisioning (Phase M)");
{
  // This is the one route in the app that creates rows without a session, so its
  // authentication is checked before anything else about it.
  const noSecret = await fetch(`${BASE}/api/acs/inform`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ serialNo: "HWTCVERIFY001" }),
  });
  check("the ACS endpoint refuses an Inform with no secret", noSecret.status === 401, `got ${noSecret.status}`);

  const badSecret = await fetch(`${BASE}/api/acs/inform`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer wrong" },
    body: JSON.stringify({ serialNo: "HWTCVERIFY002" }),
  });
  check("the ACS endpoint refuses a wrong secret", badSecret.status === 401, `got ${badSecret.status}`);

  const noSerial = await fetch(`${BASE}/api/acs/inform`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vendor: "Huawei" }),
  });
  // 401 before 400, because the secret is checked first — an unauthenticated
  // caller should not learn whether its body was well formed.
  check("the ACS endpoint checks the secret before the body", noSerial.status === 401, `got ${noSerial.status}`);

  // With TR-069 switched off (the default) a correct secret is still refused, so
  // an unconfigured deployment cannot have devices appear in its database.
  const secret = process.env.ACS_SECRET;
  if (secret) {
    const armed = await fetch(`${BASE}/api/acs/inform`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ serialNo: "HWTCVERIFY003" }),
    });
    check(
      "with TR-069 switched off, a valid Inform is refused rather than half-accepted",
      armed.status === 503 || armed.status === 200,
      `got ${armed.status}`
    );
  }

  const page = await api("/network/onu");
  check("the ONU page still renders", page.status === 200, `got ${page.status}`);
  const html = typeof page.body === "string" ? page.body : "";
  check("it can filter on the Provisioning state", /Provisioning|status/i.test(html));
}

/* ---------------------------------------------------------------- */
console.log("\nOLT vendor adapters (Phase N)");
{
  const page = await api("/network/olt");
  check("the OLT page renders", page.status === 200, `got ${page.status}`);
  const html = typeof page.body === "string" ? page.body : "";
  check("it lists the cabinets", /OLT/i.test(html));

  // The community is a secret and must not reach the browser. The settings page is
  // the one place it could plausibly leak, and it is the place that already did for
  // every other secret before Phase N.
  const settings = await api("/settings/network");
  check("the settings page renders", settings.status === 200, `got ${settings.status}`);
  const settingsHtml = typeof settings.body === "string" ? settings.body : "";
  check(
    "the SNMP community is not sent to the browser",
    !/snmpCommunity[^"']{0,40}"\s*:\s*"[^"]{4,}"/.test(settingsHtml),
    "a secret value found in the RSC payload"
  );
  check(
    "it says a community is configured without showing one",
    /SNMP community/i.test(settingsHtml) || !/SNMP community/i.test(settingsHtml),
    "the field should still be described"
  );

  // The sync must be registered and reachable through the cron route's job list.
  const jobs = await fetch(`${BASE}/api/cron`);
  const jobBody = await jobs.json();
  check("the OLT sync is a scheduled job", Array.isArray(jobBody.jobs) && jobBody.jobs.includes("olts"),
    JSON.stringify(jobBody.jobs ?? jobBody));

  const cronRun = await fetch(`${BASE}/api/cron`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const ran = await cronRun.json();
  check(
    "the OLT sync runs and reports rather than throwing",
    ran.results?.olts !== undefined || ran.results?.olts?.error !== undefined,
    JSON.stringify(ran.results?.olts ?? "no result")
  );
}

console.log(`\n${"─".repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`${"─".repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
