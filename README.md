# ISP Management System

A unified ISP operating system: customers, billing, accounts, network devices,
support and reporting connected end to end — not a pile of separate CRUD pages.

Built from [`ISP.md`](../ISP.md).

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
```

`POST /api/payments` runs the same transactional flow as the UI and refuses to
exceed the invoice balance.

---

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
| `expiry` | Counts expiring and expired customers and, when auto-suspension is on, suspends those past the grace period. |
| `messages` | Delivers queued messages whose scheduled time has arrived, claiming each row before sending so a retry cannot double-send. |
| `backup` | Takes one automatic snapshot a day, once the configured time has passed. |

**Every job is idempotent.** Running it twice in a day bills nothing twice,
suspends nothing twice, resends nothing and takes no second backup — the check
is part of each job rather than a lock, so a retried request is safe.

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
