import { describe, expect, it, vi } from "vitest";
import { extractTextFromFile, ScannedPdfError } from "./extractFile";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));

import { getDocument } from "pdfjs-dist";

/** Minimal fake of the pdfjs surface extractPdfText uses. */
function fakeDoc(pages: { items: unknown[] }[]) {
  return {
    numPages: pages.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({ items: pages[n - 1].items }),
      getViewport: () => ({ width: 612, height: 792 }),
      cleanup: () => {},
    }),
    destroy: async () => {},
  };
}

function pdfFile(name = "scan.pdf"): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

describe("extractTextFromFile — scanned PDF detection", () => {
  it("throws ScannedPdfError with the page count when a PDF has no text layer", async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(fakeDoc([{ items: [] }, { items: [] }])),
    } as never);
    await expect(extractTextFromFile(pdfFile())).rejects.toThrow(ScannedPdfError);
    await expect(extractTextFromFile(pdfFile())).rejects.toMatchObject({ pages: 2 });
  });

  it("still extracts text from a text-layer PDF", async () => {
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve(
        fakeDoc([
          {
            items: [{ str: "Led the platform team", transform: [1, 0, 0, 1, 72, 700], width: 200, height: 12 }],
          },
        ]),
      ),
    } as never);
    const text = await extractTextFromFile(pdfFile());
    expect(text).toContain("Led the platform team");
  });
});
