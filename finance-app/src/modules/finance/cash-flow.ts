import type { Category, CategoryKind, Id, Transaction, TransactionSplit } from "@/domain/models";
import { assertSingleCurrency } from "./currency";
import { validateSplits } from "./splits";
import { type BasisPoints, type Money, ZERO, add, money, negate, ratioInBasisPoints, subtract } from "./money";
import { type MonthKey, type ReportPeriod, assertValidPeriod, isDateInPeriod, monthPeriod } from "./period";

/**
 * Cash-flow rules (documented in docs/finance-rules.md; every rule is covered by tests):
 *
 * 1. Excluded transactions (excludedFromReports) never count toward income or spending.
 * 2. Pending transactions are ignored by default. The amount of a pending transaction can
 *    still change or disappear, and it will reappear as a posted transaction later, so
 *    counting it risks double counting. Pass { includePending: true } to opt in.
 * 3. Transfer-kind categories (Transfer, Credit Card Payment, Loan Payment, …) are neither
 *    income nor spending. Both legs of a move between the user's own accounts are
 *    categorized as transfers, so moving money never creates income or spending.
 * 4. Credit-card purchases count as spending when they are made (on the card account).
 *    The later card payment is a transfer, so the same purchase is not counted twice.
 * 5. Loan payments are transfers (they reduce a liability, not net worth). Interest is
 *    spending when the lender posts it as a separate charge.
 * 6. Refunds are positive amounts in an expense category and reduce spending (net).
 * 7. Income = sum of amounts in income categories (a negative income entry, e.g. a payroll
 *    reversal, reduces income).
 * 8. Uncategorized transactions (categoryId = null) are treated as expense-kind, so an
 *    unrecognised outflow still shows up as spending rather than vanishing.
 * 9. Split transactions are reported line by line: each split line is classified by its own
 *    category (so a loan payment can be $420 transfer + $80 expense). Exclusion and pending
 *    status apply to the whole transaction. Lines must sum exactly to the amount.
 */

export interface ReportOptions {
  /** Default false: pending transactions are ignored in reports. */
  includePending?: boolean;
}

export type ReportableTransaction = Pick<
  Transaction,
  "date" | "amount" | "currency" | "pending" | "excludedFromReports" | "categoryId"
> & { splits?: readonly TransactionSplit[] };
export type ReportCategory = Pick<Category, "id" | "kind">;

export type ReportClassification =
  | { counted: true; kind: Exclude<CategoryKind, "transfer"> }
  | { counted: false; reason: "excluded" | "pending" | "transfer" };

export class UnknownCategoryError extends Error {
  constructor(categoryId: Id) {
    super(`Transaction references unknown category ${categoryId}`);
    this.name = "UnknownCategoryError";
  }
}

export type CategoryLookup = ReadonlyMap<Id, ReportCategory>;

export function buildCategoryLookup(categories: readonly ReportCategory[]): CategoryLookup {
  return new Map(categories.map((c) => [c.id, c]));
}

/** The single place that decides whether and how a transaction participates in cash-flow reports. */
export function classifyForReports(
  tx: ReportableTransaction,
  categories: CategoryLookup,
  options: ReportOptions = {},
): ReportClassification {
  if (tx.excludedFromReports) return { counted: false, reason: "excluded" };
  if (tx.pending && !options.includePending) return { counted: false, reason: "pending" };
  let kind: CategoryKind = "expense";
  if (tx.categoryId !== null) {
    const category = categories.get(tx.categoryId);
    if (!category) throw new UnknownCategoryError(tx.categoryId);
    kind = category.kind;
  }
  if (kind === "transfer") return { counted: false, reason: "transfer" };
  return { counted: true, kind };
}

/** A counted piece of a transaction: the whole transaction, or one split line. */
export interface ReportLine {
  amount: Money;
  categoryId: Id | null;
  kind: "income" | "expense";
}

/**
 * The lines of a transaction that count toward reports (empty when it doesn't count).
 * Unsplit: one line with the transaction's amount and category. Split: one line per split.
 */
export function reportLinesFor(tx: ReportableTransaction, categories: CategoryLookup, options: ReportOptions = {}): ReportLine[] {
  const splits = tx.splits ?? [];
  validateSplits(tx.amount, splits);
  const lines = splits.length > 0 ? splits : [{ amount: tx.amount, categoryId: tx.categoryId }];
  const counted: ReportLine[] = [];
  for (const line of lines) {
    const c = classifyForReports({ ...tx, amount: line.amount, categoryId: line.categoryId }, categories, options);
    if (c.counted) counted.push({ amount: line.amount, categoryId: line.categoryId, kind: c.kind });
  }
  return counted;
}

