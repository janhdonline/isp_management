import {
  LayoutDashboard,
  Users,
  Package,
  Receipt,
  Network,
  LifeBuoy,
  MapPin,
  Wallet,
  Landmark,
  Briefcase,
  BarChart3,
  Bell,
  Settings,
  Boxes,
  Handshake,
  type LucideIcon,
} from "lucide-react";

export type NavChild = {
  label: string;
  href: string;
  /** Permission key required to see this entry. */
  permission?: string;
  badge?: string;
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  children?: NavChild[];
};

/** Sidebar structure follows ISP.md section 22 exactly. */
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "Customers",
    href: "/customers",
    icon: Users,
    permission: "customers.view",
    children: [
      { label: "Customer List", href: "/customers", permission: "customers.view" },
      { label: "New Customer", href: "/customers/new", permission: "customers.create" },
      { label: "Active", href: "/customers/status/active", permission: "customers.view" },
      { label: "Expiring Soon", href: "/customers/expiring", permission: "customers.view" },
      { label: "Expired", href: "/customers/status/expired", permission: "customers.view" },
      { label: "Due", href: "/customers/due", permission: "customers.view" },
      { label: "Online", href: "/customers/online", permission: "customers.view" },
      { label: "Offline", href: "/customers/offline", permission: "customers.view" },
      { label: "Suspended", href: "/customers/status/suspended", permission: "customers.view" },
      { label: "Disconnected", href: "/customers/status/disconnected", permission: "customers.view" },
    ],
  },
  {
    label: "Packages",
    href: "/packages",
    icon: Package,
    permission: "packages.view",
    children: [
      { label: "Package List", href: "/packages", permission: "packages.view" },
      { label: "Add Package", href: "/packages/new", permission: "packages.create" },
      { label: "Package Reports", href: "/packages/reports", permission: "packages.view" },
    ],
  },
  {
    label: "Billing",
    href: "/billing",
    icon: Receipt,
    permission: "billing.view",
    children: [
      { label: "Invoices", href: "/billing/invoices", permission: "billing.view" },
      { label: "New Invoice", href: "/billing/invoices/new", permission: "billing.create" },
      { label: "Payments", href: "/billing/payments", permission: "payments.view" },
      { label: "Collect Payment", href: "/billing/payments/new", permission: "payments.create" },
      { label: "Due", href: "/billing/due", permission: "billing.view" },
      { label: "Receipts", href: "/billing/receipts", permission: "billing.view" },
    ],
  },
  {
    label: "Network",
    href: "/network",
    icon: Network,
    permission: "network.view",
    children: [
      { label: "Overview", href: "/network", permission: "network.view" },
      { label: "Online Users", href: "/network/online", permission: "network.view" },
      { label: "Routers", href: "/network/routers", permission: "network.view" },
      { label: "OLT", href: "/network/olt", permission: "network.view" },
      { label: "ONU", href: "/network/onu", permission: "network.view" },
      { label: "Bandwidth", href: "/network/bandwidth", permission: "network.view" },
      { label: "Enforcement", href: "/network/enforcement", permission: "network.view" },
      { label: "RADIUS Live", href: "/network/radius", permission: "network.view" },
      { label: "Alerts", href: "/network/alerts", permission: "network.view" },
    ],
  },
  {
    label: "Support",
    href: "/support",
    icon: LifeBuoy,
    permission: "support.view",
    children: [
      { label: "Tickets", href: "/support/tickets", permission: "support.view" },
      { label: "Complaints", href: "/support/complaints", permission: "support.view" },
      { label: "Technicians", href: "/support/technicians", permission: "support.view" },
    ],
  },
  {
    label: "Areas",
    href: "/areas",
    icon: MapPin,
    permission: "areas.view",
    children: [
      { label: "Areas", href: "/areas", permission: "areas.view" },
      { label: "Zones", href: "/areas/zones", permission: "areas.view" },
      { label: "Coverage", href: "/areas/coverage", permission: "areas.view" },
    ],
  },
  {
    label: "Expenses",
    href: "/expenses",
    icon: Wallet,
    permission: "expenses.view",
    children: [
      { label: "Daily Expense", href: "/expenses", permission: "expenses.view" },
      { label: "New Expense", href: "/expenses/new", permission: "expenses.create" },
      { label: "History", href: "/expenses/history", permission: "expenses.view" },
    ],
  },
  {
    label: "Accounts",
    href: "/accounts",
    icon: Landmark,
    permission: "accounts.view",
    children: [
      { label: "Account List", href: "/accounts", permission: "accounts.view" },
      { label: "Transfer Fund", href: "/accounts/transfer", permission: "accounts.create" },
      { label: "Account History", href: "/accounts/history", permission: "accounts.view" },
    ],
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: Boxes,
    permission: "inventory.view",
    children: [
      { label: "Items", href: "/inventory", permission: "inventory.view" },
    ],
  },
  {
    label: "Resellers",
    href: "/resellers",
    icon: Handshake,
    permission: "resellers.view",
    children: [
      { label: "Resellers", href: "/resellers", permission: "resellers.view" },
      { label: "Commission", href: "/resellers/commission", permission: "resellers.view" },
    ],
  },
  {
    label: "Employees",
    href: "/employees",
    icon: Briefcase,
    permission: "employees.view",
    children: [
      { label: "Employees", href: "/employees", permission: "employees.view" },
      { label: "Attendance", href: "/employees/attendance", permission: "employees.view" },
      { label: "Leave", href: "/employees/leave", permission: "employees.view" },
      { label: "Salary", href: "/employees/salary", permission: "employees.view" },
    ],
  },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    permission: "reports.view",
    children: [
      { label: "Customer Reports", href: "/reports?tab=customers", permission: "reports.view" },
      { label: "Billing Reports", href: "/reports?tab=billing", permission: "reports.view" },
      { label: "Collection", href: "/reports?tab=collection", permission: "reports.view" },
      { label: "Due", href: "/reports?tab=due", permission: "reports.view" },
      { label: "Expense", href: "/reports?tab=expense", permission: "reports.view" },
      { label: "Profit & Loss", href: "/reports?tab=pnl", permission: "reports.view" },
      { label: "Network", href: "/reports?tab=network", permission: "reports.view" },
      { label: "Attendance", href: "/reports?tab=attendance", permission: "reports.view" },
    ],
  },
  {
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
    permission: "notifications.view",
    children: [
      { label: "SMS", href: "/notifications/sms", permission: "notifications.view" },
      { label: "Email", href: "/notifications/email", permission: "notifications.view" },
      { label: "Reminders", href: "/notifications/reminders", permission: "notifications.view" },
      { label: "History", href: "/notifications/history", permission: "notifications.view" },
    ],
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    permission: "settings.view",
    children: [
      { label: "General", href: "/settings", permission: "settings.view" },
      { label: "Billing", href: "/settings/billing", permission: "settings.view" },
      { label: "Network", href: "/settings/network", permission: "settings.view" },
      { label: "Users & Roles", href: "/settings/users", permission: "settings.view" },
      { label: "SMS / API", href: "/settings/api", permission: "settings.view" },
      { label: "Notifications", href: "/settings/notifications", permission: "settings.view" },
      { label: "Backup", href: "/settings/backup", permission: "settings.view" },
    ],
  },
];

/** Modules delivered in a later phase - rendered with a "Soon" badge. */
export const PHASE_2 = new Set([
  "/support",
  "/employees",
  "/notifications",
]);

export function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}
