/**
 * Sync lifecycle (review areas G and H), provider-boundary validation (area A.3) and
 * account-currency immutability. Uses a fresh repository with a single scripted account so
 * nothing from the sample dataset can mask a bug.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryFinanceRepository } from "@/db/in-memory-repository";
import { TRANSACTION_FIELD_OWNERSHIP, type Transaction } from "@/domain/models";
import type { FinancialDataProvider, NormalizedAccount, NormalizedTransaction, TransactionSyncPage } from "@/integrations/provider";
import { ValidationError } from "@/lib/errors";
import { buildDefaultTaxonomy, categoryIdFor } from "@/modules/categories/taxonomy";
import { calculateCashFlow } from "@/modules/finance/cash-flow";
import { type Money, money } from "@/modules/finance/money";
import { monthPeriod } from "@/modules/finance/period";
import { connectInstitution, syncConnection } from "./ingest";

const USER = "u1";
const NOW = "2026-09-28T12:00:00.000Z";
const now = () => NOW;
const SEPT = monthPeriod("2026-09");

const ACCOUNT: NormalizedAccount = {
  externalAccountId: "acc-1", name: "Checking", institutionName: "Test Bank", type: "checking",
  mask: "0001", currency: "USD", currentBalance: money(100_000), balanceAsOf: NOW,
};

/** A provider whose next sync returns whatever the test queues. */
class ScriptedProvider implements FinancialDataProvider {
  readonly provider = "sample" as const;
  accounts: NormalizedAccount[] = [ACCOUNT];
  private queue: TransactionSyncPage[][] = [];
  syncCalls = 0;
  /** Queue the pages returned by the NEXT syncConnection call. */
  next(...pages: Partial<TransactionSyncPage>[]) {
    this.queue.push(pages.map((p, i) => ({ added: [], modified: [], removed: [], nextCursor: `c${this.syncCalls}-${i}`, hasMore: i < pages.length - 1, ...p })));
  }
  private current: TransactionSyncPage[] = [];
  async connectInstitution() { return { providerConnectionId: "inst-1", institutionName: "Test Bank" }; }
  async getAccounts() {
    this.current = this.queue.shift() ?? [{ added: [], modified: [], removed: [], nextCursor: "empty", hasMore: false }];
    this.syncCalls += 1;
    return this.accounts;
  }
  async syncTransactions() { return this.current.shift()!; }
  async getBalances() { return []; }
}

