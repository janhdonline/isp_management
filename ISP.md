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

## Final Requirement

The final UI must feel like **one unified ISP operating system**, not
disconnected CRUD pages.

Every module should link naturally to related records through detail
pages, tabs, actions and contextual navigation.
