import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
  size?: "sm" | "md";
}

const VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: [
    "text-white bg-gradient-to-br from-kairo-blue to-kairo-violet",
    "shadow-sm shadow-kairo-blue/30 ring-1 ring-kairo-blue/40",
    "hover:brightness-110 hover:shadow-md hover:shadow-kairo-blue/30 hover:-translate-y-px",
    "active:translate-y-0 active:brightness-95",
    "focus-visible:ring-kairo-blue",
  ].join(" "),
  secondary:
    "border border-line bg-card text-ink shadow-sm hover:border-line-strong hover:bg-accent-soft hover:-translate-y-px active:translate-y-0 focus-visible:ring-kairo-blue/50",
  ghost: "text-muted hover:bg-accent-soft hover:text-ink focus-visible:ring-kairo-blue/50",
  danger:
    "text-white bg-bad shadow-sm ring-1 ring-bad/40 hover:bg-bad hover:-translate-y-px active:translate-y-0 focus-visible:ring-bad",
  "danger-outline":
    "border border-bad/25 bg-card text-bad shadow-sm hover:bg-bad/5 hover:border-bad/40 dark:border-bad/30 dark:text-red-400 dark:hover:bg-bad/10 focus-visible:ring-bad",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
