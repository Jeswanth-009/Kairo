import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "violet"
  | "sky"
  | "green"
  | "amber"
  | "red"
  | "dawn";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-accent-soft text-muted border-line",
  blue: "bg-kairo-blue/10 text-kairo-blue border-kairo-blue/30 dark:bg-kairo-blue/15 dark:text-kairo-sky dark:border-kairo-blue/30",
  violet:
    "bg-kairo-violet/10 text-violet-700 border-kairo-violet/30 dark:bg-kairo-violet/15 dark:text-violet-300 dark:border-kairo-violet/30",
  sky: "bg-kairo-sky/25 text-sky-800 border-kairo-sky/40 dark:bg-kairo-sky/10 dark:text-kairo-sky dark:border-kairo-sky/30",
  green:
    "bg-ok/10 text-ok border-ok/30 dark:bg-ok/10 dark:text-emerald-300 dark:border-ok/30",
  amber:
    "bg-warn/10 text-warn border-warn/30 dark:bg-warn/10 dark:text-kairo-dawn dark:border-warn/30",
  red: "bg-bad/10 text-bad border-bad/30 dark:bg-bad/10 dark:text-red-300 dark:border-bad/30",
  dawn:
    "bg-kairo-dawn/25 text-amber-800 border-kairo-dawn/50 dark:bg-kairo-dawn/10 dark:text-kairo-dawn dark:border-kairo-dawn/30",
};

/** Tinted pill for statuses and kinds — the single source of pill styling. */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
