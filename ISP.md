# ISP Management System --- UI Design & Page Structure Specification

**Version:** 1.0\
**Purpose:** UI/UX blueprint for an ISP Management, Billing, Network and
Accounting system.

------------------------------------------------------------------------

## 1. Global Layout

``` text
┌────────────────────────────────────────────────────────────────────┐
│ ☰ ISP Management   🔍 Search...   🔔   🌙   👤 Admin ▼            │
├────────────────┬───────────────────────────────────────────────────┤
│ SIDEBAR        │ Breadcrumb                                        │
│                │ Page Title                         [+ Add]        │
│ Dashboard      │ Description                                       │
│ Customers      │                                                   │
│ Packages       │ Cards / Charts / Filters / Tables / Forms         │
│ Billing        │                                                   │
│ Network        │                                                   │
│ Support        │                                                   │
│ Areas          │                                                   │
│ Expenses       │                                                   │
│ Accounts       │                                                   │
│ Employees      │                                                   │
│ Reports        │                                                   │
│ Notifications  │                                                   │
│ Settings       │                                                   │
└────────────────┴───────────────────────────────────────────────────┘
```

### Topbar

-   Sidebar toggle
-   Global search
-   Notifications
-   Quick action
-   Language
-   Light/Dark mode
-   User profile
-   Logout

### Global Search

Search customer, username, phone, invoice, IP and ticket.

### Reusable UI

-   Stat cards
-   Charts
-   Data tables
-   Filter bars
-   Date range picker
-   Status badges
-   Tabs
-   Modals
-   Confirmation dialogs
-   Toasts
-   Pagination
-   Loading/empty/error states

------------------------------------------------------------------------

# 2. Dashboard

## Statistics Cards

### Customer

-   Total Customers
-   Active Customers
-   Online Now
-   Offline

### Finance

-   Today's Collection
-   Monthly Collection
-   Total Due
-   Monthly Expense

### Alerts

-   Expiring Today
-   Expired
-   Suspended
-   Open Tickets

## Charts

1.  **Collection Overview:** Today / Week / Month / Year / Custom
2.  **Customer Growth:** New / Disconnected / Reconnected
3.  **Customer Status:** Active / Expired / Suspended / Disconnected
4.  **Package Distribution:** Customer count by package

## Tables

### Expiring Customers

Customer, Package, Expiry, Due, Status, Action

### Recent Payments

Invoice, Customer, Amount, Method, Date, Status

### Live Online Users

Username, Customer, IP, Package, Download, Upload, Uptime

## Quick Actions

New Customer, Collect Payment, Create Invoice, Add Package, New Ticket,
Add Expense

------------------------------------------------------------------------

# 3. Customers

## New Customer

### Personal Information

-   Customer ID (auto)
-   Customer Name \*
-   Father/Mother Name
-   Mobile \*
-   Alternative Mobile
-   Email
-   NID
-   Date of Birth
-   Gender
-   Address
-   Area
-   Zone
-   Customer Type
-   Photo

### Connection Information

-   Username \*
-   Password
-   Connection Type
-   Package \*
-   Static/Dynamic IP
-   IP Address
-   MAC Address
-   Router
-   OLT
-   ONU
-   PON Port
-   Connection Date
-   Billing Date
-   Expiry Date

### Billing Information

-   Monthly Bill
-   Installation Fee
-   Advance Payment
-   Previous Due
-   Discount
-   VAT
-   Total Payable

Buttons: **Save Customer, Save & Create Invoice, Save & Create
Connection, Reset, Cancel**

## Customer List

Top: - Search - Area filter - Package filter - Status filter - Expiry
filter - Date filter - Reset - Import/Export - New Customer

Table: Customer ID, Customer, Phone, Username, Package, Area, Monthly
Bill, Expiry, Due, Status, Actions

Actions: View, Edit, Payment, Renew, Change Package, Suspend, Delete

## Online

Cards: - Online Users - Total Download - Total Upload - Peak Users

Table: Username, Customer, IP, MAC, Package, Download, Upload, Uptime,
Router, Login Time, Action

Actions: Disconnect, View Customer, Block, Change Package

## Offline

Table: Customer, Username, Package, Last Online, Expiry, Due, Status,
Action

Filters: Area, Package, Last Seen

## Active

Cards: Active, Active With Due, Active Without Due, Active Online

Table: Customer, Package, Area, Monthly Bill, Due, Expiry, Online
Status, Action

## Expired

Cards: Expired Today, This Week, This Month

Table: Customer, Package, Expiry Date, Due, Days Expired, Last Payment,
Status, Actions

Actions: Renew, Collect Payment, Suspend, Send SMS

## Due

Cards: Total Due, 1--7 Days, 8--30 Days, 30+ Days

Table: Customer, Phone, Package, Invoice, Bill, Paid, Due, Days Overdue,
Action

Actions: Collect, Send SMS, View Customer

## Suspended

Table: Customer, Username, Package, Suspended Date, Reason, Due, Status,
Action

Actions: View, Collect Payment, Reconnect

## Disconnected

Table: Customer, Username, Package, Disconnected Date, Reason, Total
Paid, Due, Action

Actions: View, Reconnect, Archive

## Customer Profile

Header: - Customer Name - Customer ID - Status - Package - Monthly
Bill - Due - Expiry

Quick actions: Collect Payment, Renew, Edit, Change Package, Suspend,
Reconnect, Create Ticket, Print, Send SMS

Tabs: - **Overview:** personal, connection and billing summary -
**Billing:** invoices, due, next billing - **Payments:** payment
history - **Connection:** username, IP, MAC, package, router, OLT, ONU,
PON - **Complaints:** tickets and complaints - **Usage:** online history
and bandwidth - **History:** package, payment, suspension and profile
activity

------------------------------------------------------------------------

# 4. Packages

## Package List

Cards: - Total Packages - Active - Inactive - Total Subscribers

Table: Package Name, Download, Upload, Monthly Price, Installation Fee,
Customers, Status, Actions

Actions: View, Edit, Duplicate, Activate/Deactivate, Delete

## Add Package

Fields: - Package Name * - Download Speed * - Upload Speed * - Monthly
Price * - Installation Fee - Validity - Billing Cycle - FUP Limit -
Description - Status

Buttons: Save, Save & Add Another, Cancel

## Package Reports

-   Customer count by package
-   Revenue by package
-   Active subscribers
-   Expired subscribers
-   Package distribution chart
-   Package revenue chart

------------------------------------------------------------------------

# 5. Billing

## Invoices

Cards: Total, Paid, Partial, Due, Overdue

Filters: Date Range, Customer, Area, Package, Status

Table: Invoice Number, Customer, Package, Issue Date, Due Date, Amount,
Paid, Due, Status, Actions

Actions: View, Print, PDF, Payment, Cancel

## Invoice Details

Show: - Company information - Customer information - Invoice number -
Issue/due date - Package - Billing period - Amount - Discount - VAT -
Total - Payment status

Buttons: Print, Download PDF, Collect Payment, Send Invoice

## Payments

Cards: Today's Collection, This Month, Cash, Mobile Banking, Bank

Filters: Date, Customer, Method, Account

Table: Payment ID, Customer, Invoice, Amount, Method, Transaction ID,
Account, Date, Collected By, Action

## Due

Include: - Total due - Aging - Area-wise due - Package-wise due -
Collection progress

## Receipts

Table: Receipt Number, Customer, Invoice, Amount, Payment Method, Date,
Status, Actions

Actions: View, Print, PDF, Send

------------------------------------------------------------------------

# 6. Network

## Online Users

Cards: Total Online, Download Traffic, Upload Traffic, Peak Users

Table: Username, Customer, IP, MAC, Package, Download, Upload, Uptime,
Router, Login Time, Action

## MikroTik

Router cards: Name, Status, CPU, RAM, Uptime, Active Users

Router table: Router, IP, Location, API Port, Status, CPU, RAM, Uptime,
Actions

Actions: View, Edit, Test Connection, Sync, Restart

Details tabs: Overview, Interfaces, Active Users, PPPoE, Traffic, Logs

## Routers

Table: Router Name, Model, IP, Location, Customers, Online Users,
Status, Actions

## OLT

Cards: Total OLT, Online, Offline, Total PON, Online ONU

Table: OLT, Vendor, IP, Location, PON Ports, Online ONU, Offline ONU,
Status, Actions

## ONU

Filters: OLT, Area, Status, Signal

Table: ONU, Customer, Serial, OLT, PON, RX Power, TX Power, Status, Last
Seen, Action

Statuses: Online, Offline, Low Signal

## Bandwidth

Cards: Total Download, Total Upload, Peak Traffic, Average Traffic

Charts: Hourly bandwidth, Daily bandwidth, Router traffic, Package
traffic

Tables: Top users, Top routers, Top packages

------------------------------------------------------------------------

# 7. Support

## Tickets

Cards: Open, Pending, In Progress, Resolved, Closed

Filters: Status, Priority, Technician, Area, Date

Table: Ticket ID, Customer, Subject, Problem, Priority, Technician,
Created, Status, Action

Priority: Low, Medium, High, Critical

## Ticket Details

Show: Customer, Contact, Problem, Description, Priority, Technician,
Status, Created Date

Sections: Conversation, Internal Notes, Attachments, Activity,
Resolution

Actions: Assign, Change Priority, Change Status, Comment, Resolve, Close

## Complaints

Categories: No Internet, Slow Internet, Router Problem, ONU Problem,
Cable Problem, Payment Problem, Package Problem, Other

Table: Complaint ID, Customer, Category, Description, Date, Assigned To,
Status, Action

## Technicians

Cards: Total, Available, Busy, Jobs Today

Table: Technician, Phone, Area, Assigned, Pending, Completed, Status,
Action

------------------------------------------------------------------------

# 8. Areas

## Area

Cards: Total Areas, Customers, Online, Due

Table: Area, Zone, Customers, Active, Online, Due, Status, Actions

## Zone

Table: Zone, Area Count, Customer Count, Active, Online, Status, Actions

Add Zone: Zone Name, Description, Status

## Coverage

Show: - Area map - Coverage zones - OLT locations - Router locations -
Customer distribution

Filters: Area, Zone, Device, Customer Status

------------------------------------------------------------------------

# 9. Expenses

## New Expense

Fields: - Expense Category * - Amount * - Date * - Account * -
Vendor/Payee - Reference - Description - Attachment - Note

Buttons: Save Expense, Save & Add Another, Cancel

## Daily Expense

Cards: Today's Expense, Number of Expenses, Highest Expense

Table: Time, Category, Description, Amount, Account, Added By, Action

## Expense History

Filters: Date, Category, Account, Amount Range

Table: Date, Category, Description, Amount, Account, Added By, Actions

------------------------------------------------------------------------

# 10. Accounts

## Account List

Cards: Total Balance, Cash, Bank, bKash, Nagad, Other

Table: Account Name, Type, Opening Balance, Current Balance, Status,
Actions

Show recent transactions.

## Transfer Fund

