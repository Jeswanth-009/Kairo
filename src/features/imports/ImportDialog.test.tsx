// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "./ImportDialog";
import { ScannedPdfError } from "./extractFile";

vi.mock("./extractFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./extractFile")>();
  return {
    ...actual,
    extractTextFromFile: vi.fn(async () => {
      throw new ScannedPdfError(3, "scanned-resume.pdf");
    }),
  };
});

vi.mock("../../lib/ipc", () => ({
  ipc: { parseResumeText: vi.fn() },
}));

function pickPdf() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");
  const file = new File([new Uint8Array([1])], "scanned-resume.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("ImportDialog — scanned PDF guided fallback", () => {
  afterEach(cleanup);

  it("explains the missing text layer and offers OCR, paste, and manual paths", async () => {
    render(<ImportDialog open onClose={() => {}} />);
    pickPdf();
    expect(
      await screen.findByText(/no text layer — it is probably a scan or image export/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /try ocr here/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /paste the text instead/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add records manually/i })).toBeTruthy();
    expect(screen.getByText(/re-export it as a searchable/i)).toBeTruthy();
  });

  it("dismisses the fallback when the user chooses to paste text", async () => {
    render(<ImportDialog open onClose={() => {}} />);
    pickPdf();
    fireEvent.click(await screen.findByRole("button", { name: /paste the text instead/i }));
    expect(screen.queryByText(/try ocr here/i)).toBeNull();
  });
});
