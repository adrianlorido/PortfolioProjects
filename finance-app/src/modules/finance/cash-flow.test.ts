import { describe, expect, it } from "vitest";
import type { CategoryKind } from "@/domain/models";
import {
  UnknownCategoryError,
  calculateCashFlow,
  calculateCashFlowByMonth,
  calculateIncome,
  calculateMonthlyIncome,
  calculateMonthlySavings,
  calculateMonthlySpending,
  calculateSavingsRate,
  calculateSpending,
  calculateSpendingByCategory,
  classifyForReports,
  buildCategoryLookup,
  totalOf,
  type ReportableTransaction,
} from "./cash-flow";
import { MixedCurrencyError } from "./currency";
import { calculateNetWorth } from "./net-worth";
import { dollars } from "./money";
import { monthPeriod } from "./period";

const categories: { id: string; kind: CategoryKind }[] = [
  { id: "paycheck", kind: "income" },
  { id: "groceries", kind: "expense" },
  { id: "dining", kind: "expense" },
  { id: "rent", kind: "expense" },
  { id: "shopping", kind: "expense" },
  { id: "transfer", kind: "transfer" },
  { id: "cc_payment", kind: "transfer" },
  { id: "loan_payment", kind: "transfer" },
  { id: "interest", kind: "expense" },
];

const SEPT = monthPeriod("2026-09");

function tx(amount: number, categoryId: string | null, overrides: Partial<ReportableTransaction> = {}): ReportableTransaction {
  return {
    date: "2026-09-15",
    amount: dollars(amount),
    currency: "USD",
    pending: false,
    excludedFromReports: false,
    categoryId,
    ...overrides,
  };
}

describe("cash flow (requirement B)", () => {
  it("income $5,000, eligible spending $3,500 -> savings $1,500, savings rate 30%", () => {
    const txs = [
      tx(2_500, "paycheck", { date: "2026-09-01" }),
      tx(2_500, "paycheck", { date: "2026-09-15" }),
      tx(-2_000, "rent"),
      tx(-900, "groceries"),
      tx(-600, "dining"),
    ];
    const result = calculateCashFlow(txs, categories, SEPT);
    expect(result.income).toBe(dollars(5_000));
    expect(result.spending).toBe(dollars(3_500));
    expect(result.savings).toBe(dollars(1_500));
    expect(result.savingsRate).toBe(3000); // basis points = 30.00%

    expect(calculateMonthlyIncome(txs, categories, "2026-09")).toBe(dollars(5_000));
    expect(calculateMonthlySpending(txs, categories, "2026-09")).toBe(dollars(3_500));
    expect(calculateMonthlySavings(txs, categories, "2026-09")).toBe(dollars(1_500));
    expect(calculateSavingsRate(dollars(5_000), dollars(1_500))).toBe(3000);
  });

  it("savings rate is negative when overspending and undefined without income", () => {
    expect(calculateSavingsRate(dollars(1_000), dollars(-250))).toBe(-2500);
    expect(calculateSavingsRate(dollars(0), dollars(-250))).toBeNull();
    expect(calculateSavingsRate(dollars(-10), dollars(-10))).toBeNull();
  });

  it("only counts transactions dated inside the period (inclusive bounds)", () => {
    const txs = [
      tx(-10, "dining", { date: "2026-08-31" }),
      tx(-20, "dining", { date: "2026-09-01" }),
      tx(-30, "dining", { date: "2026-09-30" }),
      tx(-40, "dining", { date: "2026-10-01" }),
    ];
    expect(calculateSpending(txs, categories, SEPT)).toBe(dollars(50));
  });

  it("produces a per-month series", () => {
    const txs = [tx(1_000, "paycheck", { date: "2026-08-10" }), tx(-100, "dining", { date: "2026-09-10" })];
    const series = calculateCashFlowByMonth(txs, categories, ["2026-08", "2026-09"]);
    expect(series.map((m) => [m.month, m.income, m.spending, m.savings])).toEqual([
      ["2026-08", dollars(1_000), 0, dollars(1_000)],
      ["2026-09", 0, dollars(100), dollars(-100)],
    ]);
  });
});

