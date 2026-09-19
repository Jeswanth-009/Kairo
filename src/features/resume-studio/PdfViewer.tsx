import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ExternalLink, FolderOpen, HardDriveDownload, Maximize2, Minus, Plus } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { toast } from "../../stores/toastStore";
import { Skeleton, Spinner } from "../../components/ui/Feedback";
import { cn } from "../../lib/cn";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

interface PdfViewerProps {
  pdfPath: string;
  candidateName?: string;
  className?: string;
}

/** One canvas per page; resumes are short so rendering eagerly is fine. */
function PdfPage({
  doc,
  pageNumber,
  scale,
}: {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const taskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        taskRef.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport, canvas });
        taskRef.current = task;
        await task.promise;
      } catch (err) {
        const name = (err as { name?: string })?.name ?? "";
        if (name !== "RenderingCancelledException" && !cancelled) {
          console.error("PDF page render failed:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return <canvas ref={canvasRef} data-page={pageNumber} className="block bg-card shadow-md ring-1 ring-black/5" />;
}

/** Continuous multi-page PDF preview with fit-width default and zoom. */
export function PdfViewer({ pdfPath, candidateName, className }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(1);
  const [scale, setScale] = useState<number | null>(null); // null = not fitted yet
  const [fitWidth, setFitWidth] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [savingDownload, setSavingDownload] = useState(false);

  const suggestedFileName = candidateName
    ? `${candidateName.replace(/\s+/g, "_")}_Resume.pdf`
    : "Resume.pdf";

  // Load the document bytes via Tauri IPC.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setScale(null);
    setFitWidth(true);

    async function loadPdf() {
      try {
        const bytes = await ipc.readPdfBytes(pdfPath);
        if (cancelled) return;
        const uint8 = new Uint8Array(bytes);
        const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
      } catch (err: unknown) {
        if (!cancelled) {
          console.error("Failed to load PDF in PdfViewer:", err);
          setError(String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  // Fit width on first load and on demand.
  const fitToWidth = useCallback(async (doc: pdfjsLib.PDFDocumentProxy) => {
    const container = scrollRef.current;
    if (!container) return;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (container.clientWidth - 56) / base.width));
    setScale(+target.toFixed(2));
  }, []);

  useEffect(() => {
    if (pdfDoc && fitWidth) void fitToWidth(pdfDoc);
  }, [pdfDoc, fitWidth, fitToWidth]);

  // Track the page currently in view.
  const onScroll = () => {
    const container = scrollRef.current;
    if (!container || numPages <= 1) return;
    const kids = Array.from(container.querySelectorAll<HTMLElement>("canvas[data-page]"));
    const mid = container.scrollTop + container.clientHeight / 2;
    let best = 1;
    for (const kid of kids) {
      const top = kid.offsetTop;
      const n = Number(kid.dataset.page ?? 1);
      if (top <= mid) best = n;
    }
    setCurrentPage(best);
  };

  const zoomIn = () => {
    setFitWidth(false);
    setScale((s) => Math.min(MAX_SCALE, +((s ?? 1) + 0.15).toFixed(2)));
  };
  const zoomOut = () => {
    setFitWidth(false);
    setScale((s) => Math.max(MIN_SCALE, +((s ?? 1) - 0.15).toFixed(2)));
  };

  const handleSaveToDownloads = async () => {
    setSavingDownload(true);
    try {
      const savedPath = await ipc.savePdfToDownloads(pdfPath, suggestedFileName);
      toast.ok(`Saved to Downloads: ${savedPath}`);
    } catch (e) {
      toast.error(`Save failed: ${String(e)}`);
    } finally {
      setSavingDownload(false);
    }
  };

  const handleReveal = () => void ipc.revealFile(pdfPath).catch((e) => toast.error(String(e)));
  const handleOpenExternal = () => void ipc.openFile(pdfPath).catch((e) => toast.error(String(e)));

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-line bg-card shadow-card", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-card px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          {numPages > 1 ? (
            <span className="mr-1 rounded-md bg-accent-soft px-2 py-1 text-[11px] font-medium text-muted">
              Page {currentPage} / {numPages}
            </span>
          ) : null}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={zoomOut}
              aria-label="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setFitWidth(false);
                setScale((s) => s ?? 1);
              }}
              className="w-12 text-[11px] font-semibold text-muted hover:text-kairo-blue"
              title="Reset zoom"
            >
              {Math.round((scale ?? 1) * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              aria-label="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setFitWidth(true)}
              aria-label="Fit to width"
              title="Fit to width"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md",
                fitWidth ? "bg-kairo-blue/10 text-kairo-blue" : "text-muted hover:bg-accent-soft hover:text-ink",
              )}
            >
              <Maximize2 className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleSaveToDownloads()}
            disabled={savingDownload}
            className="flex items-center gap-1.5 rounded-md border border-line bg-card px-2 py-1.5 text-[11px] font-medium text-ink hover:bg-accent-soft disabled:opacity-50"
            title="Save a copy directly into your Downloads folder"
          >
            <HardDriveDownload className="size-3.5" />
            Save to Downloads
          </button>
          <button
            type="button"
            onClick={handleReveal}
            aria-label="Reveal in folder"
            title="Reveal in folder"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
          >
            <FolderOpen className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleOpenExternal}
            aria-label="Open in system viewer"
            title="Open in system viewer"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-accent-soft hover:text-ink"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Viewport */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex min-h-[560px] w-full flex-col items-center gap-4 overflow-auto bg-accent-soft p-5"
      >
        {loading ? (
          <div className="flex w-full max-w-[620px] flex-col gap-3">
            <Skeleton className="h-[780px] w-full" />
            <p className="flex items-center justify-center gap-2 text-xs font-medium text-muted">
              <Spinner className="size-3.5" /> Rendering PDF preview…
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="m-auto max-w-md rounded-xl border border-red-200 bg-red-50 p-5 text-center dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Unable to render PDF in-app</p>
            <p className="mt-1 font-mono text-[11px] break-all text-red-600 dark:text-red-400/80">{error}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                onClick={handleOpenExternal}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
              >
                Open in external PDF reader
              </button>
              <button
                type="button"
                onClick={handleReveal}
                className="rounded-lg border border-red-300 bg-card px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
              >
                Reveal in folder
              </button>
            </div>
          </div>
        ) : null}

        {pdfDoc && scale !== null
          ? Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <PdfPage key={n} doc={pdfDoc} pageNumber={n} scale={scale} />
            ))
          : null}
      </div>
    </div>
  );
}
