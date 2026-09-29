"use client";

import { cn } from "@/lib/utils";
import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

const base =
  "neu-inset w-full rounded-full text-sm text-[var(--fg)] transition-shadow placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/25 disabled:cursor-not-allowed disabled:opacity-70";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(base, "h-9 px-3", invalid && "border-red-500 focus:border-red-500 focus:ring-red-500/25", className)}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  }
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        base,
        "min-h-20 px-3 py-2 leading-relaxed",
        invalid && "border-red-500 focus:border-red-500 focus:ring-red-500/25",
        className
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    options?: SelectOption[];
    placeholder?: string;
    invalid?: boolean;
  }
>(function Select({ className, options, placeholder, invalid, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          base,
          "h-9 appearance-none pl-3 pr-9",
          invalid && "border-red-500 focus:border-red-500 focus:ring-red-500/25",
          className
        )}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
    </div>
  );
});

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded border-[var(--border-strong)] text-brand-600 accent-brand-600 focus:ring-2 focus:ring-brand-500/30",
        className
      )}
      {...props}
    />
  );
}

export function Switch({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5", className)}>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          className="peer sr-only"
          {...props}
        />
        <span className="h-5 w-9 rounded-full bg-[var(--border-strong)] transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="text-sm text-[var(--fg)]">{props["aria-label"] ? null : null}</span>
    </label>
  );
}

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn("text-xs font-medium text-[var(--fg)] sm:text-[13px]", className)}
      {...props}
    >
      {children}
      {required ? <span className="ml-0.5 text-red-500">*</span> : null}
    </label>
  );
}

/** Label + control + hint + error, the single form primitive (ISP.md §17). */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      ) : null}
      {children}
      {error ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  icon,
  children,
  columns = 2,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
        {icon ? <span className="text-fg-subtle [&_svg]:size-4">{icon}</span> : null}
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
        </div>
      </div>
      <div
        className={cn(
          "grid gap-4",
          columns === 1 && "grid-cols-1",
          columns === 2 && "grid-cols-1 sm:grid-cols-2",
          columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Small visual toggle group used for segment switches inside forms. */
export function SegmentedControl({
  value,
  onValueChange,
  options,
  name,
}: {
  value: string;
  onValueChange?: (v: string) => void;
  options: { value: string; label: string }[];
  name: string;
}) {
  return (
    <div className="neu-inset inline-flex rounded-full p-1">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-all",
            value === o.value
              ? "neu-gradient text-white shadow-[3px_3px_8px_var(--neu-dark),-3px_-3px_8px_var(--neu-light)]"
              : "text-fg-muted hover:text-[var(--fg)]"
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onValueChange?.(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export { Check };
