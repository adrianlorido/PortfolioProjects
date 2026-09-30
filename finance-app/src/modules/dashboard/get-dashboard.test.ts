import { describe, expect, it } from "vitest";
import { SAMPLE_USER, createSampleRepository } from "@/db/sample-bootstrap";
import { createFinanceQueries } from "@/modules/analytics/finance-queries";
import { getDashboard } from "./get-dashboard";

async function dashboard(month?: string) {
  const repo = await createSampleRepository();
  return getDashboard(createFinanceQueries(repo, SAMPLE_USER.id), month);
}

describe("getDashboard", () => {
  it("defaults to the latest sample month and flags it as month-to-date", async () => {
    const d = await dashboard();
    expect(d.month).toBe("2026-09");
    expect(d.isPartialMonth).toBe(true);
    expect(d.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(d.previousCashFlow?.month).toBe("2026-08");
  });

  it("accepts a valid earlier month and ignores invalid ones", async () => {
    expect((await dashboard("2026-06")).month).toBe("2026-06");
    expect((await dashboard("2026-06")).isPartialMonth).toBe(false);
    expect((await dashboard("2019-01")).month).toBe("2026-09");
    expect((await dashboard("garbage")).month).toBe("2026-09");
  });

  it("net-worth change is latest minus the previous snapshot", async () => {
    const d = await dashboard();
    const prev = d.history[d.history.length - 2]!;
    expect(d.netWorthChange).toEqual({ amount: d.netWorth.netWorth - prev.netWorth, since: prev.date });
  });

  it("returns recent transactions newest first", async () => {
    const d = await dashboard();
    const dates = d.recentTransactions.map((t) => t.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(d.recentTransactions).toHaveLength(8);
  });
});
