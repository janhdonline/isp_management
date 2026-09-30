import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-2)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-gold-500 text-pine-950 shadow-md hover:bg-gold-600 hover:shadow-lg",
        secondary: "bg-[var(--surface)] text-[var(--fg)] shadow-sm hover:shadow",
        outline: "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--fg)] hover:border-gold-500",
        ghost: "text-[var(--fg-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]",
        danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
        "danger-outline": "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950",
        success: "bg-pine-700 text-white hover:bg-pine-800 shadow-sm",
        link: "text-gold-700 underline-offset-4 hover:underline dark:text-gold-400",
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
