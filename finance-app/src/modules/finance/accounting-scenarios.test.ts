/**
 * Accounting scenarios (review areas B–F, I, J).
 *
 * Balances here are never hand-typed "after" values: they are derived from opening balances
 * plus the scenario's transactions via applyPostedTransactions (the sign convention as
 * arithmetic). Cash flow comes from the report engine, net worth from calculateNetWorth. The
 * expected numbers are the economic answers stated in the review, not re-computations.
 */
import { describe, expect, it } from "vitest";
import type { AccountType, CategoryKind, TransactionSplit } from "@/domain/models";
import { calculateCashFlow, calculateSpendingByCategory, reportLinesFor, buildCategoryLookup, type ReportableTransaction } from "./cash-flow";
import { MixedCurrencyError } from "./currency";
import { applyPostedTransactions } from "./ledger";
import { type Money, dollars } from "./money";
import { calculateNetWorth, calculateNetWorthHistory } from "./net-worth";
import { monthPeriod } from "./period";
import { SplitError } from "./splits";

const CATEGORIES: { id: string; kind: CategoryKind }[] = [
  { id: "paycheck", kind: "income" },
  { id: "groceries", kind: "expense" },
  { id: "shopping", kind: "expense" },
  { id: "interest_fees", kind: "expense" },
  { id: "transfer", kind: "transfer" },
  { id: "credit_card_payment", kind: "transfer" },
  { id: "loan_payment", kind: "transfer" },
  { id: "investment_contribution", kind: "transfer" },
];

const ACCOUNT_TYPES: Record<string, AccountType> = {
  checking: "checking",
  savings: "savings",
  card: "credit",
  loan: "loan",
  brokerage: "investment",
};

type Tx = ReportableTransaction & { accountId: string };

function tx(accountId: string, amount: number, categoryId: string | null, extra: Partial<Tx> = {}): Tx {
  return {
    accountId,
    date: "2026-09-15",
    amount: dollars(amount),
    currency: "USD",
    pending: false,
    excludedFromReports: false,
    categoryId,
    ...extra,
  };
}

/** Runs a scenario end to end: ledger balances, net worth, and cash flow for the whole period. */
function run(opening: Record<string, number>, txs: Tx[], period = { start: "2026-01-01", end: "2026-12-31" }) {
  const openingMap = new Map(Object.entries(opening).map(([k, v]) => [k, dollars(v)]));
  const after = applyPostedTransactions(openingMap, txs);
  const nw = (balances: Map<string, Money>) =>
    calculateNetWorth([...balances].map(([id, b]) => ({ type: ACCOUNT_TYPES[id]!, currentBalance: b, currency: "USD" }))).netWorth;
  const cashFlow = calculateCashFlow(txs, CATEGORIES, period);
  return {
    before: Object.fromEntries(openingMap),
    after: Object.fromEntries(after),
    netWorthBefore: nw(openingMap),
    netWorthAfter: nw(after),
    income: cashFlow.income,
    spending: cashFlow.spending,
  };
}

const OPENING = { checking: 5_000, savings: 6_000, card: -500, loan: -10_000, brokerage: 20_000 };

