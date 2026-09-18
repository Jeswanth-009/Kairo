import { cn } from "../../lib/cn";

interface TabsProps<T extends string> {
  tabs: readonly { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
  /** `pills` = boxed segmented control; `underline` = quiet top-level tabs. */
  variant?: "pills" | "underline";
}

/** The one segmented tab bar for the whole app (replaces per-page variants). */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
  variant = "pills",
}: TabsProps<T>) {
  if (variant === "underline") {
    return (
      <div
        role="tablist"
        className={cn("flex items-center gap-1 overflow-x-auto border-b border-line", className)}
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => onChange(t.id)}
              className={cn(
                "relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kairo-blue/50 rounded-t-lg",
                isActive ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              {typeof t.count === "number" ? (
                <span className="ml-1.5 text-xs text-muted">{t.count}</span>
              ) : null}
              {isActive ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-kairo-blue to-kairo-violet" />
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-line bg-accent-soft p-1",
        className,
      )}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kairo-blue/50",
              isActive
                ? "bg-kairo-midnight text-white shadow-sm dark:bg-gradient-to-br dark:from-kairo-blue dark:to-kairo-violet"
                : "text-muted hover:text-ink",
            )}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span className={cn("ml-1.5", isActive ? "text-white/70" : "text-muted")}>
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
