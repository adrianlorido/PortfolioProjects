import type { z } from "zod";
import {
  type Account,
  type FinancialConnection,
  type Id,
  type IsoDateTime,
  type ProviderOwnedTransactionField,
  TRANSACTION_FIELD_OWNERSHIP,
  type Transaction,
} from "@/domain/models";
import type { FinanceReadRepository, IngestionRepository } from "@/db/repository";
import type {
  FinancialDataProvider,
  NormalizedAccount,
  NormalizedTransaction,
  RemovedTransactionRef,
  TransactionSyncPage,
} from "@/integrations/provider";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { findCategoryForTransaction } from "@/modules/categories/rules";
import { type Money, money, sum } from "@/modules/finance/money";
import {
  describeZodError,
  normalizedAccountSchema,
  normalizedBalanceSchema,
  normalizedTransactionSchema,
  removedTransactionSchema,
} from "./normalized-schemas";

/**
 * Provider -> domain ingestion. Idempotent by construction:
 *   - connections are keyed on (user, provider, providerConnectionId)
 *   - accounts on (connection, externalAccountId)
 *   - transactions on (account, externalTransactionId)
 *   - balance snapshots on (account, date)
 * Replaying the same provider data any number of times converges to the same state.
 *
 * Order of work: FETCH every page -> VALIDATE every record -> WRITE. Nothing is written if any
 * record is invalid, and the cursor only advances after all writes. (A database-backed
 * repository must additionally wrap the write phase in one transaction.)
 *
 * Field ownership follows TRANSACTION_FIELD_OWNERSHIP: provider fields are refreshed on every
 * sync; user fields are never overwritten by a re-sync. Two documented exceptions:
 *   - pending -> posted: user fields are CARRIED OVER from the pending row to its posted
 *     replacement (when the provider links them via pendingExternalTransactionId);
 *   - if the provider changes the amount of a split transaction so the splits no longer sum
 *     to it, the splits are cleared (they would otherwise misstate reports).
 */

export interface SyncDeps {
  repo: IngestionRepository & Pick<FinanceReadRepository, "listCategoryRules" | "listCategories">;
  provider: FinancialDataProvider;
  now: () => IsoDateTime;
}

export interface SyncResult {
  connectionId: Id;
  accounts: { inserted: number; updated: number };
  transactions: {
    inserted: number;
    updated: number;
    unchanged: number;
    removed: number;
    /** Pending rows deleted because their posted replacement arrived. */
    replacedPending: number;
    /** Split transactions whose splits were cleared because the provider changed the amount. */
    splitsCleared: number;
  };
  snapshots: number;
}

const MAX_SYNC_PAGES = 1_000;

const PROVIDER_FIELDS: readonly ProviderOwnedTransactionField[] = TRANSACTION_FIELD_OWNERSHIP.provider;

