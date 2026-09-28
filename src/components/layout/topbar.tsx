"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/providers";
import {
  Bell,
  LogOut,
  Menu,
  Moon,
  Plus,
  Sun,
  UserCog,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";
import { GlobalSearch } from "./global-search";
import { DropdownMenu, type MenuItem } from "@/components/ui/dropdown";
import { Avatar } from "./avatar";

export function Topbar({
  user,
  onOpenMobile,
  alerts,
}: {
  user: SessionUser;
  onOpenMobile: () => void;
  alerts: { expiringToday: number; expired: number; suspended: number; openTickets: number; totalDue: number };
}) {
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  const quickActions: MenuItem[] = [
    { label: "New Customer", onSelect: () => router.push("/customers/new") },
    { label: "Collect Payment", onSelect: () => router.push("/billing/payments/new") },
    { label: "Create Invoice", onSelect: () => router.push("/billing/invoices/new") },
    { label: "Add Package", onSelect: () => router.push("/packages/new") },
    { label: "New Ticket", onSelect: () => router.push("/support/tickets") },
    { label: "Add Expense", onSelect: () => router.push("/expenses/new") },
  ];

  const userMenu: (MenuItem | "separator")[] = [
    { label: "My Profile", icon: <UserCog />, onSelect: () => router.push("/settings/users") },
    { label: "Settings", onSelect: () => router.push("/settings") },
    "separator",
    {
      label: "Sign out",
      icon: <LogOut />,
      danger: true,
      onSelect: async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      },
    },
  ];

  const notificationCount = alerts.expiringToday + alerts.expired + alerts.openTickets;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 sm:px-4">
      <button
        onClick={onOpenMobile}
        aria-label="Open menu"
        className="flex size-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-[var(--surface-3)] lg:hidden"
      >
        <Menu className="size-5" />
      </button>

      <div className="hidden items-center gap-2 lg:flex">
        <span className="text-sm font-semibold">ISP Management</span>
      </div>

      <div className="mx-2 hidden min-w-0 max-w-md flex-1 md:block">
        <GlobalSearch
          value={query}
          onChange={setQuery}
          onSubmit={(q) => {
            router.push(`/customers?q=${encodeURIComponent(q)}`);
            setQuery("");
          }}
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu
          align="right"
          items={quickActions}
          buttonClassName="hidden h-9 w-auto gap-1.5 px-2.5 sm:flex"
          trigger={
            <>
              <Plus className="size-4" />
              <span className="text-sm font-medium">Quick Add</span>
            </>
          }
        />

        <DropdownMenu
          align="right"
          className="relative"
          items={[
            { label: `Expiring today: ${alerts.expiringToday}`, onSelect: () => router.push("/customers/expiring") },
            { label: `Expired: ${alerts.expired}`, onSelect: () => router.push("/customers/status/expired") },
            { label: `Due total`, onSelect: () => router.push("/customers/due") },
            { label: `Suspended: ${alerts.suspended}`, onSelect: () => router.push("/customers/status/suspended") },
            { label: `Open tickets: ${alerts.openTickets}`, onSelect: () => router.push("/support/tickets") },
          ]}
          buttonClassName="relative size-9"
          trigger={<Bell className="size-4.5" />}
        />
        {notificationCount > 0 ? (
          <span className="pointer-events-none absolute right-1.5 top-1.5 flex size-2 rounded-full bg-red-500 ring-2 ring-[var(--surface)]" />
        ) : null}

        <button
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="flex size-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-[var(--surface-3)]"
        >
          {theme === "dark" ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
        </button>

        <div className="mx-1 h-6 w-px bg-[var(--border)]" />

        <DropdownMenu
          align="right"
          items={userMenu}
          buttonClassName="h-9 w-auto gap-2 px-1.5"
          trigger={
            <>
              <Avatar name={user.name} className="size-7" />
              <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
              <svg viewBox="0 0 24 24" className="size-3.5 text-fg-subtle" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </>
          }
        />
      </div>
    </header>
  );
}
