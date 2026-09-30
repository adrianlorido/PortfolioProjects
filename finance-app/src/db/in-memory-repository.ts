import type {
  Account,
  BalanceSnapshot,
  Category,
  CategoryGroup,
  CategoryRule,
  FinancialConnection,
  Id,
  Provider,
  Transaction,
  TransactionUserEdits,
  User,
} from "@/domain/models";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  type TransactionFilters,
  compareTransactionsNewestFirst,
  matchesTransactionFilters,
} from "@/modules/transactions/filters";
import type { FinanceRepository, SnapshotQuery } from "./repository";

/**
 * In-memory implementation used by sample mode and tests.
 *
 * It mirrors the Postgres constraints that matter for correctness: per-user scoping (RLS),
 * unique (connection, external_account_id), unique (account, external_transaction_id),
 * unique (account, date) for snapshots, and category ownership checks (composite FKs).
 * All reads return copies so callers can't mutate stored state.
 */
export class InMemoryFinanceRepository implements FinanceRepository {
  private readonly users = new Map<Id, User>();
  private readonly connections = new Map<Id, FinancialConnection>();
  private readonly accounts = new Map<Id, Account>();
  private readonly groups = new Map<Id, CategoryGroup>();
  private readonly categories = new Map<Id, Category>();
  private readonly rules = new Map<Id, CategoryRule>();
  private readonly transactions = new Map<Id, Transaction>();
  private readonly snapshots = new Map<string, BalanceSnapshot>();
  private idCounter = 0;

  // ---- Seeding (sample bootstrap / tests) -----------------------------------------------

  seedUser(user: User): void {
    this.users.set(user.id, { ...user });
  }

  seedTaxonomy(groups: CategoryGroup[], categories: Category[]): void {
    for (const g of groups) this.groups.set(g.id, { ...g });
    for (const c of categories) {
      if (!this.groups.has(c.groupId)) throw new ValidationError(`Category ${c.id} references unknown group`);
      this.categories.set(c.id, { ...c });
    }
  }

  seedRules(rules: CategoryRule[]): void {
    for (const r of rules) {
      const category = this.categories.get(r.categoryId);
      if (!category || category.userId !== r.userId) throw new ValidationError(`Rule ${r.id} references unknown category`);
      this.rules.set(r.id, { ...r });
    }
  }

  // ---- Reads ------------------------------------------------------------------------------