Fields: - From Account * - To Account * - Amount \* - Transfer Date -
Reference - Note

Show: Available Balance, Transfer Amount, Remaining Balance

Button: Transfer Fund

Rule: Source account must have sufficient balance.

## Account History

Filters: Account, Date, Transaction Type

Table: Transaction ID, Date, Account, Type, Description, Debit, Credit,
Balance, User

Types: Payment, Expense, Transfer, Refund, Adjustment

------------------------------------------------------------------------

# 11. Employees

## Employees

Cards: Total Employees, Active, On Leave, Technicians

Table: Employee ID, Name, Role, Phone, Area, Joining Date, Status,
Actions

## Employee Profile

Tabs: Personal, Job, Salary, Attendance, Leave, Advance, Documents

Quick actions: Mark Attendance, Add Leave, Pay Salary, Edit

## Attendance

Cards: Present, Absent, Late, Leave

Filters: Date, Employee, Status

Table: Employee, Date, Check In, Check Out, Status, Note

## Leave

Fields: Employee, Leave Type, Start Date, End Date, Reason, Attachment,
Approval Status

Table: Employee, Leave Type, Duration, Reason, Status, Approved By,
Action

## Salary

Cards: Total Salary, Paid, Pending, Advance

Table: Employee, Basic, Allowance, Bonus, Deduction, Advance, Net
Salary, Status, Action

------------------------------------------------------------------------

# 12. Reports

Every report uses:

``` text
Report Title
Date Range
Filters
[Generate] [Reset] [Print] [PDF] [Excel]
```

## Customer Reports

-   Customer List
-   Active
-   Expired
-   Suspended
-   Disconnected
-   Area-wise
-   Package-wise

## Billing Reports

-   Invoice Summary
-   Paid
-   Due
-   Overdue
-   Cancelled

## Collection Reports

Show: Total, Cash, bKash, Nagad, Bank, Card

Table: Date, Method, Amount, Account, Collector

## Due Reports

-   Total Due
-   Aging
-   Area-wise
-   Customer-wise
-   Package-wise

## Expense Reports

-   Total Expense
-   Category-wise
-   Account-wise
-   Daily/Monthly/Yearly

## Profit & Loss

``` text
Total Revenue
      -
Total Expense
      =
Net Profit
```

Show: Revenue, Expenses, Net Profit, Profit Margin

## Network Reports

-   Online Users
-   Offline Users
-   Bandwidth
-   Router Status
-   OLT Status
-   ONU Status
-   Signal Issues
-   Downtime

## Attendance Reports

-   Daily
-   Monthly
-   Employee-wise
-   Late
-   Leave
-   Absent

------------------------------------------------------------------------

# 13. Notifications

## SMS

Cards: - SMS Balance - Sent - Failed

Send to: - Individual customer - Selected customers - Area - Package -
Customer status - All customers

Fields: Recipient, Message, Template, Schedule

Buttons: Send Now, Schedule

## Email

Fields: Recipient, Subject, Message, Attachment, Schedule

Buttons: Send, Schedule, Save Draft

## Message History

Table: Date, Recipient, Type, Template, Message, Status, Sent By

Statuses: Sent, Failed, Pending, Scheduled

------------------------------------------------------------------------

# 14. Settings

## General

Fields: Company Name, Logo, Favicon, Address, Phone, Email, Website,
Currency, Timezone, Date Format

## Billing

Fields: Billing Cycle, Grace Period, Late Fee, Auto Invoice, Auto
Suspension, Invoice Prefix, Receipt Prefix, Default Tax, Default Payment
Method

## Network

### MikroTik

API Host, Port, Username, Password, SSL

### RADIUS

Server, Port, Secret

### OLT

Vendor, Connection/API Details

### Default Network

Default IP Pool, Default Router, Default Package

## Users & Roles

Pages: - User List - Roles - Permissions - Activity Logs

User fields: Name, Email, Phone, Role, Status, Password

Permission categories: Customers, Packages, Billing, Payments, Network,
Support, Expenses, Accounts, Employees, Reports, Settings

Permissions: View, Create, Edit, Delete, Export, Approve

## SMS/API

Sections: - SMS Provider - API Key - Sender ID - API URL - Email SMTP -
WhatsApp API

Buttons: Test Connection, Save

Never show API secrets in plain text after saving.

## Backup

Cards: Last Backup, Backup Size, Backup Status, Next Backup

Schedule: Daily, Weekly, Monthly

Buttons: Backup Now, Restore, Download

History: Date, Size, Type, Created By, Status, Actions

------------------------------------------------------------------------

# 15. Common Status System

## Connection Status

-   Active
-   Online
-   Offline
-   Suspended
-   Disconnected

## Billing Status

-   Paid
-   Due
-   Expiring Soon
-   Expired
-   Partial

## Ticket Status

-   Open
-   Pending
-   In Progress
-   Resolved
-   Closed

## Network Status

-   Online
-   Offline
-   Low Signal

**Important:** Connection status and billing status must be separate.

Example:

`Connection: Active | Online: Offline | Billing: Due`

------------------------------------------------------------------------

# 16. Common Table Rules

All large tables should support:

-   Search
-   Filters
-   Sorting
-   Pagination
-   Column visibility
-   Export
-   Row actions
-   Bulk selection
-   Bulk actions
-   Responsive layout

Pagination: `10 / 25 / 50 / 100`

------------------------------------------------------------------------

# 17. Common Form Rules

Required fields use `*`.

Validate: - Required values - Phone - Email - Number - Dates - IP -
Unique username - Duplicate customer

Standard buttons:

`[Save] [Save & New] [Cancel]`

Edit:

`[Save Changes] [Cancel]`

------------------------------------------------------------------------

# 18. Common Modal Operations

Use modals for: - Collect Payment - Change Package - Suspend Customer -
Reconnect - Send SMS - Assign Ticket - Add Note - Delete Confirmation

Destructive confirmation:

``` text
Are you sure?

This action cannot be undone.

[Cancel] [Confirm]
```

------------------------------------------------------------------------

# 19. Responsive UI

## Desktop

-   Sidebar visible
-   Multi-column cards
-   Full tables
-   Two-column forms

## Tablet

-   Collapsible sidebar
-   2-column cards
-   Responsive tables

## Mobile

-   Sidebar drawer
-   1-column cards
-   Stacked forms
-   Horizontal-scroll/card tables
-   Touch-friendly buttons

------------------------------------------------------------------------

# 20. UI Development Rules for Agent

1.  Build reusable components.
2.  Do not duplicate page structures.
3.  Keep frontend UI separate from API/service logic.
4.  Use real API/data models rather than production hard-coded data.
5.  Every form needs validation.
6.  Every data page needs loading, empty, error and success states.
7.  Confirm destructive actions.
8.  Use pagination for large datasets.
9.  Enforce permissions in frontend and backend.
10. Keep MikroTik/OLT/ONU integrations behind service/adaptor layers.
11. Never expose secrets in frontend.
12. Keep audit logs for important operations.
13. Use configurable currency/date/time.
14. Keep every page responsive.
15. Use database transactions for financial operations.
16. Keep customer, invoice, payment, account and network records
    relationally consistent.

------------------------------------------------------------------------

# 21. Main UI Flow

``` text
Customer
   ↓
Connection
   ↓
Package
   ↓
Invoice
   ↓
Payment
   ↓
Account
   ↓
Network
   ↓
Support
   ↓
Reports
```

## Payment Flow

``` text
Payment Created
      ↓
Invoice Updated
      ↓
Customer Due Updated
      ↓
Account Balance Updated
      ↓
Receipt Generated
      ↓
Activity Logged
      ↓
Optional SMS
```

## Customer Lifecycle

``` text
New Customer
     ↓
Connection Created
     ↓
Active
     ↓
Invoice Generated
     ↓
Payment
     ↓
Renewed
     ↓
Expiring
     ↓
Expired
     ↓
Grace Period
     ↓
Suspended
     ↓
Payment
     ↓
Active Again
```

------------------------------------------------------------------------

# 22. Final Module Map

``` text
ISP MANAGEMENT SYSTEM
│
├── Dashboard
│
├── Customers
│   ├── New Customer
│   ├── Customer List
│   ├── Online
│   ├── Offline
│   ├── Active
│   ├── Expired
│   ├── Due
│   ├── Suspended
│   ├── Disconnected
│   └── Customer Profile
│
├── Packages
│   ├── Package List
│   ├── Add Package
│   └── Package Reports
│
├── Billing
│   ├── Invoices
│   ├── Payments
│   ├── Due
│   └── Receipts
│
├── Network
│   ├── Online Users
│   ├── MikroTik
│   ├── Routers
│   ├── OLT
│   ├── ONU
│   ├── Bandwidth
│   ├── Enforcement
│   └── RADIUS Live
├── Notifications
│   ├── SMS
│   ├── Email
│   ├── Reminders
│   └── History
│
├── Support
│   ├── Tickets
│   ├── Complaints
│   └── Technicians
│
├── Areas
│   ├── Area
│   ├── Zone
│   └── Coverage
│
├── Resellers
│   ├── Reseller List
│   ├── Reseller Details
│   └── Commission Report
│
├── Expenses
│   ├── New Expense
│   ├── Daily Expense
│   └── Expense History
│
├── Inventory
│   ├── Items
│   ├── Stock Movements
│   └── Assigned Equipment
│
├── Accounts
│   ├── Account List
│   ├── Transfer Fund
│   └── Account History
│
├── Employees
│   ├── Employees
│   ├── Attendance
│   ├── Leave
│   └── Salary
│
├── Reports
│   ├── Customer Reports
│   ├── Billing Reports
│   ├── Collection Reports
│   ├── Due Reports
│   ├── Expense Reports
│   ├── Profit & Loss
│   ├── Network Reports
│   ├── Attendance Reports
│   └── BTRC Subscriber Report
│
├── Notifications
│   ├── SMS
│   ├── Email
│   └── Message History
│
├── Settings
│   ├── General
│   ├── Billing
│   ├── Network
│   ├── Users & Roles
│   ├── SMS/API
│   └── Backup
│
└── Customer Portal (/portal)
    ├── Overview
    ├── Invoices
    ├── Tickets
    └── Password
```

## 23. Inventory

Cards: Total Items, Low Stock, Assigned, Stock Value

Filters: Category, Status, Search

Table: Item, SKU, Category, Quantity, Unit Price, Status, Action

Item Details: Specifications, Stock Movements, Assigned To

Actions: Add Stock, Adjust, Assign to Customer, Return to Stock

Stock Movement Ledger: Date, Type (Purchase / Assign / Return / Adjust),
Quantity, Reference, By

Auto-Provisioning: Network → Routers → AutoProvision toggle. When on, new
customers get their PPPoE secret created automatically, package changes
update the secret's profile, and deletion removes the secret. When off,
this system never writes secrets on that router. Suspension is unaffected
either way.

------------------------------------------------------------------------

## 24. FUP Enforcement

Package: FUP Limit (GB), FUP Profile (throttled MikroTik profile)

