import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface PdfProgressState {
  /** Last compile output lines, oldest first. */
  lines: string[];
  jobId: number | null;
  /** True while a compile runs but no output line has arrived yet. */
  waiting: boolean;
}

const EMPTY: PdfProgressState = { lines: [], jobId: null, waiting: false };

/**
 * Subscribes to the backend's `pdf://progress` compile stream. Pass `active`
 * (the component's local busy flag) so lines are collected only for the
 * compile this component started; the buffer resets when the compile ends.
 * In the browser demo (no Tauri bridge) this degrades to a no-op.
 *
 * The returned state is derived — the effect only subscribes, so there is no
 * synchronous setState on (de)activation.
 */
export function usePdfProgress(active: boolean, maxLines = 5): PdfProgressState {
  const [events, setEvents] = useState<{ lines: string[]; jobId: number | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const buf = useRef({ lines: [] as string[], jobId: null as number | null });

  // Reset the collected events when (de)activating — during render, before
  // any effect can observe the previous compile's state. The ref buffer
  // resets in the effect below.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    setEvents(null);
    setFailed(false);
  }

  useEffect(() => {
    buf.current = { lines: [], jobId: null };
    if (!active) return undefined;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    void (async () => {
      try {
        const stop = await listen<{ jobId: number; line: string }>("pdf://progress", (event) => {
          if (cancelled) return;
          const cur = buf.current;
          cur.jobId = event.payload.jobId;
          cur.lines = [...cur.lines, event.payload.line].slice(-maxLines);
          setEvents({ lines: [...cur.lines], jobId: cur.jobId });
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // No Tauri bridge (browser dev / mock) — progress stays silent.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active, maxLines]);

  if (!active || failed) return EMPTY;
  if (events === null) return { ...EMPTY, waiting: true };
  return { lines: events.lines, jobId: events.jobId, waiting: false };
}
