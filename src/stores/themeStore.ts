import { create } from "zustand";

export type Theme = "light" | "dark";

const KEY = "kairo.theme";

function initial(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — use the v4 default */
  }
  // v4 boots into the Midnight look — the brand's home theme. Light stays one
  // click away (top bar toggle / Settings → Appearance).
  return "dark";
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

function persist(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  apply(theme);
}

export const useThemeStore = create<ThemeState>((set) => {
  const start = initial();
  apply(start);
  return {
    theme: start,
    toggle: () =>
      set((s) => {
        const next: Theme = s.theme === "dark" ? "light" : "dark";
        persist(next);
        return { theme: next };
      }),
    set: (theme) =>
      set(() => {
        persist(theme);
        return { theme };
      }),
  };
});
