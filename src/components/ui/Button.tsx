import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
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
    "border border-slate-200 bg-white text-ink shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:-translate-y-px active:translate-y-0 focus-visible:ring-slate-400",
  ghost: "text-muted hover:bg-slate-100 hover:text-ink focus-visible:ring-slate-400",
  danger:
    "border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 hover:border-red-300 focus-visible:ring-red-400",
};

const SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
      {...rest}
    />
  );
}
