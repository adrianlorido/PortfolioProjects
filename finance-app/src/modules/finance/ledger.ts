import type { Id, Transaction } from "@/domain/models";
import { type Money, ZERO, add } from "./money";

export type LedgerTransaction = Pick<Transaction, "accountId" | "amount" | "pending">;

/**
 * The sign convention stated as arithmetic: for a ledger account (cash, card, loan),
 *   balance_after = balance_before + Σ amounts of POSTED transactions.
 * Pending transactions do not move the (posted) balance. Exclusion from reports never affects
 * balances. Investment accounts are marked to market and are NOT derived this way.
 */
export function postedNetChangeByAccount(transactions: readonly LedgerTransaction[]): Map<Id, Money> {
  const changes = new Map<Id, Money>();
  for (const tx of transactions) {
    if (tx.pending) continue;
    changes.set(tx.accountId, add(changes.get(tx.accountId) ?? ZERO, tx.amount));
  }
  return changes;
}

export function applyPostedTransactions(
  openingBalances: ReadonlyMap<Id, Money>,
  transactions: readonly LedgerTransaction[],
): Map<Id, Money> {
  const result = new Map(openingBalances);
  for (const [accountId, change] of postedNetChangeByAccount(transactions)) {
    result.set(accountId, add(result.get(accountId) ?? ZERO, change));
  }
  return result;
}
