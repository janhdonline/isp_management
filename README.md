# ISP Management System

A unified ISP operating system: customers, billing, accounts, network devices,
support and reporting connected end to end — not a pile of separate CRUD pages.

Built from [`ISP.md`](./ISP.md) — the specification this implements.

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack, React 19) |
| Language | TypeScript (strict) |
| UI | Tailwind CSS v4 + a hand-built component library (`src/components/ui`) |
| Charts | Recharts |
| Database | PostgreSQL via Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Auth | JWT session cookie (`jose`) + bcrypt, role-based permissions |
| Validation | Zod (shared between forms, server actions and the REST API) |

The UI never talks to the database directly — every screen goes through the
service layer in `src/lib/services`, which is also what the REST API and any
future mobile/POS client consume.

---

## Getting started

```bash
npm install
npm run db:pg        # terminal 1 — a real PostgreSQL 18 on 127.0.0.1:5432
npm run setup        # terminal 2 — migrate + seed
npm run dev
```

`npm run db:pg` runs official PostgreSQL binaries through `embedded-postgres`, so
there is nothing to install and no root required. Data lives in `.pgdata/`.

**Already have a PostgreSQL?** Skip that script and point `DATABASE_URL` in
`.env` at your server — a local install, Supabase, RDS or Neon all work, and the
SQL is identical either way:

```
DATABASE_URL="postgresql://user:password@host:5432/isp?schema=public"
```

Open <http://localhost:3000> and sign in:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@isp.com` | `admin123` |
| Account manager | `manager@isp.com` | `manager123` |
| Technician | `tech@isp.com` | `tech123` |

### Useful scripts

```bash
npm run db:pg         # start the local PostgreSQL (leave running)
npm run db:pg:fresh   # same, but wipe the cluster first
npm run dev           # dev server
npm run build         # production build
npm run start         # serve the production build
npm run lint          # eslint
npm test              # 109 unit tests: inventory, provisioning, enforcement, gateway, RouterOS, refunds, shifts, reset, PDF, rate limit
npm run setup         # prisma migrate deploy + seed
npm run prisma:seed   # reset + reseed demo data
npm run db:reset      # drop and recreate the database
npm run db:studio     # Prisma Studio
npm run verify        # end-to-end check against a running server
```

### Moving an existing SQLite database across

`npm run migrate:from:sqlite` copies every table from the original `dev.db`
into PostgreSQL. SQLite is read with `better-sqlite3` and written through
Prisma, so field types are converted by the generated client rather than by
hand; rows are inserted in dependency order and the script finishes by checking
for orphaned payments and ledger drift.

```bash
npm run db:pg
npm run migrate:from:sqlite
```

The seed builds a realistic 9-month history: 180 customers, ~750 invoices, ~660
payments, 145 expenses, 48 tickets, routers, OLTs and ONUs. It also aligns the
document counters and recomputes every derived balance, so the demo data is
exactly what the billing engine would have produced.

---

## Project layout

```
prisma/
  schema.prisma        data model (33 tables)
  seed.ts              deterministic demo dataset
src/
  app/
    (auth)/login       public
    (app)/             authenticated shell (sidebar + topbar)
      dashboard/
      customers/       list, new, [id] profile with 7 tabs, status, due,
                       online, offline, expiring
      packages/        list, new, [id], [id]/edit, reports
      billing/         invoices, payments, receipts, due
      network/         overview, online, routers, olt, onu, bandwidth
      areas/           areas, zones, coverage
      expenses/        daily, new, history
      accounts/        list, transfer, history
      settings/        general, billing, network, users, api, backup
      support/         tickets, [id] with conversation/notes/activity/
                       resolution, new, complaints, technicians
      employees/       list, new, [id] with job/salary/attendance/leave/
                       advance/documents, attendance, leave, salary
      notifications/   sms, email, history
      reports/         customers, billing, collection, due, expense, pnl,
                       network, attendance — one route, eight reports
    api/               REST facade + auth + search
  components/
    ui/                the design system (button, card, input, table, modal,
                       toast, tabs, charts, badges, states, ...)
    layout/            app shell, sidebar, topbar, global search
    <module>/          module-specific views built from the design system
  lib/
    prisma.ts          singleton client
    auth.ts            sessions + permission checks
    enums.ts           the status vocabulary (ISP.md §15)
    validators.ts      Zod schemas shared by forms, actions and the API
    services/          all business logic and data access
    network-adapter.ts MikroTik / database adapters behind one interface
  proxy.ts             route protection (Next 16 `proxy`, not `middleware`)
```

---

## Design decisions worth knowing