Customer Profile: Usage bar (cycle usage vs FUP limit), Throttled badge

Settings → Network: FUP Action — Off / Notify / Throttle (default Off)

Throttle: customers over the FUP limit are moved to the FUP profile
automatically; restored to the package profile when the new billing cycle
starts. Hotspot customers are notify-only (no PPP profile to change).

Note: usage is synced from the router; bytes between the last sync and a
session drop are under-reported until RADIUS accounting arrives.

------------------------------------------------------------------------

## 25. Customer Portal (/portal)

Login: username + portal password (staff sets it on the customer page)

Overview: Package, Status, Expiry Date, Total Due, Usage vs FUP limit

Invoices: list + detail + "Pay Online" (gateway checkout, Phase B)

Tickets: My Tickets, New Ticket, status timeline + comments

Password: change portal password

A portal customer only ever sees their own data. Staff sessions are not
accepted on portal pages, and portal sessions are not accepted on staff
pages.

------------------------------------------------------------------------

## 26. Reseller Management

Reseller List: Name, Phone, Area, Commission %, Status, Customers, Collected

Filters: Status, Area, Search

Reseller Details: Assigned customers, collection history for a period

Customer Form: Reseller dropdown (optional)

Payment Form: Collected by Reseller (optional)

Reports → Commission: date range, per-reseller collections, commission =
collections × commission %. Derived from payment rows; v1 has no separate
reseller ledger and no reseller login.

------------------------------------------------------------------------

## 27. BTRC Reporting

Reports → BTRC: the periodic subscriber return filed with the Bangladesh
Telecommunication Regulatory Commission.

Month picker (defaults to the current month), one table, Export CSV.

Table: rows are a package × area pair; columns are Active, Suspended,
Disconnected, Total Subscribers, New Connections and Churn for that pair.
A pair with nobody today but connections in the month still gets a row.

Every subscriber count runs through `buildCustomerWhere` — the Customers
list's own filter builder, and so the same predicate the dashboard cards
read. The report has no counting logic of its own, because a second
implementation of "count the active customers" is exactly how a filed return
ends up disagreeing with the operator's own screen.

Status columns are a snapshot of the base as it stands; New Connections and
Churn are the selected month. The app stores current status and no history of
it, so a historical status split cannot be produced — see docs/BTRC_REPORT.md
for how every figure is derived.

CSV: the column layout lives in one constant, `BTRC_COLUMNS` in
src/lib/services/btrc.ts, with the header row, the row values and the filename
all derived from it. **It has not been confirmed against BTRC's current
prescribed format and must be checked before the first real submission.**
docs/BTRC_REPORT.md documents the layout and asserts against the constant.

Export: GET /api/reports/btrc?month=YYYY-MM, gated on reports.export like the
other exports. Read-only — generating or exporting a return writes nothing.

An empty or unparseable month gives an empty report, not an error: a cleared
month picker is a normal state, and reporting the wrong month because a
parameter was dropped is the worse failure.

------------------------------------------------------------------------

## 28. RADIUS (Embedded AAA)

An authoritative RADIUS server in this repository: routers ask it who may
connect, it answers from the customer table, and it can end a session the moment
the office suspends someone.

**Process model.** A separate Node process, `radius/`, started with
`npm run radius`, sharing only the database. In development it runs beside
`npm run dev`. In production, a systemd unit is in the README.

RADIUS is UDP — 1812 authentication, 1813 accounting, 3799 CoA — so it cannot be
a Next.js route handler. A route has no way to see a datagram's source port,
cannot bind a second listener, and sits behind a TCP stack a MikroTik does not
speak. Separating it also means an operator's login spike cannot slow down
rendering an invoice, and a bug in a request handler cannot take authentication
offline.

**Authentication.** On Access-Request, the credential is checked against the
stored customer password, then the account's state decides:

- PAP, CHAP and MS-CHAPv2 — the last being what a MikroTik PPPoE server
  negotiates. MD4 is a local implementation because modern OpenSSL ships it
  disabled; it is checked against all seven RFC 1320 vectors rather than trusted.
  DES comes from `crypto-js` (Node's DES is legacy-provider only) and is checked
  against the FIPS 81 known-answer vector.
- **MS-CHAPv2 is RFC 2759**, and the two details that decide whether it works at
  all are: the authenticator's challenge arrives as **MS-CHAP-Challenge** (vendor
  311 type 11) — there is no MS-CHAP2-Challenge attribute, and a server that
  "sends" one under that name rejects every real MikroTik; and the NT-Response's
  three DES keys are 56-bit slices of the 128-bit password hash taken at *bit*
  offsets 0, 56 and 112, zero-padded, because a DES key is seven significant
  bits per octet. The byte-aligned reading gives a different key and a different
  response. Verified against RFC 2759 §9.2's published trace.
- Access-Accept carries **MS-CHAP2-Success** (RFC 2759 §8.7) for a v2 login, so
  mutual authentication completes; a MikroTik negotiating it will not bring the
  interface up without it. Plus **Mikrotik-Rate-Limit** as `<down>M/<up>M` from
  the package's speeds, and **Session-Timeout** = seconds until expiry, capped at
  a day. Down is first because that is how a MikroTik reads the pair.
- Refusal requires Active status, an unexpired date within the billing grace
  period, and no outstanding dues.
- **Simultaneous-Use**, `radius.simultaneousUse` (default 1, 0 = unlimited). The
  live-session count and the reservation are one transaction behind a per-username
  advisory lock, so two simultaneous logins cannot both read a count of zero; a
  subscriber with two devices is refused the second with its own reply message,
  distinct from the billing one because their account is fine.
- Every refusal carries one identical Reply-Message. An unknown user is refused
  exactly as a wrong password is: a Reject that distinguished the two would turn
  port 1812 into a user-enumeration oracle.

**Accounting.** One row per session, keyed on the NAS's `Acct-Session-Id`.

Interim-Update is the part most likely to be wrong. Accounting is UDP, so a NAS
that does not get a response resends, and a resend carries the same *cumulative*
totals. Treating them as deltas inflates a customer's usage — a bug nobody
reports. So an update whose sequence is not newer than the stored one is ignored,
a Start upserts rather than inserts, and a Stop is a final statement applied
whatever sequence it carries. Sessions a router forgot to close are reaped after
five idle minutes, because an unclosed row looks live forever and every later
suspension would try to disconnect a session that ended at a reboot.

**PoD.** Suspension of a connected customer on a RADIUS router sends an RFC 5176
Disconnect-Request to `network.nasCoaPort`, per live session, reporting each
result separately. Accounting is what makes this possible — the request has to
name the NAS and the session id, and only accounting knows either. Routers with
RADIUS off keep the RouterOS API path unchanged, and Phase A's DB lifecycle,
outbox and retry ladder are untouched.

**Security.** Packets are answered only from a `Router.ipAddress` with RADIUS
switched on — the allowlist is the router table, because a separate IP list drifts
from it. A stranger's packet is dropped and logged, never answered: a Reject
would confirm to a prober that a RADIUS server is listening. Per-NAS rate
limiting stops one router in a fault loop from saturating the process. The shared
secret and passwords are never logged.

**Router.useRadius**, default false. Off means zero behaviour change: the
RouterOS API remains the mechanism for every router not converted. Turned on,
this application answers every PPPoE login for that router's subscribers.

**Network → RADIUS Live**: a terminal-style stream of accepts, rejects,
accounting, disconnects and drops, fed by SSE with a cursor-based reconnect, with
event-type filters, search, pause and auto-scroll. A heartbeat row written every
15 seconds drives the health widget — UP while fresh, **DOWN** after 60 seconds,
because a dead process must not read as stale-UP. A permission-checked test-auth
button sends a real Access-Request so a new router's secret can be proven in
seconds; the password is never stored or logged.

`radius.logRetentionDays` (default 7) and an idempotent `pruneRadiusLogs` cron
job keep the log bounded, with a hard cap in the writer as a backstop.

docs/radius-mikrotik.md is the operator guide.

------------------------------------------------------------------------

## 29. Automatic Payment Reminders

Notifications → Reminders, and the `reminders` cron job. Expiry and payment
reminders go out by themselves on configured days, WhatsApp first with SMS
fallback, at most once per (customer, invoice, kind, day).

**Off by default** (`reminder.enabled`). A reminder list that starts contacting
customers the moment an ISP upgrades, from data it already holds, is not a
default anybody should inherit. One click in Settings → Notifications.

**Scheduling.** `reminder.expiryDays` ("3,1") and `reminder.dueDays`
("1,3,7") are comma-separated day offsets. Each day is a separate reminder, not
a threshold: a customer expiring in 3 days gets one letter, and again the day
before. The further-out one is what gives them time to arrange payment before a
suspension notice, which is cheaper for both sides than restoring a cut line.

**Exactly-once, enforced by the database.** `Notification.idempotencyKey` is
unique, and the key is `reminder:{customerId}:{invoiceId}:{kind}:{dayOffset}`.
The invoice slot is the literal `none` for an expiry reminder — there is no
invoice, and a key that changed shape when one appeared would be a duplicate
waiting for the next billing run.

Exactly-once is a unique index and nothing else. This cron route is driven by
three schedulers, and two runs in the same second is not a bug to guard against in
application code but a race the database has to settle: the insert is a single
`createMany … skipDuplicates`, so one run records the row and the other is
dropped by the index. A check-then-insert is two queries and both can pass the
check.

**Channel fallback.** `reminder.channelOrder` is tried in order. A channel that
is not configured is skipped without being called; one that fails falls through to
the next. WhatsApp is first because it is free and a customer can reply to it;
SMS reaches a customer who never opens WhatsApp. The row records the channel
that actually delivered it and, in `notes`, which channels were tried — so a
fallback that worked is visible rather than looking like the ISP simply does not
use WhatsApp for reminders.

If nothing delivers, the row is **Failed** with the reason. Never Sent: "Sent" is
the word an operator reads when asking a customer whether they have been told.

**Quiet hours.** `reminder.quietHours` ("22:00-07:00") wraps midnight, so it is
two ranges rather than one comparison. A reminder that falls inside the window is
recorded as Scheduled with a release time at the end of the window and sent on a
later run. It is *not* handed to the generic scheduled-message job: that job
sends on the single channel recorded at scheduling time, which for a
WhatsApp-first ISP is the channel that has already failed once, and letting it
pick reminders up would deliver some of them through a different route than the
rest.

**No network I/O inside a transaction.** Rows are written and committed first;
only then is anything handed to the messaging adapters. A provider that hangs
must not hold a transaction open, and a provider that is down must leave a
visible Failed row rather than an uncommitted one.

Network → the reminder trail is on the customer's profile as well as on
Notifications → Reminders, because the first question a support agent asks of
someone who says they were never told is "what did we send them, when, and down
which channel".

------------------------------------------------------------------------

## 30. Customer Wallet (Advance Balance)

Payments a customer makes ahead of their bills. Previously one number —
`Customer.advancePayment` — that `netDue` subtracted, with no top-up flow, no
history and nothing to audit.

