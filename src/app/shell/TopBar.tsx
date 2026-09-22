import { Moon, Sun } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useThemeStore } from "../../stores/themeStore";
import { cn } from "../../lib/cn";

const STATUS_META = {
  unverified: {
    dot: "bg-warn",
    pill: "border-warn/25 bg-warn-soft/60 text-warn dark:bg-warn/10 dark:text-kairo-dawn",
    label: "SQLite · Unverified",
  },
  ok: {
    dot: "bg-ok",
    pill: "border-ok/25 bg-ok-soft/60 text-ok dark:bg-ok/10 dark:text-emerald-300",
    label: "SQLite · Verified",
  },
  error: {
    dot: "bg-bad",
    pill: "border-bad/25 bg-bad-soft/60 text-bad dark:bg-bad/10 dark:text-red-300",
    label: "SQLite · Error",
  },
} as const;

function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted shadow-sm transition-all duration-150 border border-line bg-card hover:text-ink hover:border-line-strong hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kairo-blue/60"
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function TopBar({ title }: { title: string }) {
  const dbStatus = useAppStore((s) => s.dbStatus);
  const meta = STATUS_META[dbStatus];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-card/80 px-8 backdrop-blur-md">
      <h1 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-muted sm:inline">Local-first · Offline</span>
        <span
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
            meta.pill,
          )}
        >
          <span className={`relative flex h-2 w-2`}>
            <span className={`absolute inline-flex h-full w-full rounded-full ${meta.dot} opacity-40`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
          </span>
          {meta.label}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
