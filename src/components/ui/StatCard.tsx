import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}

/** Compact stat tile used on the Dashboard and workspace overviews. */
export function StatCard({ label, value, hint, icon, onClick, className }: StatCardProps) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          {label}
        </span>
        {icon ? <span className="text-kairo-blue/70">{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </>
  );

  const cls = cn(
    "rounded-xl border border-line bg-card p-4 shadow-card transition-all duration-200",
    onClick &&
      "cursor-pointer hover:-translate-y-0.5 hover:border-kairo-blue/30 hover:shadow-raised",
    className,
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "text-left")}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}
