/**
 * Update checking through the Tauri updater plugin. The plugin talks to the
 * Rust core, which fetches `latest.json` from the GitHub releases endpoint in
 * tauri.conf.json and verifies the artifact's minisign signature against the
 * configured pubkey before anything is installed.
 *
 * In the browser demo (no Tauri bridge) every call reports `unavailable`
 * instead of throwing, so settings can render a plain "desktop app only" note.
 */

/** Progress event emitted by the plugin during `downloadAndInstall`. */
export interface DownloadEvent {
  event: "Started" | "Progress" | "Finished";
  data: { contentLength?: number; chunkLength?: number };
}

/** Structural slice of the plugin's `Update` object — keeps the handle opaque. */
export interface UpdateHandle {
  version: string;
  body: string | null;
  downloadAndInstall(onEvent: (event: DownloadEvent) => void): Promise<void>;
}

export type UpdateCheck =
  | { kind: "up-to-date"; currentVersion: string }
  | {
      kind: "available";
      currentVersion: string;
      version: string;
      notes: string | null;
      update: UpdateHandle;
    }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export async function checkForUpdates(): Promise<UpdateCheck> {
  if (!isTauriBridgeAvailable()) return { kind: "unavailable" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const { getVersion } = await import("@tauri-apps/api/app");
    const [update, currentVersion] = await Promise.all([check(), getVersion()]);
    if (update === null) {
      return { kind: "up-to-date", currentVersion };
    }
    return {
      kind: "available",
      currentVersion,
      version: update.version,
      notes: update.body ?? null,
      update: update as UpdateHandle,
    };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

export async function downloadAndInstall(
  update: UpdateHandle,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  let total: number | null = null;
  let downloaded = 0;
  let sinceLast = 0;
  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started" && event.data.contentLength) {
      total = event.data.contentLength;
    } else if (event.event === "Progress" && event.data.chunkLength) {
      downloaded += event.data.chunkLength;
      sinceLast += event.data.chunkLength;
      // Throttle to one callback per ~64 KB so React state updates stay cheap.
      if (sinceLast >= 65536 || (total !== null && downloaded >= total)) {
        onProgress({ downloaded, total });
        sinceLast = 0;
      }
    }
  });
}

/** Restarts the app after an update has installed — desktop only. */
export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

function isTauriBridgeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