**A ledger, and a cached number.** `WalletTransaction` is the truth: one signed
row per movement, each carrying the balance it produced.
`Customer.advancePayment` stays as the number the rest of the app reads, and the
two are written together in a single transaction. There is exactly one function
that does it (`post()` in `src/lib/services/wallet.ts`), and nothing else writes
either — that is what makes `SUM(amount) == advancePayment` a property of the
code rather than something to check afterwards. `npm run verify` runs
`scripts/check-wallet.mts` on the real database and fails on any drift.

Types, and what each may move the balance by:

| Type | Moves | Backed by |
|------|-------|-----------|
| `TopUp` | up | a Payment receipt, always |
| `InvoiceConsume` | down | an invoice, never more than it is owed |
| `RefundOut` | down | a reason, clamped at zero |
| `Adjustment` | either | a mandatory reason — the only hand-typed row |

**Atomicity.** A top-up writes the Payment, the receipt, the account entry, the
ledger row and the balance in one transaction. That is not tidiness: there is no
ordering of those writes that leaves the books closed if the process dies between
two of them, so they are one commit or none.

**Concurrency.** Every movement takes `SELECT … FOR UPDATE` on the customer row
before reading the balance. Two simultaneous top-ups would otherwise both read
the same balance and both write the same result, losing one payment's worth and
leaving ten ledger rows claiming one balance. The lock makes them serialise and
`balanceAfter` become a real running balance.

**Automatic consumption** happens inside the transaction that raises the invoice —
in `createInvoice`, and in the monthly run — so a customer who paid in advance is
never briefly overdue, which is long enough for an expiry or FUP sweep to cut a
line belonging to someone who has already paid. Capped at the invoice total and
never past zero.

**Overpayments.** The payment form offers, only when there is a genuine excess,
to put the remainder in the wallet instead of refusing the payment: one payment,
one ledger row, the invoice taking what it is owed. Without the option the
behaviour is unchanged — the payment is refused, because quietly keeping cash that
settles nothing is how an office ends up holding money it cannot account for.

**Adjustments** require `billing.adjust` — its own permission rather than
`billing.edit`, because the difference between correcting a customer's name and
correcting their balance is the difference between a typo and money — a mandatory
reason, and an audit entry. Refunds go through the refund flow instead, so the
money leaving is also on the account ledger.

Customers see the same ledger read-only in the portal. The first question a
support agent asks of someone who says they were never told is "what did we send
them, when, and down which channel" — the wallet has the same problem, and the
same answer.

------------------------------------------------------------------------

## 31. Per-Customer Usage

Daily traffic per customer, aggregated from the two places it is actually
measured. Before this, "amar net slow" was answered by guesswork: the sessions
were in `OnlineSession` and nobody could sum them.

**`DailyUsage`**, one row per (customer, day), from `OnlineSession` and — since
Phase W — from `RadiusAccounting`. The unique key is the whole idempotency
mechanism; there is no "does today's row exist" check anywhere, because that is
two queries and a window in which a concurrent run inserts a second row and the
chart shows two bars for Tuesday.

**Which source wins.** A customer on a RADIUS router appears in both, so they are
never summed — that would double the whole month. **RADIUS wins per
customer-day; session data is used where RADIUS has nothing.** Three reasons: it
is the router's own count of what crossed the wire, where a session row is a
report about a session and can be lost when a nightly sync fails; it is *live*,
where sessions are only as current as the last sync; and a day mixing both is the
one number nobody can reason about when a customer disputes it. `source` records
which, so the chart can say why a bar looks different from its neighbours.

**`onlineMinutes` is the union of the day's sessions, not their sum.** Two devices,
or a reconnect the router counted twice, must not report more time than passed.
An unclosed session runs to *now* rather than to the end of the day, because a row
that was never closed would otherwise contribute 24 hours; a session spanning
midnight is clipped to each day.

**BigInt throughout.** The counters are summed as BigInt and serialised to strings
across the server/client boundary — 2^53 bytes is about 9 PB, which a busy shared
uplink reaches over a 180-day window. The chart converts to `Number` for the axis
only; every figure shown to a customer is exact.

**The job recomputes a trailing window**, not just yesterday, so a night the sync
failed or a RADIUS server was down leaves a hole that closes on the next run
instead of becoming a permanent blank. `usage.retentionDays` (default 180) prunes
the rest — comfortably longer than any FUP cycle and long enough to dispute a
quarter-old bill.

**Where it surfaces.** The customer's Usage tab: an area chart of the last 30 days
with totals, time online and the busiest day. And on a **Slow Internet** ticket,
a panel of the last seven days against their package speed — because "your
internet is slow" is unanswerable on its own, while "you moved 340 GB this week
and were online 41 hours on a 10 Mbps line" separates a congested segment from a
customer's own equipment, and those go to different people.

------------------------------------------------------------------------

## 32. Device-Down Alerts

A router can die at 2am and nobody knows until customers call. This turns a
device's status changing into one alert, one notification, and — when it comes
back — one recovery notice.

**One incident, one alert.** A router down for six hours produces one row and one
page, not one per poll. An operator woken six times in six hours stops reading the
alerts, and the one time it mattered is the one they had muted.

**The dedupe is in the database.** `DeviceAlert.dedupeKey` is unique and holds only
for an *open* alert, so every monitor run while the device is still down attempts
the same key and the index rejects it. Resolving nulls the key, which frees it for
the next incident. There is no existence check anywhere in this path: a
check-then-insert is two queries and a window in which two concurrent runs both
pass the check, which is precisely the run the cron route gets when two schedulers
fire at once.

**Recoveries are history, not incidents.** A `Recovered` row is created
`Resolved`, with `dedupeKey: null`, and notifies through the same call. Two
reasons, both of them failures this design already had:

  - **No dedupe key on a recovery.** A key is how one *incident* is kept to one
    row, and a recovery is the end of an incident rather than an incident of its
    own. Claiming a key meant the first recovery kept it for ever, so the second
    outage-and-repair on a device hit the unique violation and was discarded — that
    incident got an "unreachable" page and no "it is fixed" page.
  - **Never Open.** There is nothing outstanding about a device that is working.
    Left `Open`, every recovery the installation has ever had accumulates in the
    dashboard's open count, which is meant to answer "what is broken right now".

**Transitions, not states.** The monitor remembers the last status it saw per
device, in a settings row. That memory is not the same thing as the open alert: an
open alert answers "do we believe this is broken?", the remembered status answers
"was it working an hour ago?". A device with no alert and a last-seen of `Offline`
is fine and known; one with no alert and a last-seen of `Online` has just gone
down. Without the second, a fresh deployment pages about every device it inherits.

**A failed page is not a quiet page.** The alert stays `Open` and records
`notifiedAt: null` with the reason. A device down and nobody told is a different
thing from a device down and paged, and the dashboard says which it is.

**Low signal** is its own alert rather than falling under "router down": an ONU
below −25 dBm produces drops at peak time rather than a clean outage, and nobody
reacts to it. It needs **two consecutive bad readings** — one is a dip, and alerting
on a dip is how a signal gets ignored. The streak is persisted rather than held in
memory, or a monitor that restarted on every deploy would never reach two and would
never alert at all. An ONU with no reading is not called low-signal: that is a
different failure and guessing at it would page for the wrong thing.

**Telegram** is the default channel, and the only one of the three with a real
chance of being answered at 2am. Settings → Network: `alerts.channel`,
`alerts.recipients`, `alerts.lowSignalDbm`, `alerts.lowSignalConsecutive`.

**Where it surfaces.** Network → Alerts for the history, and a banner on the
dashboard with the open count. The banner is on the dashboard because the person
who needs to see an overnight outage is usually not looking at the network page —
they are looking at the dashboard because they just logged in. It renders nothing
when nothing is wrong, because a banner that is always there gets ignored.

------------------------------------------------------------------------

## 33. Corporate / Dedicated Clients

`Customer.customerType` existed and was otherwise unused: a company paying for a
CIR contract was treated exactly like a home user. This makes those accounts
first-class, and leaves the residential flow alone.

**The company columns are all nullable.** A Home customer has `null`, not empty
strings — "this is a home account with no company" is not the same statement as
"this is a home account", and only the second is ever asked. No new required
field, no changed default, no behaviour difference: the phase is additive or it is
nothing.

**CIR and MIR are both stored**, because the gap between them is the whole
commercial point of a contract. CIR is what the operator guarantees; MIR is what
the pipe could physically do. A report showing only one cannot answer "is this
client served as sold".

**Validation is conditional.** Corporate and Dedicated require a company name and
a contact person — there is no name to put on an invoice, and nobody to call. The
rules are a `superRefine` that runs only for those types, so the Home schema keeps
exactly the validation it had. Trade licence is recorded but **not** enforced here;
the KYC checklist is Phase V's.

**The `slaHours` rule is separate from the field helper.** Whether an account has
an SLA is decided by the customer *type*; the Settings default only fills in what
an SLA already exists and left unset. Written as one line —
`slaHours: corporateFieldsFor(d).slaHours ?? defaultHours` — the `??` reads the
rule's `null` for a residential account as "missing" and gives every Home
customer a 4-hour commitment they never bought. Nothing breaks while every reader
checks the type first, and the column still says something untrue; the first
reader that trusts the column rather than the type (Phase U's tracker, a report, a
CSV export) starts treating a home account as a contract. `slaHoursFor()` exists
so the type check cannot be skipped by a later edit.

**Tickets carry a deadline.** A corporate ticket starts at High with
`slaDueAt = createdAt + slaHours`, defaulting to `corporate.defaultSlaHours`. Only
a *default* Medium is raised — an operator who explicitly chose Critical is not
overruled. `slaEscalate()` flags anything past its deadline when the queue is
read, so a ticket that sat open overnight is noticed without a job, and closing
it clears the flag: a ticket closed after breaching was late, but it is not an open
escalation. Phase U reads these two fields; nothing here computes compliance.

**Invoices bill to the company.** The company name leads, the billing label says
what the money is for, and the account contact stays underneath so somebody can
still be asked. A Home invoice renders exactly what it did before.

**Two reports.** Network client list with CIR/MIR, headroom, static IPs and SLA
hours; and a Corporate receivables report. Both reconcile against
`previousDue` — the same field the dashboard and the suspension sweep read — so
there is no third number to argue about.

**SLA compliance is reported as "pending Phase U",** not as a percentage. There is
no resolution data to measure against, and a compliance figure derived from
whatever happens to be available would be a number in front of an operator that
means nothing.

------------------------------------------------------------------------

## 34. IP Pool Management (IPAM)

`Customer.ipAddress` was free text. Two customers could be given the same address,
nothing showed what was free, and a duplicate-IP outage was a matter of time. The
subnet is now the unit an operator thinks in, and every address in it is a row that
either is or is not taken.

