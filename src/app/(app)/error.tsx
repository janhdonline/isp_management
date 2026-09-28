"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
        <AlertTriangle className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-fg-muted">
        The page could not be loaded. This has been logged — try again, and contact an administrator
        if it keeps happening.
      </p>
      {error.digest ? (
        <p className="font-mono text-[11px] text-fg-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => retry()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white transition-colors hover:bg-brand-700"
        >
          <RefreshCcw className="size-4" /> Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-strong)] px-3 text-sm font-medium hover:bg-[var(--surface-3)]"
        >
          <Home className="size-4" /> Dashboard
        </Link>
      </div>
    </div>
  );
}
