export const TRANSACTIONS_PAGE_SIZE = 50;

export interface Page<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

/** Parses a 1-based page number; anything invalid falls back to 1. Out-of-range pages clamp. */
export function paginate<T>(items: readonly T[], rawPage: unknown, pageSize = TRANSACTIONS_PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const parsed = typeof rawPage === "string" && /^\d{1,6}$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Math.min(Math.max(parsed, 1), pageCount);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageCount, total: items.length };
}
