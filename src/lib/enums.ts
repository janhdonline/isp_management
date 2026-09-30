/**
 * Central status / option definitions.
 * SQLite has no native enums, so these lists are the single source of truth
 * for both the database values and the UI filter dropdowns.
 * Mirrors ISP.md section 15 (Common Status System).
 */

// --- Connection status (independent from billing status) ---
export const CONNECTION_STATUSES = [
  "Active",
  "Pending",
  "Suspended",
  "Disconnected",
  "Archived",
] as const;

// --- Online (network session) status ---
export const ONLINE_STATUSES = ["Online", "Offline"] as const;

// --- Billing status ---
export const BILLING_STATUSES = ["Unpaid", "Partial", "Paid", "Overdue"] as const;

// --- Derived lifecycle badge used in list columns ---
export type LifecycleStatus =
  | "Active"
  | "Expiring Soon"
  | "Expired"
  | "Suspended"
  | "Disconnected"
  | "Pending";

export const LIFECYCLE_STATUSES: LifecycleStatus[] = [
  "Active",
  "Expiring Soon",
  "Expired",
  "Suspended",
  "Disconnected",
  "Pending",
];

// --- Invoice status ---
export const INVOICE_STATUSES = [
  "Paid",
  "Partial",
  "Due",
  "Overdue",
  "Cancelled",
] as const;

// --- Payment methods ---
export const PAYMENT_METHODS = [
  "Cash",
  "bKash",
  "Nagad",
  "Rocket",
  "Bank",
  "Card",
  "Online",
] as const;

export const PAYMENT_METHOD_ACCOUNT_TYPE: Record<string, string> = {
  Cash: "Cash",
  bKash: "bKash",
  Nagad: "Nagad",
  Rocket: "Other",
  Bank: "Bank",
  Card: "Card",
  Online: "Other",
};

// --- Account types ---
export const ACCOUNT_TYPES = [
  "Cash",
  "Bank",
  "bKash",
  "Nagad",
  "Rocket",
  "Card",
  "Other",
] as const;

// --- Expense categories ---
export const EXPENSE_CATEGORIES = [
  "Network Equipment",
  "Bandwidth Purchase",
  "Salary",
  "Utility Bill",
  "Rent",
  "Maintenance",
  "Marketing",
  "Transport",
  "Office Supplies",
  "Tax & License",
  "Installation",
  "Other",
] as const;

// --- Ticket ---
export const TICKET_STATUSES = [
  "Open",
  "Pending",
  "In Progress",
  "Resolved",
  "Closed",
] as const;

export const TICKET_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;

export const COMPLAINT_CATEGORIES = [
  "No Internet",
  "Slow Internet",
  "Router Problem",
  "ONU Problem",
  "Cable Problem",
  "Payment Problem",
  "Package Problem",
  "Other",
] as const;

// --- Network device status ---
export const DEVICE_STATUSES = ["Online", "Offline", "Low Signal", "Unknown"] as const;

export const BILLING_CYCLES = ["Weekly", "Bi-weekly", "Monthly", "Quarterly", "Yearly"] as const;

export const CUSTOMER_TYPES = ["Home", "Business", "Corporate", "Bulk", "Free"] as const;

export const CONNECTION_TYPES = ["PPPoE", "Static IP", "DHCP", "Hotspot", "Leased Line"] as const;

export const IP_TYPES = ["Dynamic", "Static"] as const;

export const GENDERS = ["Male", "Female", "Other"] as const;

export const NOTIFICATION_CHANNELS = ["SMS", "Email", "WhatsApp"] as const;

export const NOTIFICATION_STATUSES = [
  "Scheduled",
  "Sending",
  "Sent",
  "Failed",
  "Pending",
] as const;

export const EMPLOYEE_STATUSES = ["Active", "On Leave", "Inactive"] as const;

export const ATTENDANCE_STATUSES = ["Present", "Absent", "Late", "Leave"] as const;

export const LEAVE_STATUSES = ["Pending", "Approved", "Rejected"] as const;

export const TRANSACTION_TYPES = [
  "Payment",
  "Expense",
  "Transfer",
  "Refund",
  "Adjustment",
] as const;

// --- Inventory ---
//
// These live here rather than in the inventory service because a client component
// needs them: a service module also imports Prisma, and importing one from the
// browser drags the database driver into the bundle and breaks the build.

export const INVENTORY_CATEGORIES = [
  "ONU",
  "Router",
  "Cable",
  "Splitter",
  "Connector",
  "Other",
] as const;

export const STOCK_MOVEMENT_TYPES = ["IN", "OUT", "ADJUST"] as const;

export const PERMISSION_RESOURCES = [
  "Customers",
  "Packages",
  "Billing",
  "Payments",
  "Network",
  "Support",
  "Areas",
  "Expenses",
  "Accounts",
  "Inventory",
  "Employees",
  "Reports",
  "Notifications",
  "Settings",
] as const;

export const PERMISSION_ACTIONS = [
  "View",
  "Create",
  "Edit",
  "Delete",
  "Export",
  "Approve",
] as const;

/** Tailwind class map for status badges. */
export const STATUS_STYLES: Record<string, string> = {
  // connection
  Active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Pending: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
  Suspended: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400",
  Disconnected: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300",
  Archived: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400",
  // online
  Online: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Offline: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400",
  "Low Signal": "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-400",
  Unknown: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400",
  // billing
  Paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Unpaid: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Partial: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
  Due: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Overdue: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Cancelled: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400",
  "Expiring Soon": "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
  Expired: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  // ticket
  Open: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400",
  "In Progress": "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400",
  Resolved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Closed: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400",
  // priority
  Low: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-400",
  Medium: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400",
  High: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
  Critical: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Failed: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Sent: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Scheduled: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-400",
  Sending: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400",
  Completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Rejected: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Absent: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400",
  Late: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400",
  Leave: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-400",
  Present: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400",
  Refunded: "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-400",
};

export function statusClass(status?: string | null): string {
  if (!status) return STATUS_STYLES.Unknown;
  return STATUS_STYLES[status] ?? STATUS_STYLES.Unknown;
}