**One DataTable, every list.** `src/components/ui/data-table.tsx` provides
search, filters, sorting, pagination (10/25/50/100), column visibility, CSV
export, row selection and bulk actions. A page supplies `Column<T>[]` and gets
all of it, so no two list screens drift apart.

**Column definitions live on the client.** Server Components cannot call a
function defined in a `"use client"` module, so each list builds its columns
inside a small client component (`buildColumns` in `customer-list.tsx`,
`billing-tables.tsx`, …) rather than in the page file.

**Connection status and billing status are separate fields.** A customer can be
`Active` / `Online` / `Due` at the same time. The schema keeps
`connectionStatus`, `onlineStatus` and `billingStatus` in separate columns and
the UI renders them as a `StatusTriple` badge, exactly as ISP.md §15 requires.

**Money moves in one transaction.** `recordPayment()` in
`src/lib/services/billing.ts` writes the payment, updates the invoice, recomputes
the customer's due, posts to the account ledger, generates the receipt and writes
the audit row inside a single `prisma.$transaction`. Overpayment is rejected
before anything is written.

**Derived numbers are recomputed, not trusted.** `previousDue` on the customer
and `status` on the invoice are denormalised for list speed, but they are only
ever written by `recomputeCustomerBilling` / `recomputeInvoiceStatus`.

**One connection string.** `src/lib/db-url.ts` owns it. The app, the Prisma CLI,
the seed and the maintenance scripts all import the same constant, because a
fallback that disagrees with `.env` silently points them at a different
database — and only the Next.js process reads `.env` automatically.

**Device integrations sit behind adapters.** `NetworkAdapter` is the contract;
`MikrotikAdapter` talks RouterOS REST and `DatabaseNetworkAdapter` backs the
demo. Nothing in the UI knows the difference, and adding a vendor means writing
one class.

**Secrets are write-only.** Settings marked `isSecret` are stored server-side,
never returned to the browser. The settings form renders a masked placeholder
and only writes a new value when the field is filled in.

**Colour is not a status.** Status colours come from one map
(`STATUS_STYLES` in `src/lib/enums.ts`), so "Expired" looks the same on the
dashboard, in a customer list and on an invoice.

---

## Status vocabulary (ISP.md §15)

| Kind | Values |
| --- | --- |
| Connection | Active · Pending · Suspended · Disconnected · Archived |
| Online | Online · Offline |
| Billing | Unpaid · Partial · Paid · Overdue |
| Invoice | Paid · Partial · Due · Overdue · Cancelled |
| Ticket | Open · Pending · In Progress · Resolved · Closed |
| Device | Online · Offline · Low Signal · Unknown |

---

## Permissions

Twelve resources × six actions (`View`, `Create`, `Edit`, `Delete`, `Export`,
`Approve`) are defined in `src/lib/permissions.ts` and seeded into the database.
Roles map to those keys, and the check runs in three places:

- `proxy.ts` — blocks unauthenticated navigation (401 for `/api/*`, redirect for pages)
- every server action, via `requirePermission()`
- every REST write, via `requirePermissionFromRequest()`

Seeded roles: **Administrator** (all 72), **Account Manager** (customers,
billing, packages, areas, expenses, accounts, reports — no settings),
**Technician** (network, support and customers, read/write).

---

## REST API

Authenticated with the same session cookie.

```
POST /api/auth/login                 { email, password }
POST /api/auth/logout
GET  /api/search?q=                  customer / invoice / ticket / area / package
GET  /api/customers?perPage=&q=&areaId=&status=
GET  /api/customer?id=               one customer with billing and history
GET  /api/invoices?perPage=&status=
GET  /api/payments?method=&from=&to=
GET  /api/packages
GET  /api/accounts
GET  /api/online
GET  /api/stats                      dashboard figures as JSON
POST /api/payments                   { customerId, invoiceId, amount, method, accountId }
POST /api/lifecycle                  { customerId, action: suspend|reconnect|disconnect|renew, reason?, days? }
```

`POST /api/payments` runs the same transactional flow as the UI and refuses to
exceed the invoice balance.

`POST /api/lifecycle` exists because the most common automated case is "this
account is unpaid, cut it off", and without it a billing system of the ISP's own
has no way to reach that. It reports the network result separately from the
database change, because the two can differ and a caller told only "done" will
never check again:

```json
{
  "ok": true,
  "connectionStatus": "Suspended",
  "network": { "applied": false, "queued": true, "detail": "Edge-Mirpur has no API credentials…" }
}
```

---

## Inventory and auto-provisioning

`InventoryItem.quantity` is never typed in by anyone. It is the sum of
`StockMovement` rows, and the movement and the balance are written in the same
transaction. A stock figure that can be edited directly is a stock figure that
will be wrong, and an ISP that thinks it has twenty spare ONUs and has four
turns away customers. `reconcileStock()` asserts the two agree, and the test
suite runs it across every item.

