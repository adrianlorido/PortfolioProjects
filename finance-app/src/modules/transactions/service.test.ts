import { describe, expect, it } from "vitest";
import { SAMPLE_USER, createSampleRepository } from "@/db/sample-bootstrap";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseTransactionFilters } from "./schemas";
import { setTransactionSplitsFromInput, updateTransactionFromInput } from "./service";

const now = "2026-09-29T00:00:00.000Z";

async function setup() {
  const repo = await createSampleRepository();
  const [tx] = await repo.listTransactions(SAMPLE_USER.id, { search: "CHIPOTLE" });
  return { repo, tx: tx! };
}

describe("updateTransactionFromInput", () => {
  it("updates category, notes and exclusion", async () => {
    const { repo, tx } = await setup();
    const updated = await updateTransactionFromInput(repo, SAMPLE_USER.id, {
      transactionId: tx.id, categoryId: "cat_groceries", notes: "  split with Sam  ", excludedFromReports: true,
    }, now);
    expect(updated).toMatchObject({ categoryId: "cat_groceries", categorySource: "user", notes: "split with Sam", excludedFromReports: true, updatedAt: now });
    // Provider-owned fields untouched.
    expect(updated).toMatchObject({ amount: tx.amount, date: tx.date, originalDescription: tx.originalDescription, externalTransactionId: tx.externalTransactionId, accountId: tx.accountId });
  });

  it("rejects attempts to change provider-owned fields", async () => {
    const { repo, tx } = await setup();
    for (const extra of [{ amount: 1 }, { date: "2026-01-01" }, { externalTransactionId: "x" }, { accountId: "acct_000001" }, { originalDescription: "x" }, { userId: "someone-else" }]) {
      await expect(
        updateTransactionFromInput(repo, SAMPLE_USER.id, { transactionId: tx.id, categoryId: tx.categoryId, notes: null, excludedFromReports: false, ...extra }, now),
      ).rejects.toThrow(ValidationError);
    }
    expect(await repo.getTransaction(SAMPLE_USER.id, tx.id)).toEqual(tx);
  });

  it("empty notes become null; overly long notes are rejected", async () => {
    const { repo, tx } = await setup();
    const cleared = await updateTransactionFromInput(repo, SAMPLE_USER.id, { transactionId: tx.id, categoryId: tx.categoryId, notes: "   ", excludedFromReports: false }, now);
    expect(cleared.notes).toBeNull();
    expect(cleared.categorySource).toBe("rule"); // unchanged category keeps its source
    await expect(
      updateTransactionFromInput(repo, SAMPLE_USER.id, { transactionId: tx.id, categoryId: null, notes: "x".repeat(1001), excludedFromReports: false }, now),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects unknown categories", async () => {
    const { repo, tx } = await setup();
    await expect(
      updateTransactionFromInput(repo, SAMPLE_USER.id, { transactionId: tx.id, categoryId: "cat_nope", notes: null, excludedFromReports: false }, now),
    ).rejects.toThrow(ValidationError);
  });

  it("another user cannot see or edit the sample user's transactions", async () => {
    const { repo, tx } = await setup();
    repo.seedUser({ id: "intruder", displayName: "Intruder" });
    await expect(
      updateTransactionFromInput(repo, "intruder", { transactionId: tx.id, categoryId: null, notes: "pwned", excludedFromReports: true }, now),
    ).rejects.toThrow(NotFoundError);
    expect(await repo.listTransactions("intruder")).toEqual([]);
    expect(await repo.listAccounts("intruder")).toEqual([]);
    expect(await repo.getTransaction("intruder", tx.id)).toBeNull();
  });
});

describe("parseTransactionFilters", () => {
  it("parses valid params and drops invalid ones", () => {
    expect(parseTransactionFilters({ account: "acct_000001", q: " coffee ", from: "2026-09-01", to: "not-a-date", category: ["cat_coffee", "x"] })).toEqual({
      accountId: "acct_000001", categoryId: "cat_coffee", search: "coffee", startDate: "2026-09-01", endDate: undefined,
    });
    expect(parseTransactionFilters({ account: "'; drop table--" }).accountId).toBeUndefined();
    expect(parseTransactionFilters({})).toEqual({ accountId: undefined, categoryId: undefined, search: undefined, startDate: undefined, endDate: undefined });
  });
});

describe("setTransactionSplitsFromInput", () => {
  async function loanPayment() {
    const repo = await createSampleRepository();
    const [tx] = await repo.listTransactions(SAMPLE_USER.id, { search: "NORTHWIND AUTO FIN PMT" });
    return { repo, tx: tx! }; // -$389.00 from checking
  }

  it("splits a payment into principal and interest without changing the amount", async () => {
    const { repo, tx } = await loanPayment();
    const updated = await setTransactionSplitsFromInput(repo, SAMPLE_USER.id, {
      transactionId: tx.id,
      splits: [{ amount: -30_647, categoryId: "cat_loan_payment" }, { amount: -8_253, categoryId: "cat_interest_fees" }],
    }, now);
    expect(updated.amount).toBe(tx.amount);
    expect(updated.splits).toHaveLength(2);
    // Clearing restores the unsplit state.
    expect((await setTransactionSplitsFromInput(repo, SAMPLE_USER.id, { transactionId: tx.id, splits: [] }, now)).splits).toEqual([]);
  });

  it("rejects unbalanced, fractional, cross-user and over-posted input", async () => {
    const { repo, tx } = await loanPayment();
    const attempt = (input: unknown, userId = SAMPLE_USER.id) => setTransactionSplitsFromInput(repo, userId, input, now);
    await expect(attempt({ transactionId: tx.id, splits: [{ amount: -30_000, categoryId: null }, { amount: -8_000, categoryId: null }] })).rejects.toThrow(ValidationError);
    await expect(attempt({ transactionId: tx.id, splits: [{ amount: -30_647.5, categoryId: null }, { amount: -8_252.5, categoryId: null }] })).rejects.toThrow(ValidationError);
    await expect(attempt({ transactionId: tx.id, splits: [{ amount: -38_900, categoryId: null }] })).rejects.toThrow(ValidationError);
    await expect(attempt({ transactionId: tx.id, splits: [{ amount: -1, categoryId: "cat_nope" }, { amount: -38_899, categoryId: null }] })).rejects.toThrow(ValidationError);
    await expect(attempt({ transactionId: tx.id, amount: 1, splits: [] })).rejects.toThrow(ValidationError);
    repo.seedUser({ id: "intruder", displayName: "Intruder" });
    await expect(attempt({ transactionId: tx.id, splits: [] }, "intruder")).rejects.toThrow(NotFoundError);
    expect((await repo.getTransaction(SAMPLE_USER.id, tx.id))!.splits).toEqual([]);
  });
});
