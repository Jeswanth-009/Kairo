/**
 * The Kairo monogram — gradient tile with a white K.
 * Identity moments only (sidebar brand, about, loading states).
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Kairo logo" role="img">
      <defs>
        <linearGradient id="kairo-brand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#0B1020" />
      <rect x="7" y="7" width="50" height="50" rx="11" fill="url(#kairo-brand-grad)" />
      <path d="M25 19v26" stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" fill="none" />
      <path
        d="M41 19L28.5 32L41 45"
        stroke="#FFFFFF"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
