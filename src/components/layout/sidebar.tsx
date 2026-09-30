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
  onExpand,
  permissions,
  isAdmin,
  mobileOpen,
  onCloseMobile,
  userName,
  userEmail,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onExpand: () => void;
  permissions: string[];
  isAdmin: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  userName?: string;
  userEmail?: string;
}) {
  const pathname = usePathname();

  /** The section that owns a pathname, or null on a page that has no section. */
  const sectionFor = (path: string) =>
    NAV.find((n) => n.children && isActivePath(path, n.href))?.href ?? null;

  /**
   * Which section's submenu is open. An accordion: at most one at a time, so a
   * menu with eleven sections does not turn into a wall of links.
   *
   * Navigation opens the right section on its own, so a section never has to be
   * reopened by hand after following a link into it. The state is seeded from
   * the current route as well, so opening a deep link directly — a bookmark, a
   * refresh, a shared URL — lands with its own section already open.
   */
  const [openSection, setOpenSection] = React.useState<string | null>(() =>
    sectionFor(pathname)
  );
  const [lastPath, setLastPath] = React.useState(pathname);

  // Derive from the route rather than an effect: adjusting state during render
  // is React's recommended way to reset on a changed input, and it avoids a
  // frame where the submenu still shows the previous page's section.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpenSection(sectionFor(pathname));
  }

  const toggleSection = (href: string) =>
    setOpenSection((prev) => (prev === href ? null : href));

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
          "fixed inset-y-0 left-0 z-50 flex max-lg:w-72 flex-col bg-sidebar text-sidebar-fg shadow-2xl",
          "transition-[width,transform,border-radius,margin] duration-300 ease-out lg:static lg:translate-x-0",
          "max-lg:rounded-r-[1.75rem]",
          collapsed ? "lg:w-20" : "lg:w-68",
          // Floating rounded panel on desktop, like the mockup
          "lg:my-3 lg:ml-3 lg:max-h-[calc(100vh-1.5rem)] lg:rounded-[1.75rem]",
          collapsed && "lg:items-center",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center gap-2.5 px-4 pt-1",
            collapsed && "lg:justify-center lg:px-2"
          )}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-gold-500 text-base font-bold text-pine-950 shadow-sm">
            N
          </span>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-active">NetLink</p>
              <p className="truncate text-[10px] uppercase tracking-wider text-sidebar-fg/60">ISP Manager</p>
            </div>
          ) : null}

          {/* The toggle lives in the header, where it is actually visible —
              at the very bottom of a scrollable list it reads as decoration. */}
          <button
            onClick={onToggleCollapse}
            className={cn(
              "hidden size-7 shrink-0 items-center justify-center rounded-full text-sidebar-fg/60",
              "transition-colors hover:bg-sidebar-hover hover:text-sidebar-active",
              "lg:flex",
              !collapsed && "ml-auto"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronsRight className="size-4" />
            ) : (
              <ChevronsLeft className="size-4" />
            )}
          </button>
        </div>

        {/* Profile card, like the mockup */}
        {!collapsed && userName ? (
          <div className="mx-3 mb-2 flex shrink-0 items-center gap-3 rounded-2xl bg-white/5 px-3 py-2.5 ring-1 ring-inset ring-white/10">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-500/20 text-sm font-semibold text-gold-300 ring-2 ring-gold-500/60">
              {userName.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-sidebar-active">{userName}</p>
              {userEmail ? (
                <p className="truncate text-[11px] text-sidebar-fg/60">{userEmail}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
          {visible.map((item) => {
            const isUnder = isActivePath(pathname, item.href);
            // A parent that merely contains the current page should not wear the
            // same strong highlight as the child that is actually open.
            const active = isUnder && pathname === item.href;
            const isOpen = openSection === item.href;
            const Icon = item.icon;
            const children = item.children?.filter(
              (c) => !c.permission || hasPermission(permissions, c.permission, isAdmin)
            );

            const hasChildren = !!children && children.length > 0;

            // A collapsed rail has nowhere to show a submenu, so clicking a
            // section there expands the panel and opens that section. Without
            // this the icon is a dead end: it navigates to the section root and
            // the sub-items can never be reached.
            const handleItemClick = () => {
              onCloseMobile();
              if (!collapsed) return;
              onExpand();
              if (hasChildren) setOpenSection(item.href);
            };

            return (
              <div key={item.href}>
                <div
                  className={cn(
                    "group flex items-center transition-all duration-200",
                    active &&
                      (collapsed
                        ? "rounded-full bg-sidebar-active text-pine-900"
                        : "-mr-3 rounded-l-full bg-sidebar-active text-pine-900"),
                    !active &&
                      (isUnder
                        ? "rounded-full text-sidebar-active"
                        : "rounded-full text-sidebar-fg/80 hover:bg-sidebar-hover hover:text-sidebar-active")
                  )}
                >
                  <Link
                    href={item.href}
                    onClick={handleItemClick}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2.5 rounded-full px-3 text-sm font-medium",
                      active ? "py-[18px]" : "py-2",
                      !hasChildren && "pr-3",
                      collapsed && "lg:justify-center lg:px-0"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className={cn("size-4.5 shrink-0", active ? "text-pine-900" : "text-gold-400/90")} />
                    {!collapsed ? <span className="flex-1 truncate">{item.label}</span> : null}
                  </Link>

                  {/* A sibling of the link, not a child: a button inside an
                      anchor is invalid HTML and React warns about it. */}
                  {hasChildren && !collapsed ? (
                    <button
                      aria-label={`Toggle ${item.label} submenu`}
                      aria-expanded={isOpen}
                      onClick={() => toggleSection(item.href)}
                      className="mr-2 shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className={cn(
                          "size-3.5 transition-transform",
                          isOpen && "rotate-180"
                        )}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  ) : null}
                </div>

                {hasChildren && isOpen && !collapsed ? (
                  <div className="ml-5 space-y-0.5 border-l border-gold-400/25 pl-3 pt-1">
                    {children.map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href + child.label}
                          href={child.href}
                          onClick={onCloseMobile}
                          className={cn(
                            "block truncate rounded-full px-3 py-1.5 text-[13px] transition-colors",
                            childActive
                              ? "bg-gold-500 font-medium text-pine-950 shadow-sm"
                              : "text-sidebar-fg/75 hover:bg-sidebar-hover hover:text-sidebar-active"
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
      </aside>
    </>
  );
}
