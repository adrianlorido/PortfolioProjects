import type { Id, IsoDate, Transaction } from "@/domain/models";

export const UNCATEGORIZED = "uncategorized" as const;

export interface TransactionFilters {
  accountId?: Id;
  /** A category id, or "uncategorized" for transactions without one. */
  categoryId?: Id | typeof UNCATEGORIZED;
  /** Case-insensitive match against merchant, original description and notes. */
  search?: string;
  /** Inclusive. */
  startDate?: IsoDate;
  /** Inclusive. */
  endDate?: IsoDate;
}

export function matchesTransactionFilters(tx: Transaction, filters: TransactionFilters): boolean {
  if (filters.accountId && tx.accountId !== filters.accountId) return false;
  if (filters.categoryId) {
    if (filters.categoryId === UNCATEGORIZED ? tx.categoryId !== null : tx.categoryId !== filters.categoryId) return false;
  }
  if (filters.startDate && tx.date < filters.startDate) return false;
  if (filters.endDate && tx.date > filters.endDate) return false;
  const needle = filters.search?.trim().toLowerCase();
  if (needle) {
    const haystack = `${tx.merchantName}\n${tx.originalDescription}\n${tx.notes ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Newest first; ties broken by id so ordering is stable. */
export function compareTransactionsNewestFirst(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || b.id.localeCompare(a.id);
}
