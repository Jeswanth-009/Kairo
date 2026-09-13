const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-03" -> "Mar 2025". Returns the raw value when it is not a month. */
export function fmtMonth(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const month = Number(match[2]);
  return `${MONTHS[month - 1] ?? ""} ${match[1]}`.trim();
}

export interface DateRangeInput {
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
}

export function fmtRange({ startDate, endDate, isCurrent }: DateRangeInput): string {
  const start = fmtMonth(startDate);
  const end = isCurrent ? "Present" : fmtMonth(endDate);
  if (start && end) return `${start} – ${end}`;
  return start || end || "";
}

/**
 * SQLite UTC "YYYY-MM-DD HH:MM:SS" → relative age ("just now", "3 h ago"),
 * falling back to a calendar date beyond a month.
 */
export function fmtAgo(sqliteUtc: string | null | undefined): string {
  if (!sqliteUtc) return "";
  const iso = sqliteUtc.includes("T") ? sqliteUtc : `${sqliteUtc.replace(" ", "T")}Z`;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return sqliteUtc;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} d ago`;
  const date = new Date(then);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}
