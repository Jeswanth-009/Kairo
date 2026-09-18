import { Check, X } from "lucide-react";
import { useToastStore } from "../../stores/toastStore";
import { cn } from "../../lib/cn";

function ToastIcon({ kind }: { kind: "ok" | "error" }) {
  return kind === "ok" ? (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
      <Check className="size-3" strokeWidth={3} />
    </span>
  ) : (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
      <X className="size-3" strokeWidth={3} />
    </span>
  );
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={cn(
            "toast-enter pointer-events-auto flex items-center gap-3 rounded-xl border bg-card px-4 py-3",
            "text-left text-sm text-ink shadow-float transition-colors duration-200",
            t.kind === "ok" ? "border-emerald-200/70 dark:border-emerald-500/30" : "border-red-200/70 dark:border-red-500/30",
          )}
        >
          <ToastIcon kind={t.kind} />
          <span className="min-w-0 flex-1">{t.message}</span>
        </button>
      ))}
    </div>
  );
}
