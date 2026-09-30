import type { Account, FinancialConnection, Id, IsoDateTime, Transaction } from "@/domain/models";
import type { FinanceReadRepository, IngestionRepository } from "@/db/repository";
import type { FinancialDataProvider, NormalizedAccount, NormalizedTransaction } from "@/integrations/provider";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { findCategoryForTransaction } from "@/modules/categories/rules";

/**
 * Provider -> domain ingestion. Idempotent by construction:
 *   - connections are keyed on (user, provider, providerConnectionId)
 *   - accounts on (connection, externalAccountId)
 *   - transactions on (account, externalTransactionId)
 *   - balance snapshots on (account, date)
 * Replaying the same provider data any number of times converges to the same state.
 *
 * Provider-owned fields are refreshed on every sync; user-owned fields (category when set
 * by the user, notes, excludedFromReports, account.isHidden) are never overwritten.
 */

export interface SyncDeps {
  repo: IngestionRepository & Pick<FinanceReadRepository, "listCategoryRules">;
  provider: FinancialDataProvider;
  now: () => IsoDateTime;
}

export interface SyncResult {
  connectionId: Id;
  accounts: { inserted: number; updated: number };
  transactions: { inserted: number; updated: number; unchanged: number; removed: number };
  snapshots: number;
}

const MAX_SYNC_PAGES = 1_000;

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

export async function syncConnection(deps: SyncDeps, userId: Id, connectionId: Id): Promise<SyncResult> {
  const { repo, provider } = deps;
  const connection = await repo.getConnection(userId, connectionId);
  if (!connection) throw new NotFoundError("Connection");
  if (connection.provider !== provider.provider) throw new ValidationError("Provider mismatch for connection");
  const ref = { connectionId: connection.id, providerConnectionId: connection.providerConnectionId };
  const now = deps.now();
  const result: SyncResult = {
    connectionId,
    accounts: { inserted: 0, updated: 0 },
    transactions: { inserted: 0, updated: 0, unchanged: 0, removed: 0 },
    snapshots: 0,
  };

  // 1. Accounts
  const accountsByExternalId = new Map<string, Account>();
  for (const normalized of await provider.getAccounts(ref)) {
    const existing = await repo.findAccountByExternalId(userId, connection.id, normalized.externalAccountId);
    const account = mergeAccount(existing, normalized, { id: existing?.id ?? repo.newId("acct"), userId, connectionId: connection.id, now });
    await repo.saveAccount(account);
    accountsByExternalId.set(normalized.externalAccountId, account);
    result.accounts[existing ? "updated" : "inserted"] += 1;
  }
  const accountFor = (externalAccountId: string) => {
    const account = accountsByExternalId.get(externalAccountId);
    if (!account) throw new ValidationError(`Provider returned data for unknown account ${externalAccountId}`);
    return account;
  };

  // 2. Transactions (cursor-paged)
  const rules = await repo.listCategoryRules(userId);
  let cursor = connection.syncCursor;
  for (let page = 0; ; page++) {
    if (page >= MAX_SYNC_PAGES) throw new Error("Sync did not terminate: too many pages");
    const batch = await provider.syncTransactions(ref, cursor);
    for (const normalized of [...batch.added, ...batch.modified]) {
      const account = accountFor(normalized.externalAccountId);
      if (normalized.currency !== account.currency) throw new ValidationError("Transaction currency differs from account currency");
      const existing = await repo.findTransactionByExternalId(userId, account.id, normalized.externalTransactionId);
      if (!existing) {
        const categoryId = findCategoryForTransaction(rules, normalized);
        await repo.saveTransaction({
          id: repo.newId("txn"),
          userId,
          accountId: account.id,
          externalTransactionId: normalized.externalTransactionId,
          ...providerFields(normalized),
          categoryId,
          categorySource: categoryId ? "rule" : "none",
          notes: null,
          excludedFromReports: false,
          createdAt: now,
          updatedAt: now,
        });
        result.transactions.inserted += 1;
      } else if (providerFieldsChanged(existing, normalized)) {
        await repo.saveTransaction({ ...existing, ...providerFields(normalized), updatedAt: now });
        result.transactions.updated += 1;
      } else {
        result.transactions.unchanged += 1;
      }
    }
    for (const removed of batch.removed) {
      const account = accountFor(removed.externalAccountId);
      const existing = await repo.findTransactionByExternalId(userId, account.id, removed.externalTransactionId);
      if (existing) {
        await repo.deleteTransaction(userId, existing.id);
        result.transactions.removed += 1;
      }
    }
    cursor = batch.nextCursor;
    if (!batch.hasMore) break;
  }

  // 3. Balance snapshots
  for (const balance of await provider.getBalances(ref)) {
    const account = accountFor(balance.externalAccountId);
    await repo.saveBalanceSnapshot({ userId, accountId: account.id, date: balance.date, balance: balance.balance, source: connection.provider === "sample" ? "sample" : "provider" });
    result.snapshots += 1;
  }

  await repo.saveConnection({ ...connection, syncCursor: cursor, lastSyncedAt: now, status: "active", updatedAt: now });
  return result;
}

function providerFields(t: NormalizedTransaction) {
  return {
    date: t.date,
    merchantName: t.merchantName,
    originalDescription: t.originalDescription,
    amount: t.amount,
    currency: t.currency,
    pending: t.pending,
  } satisfies Partial<Transaction>;
}

function providerFieldsChanged(existing: Transaction, incoming: NormalizedTransaction): boolean {
  const next = providerFields(incoming);
  return (Object.keys(next) as (keyof typeof next)[]).some((key) => existing[key] !== next[key]);
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
