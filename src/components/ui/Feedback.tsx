import { cn } from "../../lib/cn";

/** Neutral shimmer placeholder block — pair with a loading flag. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-lg bg-accent-soft ring-1 ring-line/60 shimmer",
        className,
      )}
    />
  );
}

interface SpinnerProps {
  className?: string;
}

/** Brand-gradient spinner; size it via className (defaults to 16px). */
export function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-label="Loading"
      role="status"
      className={cn("size-4 animate-spin text-kairo-blue", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