// ---- B. Sign convention, one row per economic event -------------------------------------
describe("sign convention (area B): each event's legs, report effect, balance effect and net-worth effect", () => {
  const cases: {
    name: string;
    legs: Tx[];
    income: number;
    spending: number;
    balanceDelta: Partial<Record<keyof typeof OPENING, number>>;
    netWorthDelta: number;
  }[] = [
    { name: "paycheck", legs: [tx("checking", 3_000, "paycheck")], income: 3_000, spending: 0, balanceDelta: { checking: 3_000 }, netWorthDelta: 3_000 },
    { name: "grocery purchase (debit card)", legs: [tx("checking", -120, "groceries")], income: 0, spending: 120, balanceDelta: { checking: -120 }, netWorthDelta: -120 },
    { name: "credit-card purchase", legs: [tx("card", -80, "groceries")], income: 0, spending: 80, balanceDelta: { card: -80 }, netWorthDelta: -80 },
    {
      name: "credit-card payment from checking",
      legs: [tx("checking", -500, "credit_card_payment"), tx("card", 500, "credit_card_payment")],
      income: 0, spending: 0, balanceDelta: { checking: -500, card: 500 }, netWorthDelta: 0,
    },
    {
      name: "checking -> savings transfer",
      legs: [tx("checking", -1_000, "transfer"), tx("savings", 1_000, "transfer")],
      income: 0, spending: 0, balanceDelta: { checking: -1_000, savings: 1_000 }, netWorthDelta: 0,
    },
    {
      name: "savings -> checking transfer",
      legs: [tx("savings", -1_000, "transfer"), tx("checking", 1_000, "transfer")],
      income: 0, spending: 0, balanceDelta: { checking: 1_000, savings: -1_000 }, netWorthDelta: 0,
    },
    { name: "refund to credit card", legs: [tx("card", 40, "shopping")], income: 0, spending: -40, balanceDelta: { card: 40 }, netWorthDelta: 40 },
    {
      name: "loan principal payment",
      legs: [tx("checking", -420, "loan_payment"), tx("loan", 420, "loan_payment")],
      income: 0, spending: 0, balanceDelta: { checking: -420, loan: 420 }, netWorthDelta: 0,
    },
    { name: "loan interest charged by lender", legs: [tx("loan", -80, "interest_fees")], income: 0, spending: 80, balanceDelta: { loan: -80 }, netWorthDelta: -80 },
    {
      name: "investment contribution",
      legs: [tx("checking", -400, "investment_contribution"), tx("brokerage", 400, "investment_contribution")],
      income: 0, spending: 0, balanceDelta: { checking: -400, brokerage: 400 }, netWorthDelta: 0,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = run(OPENING, c.legs);
      expect(r.income).toBe(dollars(c.income));
      expect(r.spending).toBe(dollars(c.spending));
      for (const account of Object.keys(OPENING) as (keyof typeof OPENING)[]) {
        expect(r.after[account]! - r.before[account]!, account).toBe(dollars(c.balanceDelta[account] ?? 0));
      }
      expect(r.netWorthAfter - r.netWorthBefore).toBe(dollars(c.netWorthDelta));
    });
  }

  it("invariant: with every counterpart tracked, Δ net worth = income − spending for every event", () => {
    for (const c of cases) {
      const r = run(OPENING, c.legs);
      expect(r.netWorthAfter - r.netWorthBefore, c.name).toBe(r.income - r.spending);
    }
  });

  it("invariant holds for all events combined in one period", () => {
    const r = run(OPENING, cases.flatMap((c) => c.legs));
    expect(r.netWorthAfter - r.netWorthBefore).toBe(r.income - r.spending);
    expect(r.income).toBe(dollars(3_000));
    expect(r.spending).toBe(dollars(120 + 80 - 40 + 80));
  });
});

