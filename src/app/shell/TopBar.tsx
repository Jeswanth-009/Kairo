import { useAppStore } from "../../stores/appStore";

const STATUS_META = {
  unverified: {
    dot: "bg-amber-500",
    pill: "border-amber-200 bg-amber-50 text-amber-700",
    label: "SQLite · Unverified",
  },
  ok: {
    dot: "bg-emerald-500",
    pill: "border-emerald-200 bg-emerald-50 text-emerald-700",
    label: "SQLite · Verified",
  },
  error: {
    dot: "bg-red-500",
    pill: "border-red-200 bg-red-50 text-red-700",
    label: "SQLite · Error",
  },
} as const;

export function TopBar({ title }: { title: string }) {
  const dbStatus = useAppStore((s) => s.dbStatus);
  const meta = STATUS_META[dbStatus];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-8">
      <h1 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-muted sm:inline">Local-first · Offline</span>
        <span
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${meta.pill}`}
        >
          <span className={`relative flex h-2 w-2`}>
            <span className={`absolute inline-flex h-full w-full rounded-full ${meta.dot} opacity-40`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${meta.dot}`} />
          </span>
          {meta.label}
        </span>
      </div>
    </header>
  );
}
