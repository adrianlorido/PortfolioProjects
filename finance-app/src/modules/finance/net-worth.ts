import type { Account, BalanceSnapshot, Id, IsoDate } from "@/domain/models";
import { classifyAccount } from "./accounts";
import { assertSingleCurrency } from "./currency";
import { type Money, ZERO, add, negate, subtract } from "./money";

export type NetWorthAccountInput = Pick<Account, "type" | "currentBalance" | "currency">;

export interface NetWorthSummary {
  /** Sum of asset-account balances. */
  assets: Money;
  /** Amount owed, as a positive number (negated sum of liability-account balances). */
  liabilities: Money;
  /** assets - liabilities */
  netWorth: Money;
}

/**
 * Net worth = assets - liabilities, computed from account balances and account-type
 * classification. It is deliberately NOT derived from transaction totals: transaction
 * history is incomplete (it starts when the account was linked) and investment values
 * change without transactions.
 */
export function calculateNetWorth(accounts: readonly NetWorthAccountInput[]): NetWorthSummary {
  assertSingleCurrency(accounts);
  let assets = ZERO;
  let liabilityBalances = ZERO;
  for (const account of accounts) {
    if (classifyAccount(account.type) === "asset") {
      assets = add(assets, account.currentBalance);
    } else {
      liabilityBalances = add(liabilityBalances, account.currentBalance);
    }
  }
  const liabilities = negate(liabilityBalances);
  return { assets, liabilities, netWorth: subtract(assets, liabilities) };
}

export interface NetWorthPoint extends NetWorthSummary {
  date: IsoDate;
}

export type SnapshotInput = Pick<BalanceSnapshot, "accountId" | "date" | "balance">;
export type HistoryAccountInput = Pick<Account, "id" | "type" | "currency">;

/**
 * Net worth on each requested date from balance snapshots. For each account the most recent
 * snapshot on or before the date is used; an account with no snapshot yet contributes zero
 * (it wasn't tracked then). Snapshots for unknown accounts are an error, not silently dropped.
 */
export function calculateNetWorthHistory(
  accounts: readonly HistoryAccountInput[],
  snapshots: readonly SnapshotInput[],
  dates: readonly IsoDate[],
): NetWorthPoint[] {
  assertSingleCurrency(accounts);
  const accountsById = new Map<Id, HistoryAccountInput>(accounts.map((a) => [a.id, a]));
  const byAccount = new Map<Id, SnapshotInput[]>();
  for (const snapshot of snapshots) {
    if (!accountsById.has(snapshot.accountId)) {
      throw new Error(`Snapshot references unknown account ${snapshot.accountId}`);
    }
    const list = byAccount.get(snapshot.accountId) ?? [];
    list.push(snapshot);
    byAccount.set(snapshot.accountId, list);
  }
  for (const list of byAccount.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  return [...dates].sort().map((date) => {
    const balances: NetWorthAccountInput[] = [];
    for (const [accountId, list] of byAccount) {
      const account = accountsById.get(accountId)!;
      let latest: SnapshotInput | undefined;
      for (const s of list) {
        if (s.date > date) break;
        latest = s;
      }
      if (latest) balances.push({ type: account.type, currency: account.currency, currentBalance: latest.balance });
    }
    return { date, ...calculateNetWorth(balances) };
  });
}