A **reorder level of zero switches the warning off** rather than meaning
"reorder when empty" — otherwise every item created with the default level
lights up the low-stock list the moment it is empty, and an alert that is
always on is one nobody reads. "Low stock" is `quantity <= reorderLevel`, a
comparison between two columns of one row, which Prisma cannot express in a
`where`; hard-coding `lte: 0` returns only the genuinely empty items and hides
exactly the ones that need ordering.

`CustomerEquipment` is separate from the ledger because a stock count and a
device in someone's house are different facts. The serial is unique system-wide,
so one ONU cannot be recorded in two houses — which is the failure that turns a
swap into a fortnight of arguing about whose line actually works. A returned
device rejoins the shelf; a faulty one is written off and stays on the ledger so
the write-off is visible.

**Provisioning.** `Package.mikrotikProfile` maps a package to a RouterOS
rate-limit profile. A new customer gets their PPP secret created automatically
after the transaction commits, a package change repoints the profile, and a
deleted customer's secret is deleted rather than disabled — a disabled secret
left behind hands its credentials to the next subscriber at that address.

The profile is carried **on the queue row** rather than re-derived at retry
time, so a change that fails and is retried after a further package change still
applies what it was raised for.

One asymmetry in the retry job, and it is deliberate:

| Action | Is it still wanted? |
| --- | --- |
| `suspend` | Checked against the customer's current status. A queued suspend for someone who has since paid is dropped — executing it cuts off a customer who owes nothing. |
| `provision`, `setProfile`, `removeSecret` | Never dropped. These say what access should look like, which stays true regardless of status. Applying the same check would silently drop a queued provision for a customer who happened to be suspended in between — and that subscriber is then never configured at all. |

A hotspot router has no secret to create, so provisioning is skipped and logged
rather than attempted. Adding `Inventory` to `PERMISSION_RESOURCES` generates
`inventory.*` automatically; `scripts/sync-permissions.mjs` backfills them into
the roles that already exist, because a new module nobody holds a permission for
is indistinguishable from a broken sidebar.

## Online payments

bKash, Nagad, Rocket and cards go through one aggregator — SSLCommerz by
default, behind a `PaymentGateway` interface so ShurjoPay or anything else is one
file. `PAYMENT_METHODS` always listed those names, but they were labels on a
dropdown until now: every online payment had to be typed in by hand after the
customer handed over cash, which is both slow and the largest source of
collection error in a Bangladeshi ISP.

**The webhook is the security boundary.** A callback is an untrusted claim from
the internet saying "I was paid", and it gets three defences:

- **The posted body only decides what to ask about.** The amount recorded is the
  one the gateway's own validation API returns, so tampering with the posted
  `amount` changes nothing.
- **The amount is re-checked against our own invoice.** A gateway reporting more
  than the balance is refused with a 409 — a business partner is not an authority
  on what a customer owes.
- **The gateway transaction id is uniquely indexed.** Providers retry; a duplicate
  delivery is one payment. The index means even two simultaneous deliveries are
  caught by the database rather than by hope.

A failed or cancelled transaction is answered with 200 so the provider stops
delivering, and records nothing. A genuine recording failure is a 5xx, because a
provider told 200 will not retry — and an invoice a customer believes they paid
is the worst outcome available here.

Configure the provider to POST to `https://your-host/api/webhooks/sslcommerz`,
and set `app.url` so the return and cancel links point at the real deployment.

---

## Network enforcement

Suspending a customer has to reach the router, or "Suspended" is only a word in
a report. The chain is:

1. **The database is committed first.** A router being unreachable must never
   roll back an office's decision to cut off a non-paying customer, and a network
   call held open across a transaction holds a row lock for as long as the router
   takes to answer.
2. **A `NetworkAction` row is written before the router is called.** If the
   process dies mid-call, the action is still queued. Writing the row only on
   failure would lose exactly the case that matters.
3. **The router call happens.** For PPPoE, the PPP secret is disabled — which
   works whether or not the customer is online — and any live session is kicked.
   Hotspot has no secret, so an offline user genuinely cannot be blocked; that
   limitation is reported as a failure to be queued rather than reported as done.
4. **A failure leaves the row `Pending`, not `Failed`.** `Failed` is terminal,
   and the retry job only looks at `Pending`, so marking a router failure as
   failed would mean the enforcement was never retried and the customer stayed
   online indefinitely.

The retry job walks the queue with a backoff ladder and gives up after ten
attempts. A queued action is also re-checked against the customer's *current*
status before being carried out — an old suspend sitting in the queue is dropped
rather than executed against somebody who has since paid, because cutting off a
customer who owes nothing is worse than doing nothing.