**A pool expands into one row per allocatable address.** A /24 yields 253: the
network address, the broadcast address and the gateway are not hosts, and a router
cannot route a pool whose gateway is inside it. A /30 leaves one. **/31 and /32 have
no network or broadcast** (RFC 3021) and all their addresses are usable — excluding
the first and last of a /31 would leave a subnet that cannot route, which is the one
case a "usable hosts" helper most often gets wrong.

**The unique index is the design, not the check.** Allocation is check-then-allocate:
find a free address, then claim it, and two operators doing that at the same instant
both read "free" and both write. The index settles it — one transaction wins, the
other comes back as a unique violation which the caller is told about. `customerId`
is unique for the same reason from the other side: one address per customer, so a
change of pool frees the old one rather than leaving somebody holding two.

**Two bugs this ordering hid**, both found by the concurrency tests rather than by
reading the code:

  - An auto-assign claimed its address with a plain `update`. Several at once all
    read the same lowest-free row and all succeeded in turn — no unique violation,
    because there was nothing to violate: one row written four times. The last
    writer won and three customers were told they had the same address. The claim is
    now a compare-and-swap (`updateMany` with the row's current owner in the
    `where`), which is the statement the database makes atomic.
  - The old address was released *after* the new one was claimed. Because
    `customerId` is unique, claiming a second address while the first still pointed
    at that customer was refused — and the failure looked like a collision with a
    stranger. Release now comes first, and a caller who loses the race has its own
    address put back.

**Addresses sort numerically.** `sortKey` is the same address zero-padded per octet
so a lexical sort is a numeric one. Plain string ordering puts "10.30.0.10" before
"10.30.0.2", so auto-assign would fill .10 through .19 before ever reaching .2 — and
an operator looking at the pool would wonder why. `ip` stays the human-readable
value and keeps its uniqueness.

**Existing addresses are adopted, never clobbered.** The migration adds two empty
tables and touches nothing: `Customer.ipAddress` holds whatever years of operators
typed into it, some of it not an address in any pool, and rewriting it from a
migration would be destructive. Adoption is an explicit action because only an
operator can say whether "10.10.10.7" on a customer is inside the new /24 or a
stale note from a decommissioned range.

**Release** happens on disconnect, on delete and on a change of address, inside the
caller's transaction — between the two writes the customer row and the allocation row
disagree, and that is exactly when an operator sees an address as free while it is
still on somebody's line.

**Reserved** is a third status for addresses held for infrastructure or a planned
customer. Utilisation counts *allocated* only, so a reserved gateway is not a
subscriber and does not make the pool look fuller than it is.

------------------------------------------------------------------------

## 35. GIS Fiber Map and Fault Localization

No geo fields existed anywhere in the schema. When fiber was cut, nobody knew
which customers were affected until they called, and the technician drove around
guessing. The hierarchy needed for the answer was already here — `Customer → Onu →
Olt`, with `ponIndex` on the ONU — so only the geography was missing.

**The affected list comes from the PON topology, not from geography.** An outage
on one OLT resolves to its customers with one query, because a subscriber hangs
off a specific ONU on a specific port. That is the whole point: the crew is sent
to the cabinet the data says broke, rather than to the right postcode.

**A dead OLT is not one incident, it is every ONU behind it.** Which means the
naive version opens two tickets for one cut — the OLT rule fires, then the
ONU-cluster rule fires on the same physical event and finds every customer already
on the first ticket. The cluster rule therefore skips any PON whose own OLT is
offline: that event is already open, at better resolution. Found by a test, not by
reading the code.

**The cluster rule needs a clock, so the job is the clock.** "N ONUs dropped within
10 minutes" cannot be answered from status alone: a job only sees status at its own
run boundaries, so two ONUs that dropped in the same run are indistinguishable from
two that dropped a second apart. `Onu.lastSeenAt` existed and nothing ever wrote it.
This job stamps it, one statement for every online ONU, and the rule then asks a
real question. **Every** member of a cluster must be recent — one ONU that has
been dark for a week is a dead ONU that happens to share a port, and counting it
would lower the bar for every cluster on the network.

**Both claims are unique indexes, and one of them was wrong at first.** The bulk
ticket is claimed by `Ticket.dedupeKey` and the batch by
`Notification.idempotencyKey`, both in the same transaction, so an incident can
never exist as a ticket nobody was told about. The ticket key carries an hour
bucket; the *message* keys were originally derived from it too, and that meant a
customer could be told about at most one outage an hour — two separate cuts in the
same hour opened a second ticket whose messages all collided with the first batch
and were silently dropped. **The message keys are now keyed on the ticket id**,
which is unique per incident and is exactly the granularity wanted. The tests
found this one: a second outage forty minutes after the first produced a ticket
and no notifications.

**The hour bucket bounds a claim, not an outage.** Keeping one fault to one ticket
across a six-hour failure is the *open-incident memory* in a settings row; the
bucket is the claim for the case memory cannot help with — two processes racing a
trigger neither has recorded yet. A fault crossing an hour boundary still produces
one ticket and one batch, and there is a test for it.

**A resolved incident gives its key back.** Otherwise a second outage on the same
OLT could never be opened, and the database would be silently refusing to record a
real event.

**`(0, 0)` is not a location.** It is what an empty field parses as, and it is in
the Gulf of Guinea. Refused at three layers — schema validation, the service, and
the map — so an unlocated cabinet is *absent* rather than plotted in the ocean. An
incident on a cabinet nobody has positioned says "location not recorded" in the
ticket instead of inventing a pin.

**The pin is a chain, and the order is the answer.** OLT cabinet, then area
centroid, then the centroid of the affected ONUs — because the OLT is the node
whose position *is* the thing that broke, and the ONU centroid is computed from the
customers who actually lost service. A ticket on an OLT with no coordinates, in an
area with none, and serving no located ONU says so and tells the office to ask.

**Colour is not the only signal.** Red against green is exactly the distinction
most people with the common forms of colour blindness cannot make, and this is the
one page where being wrong about it sends a crew to the wrong building. OLTs are
squares, routers diamonds, ONUs circles.

**One unreadable route must not take the map down.** `points` is `Json`, so it can
hold anything a hand-written INSERT left behind. The map parses every route and
drops what it cannot draw, counting what it dropped — and the form stores the
*parsed* points rather than the text typed, so what is accepted is always drawable.

**Leaflet is loaded from a CDN, and typed by hand.** It is the only map on the
site; a dependency would put 150 kB in every route's bundle and its `window` global
in every unrelated test. The handful of API members actually called are declared
locally, so anything added later is a compile error rather than a silent `any`.

**OLT and ONU status is still written by nothing at runtime.** This module reacts
to whatever wrote `status` — the same seam Phase I reads — so on a deployment with
no poller it fires when an operator or a future SNMP collector changes a status,
and not before. That is inherited, not introduced here.

**Recovery is a note, not a second message.** The customers were told a team was
dispatched and it was. "Your internet is back" is a third message to somebody who
has just had a bad hour, so it sits behind `faults.notifyRecovery`, off.

------------------------------------------------------------------------

## 36. Zero-Touch ONU Provisioning (TR-069)

Every ONU used to be configured by hand. A technician logged into the device's own
web UI, typed PPPoE credentials into a form, set a WiFi name, and walked away. It
is slow, it does not scale, and a transposed digit in a PPPoE password produces a
symptom — a line that associates and then fails every login — which sends the
diagnosis to the wrong end of the problem entirely.

The device already knows how to ask for help. An unconfigured ONT boots, finds an
ACS, and sends an Inform saying *I am here, this is what I am*. Everything after
that moment is our job rather than the technician's.

### The device checks in; it does not get configured

`POST /api/acs/inform` creates the ONU row with `status: Provisioning`. **Not
Online** — the device has announced itself and has nothing working on it yet, and
saying otherwise hides it from every count and from the Phase L map, where it would
look like a healthy subscriber's equipment.

### An Inform may not change an existing device

This is the single most important rule in the phase, and it is not about which
columns to copy.

An unknown serial **creates**. A known serial updates exactly two fields:
`lastSeenAt`, and `status` when the device reports itself online. Nothing else —
not vendor, not model, not OLT, not PON port, not the customer link.

The reason is that first contact is the only contact that happens with somebody
standing next to the hardware. Every later Inform is an unauthenticated claim from
the network that happens to identify itself with that serial, and a re-flashed or
spoofed device will report whatever it was told to report. Letting a routine
heartbeat move an ONU to another OLT's PON port puts a live subscriber's equipment
on the wrong card — and the wrong card is where an outage investigation starts.

The shared secret is the only credential, so anyone holding it can claim to be any
device. That is honest about what TR-069 deployment commonly looks like, and the
blast radius is exactly what `recordInform` bounds: the worst a caller with the
secret can do is *create* rows, never repoint live ones.

### Two Informs at once, on purpose

`create` is attempted and its unique violation caught, rather than find-then-create.
A check-then-create is two queries and both can pass the check — and a brand-new
ONU reporting in twice is the *normal* case, because Inform is retried until it is
answered. The catch path lands on the same state the known-serial path produces, so
a race and a duplicate arrive at the same place.

### Nothing secret is stored by this module

The pushed configuration contains the customer's PPPoE password in plaintext,
because that is the entire point of the push. Three consequences:

  - **`Tr069Log` has a `payloadHash` column and no payload column.** A SHA-256 is
    enough to answer the only two questions anyone asks of this log — did we try,
    and was it the same attempt as last time — and useless to a reader hoping for
    a credential.
  - **The retry outbox stores no payload either.** Not the password, not a hash. A
    retry re-reads the customer's *current* password. This deliberately differs
    from Phase A, which pins a router profile on the row: a profile name is not a
    secret, and here the fresh read is better anyway — if the password changed
    while the device was unreachable, the device should end up with the one that
    works now, not the one that was wrong.
  - **WiFi passwords are derived, never stored.** There is deliberately no
    `random` policy, because a random key would have to be stored to be read back
    to the customer. `pppoe` gives the customer one credential instead of two;
    `derived` is an HMAC of the ACS secret keyed on the serial, which support can
    recompute on the phone without reading anything from the database, and which
    nobody else can produce. Rotating the ACS secret changes every derived key —
    the correct blast radius, since so does every WiFi device.

### The form field was broken before this phase

`Customer.onuId` is a foreign key to `Onu.id`. The customer form asked for a
**serial** in a field named `onuId`. So the one field linking a subscriber to
their equipment could not be filled in at all: a serial matches no id, and the
write either did nothing or failed the constraint. The field is now `onuSerial`
and is resolved to a row.

An unmatched serial is a **form error**, not a skipped link. Until a device has
checked in there is no row to point at, and silently ignoring the serial would
leave an operator looking at a customer record that says the device was assigned,
with no device assigned and no message — at which point they go and type the
serial into the ONU's own web UI, which is the exact step this phase removes.
Creating the row instead would be worse: a mistyped serial becomes a phantom ONU
on the map, on the fault-localization path and in every device count.

### A device that will not answer

