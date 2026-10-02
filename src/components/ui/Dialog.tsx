import { useEffect, useRef } from "react";
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

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/** Modal panel. Reserved for forms and destructive confirmations (spec §8.1). */
export function Dialog({ open, onClose, title, children, maxWidth = "max-w-lg" }: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = ++dialogSeq;
    escStack.push(id);
    restoreRef.current = document.activeElement as HTMLElement | null;

    // Initial focus lands on the first focusable element so keyboard users
    // start inside the dialog, never behind it.
    const focusTarget = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (focusTarget ?? panelRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (escStack[escStack.length - 1] !== id) return;
        e.preventDefault();
        const idx = escStack.indexOf(id);
        if (idx >= 0) escStack.splice(idx, 1);
        onClose();
        return;
      }
      // Focus trap: Tab cycles inside the panel.
      if (e.key === "Tab" && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const idx = escStack.indexOf(id);
      if (idx >= 0) escStack.splice(idx, 1);
      // Hand focus back to whatever opened the dialog.
      restoreRef.current?.focus?.();
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
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-label={title}
        tabIndex={-1}
        className={`dialog-enter relative flex max-h-[85vh] w-full ${maxWidth} flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-float outline-none`}
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
