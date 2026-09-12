import { useToastStore } from "../../stores/toastStore";

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-72 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm text-ink shadow-lg transition-opacity duration-200"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${t.kind === "ok" ? "bg-emerald-500" : "bg-red-500"}`}
          />
          {t.message}
        </button>
      ))}
    </div>
  );
}
