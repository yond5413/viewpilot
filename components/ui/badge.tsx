import * as React from "react";

import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "border-transparent bg-[var(--foreground)] text-white",
  secondary: "border-transparent bg-[var(--accent-soft)] text-[var(--accent)]",
  destructive: "border-transparent bg-[var(--danger)] text-white",
  outline: "border-[var(--border)] bg-white text-[var(--foreground)]",
};

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