The queue row is written **before** the device is called, for Phase A's reason: a
crash between the two must not lose the request, because the failure mode of
losing it is a customer whose line is installed and does not work, with nothing
in the system to show for it. The push is an `onuConfigure` row on the same
`NetworkAction` outbox and the same backoff ladder as the router queue — one
promise, two devices — but handed to the TR-069 adapter, never to a router.

A failed push leaves the action `Pending`, never `Failed`. `Failed` is terminal
and unretried, so a device that was briefly unreachable would be written off after
one attempt. **The ONU row is not touched on failure**: it stays `Provisioning`,
because flipping it to `Online` on a push that did not land is the exact lie that
status value exists to prevent.

The one thing that *is* terminal is a missing PPPoE password. Ten retries over
hours will not invent one, and a person has to.

### The one route in the app that writes without a session

So its authentication is the interesting part. Three things:

  - **No secret configured means no Inform is accepted at all** — 503, not an
    empty-string comparison. An empty setting must never become an empty shared
    secret, or the first device on the internet registers itself.
  - **The comparison is constant-time.** The repo does not do this anywhere else;
    the cron route uses `!==`. A byte-at-a-time comparison of a shared secret is a
    timing oracle that recovers it one byte at a time, and this secret is the only
    thing between the internet and the right to add rows. Two lines of cost.
  - **The secret is checked before the body**, so an unauthenticated caller cannot
    learn whether its Inform was well formed.

3xx and 4xx mean "you are wrong, do not keep trying". 5xx means "try again", which
a real CPE will. Sending 200 to a failed request leaves a device that never learns
it was rejected.

------------------------------------------------------------------------

## 37. OLT Vendor Adapter Framework

Every OLT row was manual entry. `network-sync.ts` had zero references to an OLT, no
vendor API code existed anywhere, and so the real signal levels were unknown: nobody
could say whether a subscriber at -29 dBm was degrading or fine, because the number
was never read off the equipment. And a customer who plugged in their own ONU was
invisible — connected, carrying traffic, and nobody's customer.

### The same seam as the router, one level up

`NetworkAdapter` exists because MikroTik is one vendor among several. `OltAdapter`
is the same argument with more force: Huawei, BDCom and VSOL do not merely differ in
commands, they differ in **where the information is**. The shape is identical —
`discoverOnus`, `getOnuSignal`, `listPonPorts`, `authorizeOnu`, `deauthorizeOnu`,
`rebootOnu` — and nothing above it learns a vendor name.

Each adapter carries a `live` flag. The stand-in used when a cabinet has no vendor or
no community throws from every method rather than returning empty results, because an
empty `discoverOnus()` is indistinguishable from a real OLT with nothing on it — and
the sync would happily mark every subscriber behind that cabinet offline.

### The MIB layout is configuration, not code

Those numbers belong to a model running a firmware, not to this application, and
both Huawei and BDCom have moved subtrees between firmware revisions. Hardcoding them
means an upgrade silently reads the wrong OIDs, and wrong OIDs return **plausible
garbage** rather than an error: a serial index that reads as an empty string, an rx
power that comes back as 0. So each map lives in Settings as JSON, merged field by
field over a default, and an invalid override is dropped *and named* — a silently
ignored typo is how somebody spends an afternoon wondering why their override did
nothing. The shipped defaults are placeholders and are documented as such.

The one thing that is not configuration is the ONU state table: those integers are
assigned by the GPON standard and every vendor implements them identically. An
*unrecognised* value is `Unknown`, never guessed — a vendor-specific code turned into
`Offline` would mass-disconnect subscribers whose ONUs are perfectly healthy but
report a code the table has not been taught.

### Signal is correlated by the OID suffix, not by row order

The four leaf OIDs are columns of one table. Reading them positionally — row N of the
serial column pairs with row N of the rx column — is the bug that shows four
subscribers' light levels shuffled between them, every value plausible and every one
wrong. The driver keys on the index in the OID suffix. The fake OLT deliberately
answers its columns in opposite orders so this is actually tested.

**9999 and -9999 are "no reading"**, not levels. Stored as read, an ONU that has
never transmitted looks impossibly healthy and never trips the low-signal alert.

### What a sync may write, and what it may never write

Five fields: `rxPower`, `txPower`, `status`, `ponIndex`, `lastSeenAt`. The OLT is the
authority on those five and on nothing else.

`serialNo` is the join key and is never rewritten. `vendor`, `model`, `name` and the
`Customer.onuId` link are not the OLT's to set: a Phase M ONU checked in over TR-069
with a real vendor and model, and a sync that let the cabinet restate them would
slowly replace what somebody verified with whatever the firmware claims. The customer
link especially — a row whose serial matches but whose customer is set must keep that
customer, or a reconnect would silently detach a subscriber from their own account.

The rule is enforced by the shape of the update, not by remembering to leave fields
out of a wider object spread.

### An unreachable OLT is not an empty one

This is the whole point of the module, and `syncRouters` established the principle
for routers. A cabinet we cannot reach is recorded as **`Unknown`** with the reason
on `lastError`, `lastSyncAt` does not advance, and **not one ONU row is written**.

It matters more now than it did for routers. Phase L's fault localization takes an
offline OLT as a trigger and opens a bulk ticket with an SMS batch to every customer
behind it. "The cabinet did not answer" would page the entire base of an exchange on
a dropped management VLAN.

### An unknown serial is a problem, not an ONU

**The sync never creates an `Onu` row.** An earlier draft did, and the count of
created rows came back zero every time for a reason that took a moment to see: every
serial it did not recognise went to the rogue path instead. The two behaviours cannot
coexist — auto-creating would make rogue detection unreachable — and auto-creating
would be the wrong answer anyway. Auto-registering unmanaged hardware would put it
into the fault-localization path, the fiber map and every device count, with no
customer behind it, no PPPoE secret and nobody to answer for it. A silent row is far
worse than an alert.

So an unknown serial is recorded in `RogueOnu`, alerted exactly once, shown on the
dashboard, and left there until a person decides. Bringing it into service is a
deliberate act: link it to a customer, and the next sync adopts it.

**One record per serial per OLT, for ever.** A resolved rogue that comes back is
*reopened* — same row, `resolvedAt` cleared, the key taken again, a new alert — rather
than inserted twice. Retaining the key would mean a cleaned-up serial that somebody
reconnects is never alerted about again, silently and for ever.

### Two security defects fixed on the way, because this phase would have tripped both

Both pre-existing, both found while adding `network.snmpCommunity` as a secret:

  - **Secret settings values were sent to the browser in plaintext.** `getSettings()`
    returns everything, and six settings pages handed the whole map to a `"use client"`
    form. The password inputs rendered empty, which looked like masking and was not:
    the values were in the RSC flight payload. That was true of the RADIUS secret, the
    MikroTik password and the payment gateway key before this phase. `redactSecrets()`
    is now what the UI calls.
  - **Saving the settings page erased every secret.** The inputs submit
    `defaultValue=""` with a hint promising "leave blank to keep the current value",
    and the action upserted whatever arrived. Changing one non-secret setting wiped
    the RADIUS secret and the payment credentials. Blank now means blank.

### The community is a write-only marker

`Olt.snmpCommunityEnc` is a **boolean**, mirroring `Router.apiSecretEnc`. The
community lives in an `isSecret` Settings row, so no select on `Olt` — in the
dashboard, an export, a log line or an API response — can produce it. `safeConfig()`
is the single place an adapter describes itself for a log, and the community is absent
from it.

Write operations use a separate session from reads, so a read can never inherit write
authority by accident. And `deauthorizeOnu` cuts a customer's line: it is never
called by a sync, because that belongs to a person deciding to.

------------------------------------------------------------------------

## 38. PON Port Capacity Planning

A 1:64 split fills up silently. There is no alarm, no error and nothing on any
screen — the 65th ONU on a port is simply refused by the OLT, and the ISP hears
about it as a customer whose light does not come on. By then the fix is a second
port and a second cable, not a decision.

## Nothing here is stored

Every number in this module is counted from the `Onu` rows that exist right now. No
occupancy column, no counter, no cache. That is not minimalism; it is the only safe
design:

  - A stored count is a second copy of a fact `Onu.ponIndex` already holds, and it
    is wrong the moment an ONU moves, a Phase N sync relocates it, or a row is
    deleted. **Nothing anywhere updates a counter when a device is unplugged.**
  - A **cached suggestion is worse than no suggestion.** It was computed from a
    count that was true a moment ago, and what an operator does with it is put a
    real ONU on a real port. Offering a port that is now full is how a port goes
    past capacity: the suggestion is the *mechanism* by which the overfill happens,
    so it must not be able to be stale.

The cost is a grouped count per render. An OLT has a few hundred ports and a few
thousand ONUs, so that is one query, not a scan of anything a dashboard should
flinch at.

## A port is the part before the colon

`0/1/1:2` is frame 0, slot 1, port 1, ONU slot 2. The split ratio applies to the
**port**; the ONU slot is which of the 64 an ONU occupies. Counting the whole
string would treat every ONU as its own port and report a network at 3% that is
really full. There is a test that does exactly that and asserts one port.

An index with no colon — which is what the Phase N SNMP driver writes when a vendor
does not report the frame — is taken whole rather than dropped.

## Unassigned is a bucket, not a hole

An ONU with no `ponIndex` occupies capacity nobody can see. It is counted under a
synthetic `unassigned` bucket on every report and on every OLT page, sorted **last**
because it is the worst row and sorting it among real ports makes it the hardest to
see. It reads as 100% full, which is the loudest honest way to say "no port has
been assigned to this".

And it is excluded from the suggestion: an unassigned bucket is not somewhere to
put the next ONU.

## The count alone is not enough — the race is in the check

"Count the ONUs, and if the count is below the split, insert" has a race in it. Two
assignments for the last slot both count 63, both see room, both insert, and the
port ends up with 65 ONUs on a 64 split. That is the exact failure this module
exists to prevent, reached *through* the check.

So the count and the insert happen inside one transaction, and that transaction
takes a row lock on the **OLT**:

    SELECT id FROM "Olt" WHERE id = $1 FOR UPDATE

Concurrent assignments on the same cabinet serialise, and the loser re-reads the
count with the winner's ONU already in it. A lock on the ONU row would not help —
the two assignments are usually about *different* ONUs, so there is no shared row
to lock. Locking the cabinet is coarse: two operators filling two different ports
on one OLT wait for each other, which is milliseconds, and entirely acceptable next
to overfilling a port.

The UI hides full ports from the list, which is usability. The transaction is the
rule.

## A refusal names the alternative

"Suggestions" recompute on every call, least-loaded first, ties broken on the port
name so the same state always produces the same answer — an operator who is told
`0/1/2`, writes it down, and finds a different port offered next time has a bug
report and not a bad day.

When a port is refused, the response says where to go instead, and the dashboard
form offers the next one preselected rather than hidden: **preselected, not
automatic**. An operator can see what the system thinks and disagree with it, which
is the difference between a suggestion and an autopilot.

## The split ratio is per cabinet

