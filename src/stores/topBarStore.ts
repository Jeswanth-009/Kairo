import { create } from "zustand";

/**
 * Page → TopBar channel. The shell renders the top bar once; each page
 * publishes its own location trail, save state, and the single contextual
 * primary action. Pages set it on mount (and when state changes) and the
 * shell clears it on navigation.
 */
export interface TopBarCrumb {
  label: string;
  to?: string;
}

export interface TopBarPrimary {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface TopBarState {
  crumbs: TopBarCrumb[] | null;
  saveState: "saved" | "saving" | "error" | null;
  primaryAction: TopBarPrimary | null;
  set: (v: {
    crumbs?: TopBarCrumb[] | null;
    saveState?: "saved" | "saving" | "error" | null;
    primaryAction?: TopBarPrimary | null;
  }) => void;
  clear: () => void;
}

export const useTopBarStore = create<TopBarState>((set) => ({
  crumbs: null,
  saveState: null,
  primaryAction: null,
  set: (v) => set(v),
  clear: () => set({ crumbs: null, saveState: null, primaryAction: null }),
}));
