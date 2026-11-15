/**
 * Offline OCR for scanned PDFs. Pages are rendered by pdfjs-dist (the same
 * lazy import the text path uses) into canvases and recognized by
 * tesseract.js, whose worker, WASM core and language data are bundled into
 * `public/ocr/` by scripts/ensure-ocr-assets.mjs — the app's CSP allows no
 * CDN traffic, so nothing is fetched from the network at runtime.
 *
 * English only: tessdata_fast `eng` is the bundled language. Recognition
 * quality on clean scans is decent; the result feeds the same paste-analyzer
 * pipeline as typed text, so the human still reviews every extracted fact.
 */

export interface OcrProgress {
  page: number;
  total: number;
}

export async function ocrPdfText(
  buffer: ArrayBuffer,
  onProgress: (p: OcrProgress) => void,
): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const doc = await loadingTask.promise;
  const total = doc.numPages;

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    // tessdata_fast ships plain .traineddata files (no .gz).
    gzip: false,
  });

  const parts: string[] = [];
  try {
    for (let i = 1; i <= total; i++) {
      onProgress({ page: i, total });
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OCR needs canvas support, which this webview does not provide");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const { data } = await worker.recognize(canvas);
      if (data.text.trim()) parts.push(data.text.trim());
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await loadingTask.destroy();
  }

  const text = parts.join("\n\n");
  if (!text.trim()) {
    throw new Error(
      `OCR finished but found no text in any of the ${total} page(s). If the pages are photos of handwriting or very low quality, manual entry may be faster.`,
    );
  }
  return text;
}
