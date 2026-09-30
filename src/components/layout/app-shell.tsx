"use client";

import * as React from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { PwaRegistration } from "./pwa-registration";
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
  // "1" = collapsed. The default is expanded: a first-time visitor landing on a
  // 64px icon rail with no labels reads as a broken sidebar.
  const [collapseFlag, setCollapseFlag] = useLocalStorage<string>(COLLAPSE_KEY, "0");
  const collapsed = collapseFlag === "1";

  const toggle = () => setCollapseFlag(collapsed ? "0" : "1");

  /** Used when a collapsed rail item is clicked, so the panel opens on it. */
  const expand = () => {
    if (collapsed) setCollapseFlag("0");
  };

  return (
    <div className="flex min-h-screen bg-[var(--surface-2)]">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggle}
        onExpand={expand}
        permissions={user.permissions}
        isAdmin={user.isAdmin}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        userName={user.name}
        userEmail={user.email}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} alerts={alerts} onOpenMobile={() => setMobileOpen(true)} />
        <main className={cn("min-w-0 flex-1")}>{children}</main>
        {/* Sits below the content rather than floating, so it cannot cover a
            row of a table on a small screen. */}
        <PwaRegistration />
      </div>
    </div>
  );
}