// ---- C. Credit-card payment -------------------------------------------------------------
describe("credit-card payment (area C)", () => {
  // Card starts at $0; $500 of purchases in August bring it to -$500; paid in full in September.
  const purchases = [
    tx("card", -300, "groceries", { date: "2026-08-10" }),
    tx("card", -200, "shopping", { date: "2026-08-20" }),
  ];
  // The two legs of ONE transfer. Descriptions are irrelevant to the engine, so they are not
  // even modelled here: classification comes only from the category's kind.
  const paymentChecking = tx("checking", -500, "credit_card_payment", { date: "2026-09-05" });
  const paymentCard = tx("card", 500, "credit_card_payment", { date: "2026-09-05" });

  it("before payment: checking $5,000, card -$500, net worth $4,500", () => {
    const r = run({ checking: 5_000, card: 0 }, purchases);
    expect(r.after).toEqual({ checking: dollars(5_000), card: dollars(-500) });
    expect(r.netWorthAfter).toBe(dollars(4_500));
  });

  it("after payment: checking $4,500, card $0, net worth still $4,500, spending exactly $500, income $0", () => {
    const beforePayment = run({ checking: 5_000, card: 0 }, purchases);
    const all = run({ checking: 5_000, card: 0 }, [...purchases, paymentChecking, paymentCard]);
    expect(all.after).toEqual({ checking: dollars(4_500), card: dollars(0) });
    expect(all.netWorthAfter).toBe(dollars(4_500));
    expect(all.netWorthAfter).toBe(beforePayment.netWorthAfter); // payment doesn't change net worth
    expect(all.spending).toBe(dollars(500)); // only the purchases
    expect(all.income).toBe(0); // the +$500 card leg is not income
  });

  it("the payment month shows no spending; the purchase month shows $500", () => {
    const txs = [...purchases, paymentChecking, paymentCard];
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-08")).spending).toBe(dollars(500));
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-09"))).toMatchObject({ income: 0, spending: 0 });
  });

  it("classification is by category kind, never by text: a mislabelled category counts, a misleading description doesn't", () => {
    // Same economic payment, but the user (wrongly) categorised the checking leg as Shopping:
    // the engine follows the category, so it WOULD count — proving there is no text matching.
    const miscategorised = [...purchases, { ...paymentChecking, categoryId: "shopping" }, paymentCard];
    expect(run({ checking: 5_000, card: 0 }, miscategorised).spending).toBe(dollars(1_000));
  });

  it("if both legs are uncategorized they still net to zero spending in the same period (refund-like card leg)", () => {
    const r = run({ checking: 5_000, card: 0 }, [...purchases, { ...paymentChecking, categoryId: null }, { ...paymentCard, categoryId: null }]);
    expect(r.spending).toBe(dollars(500));
    expect(r.income).toBe(0);
  });
});

// ---- D. Loan payment with principal and interest ----------------------------------------
describe("loan payment: $500 = $420 principal + $80 interest (area D)", () => {
  const opening = { checking: 5_000, loan: -10_000 };
  const expected = (r: ReturnType<typeof run>) => {
    expect(r.after.checking! - r.before.checking!).toBe(dollars(-500)); // checking decreases $500
    expect(r.after.loan! - r.before.loan!).toBe(dollars(420)); // liability decreases $420
    expect(r.spending).toBe(dollars(80)); // only interest is spending
    expect(r.income).toBe(0);
    expect(r.netWorthAfter - r.netWorthBefore).toBe(dollars(-80)); // net worth declines $80
  };

  it("representation 1 — lender posts interest separately on the loan account", () => {
    expected(
      run(opening, [
        tx("checking", -500, "loan_payment"),
        tx("loan", 500, "loan_payment"),
        tx("loan", -80, "interest_fees"),
      ]),
    );
  });

  it("representation 2 — one $500 payment split into principal and interest", () => {
    const splits: TransactionSplit[] = [
      { amount: dollars(-420), categoryId: "loan_payment" },
      { amount: dollars(-80), categoryId: "interest_fees" },
    ];
    const r = run(opening, [tx("checking", -500, "loan_payment", { splits }), tx("loan", 420, "loan_payment")]);
    expected(r);
    const byCategory = calculateSpendingByCategory([tx("checking", -500, "loan_payment", { splits })], CATEGORIES, monthPeriod("2026-09"));
    expect(byCategory).toEqual([{ categoryId: "interest_fees", amount: dollars(80), transactionCount: 1 }]);
  });

  it("without a split, the whole payment is either all-transfer ($0 spending) or all-expense ($500) — both wrong", () => {
    const asTransfer = run(opening, [tx("checking", -500, "loan_payment"), tx("loan", 420, "loan_payment")]);
    const asExpense = run(opening, [tx("checking", -500, "interest_fees"), tx("loan", 420, "loan_payment")]);
    expect(asTransfer.spending).toBe(0);
    expect(asExpense.spending).toBe(dollars(500));
    // Net worth is right either way (it comes from balances), which is exactly why the
    // Δnet worth = income − spending invariant flags the missing split:
    expect(asTransfer.netWorthAfter - asTransfer.netWorthBefore).not.toBe(asTransfer.income - asTransfer.spending);
    expect(asExpense.netWorthAfter - asExpense.netWorthBefore).not.toBe(asExpense.income - asExpense.spending);
  });

  it("split lines must sum exactly to the amount; single-line and zero lines are rejected", () => {
    const lookup = buildCategoryLookup(CATEGORIES);
    const bad = (splits: TransactionSplit[]) => () => reportLinesFor(tx("checking", -500, null, { splits }), lookup);
    expect(bad([{ amount: dollars(-420), categoryId: "loan_payment" }, { amount: dollars(-79.99), categoryId: "interest_fees" }])).toThrow(SplitError);
    expect(bad([{ amount: dollars(-500), categoryId: "loan_payment" }])).toThrow(SplitError);
    expect(bad([{ amount: dollars(-500), categoryId: "loan_payment" }, { amount: dollars(0), categoryId: "interest_fees" }])).toThrow(SplitError);
  });

  it("exclusion and pending apply to the whole split transaction", () => {
    const splits: TransactionSplit[] = [
      { amount: dollars(-420), categoryId: "loan_payment" },
      { amount: dollars(-80), categoryId: "interest_fees" },
    ];
    expect(run(opening, [tx("checking", -500, null, { splits, excludedFromReports: true })]).spending).toBe(0);
    expect(run(opening, [tx("checking", -500, null, { splits, pending: true })]).spending).toBe(0);
  });
});