**A payment that clears the dues reconnects the customer automatically** (both
screens and the REST API), so nobody has to log into a router. It is gated on
`billing.autoReconnect` and only fires when the customer is Suspended *and* the
recomputed due is at or below zero.

Two settings control it: `network.enforceOnSuspend` (default on) and
`billing.autoReconnect` (default on). Both being on is what makes the report and
the network agree.

| Surface | What it is |
| --- | --- |
| Network → Enforcement | The queue, so the drift between database and router is visible. |
| `POST /api/lifecycle` | `{ customerId, action, reason }` for suspend / reconnect / disconnect / renew. Reports `network.applied` separately from the database change. |
| `settings.network.enforceOnSuspend` | Whether suspension reaches the router at all. |

## Scheduled work

Everything recurring runs through one endpoint rather than living in the request
path, so it can be driven by any scheduler:

```bash
curl -X POST https://your-host/api/cron -H "authorization: Bearer $CRON_SECRET"
```

It is refused with a 401 unless `CRON_SECRET` is set — the route stays disabled
rather than defaulting to open, because it raises invoices, messages customers
and writes files. With the secret in place it runs four jobs:

| Job | What it does |
| --- | --- |
| `invoices` | Raises the subscription invoice for every active customer on the configured cycle, skipping anyone already invoiced this month. |
| `expiry` | Counts expiring and expired customers and, when auto-suspension is on, suspends those past the grace period. Router enforcement is queued as `NetworkAction` rows rather than done inline, so a slow or dead router cannot stall the sweep. |
| `enforcement` | Re-attempts queued router actions with a backoff ladder (1, 5, 15, 30 min, then hourly), and writes off anything past ten attempts so the queue cannot grow without limit. |
| `messages` | Delivers queued messages whose scheduled time has arrived, claiming each row before sending so a retry cannot double-send. |
| `collection` | Settles outstanding invoices for customers who have an active payment mandate. |
| `network` | Pulls live sessions from every configured MikroTik and folds them into the online-user tables. |
| `backup` | Takes one automatic snapshot a day, once the configured time has passed. |

**Every job is idempotent.** Running it twice in a day bills nothing twice,
suspends nothing twice, resends nothing and takes no second backup — the check
is part of each job rather than a lock, so a retried request is safe.

### Running it on a schedule

`.github/workflows/scheduled-billing.yml` calls the endpoint once a day. Give it
two repository secrets and nothing else:

```bash
gh secret set APP_URL     https://your-host.example.com
gh secret set CRON_SECRET <the same value as in the app's .env>
```

Until both are set the job exits cleanly rather than calling a wrong address,
and the Actions tab can trigger it by hand. Any other scheduler works just as
well — the endpoint is the contract, not the workflow.

### Messaging

SMS, email and WhatsApp go out for real. `src/lib/services/messaging.ts` holds
one adapter per channel over the credentials in Settings → API, and the delivery
result is what gets recorded: a message that fails stores the provider's reason
in `error`, and one whose channel has no credentials is marked `Pending` rather
than `Sent`. The log never claims a delivery that did not happen.

### Backups

Settings → Backup writes real snapshots and can restore them:

- `pg_dump` in custom format when the binary is on `PATH`
- otherwise a gzipped JSON export through Prisma, which is what the bundled
  development server uses

Either way the row, the download and the restore button in the history table
work, and a restore replays the whole database in a single transaction so it can
never stop halfway. Retention is applied after each backup.

---

## What is in the system

**Delivered:** Dashboard · Customers (all views + profile) · Packages (with
reports) · Billing (invoices, payments, receipts, due) · Network (online, routers,
OLT, ONU, bandwidth) · Areas · Expenses · Accounts · Settings (general, billing,
network, users & roles, SMS/API, backup) · auth · audit log · dark mode ·
responsive layouts · REST API.

**Phase 2 also delivered:** Support (tickets with a full detail view —
conversation, internal notes, activity, resolution — plus complaints and
technician workload), Employees (profiles, attendance register, leave
approvals, payroll that posts a debit to the cash account when paid),
Notifications (SMS and email with templates and audience targeting, every
message logged) and Reports (eight reports over one shared date range).

Phase 2 modules are driven by server actions rather than REST routes, so they
are reached through their pages, not through `/api`.

---

## Verification

`npm run verify` drives a running server over HTTP and checks the behaviour
rather than the markup: the payment chain from ISP.md §21 (payment → invoice →
customer due → account balance → receipt → audit row), that overpayment is
refused, that unauthenticated and under-privileged requests are rejected, that
all 68 pages render, that report date ranges are honoured, that the scheduled
endpoint refuses a missing or wrong token, and that running it twice in a row
changes nothing the second time. 50 checks.
