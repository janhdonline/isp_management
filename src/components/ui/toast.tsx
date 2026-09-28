"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";

export type ToastVariant = "success" | "error" | "info" | "warning";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

export type ToastItem = ToastInput & { id: string };

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />,
  error: <AlertCircle className="size-4 text-red-600 dark:text-red-400" />,
  info: <Info className="size-4 text-sky-600 dark:text-sky-400" />,
  warning: <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />,
};

const BORDERS: Record<ToastVariant, string> = {
  success: "border-l-emerald-500",
  error: "border-l-red-500",
  info: "border-l-sky-500",
  warning: "border-l-amber-500",
};

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  theme?: string;
  onToggleTheme?: () => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => {
        const variant = t.variant ?? "info";
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "animate-slide-in pointer-events-auto flex items-start gap-3 rounded-lg border border-[var(--border)] border-l-4 bg-[var(--surface)] p-3 shadow-lg",
              BORDERS[variant]
            )}
          >
            <span className="mt-0.5">{ICONS[variant]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--fg)]">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{t.description}</p>
              ) : null}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Dismiss"
              className="rounded p-0.5 text-fg-subtle transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
