"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";

type Hit = {
  id: string;
  type: "Customer" | "Package" | "Invoice" | "Ticket" | "Area";
  title: string;
  subtitle: string;
  href: string;
};

export function GlobalSearch({
  value,
  onChange,
  onSubmit,
  placeholder = "Search customer, username, phone, invoice, IP, ticket...",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (q: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [pending, startTransition] = useTransition();
  const ref = React.useRef<HTMLDivElement>(null);
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        ref.current?.querySelector("input")?.focus();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // debounced lookup against the server search endpoint
  React.useEffect(() => {
    const term = value.trim();
    // Nothing to look up — the results panel is hidden by the render guard
    // below, so there is no need to touch state here.
    if (term.length < 2) {
      if (timer.current) window.clearTimeout(timer.current);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (res.ok) setHits((await res.json()).hits ?? []);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 280);
    timer.current = t;
    return () => window.clearTimeout(t);
  }, [value]);

  const go = (href: string) => {
    setOpen(false);
    onChange("");
    startTransition(() => router.push(href));
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            setOpen(false);
            if (onSubmit) onSubmit(value.trim());
            else startTransition(() => router.push(`/customers?q=${encodeURIComponent(value.trim())}`));
            onChange("");
          }
          if (e.key === "Escape") {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-full border border-transparent bg-[var(--surface)] pl-10 pr-16 text-sm text-[var(--fg)] shadow-md placeholder:text-fg-subtle focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-500/25"
      />
      {value ? (
        <button
          onClick={() => onChange("")}
          aria-label="Clear"
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-fg-subtle hover:bg-[var(--surface-3)]"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle sm:block">
          ⌘K
        </kbd>
      )}

      {open && value.trim().length >= 2 ? (
        <div className="animate-in-up absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl">
          {loading ? (
            <p className="px-3 py-4 text-center text-xs text-fg-muted">Searching...</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-fg-muted">
              No matches for “{value}”
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((hit) => (
                <li key={`${hit.type}-${hit.id}`}>
                  <button
                    onClick={() => go(hit.href)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-3)]"
                  >
                    <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
                      {hit.type}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-[var(--fg)]">{hit.title}</span>
                      <span className="block truncate text-xs text-fg-muted">{hit.subtitle}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {pending ? <span className="sr-only">Navigating</span> : null}
    </div>
  );
}
