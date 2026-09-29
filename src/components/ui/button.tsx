import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

const buttonVariants = cva(
  "neu-press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "neu-gradient text-white shadow-[4px_4px_10px_var(--neu-dark),-4px_-4px_10px_var(--neu-light)] hover:brightness-105",
        secondary: "neu-sm bg-[var(--neu-bg)] text-[var(--fg)]",
        outline: "neu-inset text-[var(--fg)]",
        ghost: "text-[var(--fg-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]",
        danger: "bg-gradient-to-br from-rose-400 to-red-500 text-white shadow-[4px_4px_10px_var(--neu-dark),-4px_-4px_10px_var(--neu-light)] hover:brightness-105",
        "danger-outline": "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950",
        success: "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-[4px_4px_10px_var(--neu-dark),-4px_-4px_10px_var(--neu-light)] hover:brightness-105",
        link: "text-brand-600 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "h-9 px-3.5",
        lg: "h-11 px-5",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
    /** Rendered before the label. */
    icon?: React.ReactNode;
  };

export function Button({
  className,
  variant,
  size,
  loading,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export { buttonVariants };
