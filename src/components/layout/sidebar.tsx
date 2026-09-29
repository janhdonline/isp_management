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
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onExpand: () => void;
  permissions: string[];
  isAdmin: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
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
          "fixed inset-y-0 left-0 z-50 flex max-lg:w-64 flex-col bg-sidebar text-sidebar-fg",
          "transition-[width,transform] duration-200 lg:static lg:translate-x-0",
          collapsed ? "lg:w-16" : "lg:w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center gap-2.5 px-4",
            collapsed && "lg:justify-center lg:px-2"
          )}
        >
          <span className="neu-gradient flex size-8 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-[3px_3px_8px_rgba(0,0,0,0.35)]">
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
              "hidden size-7 shrink-0 items-center justify-center rounded-md text-sidebar-fg/60",
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

        <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2 pb-4">
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
                    "group flex items-center rounded-xl transition-all",
                    active
                      ? "neu-gradient text-white shadow-[3px_3px_10px_rgba(0,0,0,0.35)]"
                      : isUnder
                        ? "text-sidebar-active"
                        : "text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-active"
                  )}
                >
                  <Link
                    href={item.href}
                    onClick={handleItemClick}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium",
                      !hasChildren && "pr-2.5"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className="size-4.5 shrink-0" />
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
                  <div className="ml-4 space-y-0.5 border-l border-sidebar-fg/15 pl-2.5 pt-1">
                    {children.map((child) => {
                      const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href + child.label}
                          href={child.href}
                          onClick={onCloseMobile}
                          className={cn(
                            "block truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-all",
                            childActive
                              ? "neu-gradient font-medium text-white"
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
