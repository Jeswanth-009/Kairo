import { Moon, Search, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { useThemeStore } from "../../stores/themeStore";
import { cn } from "../../lib/cn";

interface Crumb {
  label: string;
  to?: string;
}

/**
 * Top bar: location breadcrumb, optional contextual primary action.
 * Database health lives in Settings; the bar only surfaces a problem the
 * user must act on (error state), never routine "verified" noise.
 */
export function TopBar({
  crumbs,
  saveState,
  primaryAction,
  onSearchClick,
}: {
  /** Location trail, e.g. Jobs / Acme / Resume. Falls back to a single title. */
  crumbs?: Crumb[];
  /** Autosave state for the current context, when one exists. */
  saveState?: "saved" | "saving" | "error";
  /** The one primary action for this screen, when it has one. */
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  onSearchClick?: () => void;
}) {
  const dbStatus = useAppStore((s) => s.dbStatus);
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);

  const title = crumbs?.length ? crumbs[crumbs.length - 1].label : "";

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between gap-4 border-b border-line bg-card/80 px-6 backdrop-blur-xl lg:px-10">
      <nav aria-label="Location" className="flex min-w-0 items-center gap-2 text-sm">
        {crumbs && crumbs.length > 0 ? (
          crumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 ? (
                <span aria-hidden className="text-muted/50">
                  /
                </span>
              ) : null}
              {i === crumbs.length - 1 ? (
                <span className="truncate text-lg font-semibold tracking-tight text-ink">{crumb.label}</span>
              ) : crumb.to ? (
                <Link to={crumb.to} className="truncate text-muted hover:text-ink">
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate text-muted">{crumb.label}</span>
              )}
            </span>
          ))
        ) : title ? (
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
        ) : null}
      </nav>
      <div className="flex items-center gap-2.5">
        {saveState ? (
          <span
            role="status"
            className={cn(
              "text-xs font-medium",
              saveState === "error" ? "text-bad" : "text-muted",
            )}
          >
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save" : "Saved"}
          </span>
        ) : null}
        {primaryAction ? (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            className="flex h-10 items-center rounded-xl bg-kairo-blue px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-kairo-blue/90 disabled:opacity-50"
          >
            {primaryAction.label}
          </button>
        ) : null}
        {onSearchClick ? (
          <button
            type="button"
            onClick={onSearchClick}
            title="Search everything (Ctrl+K)"
            aria-label="Search everything (Ctrl+K)"
            className="flex h-10 items-center gap-3 rounded-xl border border-line bg-surface px-3 text-xs text-muted transition-all duration-150 hover:border-line-strong hover:bg-accent-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kairo-blue/60"
          >
            <Search className="size-3.5" />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden rounded border border-line bg-accent-soft px-1 py-0.5 font-mono text-[10px] md:inline">
              ⌃K
            </kbd>
          </button>
        ) : null}
        {dbStatus === "error" ? (
          <span
            className="flex items-center gap-2 rounded-full border border-bad/25 bg-bad-soft/60 px-3 py-1 text-xs font-medium text-bad dark:bg-bad/10 dark:text-red-300"
            role="alert"
          >
            Database error — check Settings
          </span>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-muted transition-all duration-150 hover:border-line-strong hover:bg-accent-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kairo-blue/60"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}
