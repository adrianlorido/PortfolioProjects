import type { IsoDate } from "@/domain/models";
import type { FinanceQueries } from "@/modules/analytics/finance-queries";
import { type Money, type MonthKey, isMonthKey, monthOf, monthPeriod, subtract, sum } from "@/modules/finance";

const RECENT_TRANSACTION_COUNT = 8;
const TOP_CATEGORY_COUNT = 7;

/**
 * Assembles the dashboard from the deterministic finance queries. No arithmetic on money
 * happens here beyond period-over-period differences.
 */
export async function getDashboard(queries: FinanceQueries, requestedMonth: string | undefined) {
  const months = await queries.getAvailableMonths();
  const latestMonth = months[months.length - 1];
  const month: MonthKey | undefined =
    requestedMonth && isMonthKey(requestedMonth) && months.includes(requestedMonth) ? requestedMonth : latestMonth;
  const latestDate = await queries.getLatestTransactionDate();

  const [netWorth, history, accountGroups, cashFlowSeries, recent] = await Promise.all([
    queries.getNetWorth(),
    queries.getNetWorthHistory({ start: "1900-01-01", end: "9999-12-31" }),
    queries.getAccountGroups(),
    queries.getMonthlyCashFlow(months),
    queries.getTransactions(),
  ]);

  const monthIndex = month ? months.indexOf(month) : -1;
  const current = monthIndex >= 0 ? cashFlowSeries[monthIndex] : undefined;
  const previous = monthIndex > 0 ? cashFlowSeries[monthIndex - 1] : undefined;
  const spendingRows = month ? await queries.getSpendingByCategory(monthPeriod(month)) : [];

  const previousPoint = history.length >= 2 ? history[history.length - 2] : undefined;
  const netWorthChange: { amount: Money; since: IsoDate } | null = previousPoint
    ? { amount: subtract(netWorth.netWorth, previousPoint.netWorth), since: previousPoint.date }
    : null;

  // Month-over-month deltas are computed here, not in the UI.
  const cashFlowChange =
    current && previous
      ? {
          income: subtract(current.income, previous.income),
          spending: subtract(current.spending, previous.spending),
          savings: subtract(current.savings, previous.savings),
        }
      : null;
  const otherCategories = spendingRows.slice(TOP_CATEGORY_COUNT);

  const isPartialMonth = Boolean(month && latestDate && monthOf(latestDate) === month && latestDate < monthPeriod(month).end);

  return {
    months,
    month: month ?? null,
    isPartialMonth,
    latestDate,
    netWorth,
    netWorthChange,
    history,
    accountGroups,
    cashFlow: current ?? null,
    previousCashFlow: previous ?? null,
    cashFlowSeries,
    cashFlowChange,
    topCategories: spendingRows.slice(0, TOP_CATEGORY_COUNT),
    otherCategories,
    otherCategoriesTotal: sum(otherCategories.map((c) => c.amount)),
    recentTransactions: recent.slice(0, RECENT_TRANSACTION_COUNT),
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