  async getUser(userId: Id) {
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  async listConnections(userId: Id) {
    return ownedBy(this.connections, userId);
  }

  async listAccounts(userId: Id) {
    return ownedBy(this.accounts, userId);
  }

  async getAccount(userId: Id, accountId: Id) {
    return ownedOne(this.accounts, userId, accountId);
  }

  async listCategoryGroups(userId: Id) {
    return ownedBy(this.groups, userId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listCategories(userId: Id) {
    return ownedBy(this.categories, userId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listCategoryRules(userId: Id) {
    return ownedBy(this.rules, userId).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  async listTransactions(userId: Id, filters: TransactionFilters = {}) {
    return ownedBy(this.transactions, userId)
      .filter((tx) => matchesTransactionFilters(tx, filters))
      .sort(compareTransactionsNewestFirst);
  }

  async getTransaction(userId: Id, transactionId: Id) {
    return ownedOne(this.transactions, userId, transactionId);
  }

  async listBalanceSnapshots(userId: Id, query: SnapshotQuery = {}) {
    return ownedBy(this.snapshots, userId)
      .filter(
        (s) =>
          (!query.accountId || s.accountId === query.accountId) &&
          (!query.startDate || s.date >= query.startDate) &&
          (!query.endDate || s.date <= query.endDate),
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId));
  }

  // ---- User edits -------------------------------------------------------------------------

  async updateTransactionUserFields(userId: Id, transactionId: Id, edits: TransactionUserEdits, now: string) {
    const existing = this.transactions.get(transactionId);
    if (!existing || existing.userId !== userId) throw new NotFoundError("Transaction");

    const updated: Transaction = { ...existing, updatedAt: now };
    if (edits.categoryId !== undefined && edits.categoryId !== existing.categoryId) {
      if (edits.categoryId !== null) {
        const category = this.categories.get(edits.categoryId);
        if (!category || category.userId !== userId) throw new ValidationError("Unknown category");
      }
      updated.categoryId = edits.categoryId;
      updated.categorySource = edits.categoryId === null ? "none" : "user";
    }
    if (edits.notes !== undefined) updated.notes = edits.notes;
    if (edits.excludedFromReports !== undefined) updated.excludedFromReports = edits.excludedFromReports;
    this.transactions.set(transactionId, updated);
    return { ...updated };
  }

  // ---- Ingestion ----------------------------------------------------------------------------

  newId(prefix: string): Id {
    this.idCounter += 1;
    return `${prefix}_${String(this.idCounter).padStart(6, "0")}`;
  }

  async findConnection(userId: Id, provider: Provider, providerConnectionId: string) {
    const found = [...this.connections.values()].find(
      (c) => c.userId === userId && c.provider === provider && c.providerConnectionId === providerConnectionId,
    );
    return found ? { ...found } : null;
  }

  async getConnection(userId: Id, connectionId: Id) {
    return ownedOne(this.connections, userId, connectionId);
  }

  async saveConnection(connection: FinancialConnection) {
    this.assertUser(connection.userId);
    this.connections.set(connection.id, { ...connection });
  }

  async findAccountByExternalId(userId: Id, connectionId: Id, externalAccountId: string) {
    const found = [...this.accounts.values()].find(
      (a) => a.userId === userId && a.connectionId === connectionId && a.externalAccountId === externalAccountId,
    );
    return found ? { ...found } : null;
  }

  async saveAccount(account: Account) {
    this.assertUser(account.userId);
    if (account.connectionId) {
      const connection = this.connections.get(account.connectionId);
      if (!connection || connection.userId !== account.userId) throw new ValidationError("Account references unknown connection");
    }
    const clash = [...this.accounts.values()].find(
      (a) =>
        a.id !== account.id &&
        a.connectionId === account.connectionId &&
        account.externalAccountId !== null &&
        a.externalAccountId === account.externalAccountId,
    );
    if (clash) throw new ValidationError("Duplicate (connection, external_account_id)");
    this.accounts.set(account.id, { ...account });
  }

  async findTransactionByExternalId(userId: Id, accountId: Id, externalTransactionId: string) {
    const found = [...this.transactions.values()].find(
      (t) => t.userId === userId && t.accountId === accountId && t.externalTransactionId === externalTransactionId,
    );
    return found ? { ...found } : null;
  }

  async saveTransaction(transaction: Transaction) {
    const account = this.accounts.get(transaction.accountId);
    if (!account || account.userId !== transaction.userId) throw new ValidationError("Transaction references unknown account");
    if (transaction.categoryId !== null) {
      const category = this.categories.get(transaction.categoryId);
      if (!category || category.userId !== transaction.userId) throw new ValidationError("Transaction references unknown category");
    }
    const existing = this.transactions.get(transaction.id);
    if (existing && (existing.externalTransactionId !== transaction.externalTransactionId || existing.accountId !== transaction.accountId)) {
      // Mirrors the database trigger: provider identity is immutable.
      throw new ValidationError("externalTransactionId and accountId are immutable");
    }
    const clash = [...this.transactions.values()].find(
      (t) =>
        t.id !== transaction.id &&
        t.accountId === transaction.accountId &&
        transaction.externalTransactionId !== null &&
        t.externalTransactionId === transaction.externalTransactionId,
    );
    if (clash) throw new ValidationError("Duplicate (account, external_transaction_id)");
    this.transactions.set(transaction.id, { ...transaction });
  }

  async deleteTransaction(userId: Id, transactionId: Id) {
    const existing = this.transactions.get(transactionId);
    if (existing && existing.userId === userId) this.transactions.delete(transactionId);
  }

  async saveBalanceSnapshot(snapshot: Omit<BalanceSnapshot, "id">) {
    const account = this.accounts.get(snapshot.accountId);
    if (!account || account.userId !== snapshot.userId) throw new ValidationError("Snapshot references unknown account");
    const key = `${snapshot.accountId}|${snapshot.date}`;
    const existing = this.snapshots.get(key);
    this.snapshots.set(key, { ...snapshot, id: existing?.id ?? this.newId("snap") });
  }

  private assertUser(userId: Id) {
    if (!this.users.has(userId)) throw new ValidationError("Unknown user");
  }
}

function ownedBy<T extends { userId: Id }>(map: Map<string, T>, userId: Id): T[] {
  return [...map.values()].filter((v) => v.userId === userId).map((v) => ({ ...v }));
}

function ownedOne<T extends { userId: Id }>(map: Map<string, T>, userId: Id, id: Id): T | null {
  const value = map.get(id);
  return value && value.userId === userId ? { ...value } : null;
}
