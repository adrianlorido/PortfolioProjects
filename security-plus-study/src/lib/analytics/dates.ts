/** Calendar-date helpers. Dates are "YYYY-MM-DD" strings in the learner's timezone. */

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function toLocalDate(date: Date, timeZone = "UTC"): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const d = parse(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

export function diffDays(later: string, earlier: string): number {
  return Math.round((parse(later).getTime() - parse(earlier).getTime()) / 86_400_000);
}

/** Inclusive list of `days` dates ending at `end`. */
export function dateRange(end: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
}

export function dayOfWeek(dateStr: string): number {
  return parse(dateStr).getUTCDay();
}
