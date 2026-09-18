import { create } from "zustand";

export type Theme = "light" | "dark";

const KEY = "kairo.theme";

function initial(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — fall through to OS preference */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const start = initial();
  apply(start);
  return {
    theme: start,
    toggle: () =>
      set((s) => {
        const next: Theme = s.theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(KEY, next);
        } catch {
          /* ignore */
        }
        apply(next);
        return { theme: next };
      }),
  };
});
