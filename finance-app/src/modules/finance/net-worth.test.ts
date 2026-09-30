import { describe, expect, it } from "vitest";
import type { AccountType } from "@/domain/models";
import { MixedCurrencyError } from "./currency";
import { dollars } from "./money";
import { calculateNetWorth, calculateNetWorthHistory } from "./net-worth";

const acct = (type: AccountType, balance: number, currency = "USD") => ({
  type,
  currentBalance: dollars(balance),
  currency,
});

describe("calculateNetWorth (requirement A)", () => {
  it("assets $100,000 - liabilities $30,000 = $70,000", () => {
    const result = calculateNetWorth([
      acct("checking", 10_000),
      acct("savings", 25_000),
      acct("investment", 65_000),
      acct("credit", -5_000), // $5k owed
      acct("loan", -25_000), // $25k owed
    ]);
    expect(result).toEqual({ assets: dollars(100_000), liabilities: dollars(30_000), netWorth: dollars(70_000) });
  });

  it("classifies by account type, not balance sign", () => {
    const result = calculateNetWorth([
      acct("checking", -200), // overdrawn: still an asset
      acct("credit", 50), // overpaid card: still a liability, reduces amount owed
      acct("other_liability", -1_000),
      acct("cash", 300),
      acct("other_asset", 5_000),
    ]);
    expect(result.assets).toBe(dollars(5_100));
    expect(result.liabilities).toBe(dollars(950));
    expect(result.netWorth).toBe(dollars(4_150));
  });

  it("is zero for no accounts", () => {
    expect(calculateNetWorth([]).netWorth).toBe(0);
  });

  it("refuses to add different currencies", () => {
    expect(() => calculateNetWorth([acct("checking", 1), acct("savings", 1, "EUR")])).toThrow(MixedCurrencyError);
  });
});

describe("calculateNetWorthHistory", () => {
  const accounts = [
    { id: "chk", type: "checking" as const, currency: "USD" },
    { id: "card", type: "credit" as const, currency: "USD" },
  ];
  const snapshots = [
    { accountId: "chk", date: "2026-01-31", balance: dollars(1_000) },
    { accountId: "chk", date: "2026-02-28", balance: dollars(1_500) },
    { accountId: "card", date: "2026-02-28", balance: dollars(-400) },
  ];

  it("uses the latest snapshot on or before each date and carries balances forward", () => {
    const history = calculateNetWorthHistory(accounts, snapshots, ["2026-03-15", "2026-01-31", "2026-02-10"]);
    expect(history.map((p) => [p.date, p.netWorth])).toEqual([
      ["2026-01-31", dollars(1_000)],
      ["2026-02-10", dollars(1_000)], // card has no data yet -> contributes 0
      ["2026-03-15", dollars(1_100)],
    ]);
    expect(history[2]).toMatchObject({ assets: dollars(1_500), liabilities: dollars(400) });
  });

  it("rejects snapshots for unknown accounts", () => {
    expect(() =>
      calculateNetWorthHistory(accounts, [{ accountId: "nope", date: "2026-01-01", balance: dollars(1) }], ["2026-01-01"]),
    ).toThrow(/unknown account/);
  });
});
