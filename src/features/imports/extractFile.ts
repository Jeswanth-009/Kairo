import { unzipSync } from "fflate";

/**
 * Turns an uploaded resume file into plain text for the existing paste
 * analyzer. PDF text extraction runs client-side through pdfjs-dist
 * (lazy-imported so the worker code is only fetched when a PDF is picked);
 * DOCX is a zip — we read word/document.xml and pull paragraph text.
 * Scanned/image-only PDFs yield no text; callers surface a clear error.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfText(await file.arrayBuffer());
  }
  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    return extractDocxText(await file.arrayBuffer());
  }
  // Everything else (txt, md, rtf-ish exports) rides the text path.
  const text = await file.text();
  if (!text.trim()) {
    throw new Error("The file appears to be empty");
  }
  return text;
}

/** Groups pdfjs text items into lines by their baseline y position. */
function itemsToLines(items: { str?: string; transform?: number[] }[]): string {
  const lines = new Map<number, string[]>();
  for (const item of items) {
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const y = Math.round(item.transform?.[5] ?? 0);
    const bucket = lines.get(y);
    if (bucket) bucket.push(item.str);
    else lines.set(y, [item.str]);
  }
  return [...lines.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.join(" ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(itemsToLines(content.items as { str?: string; transform?: number[] }[]));
  }
  const text = pages.join("\n\n");
  if (!text.trim()) {
    throw new Error(
      "No readable text in this PDF — it is probably a scan or image export. Paste the text instead.",
    );
  }
  return text;
}

function extractDocxText(buffer: ArrayBuffer): string {
  let xmlFile: Uint8Array | undefined;
  try {
    xmlFile = unzipSync(new Uint8Array(buffer))["word/document.xml"];
  } catch {
    throw new Error("This .docx file could not be opened — it may be corrupted");
  }
  if (!xmlFile) {
    throw new Error("Not a valid .docx file (word/document.xml missing)");
  }
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xmlFile), "application/xml");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(doc.getElementsByTagNameNS(ns, "p"));
  const lines = paragraphs
    .map((p) =>
      Array.from(p.getElementsByTagNameNS(ns, "t"))
        .map((t) => t.textContent ?? "")
        .join("")
        .trim(),
    )
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error("No readable text in this document — paste the text instead");
  }
  return lines.join("\n");
}
