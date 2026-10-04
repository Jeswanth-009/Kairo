import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Design-system primitives (Stage 2 of the redesign). The rule of the
 * overhaul: sections, rows and whitespace instead of card-in-card; a Card is
 * reserved for the active task, a document preview, or a meaningful decision.
 */

/** A page section: title, optional description, content — no nested card. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  ...rest
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("mb-8", className)} {...rest}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[19px] font-semibold tracking-tight text-ink">{title}</h2>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A quiet divider-labelled heading, for sub-groupings inside a section. */
export function SectionDivider({ label }: { label: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3" role="presentation">
      <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{label}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

/**
 * A list row: primary content left, meta and trailing actions right.
 * The workhorse for Home's recent jobs, Jobs list, My Story, Applications.
 */
export function Row({
  onClick,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  className,
}: {
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        onClick ? "cursor-pointer hover:bg-accent-soft" : "",
        className,
      )}
    >
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-[13px] text-muted">{subtitle}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-[13px] text-muted">{meta}</span> : null}
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </Tag>
  );
}

/** The four persistent document states, shared by Home and the editor. */
export type DocState = "draft" | "needs-update" | "current" | "export-failed";

const DOC_STATE_META: Record<DocState, { label: string; tone: string }> = {
  draft: { label: "Draft — no PDF yet", tone: "neutral" },
  "needs-update": { label: "PDF needs update", tone: "warn" },
  current: { label: "Current PDF", tone: "ok" },
  "export-failed": { label: "Export failed — previous PDF kept", tone: "bad" },
};

/** The strong, single status line for a document. */
export function StatusLine({
  state,
  detail,
  actions,
  className,
}: {
  state: DocState;
  detail?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const meta = DOC_STATE_META[state];
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm font-medium shadow-card",
        meta.tone === "bad"
          ? "border-bad/30 bg-bad-soft text-bad dark:border-red-500/30 dark:bg-bad/10 dark:text-red-300"
          : meta.tone === "warn"
            ? "border-warn/30 bg-warn-soft text-warn dark:border-warn/25 dark:bg-warn/10 dark:text-kairo-dawn"
            : meta.tone === "ok"
              ? "border-ok/30 bg-ok-soft text-ok dark:border-ok/25 dark:bg-ok/10 dark:text-emerald-300"
              : "border-line bg-card text-muted",
        className,
      )}
    >
      <span>
        {meta.label}
        {detail ? <span className="font-normal text-muted"> — {detail}</span> : null}
      </span>
      {actions ? <span className="flex items-center gap-2">{actions}</span> : null}
    </div>
  );
}

/**
 * Stage navigation for a guided sequence (workspace: Role → Evidence →
 * Resume → Review → Applied). Every step carries its real saved-state
 * status — navigation is backward-free but never implies completion.
 */
export type StepStatus = "not-started" | "in-progress" | "needs-attention" | "complete";

const STEP_STATUS_MARK: Record<StepStatus, string> = {
  "not-started": "",
  "in-progress": "",
  "needs-attention": "!",
  complete: "✓",
};

const STEP_STATUS_CLASS: Record<StepStatus, string> = {
  "not-started": "bg-accent-soft text-muted",
  "in-progress": "bg-kairo-blue/10 text-kairo-blue",
  "needs-attention": "bg-warn/15 text-warn dark:bg-warn/25 dark:text-kairo-dawn",
  complete: "bg-ok/15 text-ok dark:bg-ok/25 dark:text-emerald-300",
};

export function StepNav<T extends string>({
  steps,
  active,
  onChange,
  hint,
  className,
}: {
  /** `status` defaults to "not-started" for callers that don't track it. */
  steps: { key: T; label: string; status?: StepStatus; action?: string }[];
  active: T;
  onChange: (key: T) => void;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-label="Progress">
        {steps.map((step, i) => {
          const isActive = step.key === active;
          const status: StepStatus = isActive
            ? (step.status ?? "in-progress")
            : (step.status ?? "not-started");
          return (
            <li key={step.key} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange(step.key)}
                aria-current={isActive ? "step" : undefined}
                title={status === "needs-attention" ? step.action : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1 text-sm transition-colors",
                  isActive
                    ? "bg-kairo-blue/10 font-semibold text-kairo-blue"
                    : status === "complete"
                      ? "text-ink hover:text-kairo-blue"
                      : status === "needs-attention"
                        ? "font-medium text-warn hover:text-ink"
                        : "text-muted hover:text-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                    isActive
                      ? "bg-kairo-blue text-white"
                      : STEP_STATUS_CLASS[status],
                  )}
                >
                  {STEP_STATUS_MARK[status] || i + 1}
                </span>
                {step.label}
              </button>
              {i < steps.length - 1 ? (
                <span aria-hidden className="h-px w-4 bg-line-strong" />
              ) : null}
            </li>
          );
        })}
      </ol>
      {hint ? <p className="mt-1.5 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Simplified brand glyph for 16–24 px contexts — the full gradient logo
 * merges into mush at that size, so navigation and inline spots use this.
 */
export function BrandGlyph({
  size = 20,
  className,
  variant = "color",
}: {
  size?: number;
  className?: string;
  /**
   * "color" — the deep-navy tile with the luminous mark (dark and default).
   * "on-light" — light-background counterpart (inverted tile, deeper mark).
   * "mono" — one-color currentColor, for inline text and print.
   */
  variant?: "color" | "on-light" | "mono";
}) {
  if (variant === "mono") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        role="img"
        aria-label="Kairo"
        className={cn("shrink-0", className)}
      >
        <path
          d="M7 17V7h6.2a3.4 3.4 0 0 1 0 6.8H9.8"
          className="stroke-current"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="16.4" cy="16.4" r="2.1" className="fill-current" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Kairo"
      className={cn("shrink-0", className)}
    >
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="6"
        className={variant === "on-light" ? "fill-slate-100" : "fill-kairo-midnight"}
      />
      <path
        d="M7 17V7h6.2a3.4 3.4 0 0 1 0 6.8H9.8"
        className={variant === "on-light" ? "stroke-kairo-midnight" : "stroke-kairo-sky"}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <circle
        cx="16.4"
        cy="16.4"
        r="2.1"
        className={variant === "on-light" ? "fill-kairo-violet" : "fill-kairo-dawn"}
      />
    </svg>
  );
}