export async function connectInstitution(deps: SyncDeps, userId: Id, publicToken: string): Promise<FinancialConnection> {
  const { providerConnectionId, institutionName } = await deps.provider.connectInstitution({ userId, publicToken });
  const existing = await deps.repo.findConnection(userId, deps.provider.provider, providerConnectionId);
  if (existing) return existing; // reconnecting the same institution is a no-op
  const now = deps.now();
  const connection: FinancialConnection = {
    id: deps.repo.newId("conn"),
    userId,
    provider: deps.provider.provider,
    providerConnectionId,
    institutionName,
    status: "active",
    syncCursor: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await deps.repo.saveConnection(connection);
  return connection;
}

function validateAll<T>(schema: z.ZodType<T>, records: readonly unknown[], label: string): T[] {
  return records.map((record, index) => {
    const parsed = schema.safeParse(record);
    if (!parsed.success) throw new ValidationError(`Invalid ${label} #${index} from provider: ${describeZodError(parsed.error)}`);
    return parsed.data;
  });
}

export async function syncConnection(deps: SyncDeps, userId: Id, connectionId: Id): Promise<SyncResult> {
  const { repo, provider } = deps;
  const connection = await repo.getConnection(userId, connectionId);
  if (!connection) throw new NotFoundError("Connection");
  if (connection.provider !== provider.provider) throw new ValidationError("Provider mismatch for connection");
  const ref = { connectionId: connection.id, providerConnectionId: connection.providerConnectionId };
  const now = deps.now();

  // ---- 1. Fetch (no writes) ---------------------------------------------------------------
  const rawAccounts = await provider.getAccounts(ref);
  const pages: TransactionSyncPage[] = [];
  let cursor = connection.syncCursor;
  for (;;) {
    if (pages.length >= MAX_SYNC_PAGES) throw new Error("Sync did not terminate: too many pages");
    const page = await provider.syncTransactions(ref, cursor);
    pages.push(page);
    cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  const rawBalances = await provider.getBalances(ref);

  // ---- 2. Validate everything before writing anything ------------------------------------
  // (After schema validation every amount is a proven safe integer, so the casts to the
  // branded Money-bearing types below are sound.)
  const accounts = validateAll(normalizedAccountSchema, rawAccounts, "account") as NormalizedAccount[];
  const upserts = validateAll(
    normalizedTransactionSchema,
    pages.flatMap((p) => [...p.added, ...p.modified]),
    "transaction",
  ) as NormalizedTransaction[];
  const removals = validateAll(removedTransactionSchema, pages.flatMap((p) => p.removed), "removal") as RemovedTransactionRef[];
  const balances = validateAll(normalizedBalanceSchema, rawBalances, "balance");

  const normalizedAccountById = new Map(accounts.map((a) => [a.externalAccountId, a]));
  if (normalizedAccountById.size !== accounts.length) throw new ValidationError("Provider returned duplicate accounts");
  const requireAccount = (externalAccountId: string) => {
    const account = normalizedAccountById.get(externalAccountId);
    if (!account) throw new ValidationError(`Provider returned data for unknown account ${externalAccountId}`);
    return account;
  };
  for (const t of upserts) {
    if (t.currency !== requireAccount(t.externalAccountId).currency) {
      throw new ValidationError(`Transaction ${t.externalTransactionId} currency differs from its account`);
    }
  }
  for (const r of removals) requireAccount(r.externalAccountId);
  for (const b of balances) requireAccount(b.externalAccountId);

  const existingAccounts = new Map<string, Account | null>();
  for (const a of accounts) {
    const existing = await repo.findAccountByExternalId(userId, connection.id, a.externalAccountId);
    // A currency change would silently re-denominate every stored transaction and snapshot.
    if (existing && existing.currency !== a.currency) {
      throw new ValidationError(`Account ${a.externalAccountId} currency changed from ${existing.currency} to ${a.currency}`);
    }
    existingAccounts.set(a.externalAccountId, existing);
  }

  // ---- 3. Write ------------------------------------------------------------------------------
  const result: SyncResult = {
    connectionId,
    accounts: { inserted: 0, updated: 0 },
    transactions: { inserted: 0, updated: 0, unchanged: 0, removed: 0, replacedPending: 0, splitsCleared: 0 },
    snapshots: 0,
  };

  const accountByExternalId = new Map<string, Account>();
  for (const normalized of accounts) {
    const existing = existingAccounts.get(normalized.externalAccountId) ?? null;
    const account = mergeAccount(existing, normalized, { id: existing?.id ?? repo.newId("acct"), userId, connectionId: connection.id, now });
    await repo.saveAccount(account);
    accountByExternalId.set(normalized.externalAccountId, account);
    result.accounts[existing ? "updated" : "inserted"] += 1;
  }

  const [rules, categories] = await Promise.all([repo.listCategoryRules(userId), repo.listCategories(userId)]);
  const categoryIdBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  for (const normalized of upserts) {
    const account = accountByExternalId.get(normalized.externalAccountId)!;
    const existing = await repo.findTransactionByExternalId(userId, account.id, normalized.externalTransactionId);

    if (existing) {
      if (!providerFieldsChanged(existing, normalized)) {
        result.transactions.unchanged += 1;
        continue;
      }
      const updated: Transaction = { ...existing, ...providerFields(normalized), updatedAt: now };
      if (existing.splits.length > 0 && normalized.amount !== existing.amount) {
        updated.splits = [];
        result.transactions.splitsCleared += 1;
      }
      await repo.saveTransaction(updated);
      result.transactions.updated += 1;
      continue;
    }

    // New transaction. If it is the posted version of a pending row we hold, inherit the
    // pending row's user-owned fields and delete the pending row now (never both at once).
    let inherited: Pick<Transaction, "categoryId" | "categorySource" | "splits" | "notes" | "excludedFromReports"> | null = null;
    if (normalized.pendingExternalTransactionId) {
      const pendingRow = await repo.findTransactionByExternalId(userId, account.id, normalized.pendingExternalTransactionId);
      if (pendingRow) {
        inherited = {
          categoryId: pendingRow.categoryId,
          categorySource: pendingRow.categorySource,
          // Posted amounts can differ from pending (tips, FX); keep splits only if still exact.
          splits: sumOf(pendingRow.splits) === normalized.amount ? pendingRow.splits : [],
          notes: pendingRow.notes,
          excludedFromReports: pendingRow.excludedFromReports,
        };
        await repo.deleteTransaction(userId, pendingRow.id);
        result.transactions.replacedPending += 1;
      }
    }

    const classification = inherited ?? initialClassification(normalized);
    await repo.saveTransaction({
      id: repo.newId("txn"),
      userId,
      accountId: account.id,
      externalTransactionId: normalized.externalTransactionId,
      ...providerFields(normalized),
      ...classification,
      createdAt: now,
      updatedAt: now,
    });
    result.transactions.inserted += 1;
  }

  for (const removal of removals) {
    const account = accountByExternalId.get(removal.externalAccountId)!;
    const existing = await repo.findTransactionByExternalId(userId, account.id, removal.externalTransactionId);
    if (existing) {
      await repo.deleteTransaction(userId, existing.id);
      result.transactions.removed += 1;
    }
  }

  for (const balance of balances) {
    const account = accountByExternalId.get(balance.externalAccountId)!;
    await repo.saveBalanceSnapshot({
      userId,
      accountId: account.id,
      date: balance.date,
      balance: money(balance.balance),
      source: connection.provider === "sample" ? "sample" : "provider",
    });
    result.snapshots += 1;
  }

  await repo.saveConnection({ ...connection, syncCursor: cursor, lastSyncedAt: now, status: "active", updatedAt: now });
  return result;

  function initialClassification(t: NormalizedTransaction) {
    const ruleCategory = findCategoryForTransaction(rules, t);
    const hintCategory = t.categoryHint ? (categoryIdBySlug.get(t.categoryHint) ?? null) : null;
    const categoryId = ruleCategory ?? hintCategory;
    return {
      categoryId,
      categorySource: ruleCategory ? ("rule" as const) : hintCategory ? ("provider" as const) : ("none" as const),
      splits: [],
      notes: null,
      excludedFromReports: false,
    };
  }
}

function sumOf(splits: Transaction["splits"]): Money | null {
  return splits.length === 0 ? null : sum(splits.map((s) => s.amount));
}

function providerFields(t: NormalizedTransaction): Pick<Transaction, ProviderOwnedTransactionField> {
  return {
    date: t.date,
    merchantName: t.merchantName,
    originalDescription: t.originalDescription,
    amount: t.amount,
    currency: t.currency,
    pending: t.pending,
  };
}

function providerFieldsChanged(existing: Transaction, incoming: NormalizedTransaction): boolean {
  const next = providerFields(incoming);
  return PROVIDER_FIELDS.some((key) => existing[key] !== next[key]);
}

function mergeAccount(
  existing: Account | null,
  normalized: NormalizedAccount,
  ctx: { id: Id; userId: Id; connectionId: Id; now: IsoDateTime },
): Account {
  return {
    id: ctx.id,
    userId: ctx.userId,
    connectionId: ctx.connectionId,
    externalAccountId: normalized.externalAccountId,
    name: normalized.name,
    institutionName: normalized.institutionName,
    type: normalized.type,
    mask: normalized.mask,
    currency: normalized.currency,
    currentBalance: normalized.currentBalance,
    balanceAsOf: normalized.balanceAsOf,
    isHidden: existing?.isHidden ?? false,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  };
}