const tx = (overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction => ({
  externalTransactionId: "A", externalAccountId: "acc-1", date: "2026-09-10", merchantName: "Whole Foods",
  originalDescription: "WHOLEFDS MKT #1", amount: money(-5_000), currency: "USD", pending: false, ...overrides,
});

let repo: InMemoryFinanceRepository;
let provider: ScriptedProvider;
let connectionId: string;
const sync = () => syncConnection({ repo, provider, now }, USER, connectionId);
const all = () => repo.listTransactions(USER);
const categories = () => repo.listCategories(USER);

beforeEach(async () => {
  repo = new InMemoryFinanceRepository();
  repo.seedUser({ id: USER, displayName: "Test" });
  const { groups, categories: cats } = buildDefaultTaxonomy(USER);
  repo.seedTaxonomy(groups, cats);
  repo.seedRules([{ id: "r1", userId: USER, categoryId: categoryIdFor("groceries"), matchField: "original_description", matchType: "contains", pattern: "WHOLEFDS", priority: 1, isActive: true }]);
  provider = new ScriptedProvider();
  connectionId = (await connectInstitution({ repo, provider, now }, USER, "x")).id;
});

// ---- H. Field ownership, idempotency and user edits ----------------------------------------
describe("field ownership (area H)", () => {
  it("every Transaction field is classified exactly once as provider-, user- or system-owned", () => {
    const sample: Transaction = {
      id: "t", userId: "u", accountId: "a", externalTransactionId: null, date: "2026-01-01", merchantName: "", originalDescription: "",
      amount: money(0), currency: "USD", pending: false, categoryId: null, categorySource: "none", splits: [], notes: null,
      excludedFromReports: false, createdAt: NOW, updatedAt: NOW,
    };
    const classified = [...TRANSACTION_FIELD_OWNERSHIP.provider, ...TRANSACTION_FIELD_OWNERSHIP.user, ...TRANSACTION_FIELD_OWNERSHIP.system];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(Object.keys(sample).sort());
  });
});

describe("idempotency and user edits (area H)", () => {
  it("the same import twice creates one transaction and reports it unchanged the second time", async () => {
    provider.next({ added: [tx()] });
    provider.next({ added: [tx()] }); // provider replays the same record
    expect((await sync()).transactions.inserted).toBe(1);
    const second = await sync();
    expect(second.transactions).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(await all()).toHaveLength(1);
  });

  it("re-sync after user edits: provider fields update, user fields (category, notes, excluded) survive", async () => {
    provider.next({ added: [tx()] });
    await sync();
    const [imported] = await all();
    expect(imported).toMatchObject({ categoryId: categoryIdFor("groceries"), categorySource: "rule", notes: null, excludedFromReports: false });

    await repo.updateTransactionUserFields(USER, imported!.id, { categoryId: categoryIdFor("restaurants"), notes: "team lunch", excludedFromReports: true }, NOW);

    const changed = tx({ date: "2026-09-11", merchantName: "Whole Foods Market", originalDescription: "WHOLEFDS MKT #1 SF", amount: money(-5_250) });
    provider.next({ modified: [changed] });
    expect((await sync()).transactions.updated).toBe(1);

    const [after] = await all();
    // provider-owned: updated
    expect(after).toMatchObject({ date: "2026-09-11", merchantName: "Whole Foods Market", originalDescription: "WHOLEFDS MKT #1 SF", amount: -5_250 });
    // user-owned: untouched
    expect(after).toMatchObject({ categoryId: categoryIdFor("restaurants"), categorySource: "user", notes: "team lunch", excludedFromReports: true });
    // system-owned: identity stable
    expect(after).toMatchObject({ id: imported!.id, externalTransactionId: "A", accountId: imported!.accountId, createdAt: imported!.createdAt });
  });

  it("rules run only at first import: a modified description never re-categorises", async () => {
    provider.next({ added: [tx({ originalDescription: "UNKNOWN MERCHANT" })] });
    await sync();
    expect((await all())[0]).toMatchObject({ categoryId: null, categorySource: "none" });
    provider.next({ modified: [tx({ originalDescription: "WHOLEFDS NOW MATCHES" })] });
    await sync();
    expect((await all())[0]).toMatchObject({ categoryId: null, categorySource: "none" });
  });

  it("provider removal deletes the transaction; replaying the removal is a no-op", async () => {
    provider.next({ added: [tx()] });
    await sync();
    provider.next({ removed: [{ externalAccountId: "acc-1", externalTransactionId: "A" }] });
    provider.next({ removed: [{ externalAccountId: "acc-1", externalTransactionId: "A" }] });
    expect((await sync()).transactions.removed).toBe(1);
    expect((await sync()).transactions.removed).toBe(0);
    expect(await all()).toEqual([]);
  });

  it("a provider amount change that invalidates the user's splits clears them (and says so)", async () => {
    provider.next({ added: [tx({ amount: money(-50_000), originalDescription: "NORTHWIND AUTO FIN PMT" })] });
    await sync();
    const [loanPayment] = await all();
    await repo.setTransactionSplits(USER, loanPayment!.id, [
      { amount: money(-42_000), categoryId: categoryIdFor("loan_payment") },
      { amount: money(-8_000), categoryId: categoryIdFor("interest_fees") },
    ], NOW);
    // Unrelated provider change (description only): splits kept.
    provider.next({ modified: [tx({ amount: money(-50_000), originalDescription: "NORTHWIND PMT" })] });
    expect((await sync()).transactions.splitsCleared).toBe(0);
    expect((await all())[0]!.splits).toHaveLength(2);
    // Amount change: splits no longer sum, so they are cleared rather than silently wrong.
    provider.next({ modified: [tx({ amount: money(-50_100), originalDescription: "NORTHWIND PMT" })] });
    expect((await sync()).transactions.splitsCleared).toBe(1);
    expect((await all())[0]!.splits).toEqual([]);
  });
});

// ---- G. Pending -> posted lifecycle ---------------------------------------------------------
describe("pending -> posted lifecycle (area G)", () => {
  const pending = tx({ externalTransactionId: "P", pending: true, amount: money(-5_000) });
  const posted = tx({ externalTransactionId: "Q", pending: false, amount: money(-5_250), pendingExternalTransactionId: "P" });

  const spending = async (includePending: boolean) => calculateCashFlow(await all(), await categories(), SEPT, { includePending }).spending;

  it("linked replacement: pending row is replaced in the same step, user edits carry over, counted once", async () => {
    provider.next({ added: [pending] });
    await sync();
    const [p] = await all();
    await repo.updateTransactionUserFields(USER, p!.id, { notes: "birthday dinner", categoryId: categoryIdFor("restaurants") }, NOW);
    expect(await spending(false)).toBe(0); // pending ignored by default
    expect(await spending(true)).toBe(5_000);

    // Posted version arrives; the pending removal arrives in a LATER sync (worst case ordering).
    provider.next({ added: [posted] });
    const result = await sync();
    expect(result.transactions).toMatchObject({ inserted: 1, replacedPending: 1 });
    const rows = await all();
    expect(rows).toHaveLength(1); // never both at once
    expect(rows[0]).toMatchObject({ externalTransactionId: "Q", pending: false, amount: -5_250, notes: "birthday dinner", categoryId: categoryIdFor("restaurants"), categorySource: "user" });
    expect(await spending(false)).toBe(5_250);
    expect(await spending(true)).toBe(5_250); // not 10_250

    provider.next({ removed: [{ externalAccountId: "acc-1", externalTransactionId: "P" }] });
    expect((await sync()).transactions.removed).toBe(0); // already gone: no-op
    expect(await all()).toHaveLength(1);
  });

  it("linked replacement and removal in the same batch", async () => {
    provider.next({ added: [pending] });
    await sync();
    provider.next({ added: [posted], removed: [{ externalAccountId: "acc-1", externalTransactionId: "P" }] });
    await sync();
    expect((await all()).map((t) => t.externalTransactionId)).toEqual(["Q"]);
  });

  it("across pages of one sync (removal on page 1, posted on page 2) nothing is double counted", async () => {
    provider.next({ added: [pending] });
    await sync();
    provider.next({ removed: [{ externalAccountId: "acc-1", externalTransactionId: "P" }] }, { added: [posted] });
    await sync();
    expect((await all()).map((t) => t.externalTransactionId)).toEqual(["Q"]);
    expect(await spending(true)).toBe(5_250);
  });

  it("unlinked provider (no pendingExternalTransactionId): removal + add leaves one row; default reports never double count", async () => {
    provider.next({ added: [pending] });
    await sync();
    provider.next({ added: [{ ...posted, pendingExternalTransactionId: null }] }); // removal delayed to next sync
    await sync();
    // Transient state: both rows exist. Default reports ignore pending, so still counted once.
    expect(await all()).toHaveLength(2);
    expect(await spending(false)).toBe(5_250);
    provider.next({ removed: [{ externalAccountId: "acc-1", externalTransactionId: "P" }] });
    await sync();
    expect(await all()).toHaveLength(1);
    expect(await spending(true)).toBe(5_250);
  });

  it("a pending record cannot claim to replace another pending record", async () => {
    provider.next({ added: [tx({ externalTransactionId: "P2", pending: true, pendingExternalTransactionId: "P" })] });
    await expect(sync()).rejects.toThrow(ValidationError);
  });
});

// ---- Provider hints -----------------------------------------------------------------------------
describe("category precedence at first import", () => {
  it("user rule > provider hint > none; unknown hint slugs are ignored", async () => {
    provider.next({
      added: [
        tx({ externalTransactionId: "rule-wins", originalDescription: "WHOLEFDS", categoryHint: "restaurants" }),
        tx({ externalTransactionId: "hint", originalDescription: "ACH DEBIT 99812", categoryHint: "credit_card_payment" }),
        tx({ externalTransactionId: "unknown-hint", originalDescription: "ACH DEBIT 1", categoryHint: "no_such_category" }),
      ],
    });
    await sync();
    const byId = Object.fromEntries((await all()).map((t) => [t.externalTransactionId, t]));
    expect(byId["rule-wins"]).toMatchObject({ categoryId: categoryIdFor("groceries"), categorySource: "rule" });
    // A card payment whose description matches no rule is still a transfer via the hint.
    expect(byId["hint"]).toMatchObject({ categoryId: categoryIdFor("credit_card_payment"), categorySource: "provider" });
    expect(byId["unknown-hint"]).toMatchObject({ categoryId: null, categorySource: "none" });
  });
});

// ---- Provider boundary validation -----------------------------------------------------------------
describe("provider records are validated before anything is written", () => {
  const bad: [string, Partial<NormalizedTransaction>][] = [
    ["fractional cents", { amount: 12.5 as Money }],
    ["NaN", { amount: Number.NaN as Money }],
    ["Infinity", { amount: Number.POSITIVE_INFINITY as Money }],
    ["unsafe integer", { amount: 2 ** 53 as Money }],
    ["impossible date", { date: "2026-02-31" }],
    ["timestamp instead of date", { date: "2026-09-10T00:00:00Z" }],
    ["lower-case currency", { currency: "usd" }],
    ["empty external id", { externalTransactionId: "" }],
    ["oversized description", { originalDescription: "x".repeat(501) }],
  ];
  for (const [label, override] of bad) {
    it(`rejects ${label} and writes nothing`, async () => {
      provider.next({ added: [tx({ externalTransactionId: "good" }), tx({ externalTransactionId: "bad", ...override })] });
      await expect(sync()).rejects.toThrow(ValidationError);
      expect(await all()).toEqual([]); // the valid record in the same batch was not written either
      expect((await repo.getConnection(USER, connectionId))!.syncCursor).toBeNull(); // cursor not advanced
    });
  }

  it("rejects a non-integer account balance", async () => {
    provider.accounts = [{ ...ACCOUNT, currentBalance: 100.5 as Money }];
    await expect(sync()).rejects.toThrow(ValidationError);
    expect(await repo.listAccounts(USER)).toEqual([]);
  });

  it("rejects an account whose currency changes between syncs", async () => {
    await sync();
    provider.accounts = [{ ...ACCOUNT, currency: "EUR" }];
    await expect(sync()).rejects.toThrow(/currency changed/);
    expect((await repo.listAccounts(USER))[0]!.currency).toBe("USD");
  });
});