`Olt.splitRatio` is nullable, and null means "use `pon.defaultSplitRatio`" — 64,
because that is the GPON split and what a Huawei or VSOL cabinet does out of the
box. A cabinet reconfigured down says so on its own row, which is a property of the
hardware and belongs on the hardware rather than in a settings key named after a
cuid.

This matters more than it looks. At 64, a port holding 58 ONUs is at 91% and gets a
warning. Drop the same cabinet to 32 and those 58 ONUs are **over** capacity — a
port the OLT is already refusing additions to, reported as 91% healthy. Derived, so
the warning changes the moment the number does.

------------------------------------------------------------------------

## 39. Remote ONU Control

Rebooting an ONU meant a truck roll, or a login to somebody's NMS. Support could
not fix "the ONU is hung" from their chair, so the customer waited and the ISP paid
for the visit. The Phase N adapter already knew how to talk to a cabinet; this
section is the part in between — what the operator is about to do, whether it is
safe, whether the hardware can do it, and what happened afterwards.

## The four actions are not equally dangerous

The plan lists four verbs. They are not four buttons:

| Action | Costs | Keeps config | Needs the second act |
|---|---|---|---|
| Reboot | a customer ~1 minute | yes | no |
| Authorize | nothing | yes | no |
| Deauthorize | **a customer's service, now** | yes | yes |
| Factory reset | **a site visit afterwards** | **no** | yes |

A reboot is routine support work, so making an operator type anything for it means
they do not — and the one that mattered gets skipped. The other two get a second,
deliberate act.

**The confirm step is the product.** Nothing is sent on the first click. The second
opens a dialog whose *title* names the device and whose *body* is a sentence:

> **Factory reset HWTC00000001?**
> Erase the device's configuration entirely. It comes back with nothing on it and
> will need provisioning again before it serves anyone.
> On OLT-01, PON 0/1/1. Rahim Uddin is on this ONU and active.

"Reset this ONU?" tells an operator nothing. A misclick on factory reset has to be
obviously a misclick *before* it happens, because the recovery is a site visit — so
the serial is in the title, not just in the body, and the consequence is prose
rather than "Are you sure?".

## The refusal is in the service, not the dialog

`deauthorize` and `reset` are refused by `requestOnuAction` unless the request
carries the confirmation. A dialog-only check is one `curl` away from not existing,
and this is the check that takes a paying customer off the air. The dialog's tick
has to name the customer who will be affected — *"Rahim Uddin may lose service
immediately. Do it anyway."* — because "yes" on its own is not a decision anybody
made.

A **suspended** customer is deliberately described as *not on the air*. Their line is
already down, so the warning would be a lie, and an operator who learns to ignore it
stops reading it for the ones that matter.

## A bug that would have made the whole feature refuse to do anything

`oltAdapterFor` reads the management address, the vendor and the SNMP port from the
row it is given. The first version of this module passed only `{ id, name }`. The
result was an unconfigured adapter on **every cabinet in the country**, which reports
every action unsupported — so the feature would have shipped as a button that always
says "this OLT has no API vendor configured", and the code would have looked
correct. The tests caught it on the first run. The row's configuration now travels
with the target.

The same class of bug, once more, was a **factory reset writing the reboot's leaf**.
Phase N's driver wrote both to `reset`. Sending a reboot's command for a factory
reset means the device comes back *configured*, quietly, having lost nothing — the
one outcome where the operator is certain something went wrong and there is no
evidence of it. They are separate leaves now, and a test asserts they differ.

## Two claims, because there are two things to stop

- **Two rows.** Inside a transaction that takes `FOR UPDATE` on the ONU row, so
  concurrent requests serialise and the second sees the row the first created. The
  lock is on the device because the requests are about the same device.
- **Two executions of one row.** `executeOnuAction` claims the row by moving it
  `Pending → Running` with a conditional update, so the loser's count is zero and it
  never touches the device. **Phase A's drain does not do this**, and that is right
  for a router action — those are idempotent. A reboot is not: two of them is a
  customer watching two outages.

`Running` is a status this module introduces, and it is a permanent hole without a
reaper: the drain selects `Pending`, so a process that died mid-call would leave the
operator's request queued for ever with nothing showing as pending to explain why.
Anything older than five minutes is older than any plausible device call, so it goes
back in the queue.

### And one thing the lock cannot cover

The commonest accident is not concurrency at all: an operator double-clicking
Reboot, where the second request arrives *after* the first has finished and its row
is `Done`. A ten-second window absorbs that.

Beyond ten seconds a repeat is a **new intent**, not a duplicate. A reboot that worked
thirty seconds ago and another one now is somebody who changed their mind, and
absorbing it would silently do nothing to a hung device.

That window is a cache, and this codebase argues against caches elsewhere — so it is
worth being precise about the difference. Nothing here decides *whether a device can
be reached* or *how full a port is*. It only answers "was this exact command, on this
exact device, sent a moment ago", and being ten seconds stale about that costs one
reboot.

## The outbox stores a device reference and nothing else

`payload` is **null**. Not the command, not a parameter, not a hash. The action is
the `action` column and the device is its own row, so a retry has everything it needs
and nothing on that row could be a credential. The adapter reads its community from
Settings at the moment of the call, and nothing it reads is ever written down.

The row is written **before** the device is called, outside any transaction — Phase A's
ordering for Phase A's reason. A crash between the two must not lose the request, and
the failure mode of losing it is a device that stays hung until the end of the shift.

## Unsupported is a sentence, not a silent no-op

`capabilities()` is a method on the adapter, asked *before* a button is pressed.
An unconfigured cabinet, or a driver that cannot reset, says so in the dialog with
the field to fix named. And nothing is queued in that case: a row that fails ten
times for a reason that will never change is noise in the queue, and it makes the
queue look busy when nothing can be done about it.

## Permission

`network.edit`, checked in the server action before anything is read, written or sent
— the same gate every mutation here uses. The buttons are resolved on the server, so
a reader is shown *status only* rather than buttons that would fail.

**Stated plainly: the denial path is not covered by an automated test.** The action
imports `server-only` through `lib/auth` and cannot be loaded outside Next's own
runtime, so `scripts/verify.mjs` covers the wiring and the tests cover everything
below the gate. That is a real gap in the coverage, not a claim that the gate is
unimportant.

------------------------------------------------------------------------

## 40. Bandwidth Enforcement on MikroTik

`Package.downloadSpeed` and `uploadSpeed` were a billing number and nothing more. A
customer sold 10 Mbps and a customer sold 50 Mbps both got whatever the router felt
like, and the only way to find out was to log into the device by hand. The package
was, in the sense that mattered, fiction.

This phase programs a MikroTik **simple queue** per subscriber, named
`isp-<username>` — the same prefix Phase A uses for the firewall address list, so
everything this application puts on a router is recognisable by eye and a
half-deleted one can be found with a single filter.

## Three flags, three different questions

| Flag | Question | Default |
|---|---|---|
| `autoProvision` | may this system write PPP secrets here? | off |
| `useRadius` | does authentication live on the router or in RADIUS? | off |
| `autoQueues` | may this system shape the **bandwidth** here? | off |

All three default off, and a router can answer them differently. `autoProvision` on
with `autoQueues` off is a normal and useful combination: provisioning a secret
without shaping anything. **Nothing here runs until `autoQueues` is on**, which is
what makes this phase zero behaviour change until an admin opts a router in.

## RADIUS wins, and is checked first

On a router with `useRadius`, this module does nothing. The Mikrotik-Rate-Limit
attribute already carries the same number — it is written on every Access-Request
from the package — and two limiters on one subscriber means the stricter one wins,
which is nobody's decision.

**RADIUS is checked before `autoQueues`**, which is the opposite of the order the
gates read. A RADIUS router almost always has `autoQueues` off too, and reporting
"queues are switched off" there is true and useless: it answers a question the
operator did not ask. What they want is why this router behaves differently from
the one they just configured. A test caught this by asserting on the wrong reason.

Turning `autoQueues` on for a RADIUS router is also refused at the switch, with the
same explanation, rather than accepted and ignored.

## Suspend **removes** the queue rather than zeroing it

`max-limit=0` means different things on different RouterOS versions: on some it is
unlimited, on some it blocks. That is a coin flip with a customer's connection on
it, and the failure mode — a line dead for a reason nobody can find — is much worse
than the alternative.

Removal is also the honest inverse of adding. A suspended customer's secret is
already disabled by Phase A, so the queue is not what is keeping them off; it is
there to be taken away when they are suspended and put back when they are not, and
"put back" has to mean the limits they have *now*. A reconnect re-reads the
package, because a customer may have been moved while they were suspended.

## No zero-speed queue, ever

A package with zero or null speeds is **skipped with a recorded reason**. It is
tempting to read a missing number as 0 and shape the customer to nothing, and that
turns a data-entry omission into an outage for somebody who has paid. A package with
no speeds is a package nobody has finished entering.

The speeds are checked *after* the suspension check, deliberately: removing a queue
needs no numbers, so a customer suspended on a half-filled-in package must still
have their queue taken away.

## Idempotent means no write at all

`ensureSimpleQueue` reads the queue, compares the target and both limits, and
returns `changed: false` **without writing** if they already match. Not a write that
happens to be harmless — no PUT, no PATCH.

The second part is that "harmless" is not an accident to be assumed. RouterOS bumps
a queue's counters and re-orders its list on every touch, so a nightly job rewriting
2,000 identical queues makes the router's own diagnostics useless and buries the one
queue that did change.

## Mbps is not a bare number

RouterOS reads `10` as **bits per second**. Passing the number straight from the
package would shape a customer sold 10 Mbps to 10 bits per second — which looks
exactly like a dead line. Limits are written as `10M/2M`, and read back in whatever
spelling the router used: `50m`, `50M` and `50000000` all come back as 50.

## The queue row stores nothing

`payload` is **null** on both bandwidth actions. The limits are re-read from the
package at attempt time, so a customer who changed package *while their router was
unreachable* gets the one they are on now — and nothing on the row could be a
credential.

The row is written **before** the router is called, for the same reason as every
other enforcement path: a crash between the two must not lose the request, and the
failure mode of losing it is a customer left throttled to a speed they upgraded from
three months ago. A failure goes back to `Pending` with the reason — never `Failed`,
which is terminal and unretried.

## The gate can close while a retry waits

An admin can switch `autoQueues` off, or move a router onto RADIUS, while a queued
action is sitting in the outbox. The retry re-reads the router and **drops** the
action rather than forcing it, and marks the row `Done` with the reason. Forcing a
queue onto a router that was just opted out is exactly the failure `autoQueues`
exists to prevent, and the queued row is older than the decision that forbids it.

## The audit

The router page lists what this system manages there: the queue, its target, both
limits, and the package it came from. Queues are matched back to customers **by
name**, never by a stored RouterOS id — an id is a reference to a row on hardware
that can be rebooted, re-imaged or rebuilt, and a stale id fails in a way a name
never does.

A queue that matches no customer is reported as unattributed rather than hidden,
because somebody put it there on purpose.

