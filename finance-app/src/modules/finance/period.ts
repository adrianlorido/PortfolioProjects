import type { IsoDate } from "@/domain/models";

/** Inclusive date range of calendar dates. */
export interface ReportPeriod {
  start: IsoDate;
  end: IsoDate;
}

/** "YYYY-MM" */
export type MonthKey = string;

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return d <= daysInMonth(y, m);
}

export function isMonthKey(value: string): value is MonthKey {
  return MONTH_RE.test(value);
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month. UTC avoids DST/local-zone effects.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthPeriod(month: MonthKey): ReportPeriod {
  if (!isMonthKey(month)) throw new RangeError(`Invalid month "${month}", expected YYYY-MM`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
}

export function assertValidPeriod(period: ReportPeriod): void {
  if (!isIsoDate(period.start) || !isIsoDate(period.end)) {
    throw new RangeError(`Invalid period ${period.start}..${period.end}`);
  }
  if (period.start > period.end) {
    throw new RangeError(`Period start ${period.start} is after end ${period.end}`);
  }
}

/** ISO dates compare correctly as strings. */
export function isDateInPeriod(date: IsoDate, period: ReportPeriod): boolean {
  return date >= period.start && date <= period.end;
}

export function monthOf(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

export function addMonths(month: MonthKey, delta: number): MonthKey {
  if (!isMonthKey(month)) throw new RangeError(`Invalid month "${month}"`);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Inclusive list of months from `from` to `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const months: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m);
  return months;
}

export function formatMonthLabel(month: MonthKey, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: style,
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}
