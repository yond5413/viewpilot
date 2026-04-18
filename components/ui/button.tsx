import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-[var(--foreground)] text-white shadow-sm hover:bg-black",
  destructive:
    "bg-[var(--danger)] text-white shadow-sm hover:opacity-90",
  outline:
    "border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--accent-soft)]",
  secondary:
    "bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90",
  ghost:
    "bg-transparent text-[var(--foreground)] hover:bg-[var(--accent-soft)]",
  link: "bg-transparent px-0 text-[var(--accent)] underline-offset-4 hover:underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 px-3 text-xs",
  lg: "h-10 px-5 text-sm",
  icon: "h-9 w-9 p-0",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button };