function countedInPeriod(
  transactions: readonly ReportableTransaction[],
  categories: CategoryLookup,
  period: ReportPeriod,
  kind: "income" | "expense",
  options: ReportOptions,
): ReportLine[] {
  assertValidPeriod(period);
  const inPeriod = transactions.filter((tx) => isDateInPeriod(tx.date, period));
  assertSingleCurrency(inPeriod);
  return inPeriod.flatMap((tx) => reportLinesFor(tx, categories, options)).filter((line) => line.kind === kind);
}

/** Total income in the period, as a (normally positive) amount. */
export function calculateIncome(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  period: ReportPeriod,
  options: ReportOptions = {},
): Money {
  const lookup = buildCategoryLookup(categories);
  return countedInPeriod(transactions, lookup, period, "income", options).reduce((t, line) => add(t, line.amount), ZERO);
}

/** Net spending in the period, as a positive amount (outflows minus refunds). */
export function calculateSpending(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  period: ReportPeriod,
  options: ReportOptions = {},
): Money {
  const lookup = buildCategoryLookup(categories);
  const net = countedInPeriod(transactions, lookup, period, "expense", options).reduce(
    (t, line) => add(t, line.amount),
    ZERO,
  );
  // Expense outflows are negative under the sign convention; spending is reported as positive.
  return negate(net);
}

/** Savings = income - spending. Negative when the user spent more than they earned. */
export function calculateSavings(income: Money, spending: Money): Money {
  return subtract(income, spending);
}

/**
 * Savings rate = savings / income, in basis points (3000 = 30%).
 * Null when income is zero or negative: the ratio is undefined or meaningless there.
 */
export function calculateSavingsRate(income: Money, savings: Money): BasisPoints | null {
  if (income <= 0) return null;
  return ratioInBasisPoints(savings, income);
}

export interface CashFlowSummary {
  period: ReportPeriod;
  income: Money;
  spending: Money;
  savings: Money;
  savingsRate: BasisPoints | null;
}

export function calculateCashFlow(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  period: ReportPeriod,
  options: ReportOptions = {},
): CashFlowSummary {
  const income = calculateIncome(transactions, categories, period, options);
  const spending = calculateSpending(transactions, categories, period, options);
  const savings = calculateSavings(income, spending);
  return { period, income, spending, savings, savingsRate: calculateSavingsRate(income, savings) };
}

// ---- Monthly convenience wrappers ------------------------------------------------------

export function calculateMonthlyIncome(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  month: MonthKey,
  options: ReportOptions = {},
): Money {
  return calculateIncome(transactions, categories, monthPeriod(month), options);
}

export function calculateMonthlySpending(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  month: MonthKey,
  options: ReportOptions = {},
): Money {
  return calculateSpending(transactions, categories, monthPeriod(month), options);
}

export function calculateMonthlySavings(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  month: MonthKey,
  options: ReportOptions = {},
): Money {
  const period = monthPeriod(month);
  return calculateSavings(
    calculateIncome(transactions, categories, period, options),
    calculateSpending(transactions, categories, period, options),
  );
}

export interface MonthlyCashFlow extends CashFlowSummary {
  month: MonthKey;
}

export function calculateCashFlowByMonth(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  months: readonly MonthKey[],
  options: ReportOptions = {},
): MonthlyCashFlow[] {
  return months.map((month) => ({ month, ...calculateCashFlow(transactions, categories, monthPeriod(month), options) }));
}

// ---- Spending by category ---------------------------------------------------------------

export interface CategorySpending {
  /** Null bucket = uncategorized. */
  categoryId: Id | null;
  /** Net spending (positive). Can be negative if refunds exceed purchases in the period. */
  amount: Money;
  /** Counted lines: an unsplit transaction is one line; a split contributes one per line. */
  transactionCount: number;
}

/**
 * Net spending per expense category for the period, largest first. Uses exactly the same
 * inclusion rules as calculateSpending, so the rows always sum to calculateSpending().
 */
export function calculateSpendingByCategory(
  transactions: readonly ReportableTransaction[],
  categories: readonly ReportCategory[],
  period: ReportPeriod,
  options: ReportOptions = {},
): CategorySpending[] {
  const lookup = buildCategoryLookup(categories);
  const buckets = new Map<Id | null, { net: Money; count: number }>();
  for (const line of countedInPeriod(transactions, lookup, period, "expense", options)) {
    const bucket = buckets.get(line.categoryId) ?? { net: ZERO, count: 0 };
    buckets.set(line.categoryId, { net: add(bucket.net, line.amount), count: bucket.count + 1 });
  }
  return [...buckets.entries()]
    .map(([categoryId, { net, count }]) => ({ categoryId, amount: negate(net), transactionCount: count }))
    .sort((a, b) => b.amount - a.amount || String(a.categoryId).localeCompare(String(b.categoryId)));
}

/** Total of a spending breakdown; equals calculateSpending for the same inputs. */
export function totalOf(rows: readonly { amount: Money }[]): Money {
  return rows.reduce((t, r) => add(t, r.amount), money(0));
}
