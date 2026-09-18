import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Uppercase micro-heading with a hairline — used to open list sections. */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
