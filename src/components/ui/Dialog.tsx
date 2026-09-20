import { useEffect } from "react";
import type { ReactNode } from "react";

// Stacked-dialog bookkeeping: only the topmost dialog consumes Esc, so
// closing an inner editor never discards the outer one.
let dialogSeq = 0;
const escStack: number[] = [];

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

/** Modal panel. Reserved for forms and destructive confirmations (spec §8.1). */
export function Dialog({ open, onClose, title, children, maxWidth = "max-w-lg" }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const id = ++dialogSeq;
    escStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (escStack[escStack.length - 1] !== id) return;
      e.preventDefault();
      const idx = escStack.indexOf(id);
      if (idx >= 0) escStack.splice(idx, 1);
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const idx = escStack.indexOf(id);
      if (idx >= 0) escStack.splice(idx, 1);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        className="backdrop-enter absolute inset-0 bg-kairo-midnight/45 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        className={`dialog-enter relative flex max-h-[85vh] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-float`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-muted transition-colors duration-200 hover:bg-accent-soft hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
