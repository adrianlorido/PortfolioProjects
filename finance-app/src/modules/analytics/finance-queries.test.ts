import { describe, expect, it } from "vitest";
import { SAMPLE_USER, createSampleRepository } from "@/db/sample-bootstrap";
import { calculateNetWorth, monthPeriod, postedNetChangeByAccount, sum } from "@/modules/finance";
import { createFinanceQueries } from "./finance-queries";

async function queries() {
  const repo = await createSampleRepository();
  return { repo, q: createFinanceQueries(repo, SAMPLE_USER.id) };
}

describe("finance queries over sample data", () => {
  it("net worth comes from account balances and matches the latest net-worth history point", async () => {
    const { q } = await queries();
    const netWorth = await q.getNetWorth();
    const history = await q.getNetWorthHistory({ start: "2026-01-01", end: "2026-12-31" });
    expect(history.length).toBe(7);
    expect(history[history.length - 1]).toMatchObject({ date: "2026-09-28", netWorth: netWorth.netWorth });
    // Independent formula: under the sign convention, net worth is simply the sum of all
    // signed balances (no classification needed). Must agree with assets − liabilities.
    const accounts = await q.getAccounts();
    expect(netWorth.netWorth).toBe(sum(accounts.map((a) => a.currentBalance)));
    expect(netWorth.liabilities).toBe(-sum(accounts.filter((a) => a.accountClass === "liability").map((a) => a.currentBalance)));
  });

  it("every sample transaction is categorized by rules", async () => {
    const { q } = await queries();
    const txs = await q.getTransactions();
    expect(txs.length).toBeGreaterThan(200);
    expect(txs.filter((t) => t.categoryId === null)).toEqual([]);
  });

  it("transfers, card payments and loan payments never appear in spending by category", async () => {
    const { q } = await queries();
    for (const month of await q.getAvailableMonths()) {
      const rows = await q.getSpendingByCategory(monthPeriod(month));
      const names = rows.map((r) => r.categoryName);
      expect(names).not.toContain("Transfer");
      expect(names).not.toContain("Credit Card Payment");
      expect(names).not.toContain("Loan Payment");
      expect(names).not.toContain("Investment Contribution");
      const cashFlow = await q.getCashFlow(monthPeriod(month));
      expect(sum(rows.map((r) => r.amount))).toBe(cashFlow.spending);
    }
  });

  it("excluded sample transactions (work trip + reimbursement) don't affect cash flow", async () => {
    const { repo, q } = await queries();
    const excluded = (await repo.listTransactions(SAMPLE_USER.id)).filter((t) => t.excludedFromReports);
    expect(excluded).toHaveLength(2);
    const sept = await q.getCashFlow(monthPeriod("2026-09"));
    const aug = await q.getCashFlow(monthPeriod("2026-08"));
    // September income is exactly two paychecks: the excluded reimbursement is not income.
    expect(sept.income).toBe(630_000);
    expect((await q.getSpendingByCategory(monthPeriod("2026-08"))).map((r) => r.categoryName)).not.toContain("Flights");
    // Un-excluding the $318.40 work flight raises August spending by exactly $318.40.
    const flight = excluded.find((t) => t.originalDescription.startsWith("DELTA"))!;
    await repo.updateTransactionUserFields(SAMPLE_USER.id, flight.id, { excludedFromReports: false }, "2026-09-29T00:00:00.000Z");
    const augIncluded = await q.getCashFlow(monthPeriod("2026-08"));
    expect(augIncluded.spending - aug.spending).toBe(31_840);
  });

  it("pending sample transactions are ignored by default but can be included", async () => {
    const { q } = await queries();
    const period = monthPeriod("2026-09");
    const posted = await q.getCashFlow(period);
    const withPending = await q.getCashFlow(period, { includePending: true });
    expect(withPending.spending - posted.spending).toBe(8_712 + 1_895);
  });

  it("ledger integrity: for every non-investment account, each snapshot-to-snapshot change equals the posted transactions in between", async () => {
    const { repo } = await queries();
    const accounts = (await repo.listAccounts(SAMPLE_USER.id)).filter((a) => a.type !== "investment");
    const transactions = await repo.listTransactions(SAMPLE_USER.id);
    for (const account of accounts) {
      const snaps = await repo.listBalanceSnapshots(SAMPLE_USER.id, { accountId: account.id });
      expect(snaps.length).toBeGreaterThan(2);
      for (let i = 1; i < snaps.length; i++) {
        const between = transactions.filter((t) => t.accountId === account.id && t.date > snaps[i - 1]!.date && t.date <= snaps[i]!.date);
        const change = postedNetChangeByAccount(between).get(account.id) ?? 0;
        expect(snaps[i]!.balance - snaps[i - 1]!.balance, `${account.name} ${snaps[i]!.date}`).toBe(change);
      }
    }
    // And the latest history point is today's net worth.
    const history = await createFinanceQueries(repo, SAMPLE_USER.id).getNetWorthHistory({ start: "2026-03-31", end: "2026-09-28" });
    expect(history[history.length - 1]!.netWorth).toBe(calculateNetWorth(await repo.listAccounts(SAMPLE_USER.id)).netWorth);
  });

  it("returns results for one user only", async () => {
    const { repo } = await queries();
    repo.seedUser({ id: "other", displayName: "Other" });
    const other = createFinanceQueries(repo, "other");
    expect(await other.getAccounts()).toEqual([]);
    expect((await other.getNetWorth()).netWorth).toBe(0);
    expect(await other.getTransactions()).toEqual([]);
  });
});
