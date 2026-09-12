import { invoke } from "@tauri-apps/api/core";
import type { Diagnostics, SmokeTestResult } from "./types";

/**
 * Typed command boundary — every Tauri call goes through here so command names
 * and payload shapes stay in one place (spec §3.3).
 */
export const ipc = {
  getDiagnostics: (): Promise<Diagnostics> => invoke<Diagnostics>("get_diagnostics"),
  dbSmokeTest: (): Promise<SmokeTestResult> => invoke<SmokeTestResult>("db_smoke_test"),
};
