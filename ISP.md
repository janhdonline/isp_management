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
│   └── Bandwidth
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
│   └── Attendance Reports
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

## Final Requirement

The final UI must feel like **one unified ISP operating system**, not
disconnected CRUD pages.

Every module should link naturally to related records through detail
pages, tabs, actions and contextual navigation.
