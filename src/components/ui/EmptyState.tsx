import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}

export function EmptyState({ icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      {icon ? (
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-line-strong bg-gradient-to-b from-card to-accent-soft text-muted/70 shadow-sm">
          {icon}
        </div>
      ) : null}
      <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
      {children ? <div className="mt-6 flex items-center justify-center gap-3">{children}</div> : null}
    </div>
  );
}
