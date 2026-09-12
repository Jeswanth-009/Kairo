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
