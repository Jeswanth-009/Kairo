import { useAppStore } from "../../stores/appStore";

const STATUS_META = {
  unverified: { dot: "bg-amber-500", label: "SQLite · Unverified" },
  ok: { dot: "bg-emerald-500", label: "SQLite · Verified" },
  error: { dot: "bg-red-500", label: "SQLite · Error" },
} as const;

export function TopBar({ title }: { title: string }) {
  const dbStatus = useAppStore((s) => s.dbStatus);
  const meta = STATUS_META[dbStatus];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
      <h1 className="text-sm font-semibold text-ink">{title}</h1>
      <div className="flex items-center gap-4">
        <span className="text-xs text-muted">Local-first · Offline</span>
        <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-surface px-3 py-1 text-xs font-medium text-ink">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>
    </header>
  );
}
