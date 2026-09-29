"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { MoreHorizontal } from "lucide-react";

export type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};

export function DropdownMenu({
  items,
  align = "right",
  trigger,
  className,
  buttonClassName,
}: {
  items: (MenuItem | "separator")[];
  align?: "left" | "right";
  trigger?: React.ReactNode;
  className?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "neu-sm neu-press flex size-8 items-center justify-center rounded-full text-fg-muted hover:text-[var(--fg)]",
          buttonClassName
        )}
      >
        {trigger ?? <MoreHorizontal className="size-4" />}
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "animate-in-up absolute z-40 mt-1 min-w-48 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} className="my-1 h-px bg-[var(--border)]" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50",
                  item.danger
                    ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    : "text-[var(--fg)] hover:bg-[var(--surface-3)]"
                )}
              >
                {item.icon ? <span className="[&_svg]:size-4 text-fg-subtle">{item.icon}</span> : null}
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
