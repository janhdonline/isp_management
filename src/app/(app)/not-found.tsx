import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-[var(--surface-3)] text-fg-subtle">
        <FileQuestion className="size-6" />
      </span>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        The page you are looking for does not exist or you do not have permission to view it.
      </p>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-medium text-white"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
