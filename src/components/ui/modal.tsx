"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useIsMounted } from "@/lib/client-state";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  icon?: React.ReactNode;
}) {
  const mounted = useIsMounted();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    "2xl": "max-w-6xl",
  } as const;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "animate-in-up relative z-10 flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:rounded-2xl",
          sizes[size]
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              {icon ? <span className="mt-0.5 text-fg-subtle [&_svg]:size-5">{icon}</span> : null}
              <div className="min-w-0">
                {title ? <h2 className="text-base font-semibold text-[var(--fg)]">{title}</h2> : null}
                {description ? (
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">{description}</p>
                ) : null}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-fg-subtle transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/** Destructive confirmation used by every delete / suspend action (ISP.md §18). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-[var(--border-strong)] px-3.5 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-3)]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "h-9 rounded-lg px-3.5 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-60",
              variant === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
            )}
          >
            {loading ? "Working..." : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-fg-muted">
        {description ?? "This action cannot be undone."}
      </p>
    </Modal>
  );
}
