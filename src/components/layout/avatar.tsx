import { cn, initials } from "@/lib/utils";
import * as React from "react";

const PALETTE = [
  "bg-brand-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-indigo-600",
  "bg-teal-600",
];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({
  name,
  className,
  size = "md",
}: {
  name: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = {
    sm: "size-7 text-[11px]",
    md: "size-9 text-xs",
    lg: "size-12 text-sm",
    xl: "size-16 text-lg",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase text-white",
        colorFor(name),
        sizes[size],
        className
      )}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
