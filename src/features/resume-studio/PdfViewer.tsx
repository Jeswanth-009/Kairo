import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ipc } from "../../lib/ipc";
import { toast } from "../../stores/toastStore";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  pdfPath: string;
  candidateName?: string;
  className?: string;
}

export function PdfViewer({ pdfPath, candidateName, className = "" }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [savingDownload, setSavingDownload] = useState(false);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);

  // Suggested download file name
  const suggestedFileName = candidateName
    ? `${candidateName.replace(/\s+/g, "_")}_Resume.pdf`
    : "Resume.pdf";

  // Load PDF data via Tauri IPC
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function loadPdf() {
      try {
        const bytes = await ipc.readPdfBytes(pdfPath);
        if (cancelled) return;
        const uint8 = new Uint8Array(bytes);
        setPdfData(uint8);

        const loadingTask = pdfjsLib.getDocument({ data: uint8 });
        const doc = await loadingTask.promise;
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
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  // Render active page onto canvas
  const renderPage = useCallback(
    async (pageNumber: number, doc: pdfjsLib.PDFDocumentProxy, currentScale: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        const page = await doc.getPage(pageNumber);
        const pixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: currentScale });

        // Set actual canvas size in memory (scaled for HiDPI)
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);

        // Display size via CSS
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport,
          canvas,
        };

        await page.render(renderContext).promise;
      } catch (err) {
        console.error("Error rendering PDF page:", err);
      }
    },
    [],
  );

  // Trigger render when page, doc, or scale changes
  useEffect(() => {
    if (pdfDoc) {
      void renderPage(currentPage, pdfDoc, scale);
    }
  }, [pdfDoc, currentPage, scale, renderPage]);

  // Download directly in browser via blob
  const handleBrowserDownload = () => {
    if (!pdfData) return;
    try {
      const blob = new Blob([pdfData], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.ok(`Downloading ${suggestedFileName}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Save copy directly to Windows Downloads folder
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

  // Reveal file in Windows Explorer
  const handleReveal = async () => {
    try {
      await ipc.revealFile(pdfPath);
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Open in default OS PDF application
  const handleOpenExternal = async () => {
    try {
      await ipc.openFile(pdfPath);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const zoomIn = () => setScale((s) => Math.min(2.5, +(s + 0.15).toFixed(2)));
  const zoomOut = () => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)));
  const resetZoom = () => setScale(1.15);

  return (
    <div className={`flex flex-col rounded-xl border border-slate-200 bg-slate-900/5 shadow-sm overflow-hidden ${className}`}>
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        {/* Left: Page Navigation & Zoom */}
        <div className="flex items-center gap-1.5">
          {numPages > 1 && (
            <div className="flex items-center gap-1 border-r border-slate-200 pr-2 mr-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                title="Previous page"
              >
                ◀
              </button>
              <span className="text-[11px] font-medium text-slate-600">
                {currentPage} / {numPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                title="Next page"
              >
                ▶
              </button>
            </div>
          )}

          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={resetZoom}
              className="px-1 text-[11px] font-semibold text-slate-600 hover:text-kairo-blue"
              title="Reset zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100"
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>

        {/* Right: Quick Action Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleSaveToDownloads}
            disabled={savingDownload}
            className="flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
            title="Save a copy directly into your Windows Downloads folder"
          >
            <span>💾</span>
            <span>Save to Downloads</span>
          </button>

          <button
            type="button"
            onClick={handleBrowserDownload}
            className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            title="Download PDF"
          >
            <span>📥</span>
            <span>Download</span>
          </button>

          <button
            type="button"
            onClick={handleReveal}
            className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            title="Open containing folder in File Explorer with PDF selected"
          >
            <span>📂</span>
            <span>Reveal in Folder</span>
          </button>

          <button
            type="button"
            onClick={handleOpenExternal}
            className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-kairo-blue hover:bg-kairo-blue/5 transition-colors"
            title="Open in default desktop PDF app"
          >
            <span>↗</span>
            <span>Open in App</span>
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div
        ref={containerRef}
        className="flex min-h-[650px] max-h-[850px] w-full flex-col items-center overflow-auto bg-slate-100/80 p-4"
      >
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
            <svg className="h-6 w-6 animate-spin text-kairo-blue" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <p className="text-xs font-medium">Rendering PDF preview…</p>
          </div>
        )}

        {error && (
          <div className="m-auto max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-xs font-semibold text-red-700">Unable to render PDF in-app</p>
            <p className="mt-1 text-[11px] text-red-600 font-mono break-all">{error}</p>
            <div className="mt-3 flex justify-center gap-2">
              <button
                type="button"
                onClick={handleOpenExternal}
                className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
              >
                Open in external PDF reader ↗
              </button>
              <button
                type="button"
                onClick={handleReveal}
                className="rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
              >
                Reveal in Explorer
              </button>
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className={`bg-white shadow-md transition-opacity duration-200 ${
            loading || error ? "hidden" : "block"
          }`}
          style={{ maxWidth: "none" }}
        />
      </div>
    </div>
  );
}
