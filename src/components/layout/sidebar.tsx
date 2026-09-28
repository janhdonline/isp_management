"use client";

import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { NAV, isActivePath } from "@/lib/nav";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

export function Sidebar({
  collapsed,
  onToggleCollapse,
  permissions,
  isAdmin,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  permissions: string[];
  isAdmin: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = React.useState<string[]>([]);
  const [lastPath, setLastPath] = React.useState(pathname);

  // Derive from the route: keep the active section open when navigation
  // happens. Adjusting state during render is React's recommended alternative
  // to syncing it from an effect.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    const active = NAV.find((n) => n.children && isActivePath(pathname, n.href));
    if (active && !expanded.includes(active.href)) {
      setExpanded((prev) => [...prev, active.href]);
    }
  }

  const visible = NAV.filter((n) => !n.permission || hasPermission(permissions, n.permission, isAdmin));

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-fg transition-[width,transform] duration-200 lg:static lg:translate-x-0",
          collapsed ? "lg:w-16" : "lg:w-64",
          "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-2.5 px-4", collapsed && "lg:justify-center lg:px-2")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            N
          </span>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-active">NetLink</p>
              <p className="truncate text-[10px] uppercase tracking-wider text-sidebar-fg/60">ISP Manager</p>
            </div>
          ) : null}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 pb-4">
          {visible.map((item) => {
            const active = isActivePath(pathname, item.href);
            const isOpen = expanded.includes(item.href);
            const Icon = item.icon;
            const children = item.children?.filter(
              (c) => !c.permission || hasPermission(permissions, c.permission, isAdmin)
            );

            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  onClick={onCloseMobile}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-600 text-white shadow-sm"
                      : "text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-active"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="size-4.5 shrink-0" />
                  {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                  {children && children.length > 0 && !collapsed ? (
                    <button
                      aria-label={`Toggle ${item.label} submenu`}
                      onClick={(e) => {
                        e.preventDefault();
                        setExpanded((prev) =>
                          prev.includes(item.href)
                            ? prev.filter((x) => x !== item.href)
                            : [...prev, item.href]
                        );
                      }}
                      className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                    >
                      <svg viewBox="0 0 24 24" className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  ) : null}
                </Link>

                {children && children.length > 0 && isOpen && !collapsed ? (
                  <div className="ml-4 space-y-0.5 border-l border-sidebar-fg/15 pl-2.5 pt-1">
                    {children.map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href + child.label}
                          href={child.href}
                          onClick={onCloseMobile}
                          className={cn(
                            "block truncate rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                            childActive
                              ? "bg-sidebar-hover font-medium text-sidebar-active"
                              : "text-sidebar-fg/75 hover:text-sidebar-active"
                          )}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <button
          onClick={onToggleCollapse}
          className="hidden h-11 shrink-0 items-center justify-center border-t border-sidebar-fg/10 text-sidebar-fg/60 transition-colors hover:bg-sidebar-hover hover:text-sidebar-active lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </button>
      </aside>
    </>
  );
}
