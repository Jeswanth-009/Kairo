import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Tone = "neutral" | "danger";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required, icon-only buttons have no visible text. */
  label: string;
  tone?: Tone;
  size?: "sm" | "md";
}

const TONES: Record<Tone, string> = {
  neutral:
    "border border-line bg-card text-muted hover:text-ink hover:border-line-strong hover:bg-accent-soft focus-visible:ring-slate-400",
  danger:
    "border border-transparent bg-card text-muted hover:text-bad dark:hover:text-red-400 hover:border-bad/25 dark:hover:border-red-500/30 hover:bg-bad-soft dark:hover:bg-bad/10 focus-visible:ring-red-400",
};

const SIZES = {
  sm: "h-7 w-7 [&_svg]:size-3.5",
  md: "h-8 w-8 [&_svg]:size-4",
};

/** Icon-only button; pass the lucide icon as a child. */
export function IconButton({
  label,
  tone = "neutral",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg shadow-sm",
        "transition-all duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
        "disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
