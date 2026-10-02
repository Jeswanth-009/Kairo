import { unzipSync } from "fflate";

/**
 * Turns an uploaded resume file into plain text for the paste analyzer. PDF
 * text extraction runs client-side through pdfjs-dist (lazy-imported so the
 * worker code is only fetched when a PDF is picked); DOCX is a zip — we read
 * word/document.xml and pull paragraph text. Scanned/image-only PDFs yield no
 * text; callers surface a clear error.
 *
 * PDF extraction rebuilds reading order: pdfjs emits positioned fragments, so
 * fragments are clustered into visual lines by baseline (with tolerance —
 * exact y values differ inside one real line), ordered left-to-right, and
 * repeated page headers/footers plus page numbers are dropped. Wide gaps are
 * kept as `|` when they look like right-aligned metadata ("Acme  |  2024") so
 * the parser still sees dates together with their heading; a page-wide,
 * repeating gutter (two-column layouts) is split into columns instead, so
 * left/right content no longer interleaves.
 */

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PdfLine {
  y: number;
  items: PdfTextItem[];
}

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

/** Groups pdfjs text items into visual lines by baseline with tolerance. */
function clusterLines(items: PdfTextItem[]): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: PdfLine[] = [];
  for (const item of sorted) {
    const tol = Math.max(3, Math.min(item.h, 14) * 0.4);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tol);
    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }
  return lines.sort((a, b) => b.y - a.y);
}

/**
 * Renders one clustered line. A gap larger than `columnGap` starts a new
 * segment; segments are joined with `|` when they look like right-aligned
 * metadata, so heading + date stay on one parseable line. Returns
 * `{ text, segments }` — segments feed per-page column detection.
 */
function renderLine(
  items: PdfTextItem[],
  columnGap: number,
): { text: string; segments: { x: number; text: string }[] } {
  const segments: { x: number; text: string }[] = [];
  let current = "";
  let prev: PdfTextItem | null = null;
  for (const item of items) {
    const str = item.str.replace(/\s+/g, " ");
    if (!str.trim()) continue;
    if (prev) {
      const gap = item.x - (prev.x + prev.w);
      if (gap > columnGap) {
        segments.push({ x: prev.x, text: current.trim() });
        current = "";
      } else if (gap > 1.2) {
        current += " ";
      }
    }
    current += str;
    prev = item;
  }
  if (current.trim()) {
    segments.push({ x: (prev?.x ?? 0), text: current.trim() });
  }
  const metaLike =
    segments.length === 2 &&
    segments.every((s) => s.text.length <= 60) &&
    /^(19|20)\d{2}|[A-Za-z]{3,9} \d{4}|present|current|\d{4}\s*[–—-]\s*/i.test(
      segments[1].text,
    );
  const text = metaLike
    ? segments.map((s) => s.text).join(" | ")
    : segments.map((s) => s.text).join(" ");
  return { text, segments };
}

/** True when a page's repeating wide gutter means a real column layout. */
function detectGutter(
  pageLines: { text: string; segments: { x: number; text: string }[] }[],
): number | null {
  const multi = pageLines.filter((l) => l.segments.length >= 2);
  if (multi.length < Math.max(3, pageLines.length * 0.25)) return null;
  // Cluster the x where the widest gap starts; a shared band is a gutter.
  const xs = multi
    .map((l) => {
      let widest = l.segments[1];
      let width = 0;
      for (let i = 1; i < l.segments.length; i++) {
        const start = l.segments[i].x;
        const prevEnd =
          l.segments[i - 1].x + (l.segments[i - 1].text.length * 4 + 8);
        if (start - prevEnd > width) {
          width = start - prevEnd;
          widest = l.segments[i];
        }
      }
      return widest.x;
    })
    .sort((a, b) => a - b);
  let best = { count: 0, x: 0 };
  let run = { count: 0, x: xs[0] ?? 0 };
  for (const x of xs) {
    if (x - run.x <= 24) {
      run.count += 1;
    } else {
      run = { count: 1, x };
    }
    if (run.count > best.count) best = { ...run };
  }
  return best.count >= Math.max(3, pageLines.length * 0.2) ? best.x : null;
}

/** Rebuilds one page's text in reading order using the detected gutter. */
function pageToText(items: PdfTextItem[], pageWidth: number): string[] {
  const columnGap = Math.max(18, pageWidth * 0.045);
  const lines = clusterLines(items)
    .filter((l) => l.items.some((i) => i.str.trim().length > 0))
    .map((l) => renderLine(l.items, columnGap))
    .filter((l) => l.text.trim().length > 0);
  const gutter = detectGutter(lines);
  if (gutter === null) {
    return lines.map((l) => l.text);
  }
  // Two-pass column order: everything left of the gutter, then the rest.
  const left: string[] = [];
  const right: string[] = [];
  for (const l of lines) {
    const lhs = l.segments.filter((s) => s.x < gutter);
    const rhs = l.segments.filter((s) => s.x >= gutter);
    if (lhs.length > 0) left.push(lhs.map((s) => s.text).join(" "));
    if (rhs.length > 0) right.push(rhs.map((s) => s.text).join(" "));
  }
  return [...left, ...right];
}

/** Drops lines that repeat as first/last lines across pages (headers,
 * footers, repeated slide branding) and bare page numbers. */
function dropRepeatingFurniture(pages: string[][]): string[][] {
  if (pages.length < 3) {
    return pages.map((p) => p.filter((l) => !/^\d{1,4}$/.test(l.trim())));
  }
  const count = new Map<string, number>();
  for (const page of pages) {
    for (const line of [page[0], page[page.length - 1]]) {
      if (!line) continue;
      const key = line.trim().toLowerCase();
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  const furniture = new Set(
    [...count.entries()].filter(([, n]) => n >= 2).map(([k]) => k),
  );
  return pages.map((p) =>
    p.filter((l) => {
      const key = l.trim().toLowerCase();
      if (/^\d{1,4}$/.test(key)) return false;
      return !furniture.has(key) || p.indexOf(l) !== 0;
    }),
  );
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || typeof item.str !== "string" || !item.str.trim()) continue;
      const tr = item.transform ?? [1, 0, 0, 1, 0, 0];
      const height = "height" in item ? (item.height ?? 0) : 0;
      items.push({
        str: item.str,
        x: tr[4],
        y: tr[5],
        w: item.width ?? 0,
        h: height || Math.abs(tr[3]) || 10,
      });
    }
    const viewport = page.getViewport({ scale: 1 });
    pages.push(pageToText(items, viewport.width));
  }
  const cleaned = dropRepeatingFurniture(pages);
  const text = cleaned.map((p) => p.join("\n")).join("\n\n");
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
