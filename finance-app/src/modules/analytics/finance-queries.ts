/**
 * Deterministic finance query API.
 *
 * This is the read surface the UI uses today and the tool surface a future AI assistant will
 * call. Every number returned here is computed by the pure finance engine from stored data:
 * an assistant may *explain* these results but must never produce balances or totals itself.
 * All results are plain JSON-serialisable objects.
 */
import type { Account, Category, CategoryGroup, Id, IsoDate, Transaction } from "@/domain/models";
import type { FinanceReadRepository } from "@/db/repository";
import { type AccountGroup, groupAccounts } from "@/modules/accounts/grouping";
import {
  type BasisPoints,
  type CashFlowSummary,
  type Money,
  type MonthKey,
  type MonthlyCashFlow,
  type NetWorthPoint,
  type NetWorthSummary,
  type ReportOptions,
  type ReportPeriod,
  assertValidPeriod,
  calculateCashFlow,
  calculateCashFlowByMonth,
  calculateNetWorth,
  calculateNetWorthHistory,
  calculateSpendingByCategory,
  classifyAccount,
  monthOf,
  monthRange,
  ratioInBasisPoints,
  totalOf,
} from "@/modules/finance";
import type { TransactionFilters } from "@/modules/transactions/filters";

export interface AccountView extends Account {
  accountClass: "asset" | "liability";
}

export interface TransactionView extends Transaction {
  accountName: string;
  categoryName: string | null;
  categoryGroupName: string | null;
}

export interface CategorySpendingView {
  categoryId: Id | null;
  categoryName: string;
  groupName: string;
  amount: Money;
  transactionCount: number;
  /** Share of total spending, basis points. Null when total spending is zero. */
  share: BasisPoints | null;
}

export interface CategoryWithGroup extends Category {
  groupName: string;
}

export function createFinanceQueries(repo: FinanceReadRepository, userId: Id) {
  async function loadCategories(): Promise<{ groups: CategoryGroup[]; categories: CategoryWithGroup[] }> {
    const [groups, categories] = await Promise.all([repo.listCategoryGroups(userId), repo.listCategories(userId)]);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const groupOrder = new Map(groups.map((g) => [g.id, g.sortOrder]));
    return {
      groups,
      categories: categories
        .map((c) => ({ ...c, groupName: groupName.get(c.groupId) ?? "Other" }))
        .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.sortOrder - b.sortOrder),
    };
  }

  async function getAccounts(): Promise<AccountView[]> {
    const accounts = await repo.listAccounts(userId);
    return accounts.map((a) => ({ ...a, accountClass: classifyAccount(a.type) }));
  }

  async function getAccountGroups(): Promise<AccountGroup<AccountView>[]> {
    return groupAccounts(await getAccounts());
  }

  async function getTransactions(filters: TransactionFilters = {}): Promise<TransactionView[]> {
    const [transactions, accounts, { categories }] = await Promise.all([
      repo.listTransactions(userId, filters),
      repo.listAccounts(userId),
      loadCategories(),
    ]);
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    return transactions.map((t) => {
      const category = t.categoryId ? categoryById.get(t.categoryId) : undefined;
      return {
        ...t,
        accountName: accountName.get(t.accountId) ?? "Unknown account",
        categoryName: category?.name ?? null,
        categoryGroupName: category?.groupName ?? null,
      };
    });
  }

  async function getNetWorth(): Promise<NetWorthSummary> {
    return calculateNetWorth(await repo.listAccounts(userId));
  }

  async function getCashFlow(period: ReportPeriod, options: ReportOptions = {}): Promise<CashFlowSummary> {
    assertValidPeriod(period);
    const [transactions, categories] = await Promise.all([
      repo.listTransactions(userId, { startDate: period.start, endDate: period.end }),
      repo.listCategories(userId),
    ]);
    return calculateCashFlow(transactions, categories, period, options);
  }

  async function getMonthlyCashFlow(months: readonly MonthKey[], options: ReportOptions = {}): Promise<MonthlyCashFlow[]> {
    const [transactions, categories] = await Promise.all([repo.listTransactions(userId), repo.listCategories(userId)]);
    return calculateCashFlowByMonth(transactions, categories, months, options);
  }

  async function getSpendingByCategory(period: ReportPeriod, options: ReportOptions = {}): Promise<CategorySpendingView[]> {
    assertValidPeriod(period);
    const [transactions, { categories }] = await Promise.all([
      repo.listTransactions(userId, { startDate: period.start, endDate: period.end }),
      loadCategories(),
    ]);
    const rows = calculateSpendingByCategory(transactions, categories, period, options);
    const total = totalOf(rows);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    return rows.map((row) => {
      const category = row.categoryId ? categoryById.get(row.categoryId) : undefined;
      return {
        ...row,
        categoryName: category?.name ?? "Uncategorized",
        groupName: category?.groupName ?? "Other",
        share: total > 0 ? ratioInBasisPoints(row.amount, total) : null,
      };
    });
  }

  /** Net worth at every snapshot date in the period (balances carried forward per account). */
  async function getNetWorthHistory(period: ReportPeriod): Promise<NetWorthPoint[]> {
    assertValidPeriod(period);
    const [accounts, snapshots] = await Promise.all([
      repo.listAccounts(userId),
      repo.listBalanceSnapshots(userId, { endDate: period.end }),
    ]);
    const dates = [...new Set(snapshots.filter((s) => s.date >= period.start).map((s) => s.date))].sort();
    return calculateNetWorthHistory(accounts, snapshots, dates);
  }

  /** Months that have at least one transaction, oldest first. */
  async function getAvailableMonths(): Promise<MonthKey[]> {
    const transactions = await repo.listTransactions(userId);
    if (transactions.length === 0) return [];
    const dates = transactions.map((t) => t.date).sort();
    return monthRange(monthOf(dates[0]!), monthOf(dates[dates.length - 1]!));
  }

  async function getCategoryRules() {
    return repo.listCategoryRules(userId);
  }

  async function getLatestTransactionDate(): Promise<IsoDate | null> {
    const [latest] = await repo.listTransactions(userId);
    return latest?.date ?? null;
  }

  return {
    getAccounts,
    getAccountGroups,
    getCategories: loadCategories,
    getCategoryRules,
    getTransactions,
    getNetWorth,
    getCashFlow,
    getMonthlyCashFlow,
    getSpendingByCategory,
    getNetWorthHistory,
    getAvailableMonths,
    getLatestTransactionDate,
  };
}

export type FinanceQueries = ReturnType<typeof createFinanceQueries>;
