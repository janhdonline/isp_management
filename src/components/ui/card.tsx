import { cn } from "@/lib/utils";
import * as React from "react";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] shadow-xs",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  title,
  description,
  action,
  icon,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className="text-fg-subtle [&_svg]:size-4">{icon}</span> : null}
        <div className="min-w-0">
          {title ? (
            <h3 className="truncate text-sm font-semibold text-[var(--fg)]">{title}</h3>
          ) : null}
          {description ? (
            <p className="mt-0.5 truncate text-xs text-fg-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 sm:p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5",
        className
      )}
      {...props}
    />
  );
}