Switching the flag on is deliberately **not** retroactive. Existing subscribers are
shaped the next time something about them changes. Rewriting a thousand queues at
once, with nobody watching, is how a router becomes slow on a Tuesday afternoon.

------------------------------------------------------------------------

## 41. Prorated Billing on Mid-Cycle Package Change

Changing a customer's package swapped `packageId` and `monthlyBill` and stopped. A
customer who upgraded on the 20th was billed as if they had been on the new package
for the whole month — so they were overcharged by ten days' difference, or the ISP
quietly absorbed it and every mid-month upgrade was a small loss nobody could see.

## Exactly 166.67, and why that word is the requirement

A day-20 change on a 30-day cycle, 500 to 1000, is 500 × 10/30 = **166.666…**. The
requirement says *exactly* 166.67, and that is a claim about **determinism**, not
about approximation.

Every money column in this application is a `Float`, because that is what was there
before this phase. That is a storage and display decision; it is not an arithmetic
one. Floats cannot represent 166.67, so:

    (500 * 10) / 30   ===  166.66666666666669
    (500 / 30) * 10   ===  166.66666666666663

Both are "500 × 10 / 30", and they are different doubles. Whether an ISP is owed
166.66 or 166.67 should not depend on how somebody parenthesised an expression
three functions ago.

So the arithmetic runs on **integer poisha** (hundredths) end to end, with one
explicit rounding at the end:

    divRoundHalfAwayFromZero(50000 × 10, 30)  ===  16667  →  166.67

Every value inside that expression is an integer, so no rounding happens before the
one that is intended. The rounding is **half away from zero**, symmetric for
charges and credits, so a downgrade is never a poisha out from its mirror.

Conversion is the other place floats have bitten people: `500.07 * 100` is
`50006.99999999999` in binary floating point, and flooring that is a poisha short on
every amount with a fraction. `toPoisha` rounds rather than multiplies.

## The swap and the money are one fact

There is **no commit between them**. If the invoice failed after the customer had
been moved, the ISP would have sold a month at the new price and billed nothing for
it; if the swap failed after the invoice was raised, the customer would have been
invoiced for a package they did not have. Neither is a state a database should be
able to hold, so a failure rolls both back — and a test asserts exactly that by
forcing a failure after the swap.

## An upgrade is an invoice; a downgrade is a credit

Money **owed** is an invoice: it can be chased, reported on, and paid through the
normal paths. Money owed **to** a customer is a wallet credit, and it goes through
Phase G's `adjust()` → `post()` ledger writer, which is the single writer and takes
its own `SELECT … FOR UPDATE`. `advancePayment` is never written directly — it is a
derived balance, and the ledger is the record that has to agree with it.

**A negative invoice is never raised.** It reads as a credit on the statement, it
inflates the invoice count, and it is a thing collection software does not know
what to do with.

An upgrade invoice is **due on the day of the change**, not at the end of the
month. The customer has already had the faster speed; a proration invoice dated
today and due next month would be a debt they have not incurred.

## The order of the gates

The speeds are checked **after** the suspension check, deliberately: removing
something needs no numbers, so a customer suspended on a half-filled-in package
still has their credit taken away. And an adjustment that rounds to **exactly zero**
raises nothing at all — an invoice for 0.00 is worse than no invoice, because it is
a row in the receivables report and a thing to chase.

A customer with no previous package is a **new subscription**, not a change of
price, so nothing is prorated.

## Same price is not a chargeable change

Two packages at the same monthly price differ in ways that are not money — FUP
allowance, profile, priority — and a customer moving between them has been
shortchanged, not overcharged. No invoice, no credit, just the swap.

## The cycle has to be the same one FUP measures

The window is the customer's latest invoice's `billingFrom`/`billingTo`, falling
back to the package validity period. That is deliberately **the same rule
`cycleWindow()` in `fup.ts` uses**: if usage and proration disagreed about where
the month is, a customer near their limit would be prorated against a different
window from the one their usage was measured over.

The elapsed count is clamped to the window, so a backdated edit prorates against a
real position in the cycle rather than producing a negative or absurd number.

## A backdated change is a parameter, not a `new Date()`

`changePackage` takes `changedAt`, defaulting to now. An operator correcting a
mistake made on the 1st while entering it on the 3rd should be prorated against the
1st — and a test cannot assert a day-20 figure without it.

## The switch, and why it is on by default

`billing.prorateOnPackageChange`, default **true**. Off restores the old swap-only
behaviour exactly, which is occasionally the policy an ISP actually wants: some bill
on the package held at the start of the month and treat a mid-month change as
effective next cycle. That is a choice, not an oversight, so both are available.

## What the customer sees

The proration note is a **block**, not a sentence, and the invoice page renders it
preformatted so the arithmetic lines up:

```
Package change, prorated over the rest of the billing cycle.
From: Home 5 Mbps — 500.00 per month
To: Home 10 Mbps — 1000.00 per month
Cycle: 30 days, 2026-07-01 to 2026-07-31
Already served on the old package: 20 day(s)
Remaining on the new package: 10 day(s)
Daily rate difference: 16.67 per day
Adjustment: 10 x 16.67 = 166.67
```

For a **downgrade** every figure is signed — `-16.67 per day`, `-166.67` — because
a credit is money going the other way and reading it as positive would be
misleading.

------------------------------------------------------------------------

## 42. Staff Two-Factor Authentication (TOTP)

Every role signed in with a password alone. One phished administrator password was
the whole attack — no second factor existed anywhere in the system.

## The two things that make it worth having

**There is no bypass path once enrolled.** Not for a convenience flag, not for a
role, not for "just this once". There is a test section called *"no bypass path"*
that walks each way past it could exist: the password step alone returns a challenge
rather than a session; a challenge with no code does not pass; an empty
`require2fa` does not disable an enrolled user; and neither does removing their
role entirely. That is a claim about the **absence** of a path, which is only
provable by looking for the paths that might exist.

**A challenge token is not a session.** The usual design is "logged in, but
limited", and it is a trap: every route then has to remember to check the flag, and
one that forgets is a complete bypass. A challenge token here authorises exactly
two things — confirming an enrollment and presenting a code — and carries no
permissions. HMAC-signed with the session key, only ever minted after a successful
password comparison, five-minute lifetime.

## The maths is a library, checked against the RFC

RFC 6238 is thirty lines of HMAC, and getting it subtly wrong is a security bug
that still *looks* like it works — a code that verifies against a clock one step
off is indistinguishable from a correct implementation until somebody's phone
drifts. So the test checks `otpauth` against the RFC's **own published vectors**
rather than trusting it:

    T=59         → 94287082     (SHA1, 8 digits)
    T=1111111109 → 07081804

Plus the window, because ±1 step is the requirement: 30 seconds of drift either
way is accepted, 60 seconds is not. A six-digit space is a million times smaller
than a password, so **the rate limit is the thing that makes a second factor
meaningful** — and the same `checkMemoryRateLimit` / `checkDatabaseRateLimit`
budget as the password step, keyed on the account the challenge names. Five wrong
codes lock the account, and the password step is locked too, because the budget is
per account rather than per step.

## Constant time, by not comparing

The rule says verification must be constant-time. The implementation satisfies it
by **never comparing**: `otpauth` returns the matching step's delta or `null`, and
there is no string equality on a secret-derived value for a timing attack to
measure. Backup-code hashes *are* compared, and those use `timingSafeEqual`.

## The secret at rest, and shown exactly once

AES-256-GCM, so a tampered ciphertext fails to decrypt rather than decrypting into
garbage that would then be treated as a secret. The key is derived from
`AUTH_SECRET` by HKDF with a fixed label, so a deployment manages **one** secret
rather than two — a second one is a second thing to forget, and forgetting it means
every user's second factor has to be reset. `TOTP_ENCRYPTION_KEY` overrides it.

**The consequence operators need told:** rotating `AUTH_SECRET` rotates this too,
and every stored TOTP secret becomes undecryptable. That is the safe direction — an
attacker with the old secret cannot read the new column — but a key rotation costs
one 2FA reset per enrolled user.

Nothing ever sends the secret to a browser except the enrollment response. A second
factor whose secret an administrator can read out of the database is a second
factor an attacker who reads the database can pass.

Confirmation checks the code against the **stored** secret rather than one the
caller supplies, so a stale QR cannot confirm a *different* secret than the one
that was scanned. There is a test for exactly that.

## Backup codes: hashed, and burned by removal

A plaintext recovery code in the user table is a second password for every account
using 2FA, which defeats the point of having one. So they are stored as SHA-256
digests — deliberately **not** bcrypt, unlike `password.ts`: these have 40 bits of
entropy so there is nothing to brute-force, and a slow KDF would make every sign-in
attempt wait on purpose.

Single-use is implemented as **removal from the stored list**, not a flag on it. A
flag leaves every spent hash in the row for ever, and "used" is better expressed as
the absence. A test asserts the spent hash is gone rather than marked.

## The policy requires, it does not grant

`security.require2fa` is a comma-separated list of roles. Two independent reasons
to owe a second factor — the user turned it on, or their role is listed — and an
**enrolment outranks both**. Turning a role on does not turn anybody's 2FA on; it
requires it, and the only way past an enabled factor stays a valid code. The
alternative would be a role change quietly removing somebody's second factor.

## Two decisions worth flagging

**`Users` is a new permission resource.** "Reset this user's 2FA" needed a gate
and there was nothing to gate on — staff accounts had no permission resource at
all. Adding one also silently handed **Account Managers** seven new permissions
through their blanket "everything except Settings" rule, which would have let a
billing role disable a colleague's MFA. The rule now excludes `Users` alongside
`Settings`.

**No QR image.** The setup screen shows the `otpauth://` URI and the base32 secret,
and every authenticator app has an "enter setup key" path. A QR would need a
renderer: `qrcode` drags in a PNG encoder and a CLI parser, or it would have to be
hand-rolled — and a QR that scans to the *wrong* secret is not a cosmetic bug, it
is a second factor that either locks a user out or is readable off a shared screen.
Hand-rolling could not be validated here (verifying a QR means decoding it), so the
text form was the honest choice.

## A note on `auth.ts` and testability

`auth.ts` opens with `import "server-only"`, which is right — its cookie helpers
belong on the server — and which also makes the whole file **untestable**: the
marker resolves to a module that throws outside a `react-server` bundle. Two
services here (`wallet.ts`, `corporate.ts`) already carry comments about working
around that. This phase applies the same workaround to sign-in: the **decision**
lives in `src/lib/services/two-factor.ts` with no cookie in it, and `auth.ts` keeps
the four lines that need `next/headers`.

Installing `server-only` as a dependency was tried first and makes it *worse*, not
better: outside a `react-server` condition it resolves to the module whose whole
purpose is to throw.

------------------------------------------------------------------------

## Final Requirement

The final UI must feel like **one unified ISP operating system**, not
disconnected CRUD pages.

Every module should link naturally to related records through detail
pages, tabs, actions and contextual navigation.
