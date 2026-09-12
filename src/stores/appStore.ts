import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { DbStatus, Diagnostics, SmokeTestResult } from "../lib/types";

interface AppState {
  diagnostics: Diagnostics | null;
  diagnosticsError: string | null;
  smoke: SmokeTestResult | null;
  smokeBusy: boolean;
  dbStatus: DbStatus;
  loadDiagnostics: () => Promise<void>;
  runSmokeTest: () => Promise<void>;
}

export const useAppStore = create<AppState>()((set) => ({
  diagnostics: null,
  diagnosticsError: null,
  smoke: null,
  smokeBusy: false,
  dbStatus: "unverified",

  loadDiagnostics: async () => {
    try {
      const diagnostics = await ipc.getDiagnostics();
      set({ diagnostics, diagnosticsError: null });
    } catch (e) {
      set({ diagnosticsError: String(e) });
    }
  },

  runSmokeTest: async () => {
    set({ smokeBusy: true });
    try {
      const smoke = await ipc.dbSmokeTest();
      set({ smoke, dbStatus: smoke.ok ? "ok" : "error" });
    } catch (e) {
      const smoke: SmokeTestResult = {
        ok: false,
        tokenWritten: "",
        tokenReadBack: "",
        durationMs: 0,
        error: String(e),
      };
      set({ smoke, dbStatus: "error" });
    } finally {
      set({ smokeBusy: false });
    }
  },
}));
