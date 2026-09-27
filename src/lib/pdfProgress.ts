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
 */
export function usePdfProgress(active: boolean, maxLines = 5): PdfProgressState {
  const [state, setState] = useState<PdfProgressState>(EMPTY);
  const buf = useRef({ lines: [] as string[], jobId: null as number | null });

  useEffect(() => {
    if (!active) {
      buf.current = { lines: [], jobId: null };
      setState(EMPTY);
      return;
    }
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    setState({ ...EMPTY, waiting: true });
    void (async () => {
      try {
        const stop = await listen<{ jobId: number; line: string }>("pdf://progress", (event) => {
          if (cancelled) return;
          const cur = buf.current;
          cur.jobId = event.payload.jobId;
          cur.lines = [...cur.lines, event.payload.line].slice(-maxLines);
          setState({ lines: [...cur.lines], jobId: cur.jobId, waiting: false });
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // No Tauri bridge (browser dev / mock) — progress stays silent.
        if (!cancelled) setState({ ...EMPTY, waiting: false });
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active, maxLines]);

  return state;
}