describe("internal transfers (requirement C)", () => {
  it("moving $1,000 from checking to savings creates no income and no spending", () => {
    const txs = [
      tx(-1_000, "transfer"), // checking leg
      tx(1_000, "transfer"), // savings leg
    ];
    const result = calculateCashFlow(txs, categories, SEPT);
    expect(result.income).toBe(0);
    expect(result.spending).toBe(0);
    expect(result.savings).toBe(0);
    expect(calculateSpendingByCategory(txs, categories, SEPT)).toEqual([]);
  });

  it("transfers don't disturb other income/spending in the same period", () => {
    const txs = [tx(3_000, "paycheck"), tx(-1_000, "transfer"), tx(1_000, "transfer"), tx(-200, "groceries")];
    const result = calculateCashFlow(txs, categories, SEPT);
    expect(result.income).toBe(dollars(3_000));
    expect(result.spending).toBe(dollars(200));
  });

  it("net worth is unchanged by an internal transfer", () => {
    const before = calculateNetWorth([
      { type: "checking", currentBalance: dollars(5_000), currency: "USD" },
      { type: "savings", currentBalance: dollars(10_000), currency: "USD" },
    ]);
    const after = calculateNetWorth([
      { type: "checking", currentBalance: dollars(4_000), currency: "USD" },
      { type: "savings", currentBalance: dollars(11_000), currency: "USD" },
    ]);
    expect(after.netWorth).toBe(before.netWorth);
  });
});

describe("credit-card payments (requirement D)", () => {
  const purchases = [tx(-300, "groceries", { date: "2026-08-10" }), tx(-200, "dining", { date: "2026-08-20" })];
  const payment = [
    tx(-500, "cc_payment", { date: "2026-09-05" }), // checking leg
    tx(500, "cc_payment", { date: "2026-09-05" }), // card leg
  ];

  it("paying a $500 card bill does not count the $500 of purchases a second time", () => {
    const all = [...purchases, ...payment];
    const whole = { start: "2026-08-01", end: "2026-09-30" };
    expect(calculateSpending(all, categories, whole)).toBe(dollars(500));
    expect(calculateIncome(all, categories, whole)).toBe(0);
  });

  it("purchases count in the month they were made; the payment month shows no spending", () => {
    const all = [...purchases, ...payment];
    expect(calculateMonthlySpending(all, categories, "2026-08")).toBe(dollars(500));
    expect(calculateMonthlySpending(all, categories, "2026-09")).toBe(0);
  });

  it("the payment leaves net worth unchanged (asset down, liability down)", () => {
    const before = calculateNetWorth([
      { type: "checking", currentBalance: dollars(2_000), currency: "USD" },
      { type: "credit", currentBalance: dollars(-500), currency: "USD" },
    ]);
    const after = calculateNetWorth([
      { type: "checking", currentBalance: dollars(1_500), currency: "USD" },
      { type: "credit", currentBalance: dollars(0), currency: "USD" },
    ]);
    expect(after.netWorth).toBe(before.netWorth);
    expect(after.liabilities).toBe(0);
  });
});

describe("loan payments and interest", () => {
  it("principal payment is a transfer; interest posted by the lender is spending", () => {
    const txs = [
      tx(-450, "loan_payment"), // checking leg
      tx(450, "loan_payment"), // loan leg
      tx(-62.5, "interest"), // interest charged on the loan account
    ];
    expect(calculateSpending(txs, categories, SEPT)).toBe(dollars(62.5));
    expect(calculateIncome(txs, categories, SEPT)).toBe(0);
  });
});

describe("refunds", () => {
  it("a refund in an expense category reduces spending in that category", () => {
    const txs = [tx(-120, "shopping"), tx(45, "shopping"), tx(-80, "groceries")];
    expect(calculateSpending(txs, categories, SEPT)).toBe(dollars(155));
    const byCategory = calculateSpendingByCategory(txs, categories, SEPT);
    expect(byCategory).toEqual([
      { categoryId: "groceries", amount: dollars(80), transactionCount: 1 },
      { categoryId: "shopping", amount: dollars(75), transactionCount: 2 },
    ]);
  });

  it("a refund is not income", () => {
    expect(calculateIncome([tx(45, "shopping")], categories, SEPT)).toBe(0);
  });

  it("a category can go net-negative when refunds exceed purchases in the period", () => {
    const rows = calculateSpendingByCategory([tx(60, "shopping"), tx(-20, "shopping")], categories, SEPT);
    expect(rows).toEqual([{ categoryId: "shopping", amount: dollars(-40), transactionCount: 2 }]);
  });
});

