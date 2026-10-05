import { useThemeStore } from "../stores/themeStore";

/**
 * The Kairo monogram — the official petal-K tile from the v4 brand kit
 * (brand/app-icon-dark-glow.png / app-icon-light.png).
 * Identity moments only (sidebar brand, about, loading states). Renders the
 * glowing midnight tile on dark themes and the white tile on light themes.
 */
export function BrandMark({ size = 32, glow = false, surface = "auto" }: { size?: number; glow?: boolean; surface?: "auto" | "dark" | "light" }) {
  const theme = useThemeStore((s) => s.theme);
  const darkSurface = surface === "dark" || (surface === "auto" && theme === "dark");
  const src = `/brand/${darkSurface ? "mark-128.png" : "mark-light-128.png"}`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="Kairo logo"
      role="img"
      draggable={false}
      className={`shrink-0 select-none ${glow ? "glow-pulse" : ""}`}
    />
  );
}
