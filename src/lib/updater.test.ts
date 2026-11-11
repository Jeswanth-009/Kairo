import { describe, expect, it } from "vitest";
import { checkForUpdates, downloadAndInstall, type DownloadEvent, type UpdateHandle } from "./updater";

describe("checkForUpdates", () => {
  it("reports unavailable without a Tauri bridge instead of throwing", async () => {
    // jsdom has no __TAURI_INTERNALS__ — same as the browser demo.
    const result = await checkForUpdates();
    expect(result.kind).toBe("unavailable");
  });
});

describe("downloadAndInstall", () => {
  it("streams Started/Progress events through the progress callback", async () => {
    const events: DownloadEvent[] = [
      { event: "Started", data: { contentLength: 100 } },
      { event: "Progress", data: { chunkLength: 30 } },
      { event: "Progress", data: { chunkLength: 70 } },
      { event: "Finished", data: {} },
    ];
    const handle: UpdateHandle = {
      version: "5.1.0",
      body: null,
      downloadAndInstall: async (onEvent) => {
        for (const e of events) onEvent(e);
      },
    };
    const seen: { downloaded: number; total: number | null }[] = [];
    await downloadAndInstall(handle, (p) => seen.push(p));
    expect(seen).toEqual([
      { downloaded: 100, total: 100 },
    ]);
  });

  it("propagates install failures to the caller", async () => {
    const handle: UpdateHandle = {
      version: "5.1.0",
      body: null,
      downloadAndInstall: async () => {
        throw new Error("disk full");
      },
    };
    await expect(downloadAndInstall(handle, () => {})).rejects.toThrow("disk full");
  });
});