describe("excluded transactions (requirement E)", () => {
  const txs = [
    tx(5_000, "paycheck"),
    tx(-1_000, "groceries"),
    tx(-750, "dining", { excludedFromReports: true }), // e.g. reimbursable work dinner
    tx(2_000, "paycheck", { excludedFromReports: true }), // e.g. one-off reimbursement
  ];

  it("excluded transactions affect neither income nor spending", () => {
    const result = calculateCashFlow(txs, categories, SEPT);
    expect(result.income).toBe(dollars(5_000));
    expect(result.spending).toBe(dollars(1_000));
    expect(result.savings).toBe(dollars(4_000));
  });

  it("excluded transactions are absent from spending by category", () => {
    const rows = calculateSpendingByCategory(txs, categories, SEPT);
    expect(rows.map((r) => r.categoryId)).toEqual(["groceries"]);
  });

  it("exclusion wins even with includePending", () => {
    const pendingExcluded = tx(-99, "dining", { pending: true, excludedFromReports: true });
    expect(classifyForReports(pendingExcluded, buildCategoryLookup(categories), { includePending: true })).toEqual({
      counted: false,
      reason: "excluded",
    });
  });
});

describe("pending transactions (requirement F)", () => {
  const txs = [tx(-100, "groceries"), tx(-40, "dining", { pending: true }), tx(800, "paycheck", { pending: true })];

  it("policy: pending transactions are ignored by default", () => {
    const result = calculateCashFlow(txs, categories, SEPT);
    expect(result.spending).toBe(dollars(100));
    expect(result.income).toBe(0);
    expect(calculateSpendingByCategory(txs, categories, SEPT)).toEqual([
      { categoryId: "groceries", amount: dollars(100), transactionCount: 1 },
    ]);
  });

  it("pending transactions can be included explicitly", () => {
    const result = calculateCashFlow(txs, categories, SEPT, { includePending: true });
    expect(result.spending).toBe(dollars(140));
    expect(result.income).toBe(dollars(800));
  });
});

describe("classification edge cases", () => {
  it("uncategorized outflows count as spending in a null bucket", () => {
    const rows = calculateSpendingByCategory([tx(-25, null), tx(-10, "dining")], categories, SEPT);
    expect(rows).toEqual([
      { categoryId: null, amount: dollars(25), transactionCount: 1 },
      { categoryId: "dining", amount: dollars(10), transactionCount: 1 },
    ]);
  });

  it("an unknown category id is an error, not silently dropped", () => {
    expect(() => calculateSpending([tx(-1, "ghost")], categories, SEPT)).toThrow(UnknownCategoryError);
  });

  it("a payroll reversal (negative income) reduces income", () => {
    expect(calculateIncome([tx(3_000, "paycheck"), tx(-3_000, "paycheck")], categories, SEPT)).toBe(0);
  });

  it("refuses mixed currencies in a period", () => {
    expect(() => calculateSpending([tx(-1, "dining"), tx(-1, "dining", { currency: "EUR" })], categories, SEPT)).toThrow(
      MixedCurrencyError,
    );
  });

  it("spending by category always sums to total spending", () => {
    const txs = [
      tx(-12.34, "dining"),
      tx(-56.78, "groceries"),
      tx(9.99, "groceries"),
      tx(-0.01, null),
      tx(-100, "transfer"),
      tx(-5, "dining", { pending: true }),
      tx(-7, "dining", { excludedFromReports: true }),
    ];
    expect(totalOf(calculateSpendingByCategory(txs, categories, SEPT))).toBe(calculateSpending(txs, categories, SEPT));
  });
});
