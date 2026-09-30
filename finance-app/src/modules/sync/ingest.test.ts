import { describe, expect, it } from "vitest";
import { SAMPLE_USER, createSampleRepository } from "@/db/sample-bootstrap";
import type { FinancialDataProvider, NormalizedTransaction, TransactionSyncPage } from "@/integrations/provider";
import { SAMPLE_AS_OF_TIMESTAMP } from "@/integrations/sample/dataset";
import { SampleFinancialDataProvider } from "@/integrations/sample/provider";
import { money } from "@/modules/finance/money";
import { connectInstitution, syncConnection } from "./ingest";

const userId = SAMPLE_USER.id;
const now = () => SAMPLE_AS_OF_TIMESTAMP;

async function snapshotState(repo: Awaited<ReturnType<typeof createSampleRepository>>) {
  return {
    accounts: await repo.listAccounts(userId),
    transactions: await repo.listTransactions(userId),
    snapshots: await repo.listBalanceSnapshots(userId),
  };
}

describe("syncConnection idempotency", () => {
  it("re-syncing with the stored cursor imports nothing new", async () => {
    const repo = await createSampleRepository();
    const before = await snapshotState(repo);
    const deps = { repo, provider: new SampleFinancialDataProvider(), now };
    for (const connection of await repo.listConnections(userId)) {
      const result = await syncConnection(deps, userId, connection.id);
      expect(result.transactions).toEqual({ inserted: 0, updated: 0, unchanged: 0, removed: 0, replacedPending: 0, splitsCleared: 0 });
    }
    expect(await snapshotState(repo)).toEqual(before);
  });

  it("a full replay (cursor reset) converges to the same state and keeps user edits", async () => {
    const repo = await createSampleRepository();
    const [target] = await repo.listTransactions(userId, { search: "NETFLIX" });
    await repo.updateTransactionUserFields(userId, target!.id, { categoryId: "cat_miscellaneous", notes: "shared with roommate" }, now());
    const before = await snapshotState(repo);

    const deps = { repo, provider: new SampleFinancialDataProvider(), now };
    for (const connection of await repo.listConnections(userId)) {
      await repo.saveConnection({ ...connection, syncCursor: null });
      const result = await syncConnection(deps, userId, connection.id);
      expect(result.transactions.inserted).toBe(0);
      expect(result.transactions.updated).toBe(0);
      expect(result.transactions.unchanged).toBeGreaterThan(0);
    }
    const after = await snapshotState(repo);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.snapshots).toEqual(before.snapshots);
    const edited = await repo.getTransaction(userId, target!.id);
    expect(edited).toMatchObject({ categoryId: "cat_miscellaneous", categorySource: "user", notes: "shared with roommate" });
  });

  it("connecting the same institution twice reuses the connection", async () => {
    const repo = await createSampleRepository();
    const deps = { repo, provider: new SampleFinancialDataProvider(), now };
    const [existing] = await repo.listConnections(userId);
    const again = await connectInstitution(deps, userId, existing!.providerConnectionId);
    expect(again.id).toBe(existing!.id);
    expect(await repo.listConnections(userId)).toHaveLength(4);
  });
});

describe("syncConnection updates and removals", () => {
  function scriptedProvider(pages: TransactionSyncPage[]): FinancialDataProvider {
    let call = 0;
    return {
      provider: "sample",
      connectInstitution: async () => ({ providerConnectionId: "inst-x", institutionName: "Test Bank" }),
      getAccounts: async () => [
        { externalAccountId: "acc-1", name: "Checking", institutionName: "Test Bank", type: "checking", mask: "0001", currency: "USD", currentBalance: money(100_00), balanceAsOf: now() },
      ],
      syncTransactions: async () => pages[Math.min(call++, pages.length - 1)]!,
      getBalances: async () => [{ externalAccountId: "acc-1", date: "2026-09-28", balance: money(100_00) }],
    };
  }
  const base: NormalizedTransaction = {
    externalTransactionId: "t-1", externalAccountId: "acc-1", date: "2026-09-27", merchantName: "Whole Foods",
    originalDescription: "WHOLEFDS MKT #1", amount: money(-45_00), currency: "USD", pending: true,
  };

  it("updates provider fields (pending -> posted, amount change) without touching user fields, then removes", async () => {
    const repo = await createSampleRepository();
    const provider = scriptedProvider([
      { added: [base], modified: [], removed: [], nextCursor: "1", hasMore: false },
      { added: [], modified: [{ ...base, pending: false, amount: money(-47_12) }], removed: [], nextCursor: "2", hasMore: false },
      { added: [], modified: [], removed: [{ externalAccountId: "acc-1", externalTransactionId: "t-1" }], nextCursor: "3", hasMore: false },
    ]);
    const deps = { repo, provider, now };
    const connection = await connectInstitution(deps, userId, "anything");

    await syncConnection(deps, userId, connection.id);
    const [inserted] = await repo.listTransactions(userId, { search: "WHOLEFDS MKT #1" });
    expect(inserted).toMatchObject({ pending: true, categoryId: "cat_groceries", categorySource: "rule" });
    await repo.updateTransactionUserFields(userId, inserted!.id, { notes: "team lunch", excludedFromReports: true }, now());

    const second = await syncConnection(deps, userId, connection.id);
    expect(second.transactions.updated).toBe(1);
    const updated = await repo.getTransaction(userId, inserted!.id);
    expect(updated).toMatchObject({ pending: false, amount: -4712, notes: "team lunch", excludedFromReports: true, externalTransactionId: "t-1" });

    const third = await syncConnection(deps, userId, connection.id);
    expect(third.transactions.removed).toBe(1);
    expect(await repo.getTransaction(userId, inserted!.id)).toBeNull();
  });

  it("rejects provider data for accounts the provider didn't list", async () => {
    const repo = await createSampleRepository();
    const provider = scriptedProvider([
      { added: [{ ...base, externalAccountId: "acc-unknown" }], modified: [], removed: [], nextCursor: "1", hasMore: false },
    ]);
    const deps = { repo, provider, now };
    const connection = await connectInstitution(deps, userId, "anything");
    await expect(syncConnection(deps, userId, connection.id)).rejects.toThrow(/unknown account/);
  });
});
