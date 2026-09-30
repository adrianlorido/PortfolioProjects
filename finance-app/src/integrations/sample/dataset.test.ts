import { describe, expect, it } from "vitest";
import { add, money, sum } from "@/modules/finance/money";
import { SAMPLE_AS_OF_DATE, generateSampleDataset } from "./dataset";
import { SampleFinancialDataProvider } from "./provider";

const dataset = generateSampleDataset();

describe("sample dataset", () => {
  it("is deterministic: two generations are identical", () => {
    expect(generateSampleDataset()).toEqual(dataset);
    expect(JSON.stringify(generateSampleDataset())).toBe(JSON.stringify(dataset));
  });

  it("contains the required account types", () => {
    expect(dataset.accounts.map((a) => a.type).sort()).toEqual(["checking", "credit", "investment", "loan", "savings"]);
  });

  it("spans six months and nothing after the as-of date", () => {
    const months = new Set(dataset.transactions.map((t) => t.date.slice(0, 7)));
    expect([...months].sort()).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(dataset.transactions.every((t) => t.date <= SAMPLE_AS_OF_DATE)).toBe(true);
  });

  it("has unique external transaction ids and only integer minor-unit amounts", () => {
    const ids = dataset.transactions.map((t) => t.externalTransactionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(dataset.transactions.every((t) => Number.isSafeInteger(t.amount))).toBe(true);
  });

  it("includes pending transactions only at the end of the data", () => {
    const pending = dataset.transactions.filter((t) => t.pending);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((t) => t.date >= "2026-09-25")).toBe(true);
  });

  it("ledger account balances equal opening balance + posted transactions (pending excluded)", () => {
    for (const account of dataset.accounts.filter((a) => a.type !== "investment")) {
      const balances = dataset.balances.filter((b) => b.externalAccountId === account.externalAccountId);
      const opening = balances[0]!;
      const posted = dataset.transactions.filter((t) => t.externalAccountId === account.externalAccountId && !t.pending);
      expect(add(opening.balance, sum(posted.map((t) => t.amount)))).toBe(account.currentBalance);
      expect(balances[balances.length - 1]!.balance).toBe(account.currentBalance);
    }
  });

  it("credit card payments exactly pay off the previous month's charges", () => {
    const visa = dataset.accounts.find((a) => a.type === "credit")!;
    const payments = dataset.transactions.filter((t) => t.externalAccountId === visa.externalAccountId && t.originalDescription === "ONLINE PAYMENT - THANK YOU");
    expect(payments).toHaveLength(6);
    // Each card-side payment has a matching checking-side outflow on the same day.
    for (const p of payments) {
      const other = dataset.transactions.find((t) => t.date === p.date && t.originalDescription === "SUMMIT CARD ONLINE PMT");
      expect(other?.amount).toBe(money(-p.amount));
    }
  });

  it("every transfer leg has an opposite leg of the same size on the same day", () => {
    const pairs: [string, string][] = [
      ["ONLINE TRANSFER TO SAVINGS XXXX4821", "ONLINE TRANSFER FROM CHECKING XXXX1934"],
      ["HARBOR BROKERAGE ACH CONTRIB", "ACH CONTRIBUTION RECEIVED"],
      ["NORTHWIND AUTO FIN PMT", "AUTO LOAN PAYMENT RECEIVED"],
    ];
    for (const [out, inn] of pairs) {
      const outs = dataset.transactions.filter((t) => t.originalDescription === out);
      const ins = dataset.transactions.filter((t) => t.originalDescription === inn);
      expect(outs.length).toBeGreaterThan(0);
      expect(outs.map((t) => [t.date, -t.amount])).toEqual(ins.map((t) => [t.date, t.amount]));
    }
  });

  it("covers every required spending/income theme", () => {
    const text = dataset.transactions.map((t) => t.originalDescription).join("\n");
    for (const needle of ["PAYROLL", "WHOLEFDS", "CHIPOTLE", "AMAZON", "SHELL OIL", "PGANDE", "NETFLIX", "ONLINE TRANSFER", "SUMMIT CARD ONLINE PMT", "REFUND"]) {
      expect(text).toContain(needle);
    }
  });
});

describe("SampleFinancialDataProvider", () => {
  const provider = new SampleFinancialDataProvider(dataset);
  const ref = { connectionId: "c1", providerConnectionId: "sample-inst-summit" };

  it("pages through transactions with a cursor and then returns nothing new", async () => {
    let cursor: string | null = null;
    let total = 0;
    for (;;) {
      const page = await provider.syncTransactions(ref, cursor);
      total += page.added.length;
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    const expected = dataset.transactions.filter((t) => t.institutionId === "sample-inst-summit").length;
    expect(total).toBe(expected);
    expect(expected).toBeGreaterThan(100); // exercised more than one page
    const after = await provider.syncTransactions(ref, cursor);
    expect(after.added).toHaveLength(0);
  });

  it("scopes accounts to the connection and never leaks the internal institution tag", async () => {
    const accounts = await provider.getAccounts(ref);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).not.toHaveProperty("institutionId");
  });

  it("rejects unknown institutions", async () => {
    await expect(provider.connectInstitution({ userId: "u", publicToken: "nope" })).rejects.toThrow();
  });
});