// ---- E. Internal transfers ----------------------------------------------------------------
describe("internal transfers (area E)", () => {
  it("checking -> savings $1,000: $4,000/$6,000 -> $3,000/$7,000, net worth $10,000, income $0, spending $0", () => {
    const r = run({ checking: 4_000, savings: 6_000 }, [tx("checking", -1_000, "transfer"), tx("savings", 1_000, "transfer")]);
    expect(r.after).toEqual({ checking: dollars(3_000), savings: dollars(7_000) });
    expect(r.netWorthBefore).toBe(dollars(10_000));
    expect(r.netWorthAfter).toBe(dollars(10_000));
    expect(r.income).toBe(0);
    expect(r.spending).toBe(0);
  });

  it("savings -> checking $1,000 (reverse): $3,000/$7,000 -> $4,000/$6,000, same totals", () => {
    const r = run({ checking: 3_000, savings: 7_000 }, [tx("savings", -1_000, "transfer"), tx("checking", 1_000, "transfer")]);
    expect(r.after).toEqual({ checking: dollars(4_000), savings: dollars(6_000) });
    expect(r.netWorthAfter).toBe(dollars(10_000));
    expect(r.income).toBe(0);
    expect(r.spending).toBe(0);
  });

  it("legs posting in different months each stay out of their month's report", () => {
    const txs = [tx("checking", -1_000, "transfer", { date: "2026-08-31" }), tx("savings", 1_000, "transfer", { date: "2026-09-01" })];
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-08"))).toMatchObject({ income: 0, spending: 0 });
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-09"))).toMatchObject({ income: 0, spending: 0 });
  });
});

