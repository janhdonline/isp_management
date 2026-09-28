"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/lib/client-state";
import type { SessionUser } from "@/lib/auth";

const COLLAPSE_KEY = "isp-sidebar-collapsed";

export function AppShell({
  user,
  alerts,
  children,
}: {
  user: SessionUser;
  alerts: { expiringToday: number; expired: number; suspended: number; openTickets: number; totalDue: number };
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapseFlag, setCollapseFlag] = useLocalStorage<string>(COLLAPSE_KEY, "1");
  const collapsed = collapseFlag === "1";

  const toggle = () => setCollapseFlag(collapsed ? "0" : "1");

  return (
    <div className="flex min-h-screen bg-[var(--surface-2)]">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggle}
        permissions={user.permissions}
        isAdmin={user.isAdmin}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} alerts={alerts} onOpenMobile={() => setMobileOpen(true)} />
        <main className={cn("min-w-0 flex-1")}>{children}</main>
      </div>
    </div>
  );
}
