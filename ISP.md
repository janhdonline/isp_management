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

## Final Requirement

The final UI must feel like **one unified ISP operating system**, not
disconnected CRUD pages.

Every module should link naturally to related records through detail
pages, tabs, actions and contextual navigation.
