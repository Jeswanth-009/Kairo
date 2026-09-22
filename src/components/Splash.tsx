import { useEffect, useState } from "react";

/**
 * Branded boot splash (v4) — covers the first paint while the app initializes,
 * then fades out. Pure frontend: no native window juggling, so it can never
 * block or break startup. Motion is flattened by the global reduced-motion
 * policy.
 */
export function Splash() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">("visible");

  useEffect(() => {
    const fadeAt = window.setTimeout(() => setPhase("fading"), 700);
    const removeAt = window.setTimeout(() => setPhase("gone"), 1300);
    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(removeAt);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-kairo-midnight transition-opacity duration-500 ease-out ${
        phase === "fading" ? "opacity-0" : "opacity-100"
      }`}
    >
      <img
        src="/brand/lockup-vertical-dark-night-800.png"
        alt=""
        draggable={false}
        className="glow-pulse w-64 rounded-3xl shadow-float select-none"
      />
      <div className="mt-7 text-[11px] font-medium tracking-[0.32em] text-kairo-sky/70 uppercase">
        Progress builds possibilities
      </div>
    </div>
  );
}