// ---- F. Refunds -----------------------------------------------------------------------------
describe("refunds (area F)", () => {
  it("-$100 purchase and +$40 refund in the same month: eligible spending $60", () => {
    const txs = [tx("card", -100, "shopping"), tx("card", 40, "shopping")];
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-09")).spending).toBe(dollars(60));
    expect(calculateSpendingByCategory(txs, CATEGORIES, monthPeriod("2026-09"))).toEqual([
      { categoryId: "shopping", amount: dollars(60), transactionCount: 2 },
    ]);
  });

  it("refund in a later month: purchase month shows $100, refund month shows -$40 for the category", () => {
    const txs = [
      tx("card", -100, "shopping", { date: "2026-08-10" }),
      tx("card", 40, "shopping", { date: "2026-09-03" }),
      tx("card", -25, "groceries", { date: "2026-09-04" }),
    ];
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-08")).spending).toBe(dollars(100));
    const sept = calculateSpendingByCategory(txs, CATEGORIES, monthPeriod("2026-09"));
    expect(sept).toEqual([
      { categoryId: "groceries", amount: dollars(25), transactionCount: 1 },
      { categoryId: "shopping", amount: dollars(-40), transactionCount: 1 },
    ]);
    // Total September spending is net: $25 − $40 = −$15 (intentional cash-basis reporting).
    expect(calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-09")).spending).toBe(dollars(-15));
    // Across both months the refund exactly offsets: $100 − $40 + $25 = $85.
    expect(calculateCashFlow(txs, CATEGORIES, { start: "2026-08-01", end: "2026-09-30" }).spending).toBe(dollars(85));
  });
});

// ---- I. Net-worth history ------------------------------------------------------------------
describe("net-worth history uses historical snapshots (area I)", () => {
  const accounts = [
    { id: "checking", type: "checking" as const, currency: "USD" },
    { id: "loan", type: "loan" as const, currency: "USD" },
  ];
  const snapshots = [
    { accountId: "checking", date: "2026-09-01", balance: dollars(10_000) },
    { accountId: "loan", date: "2026-09-01", balance: dollars(-2_000) },
    { accountId: "checking", date: "2026-09-02", balance: dollars(11_000) },
    { accountId: "loan", date: "2026-09-02", balance: dollars(-1_500) },
  ];

  it("day 1 = $8,000 and day 2 = $9,500, each from that day's snapshots", () => {
    const history = calculateNetWorthHistory(accounts, snapshots, ["2026-09-01", "2026-09-02"]);
    expect(history).toEqual([
      { date: "2026-09-01", assets: dollars(10_000), liabilities: dollars(2_000), netWorth: dollars(8_000) },
      { date: "2026-09-02", assets: dollars(11_000), liabilities: dollars(1_500), netWorth: dollars(9_500) },
    ]);
  });

  it("is independent of today's balances: history takes no current-balance input at all", () => {
    // The signature has no currentBalance field; changing it on the account objects is irrelevant.
    const withBalances = accounts.map((a) => ({ ...a, currentBalance: dollars(999_999) }));
    expect(calculateNetWorthHistory(withBalances, snapshots, ["2026-09-01"])[0]!.netWorth).toBe(dollars(8_000));
  });

  it("missing snapshots: before an account's first snapshot it contributes $0; gaps carry the last value forward", () => {
    const partial = [
      { accountId: "checking", date: "2026-09-01", balance: dollars(10_000) },
      { accountId: "loan", date: "2026-09-02", balance: dollars(-1_500) },
    ];
    const history = calculateNetWorthHistory(accounts, partial, ["2026-09-01", "2026-09-03"]);
    expect(history.map((p) => p.netWorth)).toEqual([dollars(10_000), dollars(8_500)]);
  });

  it("multiple currencies are rejected", () => {
    expect(() =>
      calculateNetWorthHistory([...accounts, { id: "eur", type: "checking", currency: "EUR" }], snapshots, ["2026-09-01"]),
    ).toThrow(MixedCurrencyError);
  });
});

// ---- J. Currency isolation -----------------------------------------------------------------
describe("currency isolation (area J)", () => {
  it("net worth refuses USD $1,000 + EUR €1,000", () => {
    expect(() =>
      calculateNetWorth([
        { type: "checking", currentBalance: dollars(1_000), currency: "USD" },
        { type: "checking", currentBalance: dollars(1_000), currency: "EUR" },
      ]),
    ).toThrow(MixedCurrencyError);
  });

  it("cash flow and spending-by-category refuse a period containing USD and EUR", () => {
    const txs = [tx("usd", -1_000, "groceries"), tx("eur", -1_000, "groceries", { currency: "EUR" })];
    expect(() => calculateCashFlow(txs, CATEGORIES, monthPeriod("2026-09"))).toThrow(MixedCurrencyError);
    expect(() => calculateSpendingByCategory(txs, CATEGORIES, monthPeriod("2026-09"))).toThrow(MixedCurrencyError);
  });

  it("each currency can still be reported on its own (per-currency reporting)", () => {
    const txs = [tx("usd", -1_000, "groceries"), tx("eur", -700, "groceries", { currency: "EUR" })];
    const byCurrency = (c: string) => calculateCashFlow(txs.filter((t) => t.currency === c), CATEGORIES, monthPeriod("2026-09")).spending;
    expect(byCurrency("USD")).toBe(dollars(1_000));
    expect(byCurrency("EUR")).toBe(dollars(700));
  });
});
